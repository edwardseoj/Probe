import { describe, expect, test } from "vitest";
import { renderRun } from "./output.js";
import { faultedCheck, skippedCheck } from "./check.js";
import type { CheckResult } from "./check.js";
import type { Fact, RunResult } from "./run.js";
import type { Verdict } from "./verdict.js";

function runResultWith(
  checks: readonly CheckResult[],
  verdict: Verdict,
  extra: Partial<RunResult> = {},
): RunResult {
  return {
    target: "https://example.test",
    verdict: verdict,
    checks: checks,
    ...extra,
  };
}

describe("skip announcement rendering", () => {
  test("a skipped check renders the skip glyph, not the fail glyph", () => {
    const rendered = renderRun(runResultWith([skippedCheck("TLS")], "Degraded"));
    const line = rendered.split("\n").find((l) => l.includes("TLS"));
    expect(line).toBeDefined();
    expect(line).toContain("-");
    expect(line).not.toContain("✖");
    expect(line).not.toContain("✓");
  });

  test("the skip line carries the skip reason", () => {
    const rendered = renderRun(
      runResultWith([skippedCheck("TLS", "run budget exhausted")], "Degraded"),
    );
    expect(rendered).toContain("run budget exhausted");
  });

  test("a fault check renders the fail glyph with its Diagnosis", () => {
    const fault = faultedCheck("Reachable", "Connection refused");
    const rendered = renderRun(runResultWith([fault], "Unreachable"));
    expect(rendered).toContain("✖");
    expect(rendered).toContain("Connection refused");
  });
});

describe("redirect chain announcement (ticket #7)", () => {
  const hopFacts: readonly Fact[] = [
    { name: "Redirect", value: "302 https://chain.test/moved" },
    { name: "Redirect", value: "301 https://chain.test/landed" },
  ];

  test("verbose announces each hop as a dim redirect line, hop order kept", () => {
    const rendered = renderRun(
      runResultWith([], "Healthy", { facts: hopFacts }),
      "verbose",
    );
    const lines = rendered.split("\n").filter((line) => line.includes("→"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("→ 302 https://chain.test/moved");
    expect(lines[1]).toContain("→ 301 https://chain.test/landed");
  });

  test("default and quiet tiers stay quiet about the chain", () => {
    const renderedDefault = renderRun(
      runResultWith([], "Healthy", { facts: hopFacts }),
      "default",
    );
    expect(renderedDefault).not.toContain("302 https://chain.test/moved");
    const renderedQuiet = renderRun(
      runResultWith([], "Healthy", { facts: hopFacts }),
      "quiet",
    );
    expect(renderedQuiet).not.toContain("301 https://chain.test/landed");
  });
});
