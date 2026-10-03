/**
 * run(target, options) -> RunResult is the orchestrator seam: Target +
 * options in, verdict/checks out. The network is injected behind a single
 * fetch-like boundary (default wraps undici's fetch) and the TLS probe
 * behind a tls-probe-like boundary (default runs node:tls out-of-band —
 * see checks/tls.ts). No check ever sets an exit code; the verdict module
 * owns verdict derivation and the verdict -> exit mapping (ADR-0001).
 *
 * Run budget: ONE shared clock (AbortSignal.timeout) bounds every network
 * touch. Checks run in dependency order over that clock; a check that never
 * produces evidence is announced (skipped/faulted), never failed and never
 * silent. Zero completed checks -> Unreachable.
 */

import { fetch as undiciFetch } from "undici";
import { reachableCheck } from "./checks/reachable.js";
import { contentSanityCheck } from "./checks/content-sanity.js";
import type { HttpResponse } from "./checks/reachable.js";
import {
  TLS_CHECK_NAME,
  tlsCheck,
  plainHttpTlsCheck,
  defaultTlsProbe,
} from "./checks/tls.js";
import type { TlsProbe } from "./checks/tls.js";
import { pointCheck } from "./checks/point.js";
import { skippedCheck, faultedCheck, isCompleted } from "./check.js";
import type { CheckResult } from "./check.js";
import { deriveVerdict } from "./verdict.js";
import type { Verdict } from "./verdict.js";

export type { Verdict } from "./verdict.js";
export { exitCodeFor, deriveVerdict } from "./verdict.js";
export { skippedCheck, faultedCheck, isCompleted } from "./check.js";
export type { CheckResult } from "./check.js";

export interface RunOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutSeconds?: number;
  readonly tlsProbe?: TlsProbe;
  /** Health paths from repeatable --path; one Point check per path. */
  readonly paths?: readonly string[];
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

/**
 * A single unit of network work over the shared budget clock. The check
 * performs its fetches/probes against `signal`; returning a CheckResult
 * grades it. Tickets adding checks to the epic register them here as
 * sequenced steps.
 */
interface CheckStep {
  readonly name: string;
  perform(signal: AbortSignal): Promise<CheckResult>;
}

