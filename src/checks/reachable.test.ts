import { describe, expect, test } from "vitest";
import { reachableCheck } from "./reachable.js";
import type { HttpResponse } from "./reachable.js";

function responseFixture(status: number): HttpResponse {
  return { status: status, statusText: "" };
}

describe("Reachable", () => {
  test("carries the name Reachable on its result", () => {
    const check = reachableCheck(responseFixture(200));
    expect(check.name).toBe("Reachable");
  });

  test("passes on 2xx", () => {
    const check = reachableCheck(responseFixture(200));
    expect(check.passed).toBe(true);
    expect(check.diagnosis).toBeUndefined();
  });

  test("passes on 3xx", () => {
    const check = reachableCheck(responseFixture(302));
    expect(check.passed).toBe(true);
  });

  test("fails on 4xx", () => {
    const check = reachableCheck(responseFixture(404));
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toContain("HTTP 404");
  });

  test("fails on 5xx", () => {
    const check = reachableCheck(responseFixture(502));
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toContain("HTTP 502");
  });

  test("fails on 1xx (informational-only is not a working deployment)", () => {
    const check = reachableCheck(responseFixture(103));
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toContain("HTTP 103");
  });

  test("fails on 4xx with a fact-only Diagnosis omitting parenthetical for codes outside the status table", () => {
    const check = reachableCheck(responseFixture(599));
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toContain("HTTP 599");
  });

  test("does not carry an exit code (the verdict module owns those)", () => {
    const check = reachableCheck(responseFixture(502));
    expect(Object.keys(check)).not.toContain("exitCode");
  });

  test("carries passing-check detail on a pass for the verbose tier", () => {
    const check = reachableCheck(responseFixture(204));
    expect(check.passed).toBe(true);
    expect(check.detail).toBeDefined();
    expect(check.detail).toContain("HTTP 204");
  });

  test("carries no passing-check detail on a fail (the Diagnosis carries it)", () => {
    const check = reachableCheck(responseFixture(502));
    expect(check.detail).toBeUndefined();
  });
});
