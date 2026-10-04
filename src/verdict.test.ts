import { describe, expect, test } from "vitest";
import { deriveVerdict, exitCodeFor } from "./verdict.js";
import type { Verdict } from "./verdict.js";
import { skippedCheck } from "./check.js";
import type { CheckResult } from "./check.js";

describe("deriveVerdict", () => {
  // Shared derivation (ticket #6: skip/budget semantics). Graded = a check
  // that was actually evaluated: neither skipped (budget still had time)
  // nor faulted (never got an answer to grade).
  function passed(name: string): CheckResult {
    return { name: name, passed: true };
  }
  function failed(name: string, diagnosis: string): CheckResult {
    return { name: name, passed: false, diagnosis: diagnosis };
  }
  function skipped(name: string, reason?: string): CheckResult {
    return skippedCheck(name, reason);
  }
  function faulted(name: string, diagnosis: string): CheckResult {
    return { ...skippedCheck(name, diagnosis), fault: true };
  }

  test("all completed checks passing -> Healthy", () => {
    const verdict: Verdict = deriveVerdict([passed("Reachable")]);
    expect(verdict).toBe("Healthy");
  });

  test("any failed completed check -> Degraded", () => {
    const verdict: Verdict = deriveVerdict([failed("Reachable", "HTTP 502 (Bad Gateway)")]);
    expect(verdict).toBe("Degraded");
  });

  test("skip alongside everything-completed-passing -> Degraded (incomplete evidence)", () => {
    const verdict: Verdict = deriveVerdict([passed("Reachable"), skipped("TLS")]);
    expect(verdict).toBe("Degraded");
  });

  test("fault alongside everything-completed-passing -> Degraded", () => {
    const verdict: Verdict = deriveVerdict([passed("Reachable"), faulted("TLS", "Request failed")]);
    expect(verdict).toBe("Degraded");
  });

  test("zero completed checks -> Unreachable (no evidence to grade)", () => {
    const verdict: Verdict = deriveVerdict([]);
    expect(verdict).toBe("Unreachable");
  });

  test("zero completed checks -> Unreachable even when the sole check was skipped", () => {
    const verdict: Verdict = deriveVerdict([skipped("Reachable")]);
    expect(verdict).toBe("Unreachable");
  });

  test("zero completed checks -> Unreachable even when the sole check was faulted", () => {
    const verdict: Verdict = deriveVerdict([faulted("Reachable", "Connection refused")]);
    expect(verdict).toBe("Unreachable");
  });
});

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
