/**
 * json.ts — the --json machine shape (ticket #9). SPEC "Output": --json is
 * the FULL shape — Verdict, Target, every Check with name/passed, every
 * Fact with its value, plus metadata. Nothing dropped: consumers may
 * derive minimal projections, never the reverse.
 *
 * The shape is a STABLE CONTRACT (SPEC "Contract stability", GitHub issue
 * #9): field names, the verdict vocabulary (Healthy/Degraded/Unreachable —
 * GLOSSARY terms) and the exitCode are version-breaking to change. Human
 * copy is not here: no verdict copy, no glyphs, no colors — plain machine
 * output under process.stdout.
 */

import { exitCodeFor } from "./verdict.js";
import { statusOf } from "./check.js";
import type { CheckStatus } from "./check.js";
import type { CheckResult } from "./check.js";
import type { Fact, RunResult, Verdict } from "./run.js";

/** Self-describing, versioned envelope (stable contract). */
const SCHEMA = "probe/v1";

/**
 * The machine-readable disposition of a serialized check: `status` is the
 * three-way vocabulary from check.ts (graded | skipped | fault). It — not
 * `passed` — is how a consumer tells a graded failure apart from announced
 * non-evidence.
 */
export type { CheckStatus };

/**
 * Skips are not failures (SPEC.md "Skips are not failures", ADR-0001), so a
 * check that was never graded must not read as one in this shape. There is
 * a grade to report ONLY when status is "graded":
 *
 * - `passed: true | false` — a graded outcome; consumers filter failures
 *   as `passed === false` (or `status === "graded" && passed === false`).
 * - `passed: null` — no grade exists (status "skipped" or "fault"): the
 *   check produced no evidence to grade, so it carries neither a pass nor
 *   a fail. A `passed === false` filter therefore never miscounts skips or
 *   faults as failures; use `status` for the full three-way split.
 *
 * The internal CheckResult shape (check.ts) is unchanged — this null
 * convention lives only in the JSON serialization layer.
 */
export interface JsonCheck {
  name: string;
  /** Boolean for graded checks; null when no grade exists (skipped/faulted). */
  passed: boolean | null;
  status: CheckStatus;
  diagnosis?: string;
  detail?: string;
  note?: string;
  skipReason?: string;
}

export interface RunJsonShape {
  /** The versioned envelope: always the SCHEMA constant's value. */
  schema: typeof SCHEMA;
  target: string;
  verdict: Verdict;
  /** The verdict -> exit mapping via verdict.ts exitCodeFor (ADR-0001). */
  exitCode: 0 | 1 | 2;
  checks: JsonCheck[];
  /** Present whenever the run has Facts (completed runs); [] allowed. */
  facts?: readonly Fact[];
  metadata: RunMetadata;
}

/**
 * Intentionally minimal (budgetSeconds only, ticket #9). Anything added
 * later is an additive, version-bearing change to the stable contract —
 * never speculative fields, never derived backfill.
 */
interface RunMetadata {
  budgetSeconds?: number;
}

/**
 * Build the machine shape from a RunResult. Pure: JSON.stringify happens
 * in cli.ts. Optional Check fields are omitted when absent — that's
 * slicing, not dropping; everything present on the RunResult survives.
 */
export function runResultJson(runResult: RunResult): RunJsonShape {
  return {
    schema: SCHEMA,
    target: runResult.target,
    verdict: runResult.verdict,
    exitCode: exitCodeFor(runResult.verdict),
    checks: runResult.checks.map(checkJson),
    ...(runResult.facts !== undefined ? { facts: runResult.facts } : {}),
    metadata: { budgetSeconds: runResult.budgetSeconds },
  };
}

function checkJson(check: CheckResult): JsonCheck {
  // The three-way disposition comes from the one shared derivation
  // (check.ts statusOf); the JSON layer only decides how `passed` reads.
  const status = statusOf(check);
  const out: JsonCheck = {
    name: check.name,
    passed: status === "graded" ? check.passed : null,
    status,
  };
  if (check.diagnosis !== undefined) out.diagnosis = check.diagnosis;
  if (check.detail !== undefined) out.detail = check.detail;
  if (check.note !== undefined) out.note = check.note;
  if (check.skipReason !== undefined) out.skipReason = check.skipReason;
  return out;
}
