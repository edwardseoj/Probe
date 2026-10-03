/**
 * The verdict module owns the verdict -> exit-code mapping (ADR-0001).
 * No check ever sets an exit code; the CLI asks this module.
 * Verdict line copy lives in the presenter (output.ts), never here.
 */

export type Verdict = "Healthy" | "Degraded" | "Unreachable";

const EXIT_CODES: Record<Verdict, 0 | 1 | 2> = {
  Healthy: 0,
  Degraded: 1,
  Unreachable: 2,
};

export function exitCodeFor(verdict: Verdict): 0 | 1 | 2 {
  return EXIT_CODES[verdict];
}
