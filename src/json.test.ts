import { describe, expect, test } from "vitest";
import { run, exitCodeFor } from "./run.js";
import type { HttpResponse } from "./checks/reachable.js";
import { runResultJson } from "./json.js";
import { renderRun } from "./output.js";
import type { TlsCertInfo } from "./checks/tls.js";

/**
 * Fixtures for the --json contract (ticket #9, SPEC "Output" + "Contract
 * stability"): the shape is a stable, version-breaking contract, so tests
 * pin exact field names and the exact verdict vocabulary.
 */

const validTlsCert: TlsCertInfo = {
  validFrom: "Jan 1 00:00:00 2020 GMT",
  validTo: "Jan 1 00:00:00 2030 GMT",
  hostnameMatches: true,
};

type RunOptionsTlsProbe = NonNullable<Parameters<typeof run>[1]>["tlsProbe"];

function probeOver(cert: TlsCertInfo): RunOptionsTlsProbe {
  return () => Promise.resolve(cert);
}

async function healthyRun() {
  return run("https://healthy-json.test", {
    timeoutSeconds: 7,
    tlsProbe: probeOver(validTlsCert),
    fetchImpl: () =>
      Promise.resolve({ status: 200, statusText: "OK" } as HttpResponse),
  });
}

async function degradedRun() {
  // Root grades Degraded (404 with a Diagnosis); the blocked later steps
  // skip with a reason naming the blocker — skips are not failures.
  return run("https://degraded-json.test", {
    paths: ["/health"],
    fetchImpl: () => Promise.resolve({ status: 404, statusText: "" }),
  });
}

async function unreachableRun() {
  return run("https://unreachable-json.test", {
    fetchImpl: () =>
      Promise.reject(
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
          code: "ECONNREFUSED",
        }),
      ),
  });
}

