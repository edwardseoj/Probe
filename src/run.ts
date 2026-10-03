/**
 * run(target, options) -> RunResult is the orchestrator seam: Target +
 * options in, verdict/checks out. The network is injected behind a single
 * fetch-like boundary (default wraps undici's fetch). No check ever sets an
 * exit code; the verdict module owns the verdict -> exit mapping (ADR-0001).
 * Run budget bounds the network call via an abort signal; abort maps to
 * Unreachable (the Target never answered).
 */

import { fetch as undiciFetch } from "undici";
import { reachableCheck } from "./checks/reachable.js";
import type { HttpResponse, CheckResult } from "./checks/reachable.js";
import type { Verdict } from "./verdict.js";

export type { Verdict } from "./verdict.js";
export { exitCodeFor } from "./verdict.js";

export interface RunOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutSeconds?: number;
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<HttpResponse>;

/**
 * A Fact: a reported value from a Run that never affects the Verdict
 * (latency, HTTP version, Server header, later the redirect chain).
 */
export interface Fact {
  readonly name: string;
  readonly value: string;
}

export interface RunResult {
  readonly target: string;
  readonly verdict: Verdict;
  readonly checks: readonly CheckResult[];
  /** Present on every completed run (a response answered); absent on faults. */
  readonly facts?: readonly Fact[];
}

const DEFAULT_BUDGET_SECONDS = 10;

/**
 * Latency adjective thresholds — a non-contract tunable (SPEC "Contract
 * stability"): they shape the Fact's value copy only, never the Verdict.
 */
const FAST_MS = 300;
const OK_MS = 1000;

export async function run(
  target: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const budgetSeconds = options.timeoutSeconds ?? DEFAULT_BUDGET_SECONDS;
  const doFetch: FetchLike =
    options.fetchImpl ??
    ((input, init) =>
      undiciFetch(input, init).then(async (res) => ({
        status: res.status,
        statusText: res.statusText,
        httpVersion: "httpVersion" in res ? String(res.httpVersion) : undefined,
        headers: res.headers,
        body: await res.text(),
      })));

  const budgetSignal = AbortSignal.timeout(budgetSeconds * 1000);

  let response: HttpResponse;
  try {
    const startedAt = performance.now();
    response = await doFetch(target, { signal: budgetSignal });
    response = { ...response, elapsedMs: response.elapsedMs ?? performance.now() - startedAt };
  } catch (error) {
    return faultResult(target, error);
  }

  const check = reachableCheck(response);
  const verdict: Verdict = check.passed ? "Healthy" : "Degraded";
  return {
    target: target,
    verdict: verdict,
    checks: [check],
    facts: factsFor(response),
  };
}

/**
 * Facts from a completed response. Response time is always present (latency is
 * a Fact, never a check); HTTP version and the Server header appear only when
 * the seam captured them.
 */
function factsFor(response: HttpResponse): Fact[] {
  const facts: Fact[] = [];
  const elapsedMs = Math.round(response.elapsedMs ?? 0);
  facts.push({
    name: "Response time",
    value: `${elapsedMs} ms (${latencyAdjective(elapsedMs)})`,
  });

  if (response.httpVersion !== undefined) {
    facts.push({ name: "HTTP version", value: response.httpVersion });
  }

  const server = response.headers?.get("server");
  if (server !== null && server !== undefined && server !== "") {
    facts.push({ name: "Server", value: server });
  }

  return facts;
}

function latencyAdjective(elapsedMs: number): "fast" | "ok" | "slow" {
  if (elapsedMs < FAST_MS) {
    return "fast";
  }
  if (elapsedMs < OK_MS) {
    return "ok";
  }
  return "slow";
}

function faultResult(target: string, error: unknown): RunResult {
  const check: CheckResult = {
    name: "Reachable",
    passed: false,
    diagnosis: faultDiagnosis(error),
  };
  return { target: target, verdict: "Unreachable", checks: [check] };
}

function faultDiagnosis(error: unknown): string {
  const cause =
    error instanceof Error && "cause" in error
      ? (error.cause as { code?: string; name?: string; message?: string })
      : undefined;
  const name = error instanceof Error ? error.name : undefined;

  if (name === "AbortError" || cause?.name === "AbortError") {
    return "Request timed out";
  }
  if (name === "ConnectTimeoutError" || cause?.name === "ConnectTimeoutError") {
    return "Request timed out";
  }

  const code = (error as { code?: string })?.code ?? cause?.code;
  if (code === "ECONNREFUSED") {
    return "Connection refused";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return "DNS lookup failed";
  }

  return "Request failed";
}
