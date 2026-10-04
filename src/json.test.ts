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

function probeOver(cert: TlsCertInfo): RunOptionsTlsProbe {
  return () => Promise.resolve(cert);
}
type RunOptionsTlsProbe = NonNullable<Parameters<typeof run>[1]>["tlsProbe"];

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
    expect(reachable?.diagnosis).toContain("HTTP 404");

    for (const check of shape.checks) {
      if (check.name === "Reachable") continue;
      expect(check.status).toBe("skipped");
      expect(check.passed).toBe(false);
      expect(check.skipReason).toContain("Reachable");
    }
  });

  test("Unreachable: fault check keeps status fault and Diagnosis; facts layer absent; zero completed still serializes", async () => {
    const runResult = await unreachableRun();
    expect(runResult.verdict).toBe("Unreachable");
    const shape = runResultJson(runResult);
    expect(shape.verdict).toBe("Unreachable");
    expect(shape.exitCode).toBe(2);
    const reachable = shape.checks.find(
      (c: { name: string }) => c.name === "Reachable",
    );
    expect(reachable?.status).toBe("fault");
    expect(reachable?.passed).toBe(false);
    expect(reachable?.diagnosis).toBe("Connection refused");
    // absent-or-[] semantics: faulted runs have no Facts layer at all
    expect(shape.facts).toBeUndefined();
    expect("facts" in shape).toBe(false);
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

  test("status vocabulary is exactly graded|skipped|fault across all three fixtures", async () => {
    for (const runResult of [
      await healthyRun(),
      await degradedRun(),
      await unreachableRun(),
    ]) {
      const shape = runResultJson(runResult);
      for (const check of shape.checks) {
        expect(["graded", "skipped", "fault"]).toContain(check.status);
      }
    }
  });

  test("stringified output is parseable JSON with no ANSI codes", async () => {
    const shape = runResultJson(await degradedRun());
    const text = JSON.stringify(shape);
    expect(JSON.parse(text)).toEqual(shape);
    expect(text).not.toContain("\x1b");
  });
});

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
  });
});
