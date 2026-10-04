/**
 * json.ts — the --json machine shape (ticket #9). SPEC "Output": --json is
 * the FULL shape — Verdict, Target, every Check with name/passed, every
 * Fact with its value, plus metadata. Nothing dropped: consumers may
 * derive minimal projections, never the reverse (never a metric backfill).
 *
 * The shape is a STABLE CONTRACT (SPEC "Contract stability", GitHub issue
 * #9): field names, the verdict vocabulary (Healthy/Degraded/Unreachable —
 * GLOSSARY terms, never "result"/"metric") and the exitCode are
 * version-breaking to change. Human copy is not here: no verdict copy, no
 * glyphs, no colors — plain machine output under process.stdout.
 */

import { exitCodeFor } from "./verdict.js";
import { isCompleted } from "./check.js";
import type { CheckResult } from "./check.js";
import type { RunResult } from "./run.js";

/** Self-describing, versioned envelope (stable contract). */
const SCHEMA = "probe/v1";

/**
 * Check disposition vocabulary (stable contract): distinguishes graded
 * checks (answered and graded) from skips (skips are not failures,
 * ADR-0001) and faults (no evidence to grade at all). The distinction must survive
 * serialization on every check in run order — a skipped check keeps
 * status "skipped", never collapses into plain passed:false.
 */
export type CheckStatus = "graded" | "skipped" | "fault";

export interface JsonCheck {
  name: string;
  passed: boolean;
  status: CheckStatus;
  diagnosis?: string;
  detail?: string;
  note?: string;
  skipReason?: string;
}

export interface JsonFact {
  name: string;
  value: string;
}

export interface RunJsonShape {
  schema: "probe/v1";
  target: string;
  verdict: "Healthy" | "Degraded" | "Unreachable";
  /** The verdict -> exit mapping via verdict.ts exitCodeFor (ADR-0001). */
  exitCode: 0 | 1 | 2;
  checks: JsonCheck[];
  /** Present whenever the run has Facts (completed runs); [] allowed. */
  facts?: readonly JsonFact[];
  metadata: RunMetadata;
}

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
  const status: CheckStatus = !isCompleted(check)
    ? check.skipped === true
      ? "skipped"
      : "fault"
    : "graded";
  const out: JsonCheck = { name: check.name, passed: check.passed, status };
  if (check.diagnosis !== undefined) out.diagnosis = check.diagnosis;
  if (check.detail !== undefined) out.detail = check.detail;
  if (check.note !== undefined) out.note = check.note;
  if (check.skipReason !== undefined) out.skipReason = check.skipReason;
  return out;
}
