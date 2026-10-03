/**
 * Presenter: RunResult -> terminal lines. Verdict line copy lives here,
 * never in the verdict module (which owns only the exit mapping). Colors are
 * semantic per BRAND.md; non-TTY drops color and keeps glyphs.
 */

import chalk from "chalk";
import type { RunResult } from "./run.js";
import type { CheckResult } from "./checks/reachable.js";
import type { Verdict } from "./verdict.js";

const GLYPH_PASS = "✓";
const GLYPH_FAIL = "✖";

const VERDICT_COPY: Record<Verdict, (target: string) => string> = {
  Healthy: () => "Deployment looks healthy.",
  Degraded: () => "Deployment is degraded.",
  Unreachable: (target) => `Could not reach ${target}.`,
};

export function renderRun(runResult: RunResult): string {
  const lines: string[] = [];
  for (const check of runResult.checks) {
    lines.push(...renderCheck(check));
  }
  lines.push(renderVerdictLine(runResult.verdict, runResult.target));
  return lines.join("\n") + "\n";
}

function renderCheck(check: CheckResult): string[] {
  const lines: string[] = [];
  if (check.passed) {
    lines.push(chalk.green(`${GLYPH_PASS} ${check.name}`));
  } else {
    lines.push(chalk.red(`${GLYPH_FAIL} ${check.name}`));
    if (check.diagnosis !== undefined) {
      lines.push(chalk.dim(`  ${check.diagnosis}`));
    }
  }
  return lines;
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
