/**
 * Presenter: RunResult -> terminal lines. Verdict line copy lives here,
 * never in the verdict module (which owns only the exit mapping). Colors are
 * semantic per BRAND.md; non-TTY drops color and keeps glyphs.
 */

import chalk from "chalk";
import type { RunResult, Fact } from "./run.js";
import type { CheckResult } from "./check.js";
import type { Verdict } from "./verdict.js";

const GLYPH_PASS = "✓";
const GLYPH_FAIL = "✖";
const GLYPH_SKIP = "-";

const VERDICT_COPY: Record<Verdict, (target: string) => string> = {
  Healthy: () => "Deployment looks healthy.",
  Degraded: () => "Deployment is degraded.",
  Unreachable: (target) => `Could not reach ${target}.`,
};

/**
 * Output tiers (ticket #8 owns this signature):
 * - default: check lines + verdict line. No Facts, no passing-check detail.
 * - verbose: default output + Facts + passing-check detail. Strictly opt-in.
 * - quiet: verdict line only. Exit codes are unaffected by the mode.
 */
export type OutputMode = "default" | "verbose" | "quiet";

export function renderRun(runResult: RunResult, mode: OutputMode = "default"): string {
  const lines: string[] = [];
  if (mode !== "quiet") {
    for (const check of runResult.checks) {
      lines.push(...renderCheck(check, mode));
    }
    if (mode === "verbose" && runResult.facts !== undefined) {
      lines.push(...runResult.facts.map(renderFact));
    }
  }
  lines.push(renderVerdictLine(runResult.verdict, runResult.target));
  return lines.join("\n") + "\n";
}

function renderCheck(check: CheckResult, mode: OutputMode): string[] {
  const lines: string[] = [];
  if (check.skipped === true) {
    const skipCopy = check.skipReason ?? "run budget exhausted";
    lines.push(chalk.yellow(`${GLYPH_SKIP} Skipped: ${check.name} (${skipCopy})`));
    return lines;
  }
  if (check.passed) {
    lines.push(chalk.green(`${GLYPH_PASS} ${check.name}`));
    if (mode === "verbose" && check.detail !== undefined) {
      lines.push(chalk.dim(`  ${check.detail}`));
    }
    if (mode === "verbose" && check.note !== undefined) {
      lines.push(chalk.dim(`  ${check.note}`));
    }
  } else {
    lines.push(chalk.red(`${GLYPH_FAIL} ${check.name}`));
    if (check.diagnosis !== undefined) {
      lines.push(chalk.dim(`  ${check.diagnosis}`));
    }
  }
  return lines;
}

function renderFact(fact: Fact): string {
  // Redirect chain hops (ticket #7) announce in the `→ 301 <url>` shape,
  // one line per hop in hop order; other Facts keep the name: value form.
  if (fact.name === "Redirect") {
    return chalk.dim(`  → ${fact.value}`);
  }
  return chalk.dim(`  ${fact.name}: ${fact.value}`);
}

function renderVerdictLine(verdict: Verdict, target: string): string {
  const copy = VERDICT_COPY[verdict](target);
  switch (verdict) {
    case "Healthy":
      return chalk.green(copy);
    case "Degraded":
      return chalk.yellow(copy);
    case "Unreachable":
      return chalk.red(copy);
  }
}
