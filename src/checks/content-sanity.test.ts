import { describe, expect, test } from "vitest";
import { contentSanityCheck } from "./content-sanity.js";
import type { HttpResponse } from "./reachable.js";

function responseFixture(status: number, body?: string): HttpResponse {
  return body === undefined
    ? { status: status, statusText: "" }
    : { status: status, statusText: "", body: body };
}

describe("Content sanity", () => {
  test("carries the name Content sanity on its result", () => {
    const check = contentSanityCheck(responseFixture(200, "All good"));
    expect(check.name).toBe("Content sanity");
  });

  test("passes on a 200 body with no error markers", () => {
    const check = contentSanityCheck(responseFixture(200, "<h1>Welcome</h1>"));
    expect(check.passed).toBe(true);
    expect(check.diagnosis).toBeUndefined();
  });

  test("fails on the 'Application Error' marker in a 200 body", () => {
    const check = contentSanityCheck(
      responseFixture(200, "<html><body>Application Error</body></html>"),
    );
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toBeDefined();
  });

  test("sniffs the body case-insensitively", () => {
    const check = contentSanityCheck(
      responseFixture(200, "error: APPLICATION ERROR: something went wrong"),
    );
    expect(check.passed).toBe(false);
  });

  test("fails on a framework 502 marker in a 200 body", () => {
    const check = contentSanityCheck(
      responseFixture(200, "<title>502 Bad Gateway</title>"),
    );
    expect(check.passed).toBe(false);
  });

  test("fails on a framework 503 marker in a 200 body", () => {
    const check = contentSanityCheck(
      responseFixture(200, "<title>Service Unavailable</title>"),
    );
    expect(check.passed).toBe(false);
  });

  test("passes when no body is available (sniff only when a body exists)", () => {
    const check = contentSanityCheck(responseFixture(200));
    expect(check.passed).toBe(true);
    expect(check.diagnosis).toBeUndefined();
  });

  test("does not carry an exit code (the verdict module owns those)", () => {
    const check = contentSanityCheck(responseFixture(200, "Application Error"));
    expect(Object.keys(check)).not.toContain("exitCode");
  });
});
