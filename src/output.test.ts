import { describe, expect, test } from "vitest";
import { renderRun } from "./output.js";
import { faultedCheck, skippedCheck } from "./check.js";
import type { CheckResult } from "./check.js";
import type { Verdict } from "./verdict.js";

function runResultWith(
  checks: readonly CheckResult[],
  verdict: Verdict,
  target = "https://example.test",
): { target: string; verdict: Verdict; checks: readonly CheckResult[] } {
  return { target: target, verdict: verdict, checks: checks };
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