export async function run(
  target: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const budgetSeconds = options.timeoutSeconds ?? DEFAULT_BUDGET_SECONDS;
  const budgetMs = budgetSeconds * 1000;
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

  const budgetSignal = AbortSignal.timeout(budgetMs);
  const startedAt = Date.now();

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    // Scheme validation is the CLI's job pre-network (usage error, exit 3);
    // run() defensively grades an unparseable Target like a fault, as before.
    targetUrl = null as unknown as URL;
  }

  // The root response grades multiple checks (Reachable, Content sanity,
  // Response-time Fact), so the root fetch is its own step and later steps
  // consume the shared evidence instead of re-touching the network.
  let rootResponse: HttpResponse | undefined;

  const steps: CheckStep[] = [
    {
      name: "Reachable",
      perform: async () => {
        if (targetUrl === null) {
          // Scheme validation is the CLI's job pre-network (usage error,
          // exit 3); run() defensively grades an unparseable Target as a
          // fault, as before.
          throw Object.assign(new Error("invalid target URL"), {
            code: "ERR_INVALID_URL",
          });
        }
        // Latency is a Fact, never a check: time the root fetch so the
        // Response-time Fact can report it (transport-provided elapsedMs
        // wins when the seam supplies one).
        const rootFetchStartedAt = performance.now();
        rootResponse = await doFetch(target, { signal: budgetSignal });
        rootResponse = {
          ...rootResponse,
          elapsedMs: rootResponse.elapsedMs ?? performance.now() - rootFetchStartedAt,
        };
        return reachableCheck(rootResponse);
      },
    },
    {
      name: TLS_CHECK_NAME,
      perform: async () => {
        // HTTPS/TLS (ticket #4): https Targets get one out-of-band TLS
        // probe graded shallowly (validity window + hostname, no chain
        // walking). TLS trouble degrades — it never maps to Unreachable,
        // so probe failures are graded here, never thrown. Plain-HTTP
        // Targets pass trivially with a note (pinned in checks/tls.ts).
        if (targetUrl !== null && targetUrl.protocol === "https:") {
          try {
            const cert = await (options.tlsProbe ?? defaultTlsProbe)({
              hostname: targetUrl.hostname,
              port: Number(targetUrl.port) || 443,
              timeoutMs: budgetMs - (Date.now() - startedAt),
            });
            return tlsCheck(cert);
          } catch (error) {
            return {
              name: TLS_CHECK_NAME,
              passed: false,
              diagnosis: probeFailureDiagnosis(error),
            };
          }
        }
        return plainHttpTlsCheck();
      },
    },
    {
      name: "Content sanity",
      perform: async () => contentSanityCheck(rootResponse as HttpResponse),
    },
    ...buildPointCheckSteps(target, options.paths ?? [], doFetch),
  ];

  const checks: CheckResult[] = [];
  let blocker = false;
  for (const step of steps) {
    if (blocker || budgetSignal.aborted) {
      checks.push(skippedCheck(step.name));
      continue;
    }
    try {
      const check = await step.perform(budgetSignal);
      checks.push(check);
      // Only a graded failure blocks the remaining steps; skipped and
      // faulted check results announce missing evidence without starving
      // later steps of their own turn.
      if (isCompleted(check) && !check.passed) {
        blocker = true;
      }
    } catch (error) {
      if (budgetExpired(budgetSignal, error)) {
        // Never blindly timed out into a failure: a budget-expired abort is
        // announced as skipped (zero completed checks then grade Unreachable
        // through the shared derivation).
        checks.push(skippedCheck(step.name));
      } else {
        checks.push(faultedCheck(step.name, faultDiagnosis(error)));
        blocker = true;
      }
    }
  }

  return {
    target: target,
    verdict: deriveVerdict(checks),
    checks: checks,
    // Facts attach only to completed runs (a root response answered);
    // faulted runs have no response to report values from.
    facts: rootResponse !== undefined ? factsFor(rootResponse) : undefined,
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

/**
 * One point check per path through the same fetch seam and the same
 * budget signal as the root check (ticket #5). A point-fetch fault never
 * grades Unreachable — the Target was proven reachable at the root — so
 * the fault is announced as a skipped check with a fault-appropriate
 * reason (skippedCheck's default reason is reserved for genuine budget
 * exhaustion).
 */
function buildPointCheckSteps(
  target: string,
  paths: readonly string[],
  doFetch: FetchLike,
): CheckStep[] {
  return paths.map((path) => ({
    name: `Point check ${path}`,
    perform: async (signal: AbortSignal) => {
      try {
        const response = await doFetch(`${target}${path}`, { signal: signal });
        return pointCheck(response, path);
      } catch (error) {
        const skipReason = budgetExpired(signal, error)
          ? undefined // genuine budget exhaustion: skippedCheck's default reason
          : faultDiagnosis(error);
        return skippedCheck(`Point check ${path}`, skipReason);
      }
    },
  }));
}

function probeFailureDiagnosis(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "TLS_PROBE_TIMEOUT") {
    return "TLS probe timed out";
  }
  return "TLS handshake failed";
}

/**
 * The run budget is the only abort source: a deadline abort (or an abort-
 * shaped rejection from the fetch boundary) means budget exhausted, not a
 * Target fault.
 */
function budgetExpired(signal: AbortSignal, error: unknown): boolean {
  if (signal.aborted) {
    return true;
  }
  const cause =
    error instanceof Error && "cause" in error
      ? (error.cause as { name?: string })
      : undefined;
  const name = error instanceof Error ? error.name : undefined;
  return name === "AbortError" || cause?.name === "AbortError";
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
