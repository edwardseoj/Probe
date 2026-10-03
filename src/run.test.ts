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

  test("aborted request (budget exhausted) maps to Unreachable", async () => {
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

describe("run() with point checks (paths)", () => {
  test("one check per supplied path, each fetched and named per path", async () => {
    const pool = agent.get("https://points.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/health" }).reply(200, "");
    pool.intercept({ method: "GET", path: "/ready" }).reply(200, "");
    const runResult: RunResult = await run("https://points.test", {
      paths: ["/health", "/ready"],
    });
    expect(runResult.checks).toHaveLength(3);
    expect(runResult.checks.map((c) => c.name)).toEqual([
      "Reachable",
      "Point check /health",
      "Point check /ready",
    ]);
    expect(runResult.verdict).toBe("Healthy");
  });

  test("each point check is its own fetch against its own path", async () => {
    const pool = agent.get("https://distinct.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/health" }).reply(200, "");
    const seenPaths: string[] = [];
    const runResult = await run("https://distinct.test", {
      paths: ["/health"],
      fetchImpl: async (input) => {
        seenPaths.push(new URL(input).pathname);
        if (new URL(input).pathname === "/") {
          return { status: 204, statusText: "" };
        }
        return { status: 200, statusText: "" };
      },
    });
    expect(seenPaths).toEqual(["/", "/health"]);
    expect(runResult.verdict).toBe("Healthy");
    expect(runResult.checks).toHaveLength(2);
    expect(runResult.checks[1].name).toBe("Point check /health");
    expect(runResult.checks[1].passed).toBe(true);
  });

  test("a failing point check among passing root checks degrades the verdict", async () => {
    const pool = agent.get("https://degradedpoint.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/health" }).reply(200, "");
    pool.intercept({ method: "GET", path: "/ready" }).reply(503, "");
    const runResult = await run("https://degradedpoint.test", {
      paths: ["/health", "/ready"],
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks).toHaveLength(3);
    const ready = runResult.checks.find((c) => c.name === "Point check /ready");
    expect(ready?.passed).toBe(false);
    expect(ready?.diagnosis).toContain("HTTP 503");
  });

  test("the root Reachable check failing takes precedence: Unreachable-style fault, point checks skipped", async () => {
    const runResult = await run("https://pointsrefused.test", {
      paths: ["/health"],
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:443")),
    });
    expect(runResult.verdict).toBe("Unreachable");
    expect(runResult.checks).toHaveLength(1);
    expect(runResult.checks[0].name).toBe("Reachable");
  });

  test("a point check failing with an HTTP error status (root passing) is Degraded, not Unreachable", async () => {
    const pool = agent.get("https://selfdegraded.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/down" }).reply(500, "");
    const runResult = await run("https://selfdegraded.test", { paths: ["/down"] });
    expect(runResult.verdict).toBe("Degraded");
  });

  test("point checks share the run budget signal", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const runResult = await run("https://sharedbudget.test", {
      paths: ["/health"],
      fetchImpl: async (_input, init) => {
        signals.push(init?.signal);
        return { status: 200, statusText: "" };
      },
    });
    expect(runResult.verdict).toBe("Healthy");
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
  });

  test("a point check whose fetch faults is skipped, not failed", async () => {
    const runResult = await run("https://pointfault.test", {
      paths: ["/health"],
      fetchImpl: async (input) => {
        if (new URL(input).pathname === "/") {
          return { status: 204, statusText: "" };
        }
        throw Object.assign(new Error("getaddrinfo ENOTFOUND pointfault.test"), {
          code: "ENOTFOUND",
        });
      },
    });
    expect(runResult.checks).toHaveLength(2);
    const point = runResult.checks[1];
    expect(point.name).toBe("Point check /health");
    expect(point.passed).toBe(false);
    expect(point.skipped).toBe(true);
    expect(point.skipReason).toBeDefined();
    expect(runResult.verdict).toBe("Degraded");
  });

  test("no paths: identical to the single-check run", async () => {
    mockPool("https://nopath.test", 204);
    const runResult = await run("https://nopath.test");
    expect(runResult.checks).toHaveLength(1);
    expect(runResult.checks[0].name).toBe("Reachable");
    expect(runResult.verdict).toBe("Healthy");
  });
});

