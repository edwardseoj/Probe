/**
 * run(target, options) -> RunResult is the orchestrator seam: Target +
 * options in, verdict/checks out. The network is injected behind a single
 * fetch-like boundary (default wraps undici's fetch). No check ever sets an
 * exit code; the verdict module owns verdict derivation and the verdict ->
 * exit mapping (ADR-0001).
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

/**
 * A single unit of network work over the shared budget clock. The check
 * performs its fetches against `signal`; returning a CheckResult grades it.
 * Tickets adding checks to the epic register them here as sequenced steps.
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
  const doFetch: FetchLike =
    options.fetchImpl ??
    ((input, init) =>
      undiciFetch(input, init).then(async (res) => ({
        status: res.status,
        statusText: res.statusText,
        body: await res.text(),
      })));

  const budgetSignal = AbortSignal.timeout(budgetSeconds * 1000);

  // The root response grades multiple checks (Reachable, Content sanity),
  // so the root fetch is its own step and later steps consume the shared
  // evidence instead of re-touching the network.
  let rootResponse: HttpResponse | undefined;

  const steps: CheckStep[] = [
    {
      name: "Reachable",
      perform: async () => {
        rootResponse = await doFetch(target, { signal: budgetSignal });
        return reachableCheck(rootResponse);
      },
    },
    {
      name: "Content sanity",
      perform: async () => contentSanityCheck(rootResponse as HttpResponse),
    },
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
      if (!check.passed) {
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

  return { target: target, verdict: deriveVerdict(checks), checks: checks };
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
