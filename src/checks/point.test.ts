/**
 * Point check contract: one check per user-supplied health path, reported
 * by name `Point check <path>` (path as given), same status-class grading
 * as Reachable (2xx/3xx pass). A failing point check degrades the verdict
 * like any other check.
 */
import { describe, expect, test } from "vitest";
import { pointCheck } from "./point.js";
import type { HttpResponse } from "./reachable.js";

function responseFixture(status: number): HttpResponse {
  return { status: status, statusText: "" };
}

describe("pointCheck", () => {
  test("carries the name `Point check <path>` with the path as given", () => {
    const check = pointCheck(responseFixture(200), "/health");
    expect(check.name).toBe("Point check /health");
  });

  test("passes on 2xx", () => {
    const check = pointCheck(responseFixture(200), "/health");
    expect(check.passed).toBe(true);
    expect(check.diagnosis).toBeUndefined();
  });

  test("passes on 3xx", () => {
    const check = pointCheck(responseFixture(302), "/health");
    expect(check.passed).toBe(true);
  });

  test("fails on 4xx with a Diagnosis", () => {
    const check = pointCheck(responseFixture(404), "/health");
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toContain("HTTP 404");
  });

  test("fails on 5xx with a Diagnosis", () => {
    const check = pointCheck(responseFixture(502), "/ready");
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toContain("HTTP 502");
  });

  test("the path is represented in the name exactly as supplied", () => {
    const check = pointCheck(responseFixture(200), "/healthz?probe=1");
    expect(check.name).toBe("Point check /healthz?probe=1");
  });

  test("does not carry an exit code (the verdict module owns those)", () => {
    const check = pointCheck(responseFixture(502), "/health");
    expect(Object.keys(check)).not.toContain("exitCode");
  });
});
