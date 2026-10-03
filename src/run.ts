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
import { pointCheck } from "./checks/point.js";
import type { Verdict } from "./verdict.js";

export type { Verdict } from "./verdict.js";
export { exitCodeFor } from "./verdict.js";

export interface RunOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutSeconds?: number;
  /** Health paths from repeatable --path; one Point check per path. */
  readonly paths?: readonly string[];
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<HttpResponse>;

export interface RunResult {
  readonly target: string;
  readonly verdict: Verdict;
  readonly checks: readonly CheckResult[];
}

const DEFAULT_BUDGET_SECONDS = 10;

export async function run(
  target: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const budgetSeconds = options.timeoutSeconds ?? DEFAULT_BUDGET_SECONDS;
  const doFetch: FetchLike =
    options.fetchImpl ??
    ((input, init) =>
      undiciFetch(input, init).then((res) => ({
        status: res.status,
        statusText: res.statusText,
      })));

  const budgetSignal = AbortSignal.timeout(budgetSeconds * 1000);

  let response: HttpResponse;
  try {
    response = await doFetch(target, { signal: budgetSignal });
  } catch (error) {
    return faultResult(target, error);
  }

  const rootCheck = reachableCheck(response);
  const checks: CheckResult[] = [rootCheck];

  for (const path of options.paths ?? []) {
    checks.push(await pointCheckResult(`${target}${path}`, path, doFetch, budgetSignal));
  }

  // Skips are not failures; a failing check (or skip) degrades the verdict.
  // T6 owns the shared deriveVerdict helper; until its shape lands on this
  // branch, the derivation stays inline with the same semantics.
  const verdict: Verdict = checks.every((c) => c.passed) ? "Healthy" : "Degraded";
  return { target: target, verdict: verdict, checks: checks };
}

/**
 * One point check per path through the same fetch seam and the same
 * budget signal as the root check. A root failure means the target never
 * resolved, so no point check runs — they need a live target to mean
 * anything (skip machinery is T6's; the fault side expresses the minimal
 * skip shape here).
 */
async function pointCheckResult(
  url: string,
  path: string,
  doFetch: FetchLike,
  budgetSignal: AbortSignal,
): Promise<CheckResult> {
  try {
    const response = await doFetch(url, { signal: budgetSignal });
    return pointCheck(response, path);
  } catch {
    return {
      name: `Point check ${path}`,
      passed: false,
      skipped: true,
      skipReason: "run budget exhausted",
    };
  }
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
