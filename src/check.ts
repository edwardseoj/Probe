/**
 * Shared check vocabulary infra (per DESIGN.md: flat src/ + checks/ as the
 * showcase surface). This module owns the CheckResult shape and the skip
 * factory other tickets reuse. A check never sets an exit code (ADR-0001);
 * verdict derivation lives in verdict.ts.
 *
 * Check dispositions:
 * - graded: passed true/false, with a Diagnosis on fail only.
 * - skipped: announced with a skip reason; never graded as failed (skips
 *   are not failures, ADR-0001).
 * - fault: the check never produced evidence to grade at all (network
 *   fault, budget-expired abort with nothing completed). Announced with a
 *   Diagnosis; the verdict grades the absence of evidence.
 */

export interface CheckResult {
  name: string;
  passed: boolean;
  /** The one-line Diagnosis when a graded check fails. Absent when passing. */
  diagnosis?: string;
  /** The check never ran because the run budget was exhausted (or a blocker failed). */
  skipped?: boolean;
  /** The check never produced evidence to grade: network fault / abort before an answer. */
  fault?: boolean;
  /** Machine-readable skip reason; presenter owns announcement copy. */
  skipReason?: string;
}

/**
 * Skip factory: the canonical way to announce a skipped check. Other checks
 * landing in the epic consume this instead of hand-rolling skip results.
 */
export function skippedCheck(name: string, skipReason = "run budget exhausted"): CheckResult {
  return {
    name: name,
    passed: false,
    skipped: true,
    skipReason: skipReason,
  };
}

/**
 * Fault factory: the check never completed — no evidence to grade.
 * Distinct from a skip (which implies remaining budget time existed) and
 * from a graded failure (which implies an answer was received and graded).
 */
export function faultedCheck(name: string, diagnosis: string): CheckResult {
  return {
    name: name,
    passed: false,
    fault: true,
    diagnosis: diagnosis,
  };
}

/**
 * True when the check was actually evaluated to a grade — neither skipped
 * nor faulted. Verdict derivation counts graded checks as completed evidence.
 */
export function isCompleted(check: CheckResult): boolean {
  return check.skipped !== true && check.fault !== true;
}
