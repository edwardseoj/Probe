/**
 * The verdict module owns verdict derivation AND the verdict -> exit-code
 * mapping (ADR-0001). No check ever sets an exit code; the CLI asks this
 * module. Verdict line copy lives in the presenter (output.ts), never here.
 */

import { isCompleted } from "./check.js";
import type { CheckResult } from "./check.js";

export type Verdict = "Healthy" | "Degraded" | "Unreachable";

const EXIT_CODES: Record<Verdict, 0 | 1 | 2> = {
  Healthy: 0,
  Degraded: 1,
  Unreachable: 2,
};

/**
 * Shared verdict derivation over a run's check results (ticket #6 owns the
 * semantics; other tickets call this, never hand-roll a verdict):
 *
 * - zero completed checks -> Unreachable: no completed evidence of a live
 *   Target to grade (faults and skips are not completed evidence).
 * - any failed completed check -> Degraded.
 * - any skip or fault alongside completed checks -> Degraded: incomplete
 *   evidence cannot yield full confidence (skips are not failures).
 * - everything completed passing -> Healthy.
 *
 * Latency never gates the verdict (it is a Fact, not a check outcome).
 */
export function deriveVerdict(checks: readonly CheckResult[]): Verdict {
  const completed = checks.filter(isCompleted);
  if (completed.length === 0) {
    return "Unreachable";
  }
  const anyFailed = completed.some((check) => !check.passed);
  const anyIncomplete = completed.length !== checks.length;
  if (anyFailed || anyIncomplete) {
    return "Degraded";
  }
  return "Healthy";
}

export function exitCodeFor(verdict: Verdict): 0 | 1 | 2 {
  return EXIT_CODES[verdict];
}
