import { describe, expect, test } from "vitest";
import { skippedCheck } from "./check.js";

describe("skippedCheck factory", () => {
  // Skips are not failures (ADR-0001, "Skips are not failures"). A skipped
  // check is announced, never graded as failed, and carries the skip reason.
  test("marks the check skipped", () => {
    const check = skippedCheck("TLS");
    expect(check.skipped).toBe(true);
  });

  test("carries the check name", () => {
    const check = skippedCheck("Content sanity");
    expect(check.name).toBe("Content sanity");
  });

  test("carries the skip reason with a default", () => {
    const check = skippedCheck("TLS", "run budget exhausted");
    expect(check.skipReason).toBe("run budget exhausted");
  });

  test("defaults the skip reason", () => {
    const check = skippedCheck("TLS");
    expect(check.skipReason).toBe("run budget exhausted");
  });

  test("is never a passing grade and carries no Diagnosis", () => {
    const check = skippedCheck("TLS");
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toBeUndefined();
  });
});
