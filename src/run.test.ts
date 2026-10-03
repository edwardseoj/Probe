import { describe, expect, test } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { run } from "./run.js";
import type { FetchLike, RunResult } from "./run.js";
import type { HttpResponse } from "./checks/reachable.js";

const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);

/**
 * Fetch-over-MockAgent injection: the network is substituted at the
 * fetch-like boundary on run(), never at a per-check seam.
 * MockAgent cannot deliver a 1xx final response through fetch (1xx are
 * interim under fetch semantics), so the 1xx fixture substitutes a plain
 * response through the same boundary.
 */
function mockPool(origin: string, status: number, headers?: Record<string, string>) {
  return agent.get(origin).intercept({ method: "GET", path: "/" }).reply(status, "", headers ? { headers } : undefined);
}

/**
 * Hangs the request until the run budget's abort signal fires, then rejects
 * with a fetch-style AbortError — a Target that never answers.
 */
function hangsUntilAbort(): FetchLike {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
      );
    });
}

/** Records whether every call saw the SAME AbortSignal instance (shared clock). */
function signalCapture(): { signals: AbortSignal[]; fetch: FetchLike } {
  const signals: AbortSignal[] = [];
  return {
    signals: signals,
    fetch: (_input, init) => {
      if (init?.signal !== undefined) signals.push(init.signal);
      return Promise.resolve({ status: 204, statusText: "" });
    },
  };
}

describe("run() over the fetch-like boundary", () => {
  test("2xx grades Healthy", async () => {
    mockPool("https://two.test", 204);
    const runResult: RunResult = await run("https://two.test");
    expect(runResult.verdict).toBe("Healthy");
    expect(runResult.checks).toHaveLength(1);
    expect(runResult.checks[0].passed).toBe(true);
    expect(runResult.checks[0].name).toBe("Reachable");
  });

  test("3xx following to a 2xx destination grades Healthy at the final destination", async () => {
    const pool = agent.get("https://redirect.test");
    pool.intercept({ method: "GET", path: "/" }).reply(301, "", {
      headers: { location: "https://redirect.test/landed" },
    });
    pool.intercept({ method: "GET", path: "/landed" }).reply(200, "");
    const runResult = await run("https://redirect.test");
    expect(runResult.verdict).toBe("Healthy");
  });

  test("4xx fails the check (Degraded) with a Diagnosis", async () => {
    mockPool("https://four.test", 404);
    const runResult = await run("https://four.test");
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[0].passed).toBe(false);
    expect(runResult.checks[0].diagnosis).toContain("HTTP 404");
  });

  test("5xx fails the check (Degraded) with a Diagnosis", async () => {
    mockPool("https://five.test", 502);
    const runResult = await run("https://five.test");
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[0].passed).toBe(false);
    expect(runResult.checks[0].diagnosis).toContain("HTTP 502");
  });

  test("1xx fails the check (Degraded) — informational-only is not evidence of a working deployment", async () => {
    const runResult = await run("https://one.test", {
      fetchImpl: () =>
        Promise.resolve({ status: 103, statusText: "Early Hints" } as HttpResponse),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[0].passed).toBe(false);
    expect(runResult.checks[0].diagnosis).toContain("HTTP 103");
  });

  test("connection refused maps to Unreachable", async () => {
    const runResult = await run("https://refused.test", {
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:443")),
    });
    expect(runResult.verdict).toBe("Unreachable");
    expect(runResult.checks[0].passed).toBe(false);
    expect(runResult.checks[0].fault).toBe(true);
  });

  test("DNS lookup failure maps to Unreachable", async () => {
    const runResult = await run("https://nodns.test", {
      fetchImpl: () =>
        Promise.reject(
          Object.assign(new Error("getaddrinfo ENOTFOUND nodns.test"), { code: "ENOTFOUND" }),
        ),
    });
    expect(runResult.verdict).toBe("Unreachable");
  });

  test("aborted request with zero completed checks maps to Unreachable", async () => {
    const runResult = await run("https://aborted.test", {
      timeoutSeconds: 1,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
          );
        }),
    });
    expect(runResult.verdict).toBe("Unreachable");
  });

  test("the run budget bounds the network call via the abort signal", async () => {
    let sawSignal = false;
    await run("https://budge.test", {
      timeoutSeconds: 1,
      fetchImpl: (_input, init) => {
        sawSignal = init?.signal instanceof AbortSignal;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
          );
        });
      },
    });
    expect(sawSignal).toBe(true);
  });
});

describe("run budget: shared clock across checks", () => {
  test("every network touch honors the same AbortSignal instance", async () => {
    const capture = signalCapture();
    await run("https://shared.test", { fetchImpl: capture.fetch });
    expect(capture.signals.length).toBeGreaterThanOrEqual(1);
    const first = capture.signals[0];
    for (const signal of capture.signals) {
      expect(signal).toBe(first);
    }
  });

  test("budget-expired abort is announced as skipped, never failed", async () => {
    const runResult = await run("https://slowbudget.test", {
      timeoutSeconds: 1,
      fetchImpl: hangsUntilAbort(),
    });
    expect(runResult.verdict).toBe("Unreachable");
    expect(runResult.checks).toHaveLength(1);
    expect(runResult.checks[0].skipped).toBe(true);
    expect(runResult.checks[0].fault).toBeUndefined();
  });
});