describe("runResultJson shape (ticket #9, stable contract)", () => {
  test("Healthy: full envelope with schema, target, verdict, exitCode, checks, facts, metadata", async () => {
    const runResult = await healthyRun();
    const shape = runResultJson(runResult);
    expect(shape.schema).toBe("probe/v1");
    expect(shape.target).toBe("https://healthy-json.test");
    expect(shape.verdict).toBe("Healthy");
    expect(shape.exitCode).toBe(0);
    expect(shape.exitCode).toBe(exitCodeFor(runResult.verdict));
    expect(shape.checks).toHaveLength(runResult.checks.length);
    expect(shape.facts).toBeDefined();
    expect(shape.metadata).toBeDefined();
  });

  test("Healthy: every check listed in run order with name/passed/status", async () => {
    const runResult = await healthyRun();
    const shape = runResultJson(runResult);
    expect(shape.checks.map((c: { name: string }) => c.name)).toEqual(
      runResult.checks.map((c) => c.name),
    );
    expect(shape.checks.map((c: { name: string }) => c.name)).toEqual([
      "Reachable",
      "HTTPS/TLS",
      "Content sanity",
    ]);
    for (const check of shape.checks) {
      expect(typeof check.passed).toBe("boolean");
      expect(check.passed).toBe(true);
      expect(check.status).toBe("graded");
    }
  });

  test("Healthy: Facts values agree with runResult.facts", async () => {
    const runResult = await healthyRun();
    const shape = runResultJson(runResult);
    const facts = shape.facts ?? [];
    expect(facts.map((f) => f.name)).toContain("Response time");
    for (const fact of runResult.facts ?? []) {
      const serialized = facts.find((f) => f.name === fact.name);
      expect(serialized?.value).toBe(fact.value);
    }
  });

  test("Healthy: metadata carries the run budget seconds", async () => {
    const runResult = await healthyRun();
    const shape = runResultJson(runResult);
    expect(shape.metadata.budgetSeconds).toBe(7);
  });

  test("Degraded: failing check keeps its Diagnosis, skipped checks keep status skipped (not just passed:false)", async () => {
    const runResult = await degradedRun();
    expect(runResult.verdict).toBe("Degraded");
    const shape = runResultJson(runResult);
    expect(shape.verdict).toBe("Degraded");
    expect(shape.exitCode).toBe(1);

    const reachable = shape.checks.find(
      (c: { name: string }) => c.name === "Reachable",
    );
    expect(reachable?.passed).toBe(false);
    expect(reachable?.status).toBe("graded");
    expect(reachable?.diagnosis).toBe(runResult.checks[0].diagnosis);
    // Diagnosis copy is not a contract; assert the shape, not the words.
    expect(reachable?.diagnosis).toMatch(/^HTTP \d{3}/);

    for (const check of shape.checks) {
      if (check.name === "Reachable") continue;
      expect(check.status).toBe("skipped");
      // Skips are not failures (SPEC "Skips are not failures"): a skipped
      // check carries no grade at all, so `passed` serializes as null —
      // a `passed === false` consumer filter never counts it as a failure.
      expect(check.passed).toBeNull();
      expect(check.skipReason).toContain("Reachable");
    }
  });

  test("Unreachable: fault check keeps status fault and Diagnosis; facts array always present; zero completed still serializes", async () => {
    const runResult = await unreachableRun();
    expect(runResult.verdict).toBe("Unreachable");
    const shape = runResultJson(runResult);
    expect(shape.verdict).toBe("Unreachable");
    expect(shape.exitCode).toBe(2);
    const reachable = shape.checks.find(
      (c: { name: string }) => c.name === "Reachable",
    );
    expect(reachable?.status).toBe("fault");
    // A fault never produced evidence to grade either: no grade exists.
    expect(reachable?.passed).toBeNull();
    expect(reachable?.diagnosis).toBe("Connection refused");
    // always-array semantics (ADR-0003): facts is present even when the run
    // collected nothing — an empty array, not an omitted key.
    expect(shape.facts).toEqual([]);
    expect("facts" in shape).toBe(true);
  });

  test("plain-HTTP note survives serialization (nothing dropped)", async () => {
    const runResult = await run("http://plain-json.test", {
      fetchImpl: () =>
        Promise.resolve({ status: 200, statusText: "OK" } as HttpResponse),
    });
    const shape = runResultJson(runResult);
    const tls = shape.checks.find(
      (c: { name: string }) => c.name === "HTTPS/TLS",
    );
    expect(tls?.note).toBe(runResult.checks[1].note);
    expect(tls?.note).toBeDefined();
  });

  test("status vocabulary is exactly graded|skipped|fault; graded keeps a boolean passed, non-graded serializes null", async () => {
    for (const runResult of [
      await healthyRun(),
      await degradedRun(),
      await unreachableRun(),
    ]) {
      const shape = runResultJson(runResult);
      // every check lands in the vocabulary...
      for (const check of shape.checks) {
        expect(["graded", "skipped", "fault"]).toContain(check.status);
        if (check.status === "graded") {
          expect(typeof check.passed).toBe("boolean");
        } else {
          expect(check.passed).toBeNull();
        }
      }
    }
  });

  test("graded counts across the three fixtures: Healthy all graded, Degraded keeps its graded failure, Unreachable has none", async () => {
    expect(
      runResultJson(await healthyRun()).checks.filter(
        (check) => check.status === "graded",
      ).length,
    ).toBe(3);
    const degradedShape = runResultJson(await degradedRun());
    expect(
      degradedShape.checks.filter((check) => check.status === "graded").length,
    ).toBe(1);
    expect(
      runResultJson(await unreachableRun()).checks.filter(
        (check) => check.status === "graded",
      ).length,
    ).toBe(0);
  });

  test("stringified output is parseable JSON with no ANSI codes", async () => {
    const shape = runResultJson(await degradedRun());
    const text = JSON.stringify(shape);
    expect(JSON.parse(text)).toEqual(shape);
    expect(text).not.toContain("\x1b");
  });
});

/**
 * --json vs default text output agreement on the same Run.
 *
 * One-directional BY DESIGN (issue #9 AC 3 agreement test): both
 * presentations come from the same RunResult object, and text default-tier
 * deliberately omits Facts (verbose-only) — so agreement is asserted as
 * "JSON carries everything text names, and both grade the run identically",
 * never the reverse. Human copy is not a contract, so only names, statuses
 * and the exit code are compared across the two presentations.
 */
describe("--json vs default text output agreement on the same Run", () => {
  test("JSON is the superset: every check name rendered in text appears in the JSON checks array", async () => {
    const runResult = await degradedRun();
    const shape = runResultJson(runResult);
    const text = renderRun(runResult, "default");
    const jsonNames = shape.checks.map((c: { name: string }) => c.name);
    for (const check of runResult.checks) {
      expect(text).toContain(check.name);
      expect(jsonNames).toContain(check.name);
    }
    // the same verdict object drives both presentations
    expect(shape.verdict).toBe(runResult.verdict);
    // the JSON verdict's exit code is THE exit code main()/renderRun's run
    // graded: one shared mapping (verdict.ts) drives text, JSON and process
    // exit alike.
    expect(shape.exitCode).toBe(exitCodeFor(runResult.verdict));
  });
});
