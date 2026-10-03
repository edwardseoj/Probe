import { describe, expect, test } from "vitest";
import { exitCodeFor } from "./verdict.js";
import type { Verdict } from "./verdict.js";

describe("verdict -> exit code mapping", () => {
  test("Healthy maps to exit 0", () => {
    const verdict: Verdict = "Healthy";
    expect(exitCodeFor(verdict)).toBe(0);
  });

  test("Degraded maps to exit 1", () => {
    const verdict: Verdict = "Degraded";
    expect(exitCodeFor(verdict)).toBe(1);
  });

  test("Unreachable maps to exit 2", () => {
    const verdict: Verdict = "Unreachable";
    expect(exitCodeFor(verdict)).toBe(2);
  });
});
