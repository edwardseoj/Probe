import { describe, expect, test } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { run } from "./run.js";
import type { FetchLike, Fact, RunResult } from "./run.js";
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

describe("Facts on completed runs (never gate the verdict)", () => {
  function fact(runResult: RunResult, name: string): Fact | undefined {
    return runResult.facts?.find((candidate) => candidate.name === name);
  }

  test("every completed run carries a response-time Fact with a fast/ok/slow adjective", async () => {
    mockPool("https://facts.test", 204);
    const runResult = await run("https://facts.test");
    const responseTime = fact(runResult, "Response time");
    expect(responseTime).toBeDefined();
    expect(responseTime?.value).toMatch(/^\d+ ms \((fast|ok|slow)\)$/);
  });

  test("a failing completed run still carries the response-time Fact", async () => {
    mockPool("https://facts-fail.test", 502);
    const runResult = await run("https://facts-fail.test");
    expect(runResult.verdict).toBe("Degraded");
    expect(fact(runResult, "Response time")).toBeDefined();
  });

  test("an Unreachable run carries no Facts (no response answered)", async () => {
    const runResult = await run("https://facts-refused.test", {
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:443")),
    });
    expect(runResult.facts).toBeUndefined();
  });

  test("Server header is captured as a Fact when present", async () => {
    const runResult = await run("https://server.test", {
      fetchImpl: () =>
        Promise.resolve({
          status: 204,
          statusText: "No Content",
          headers: { get: (n) => (n === "server" ? "nginx" : null) },
        } as HttpResponse),
    });
    expect(fact(runResult, "Server")?.value).toBe("nginx");
  });

  test("no Server Fact when the header is absent", async () => {
    mockPool("https://no-server.test", 204);
    const runResult = await run("https://no-server.test");
    expect(fact(runResult, "Server")).toBeUndefined();
  });

  test("HTTP version is captured as a Fact when available", async () => {
    const runResult = await run("https://version.test", {
      fetchImpl: () =>
        Promise.resolve({ status: 204, statusText: "No Content", httpVersion: "HTTP/1.1" } as HttpResponse),
    });
    expect(fact(runResult, "HTTP version")?.value).toBe("HTTP/1.1");
  });

  test("no HTTP version Fact when the seam provides none", async () => {
    mockPool("https://no-version.test", 204);
    const runResult = await run("https://no-version.test");
    expect(fact(runResult, "HTTP version")).toBeUndefined();
  });

  test.each([
    [250, "fast"],
    [500, "ok"],
    [1500, "slow"],
  ])("latency adjective thresholds: %i ms -> %s", async (elapsedMs, adjective) => {
    const runResult = await run("https://latency.test", {
      fetchImpl: () =>
        Promise.resolve(
          Object.assign({ status: 204, statusText: "No Content" }, { elapsedMs }) as HttpResponse,
        ),
    });
    expect(fact(runResult, "Response time")?.value).toContain(String(elapsedMs));
    expect(fact(runResult, "Response time")?.value).toContain(adjective);
  });

  test("a slow response never moves the Verdict (latency is a Fact, not a check)", async () => {
    const runResult = await run("https://slow-but-up.test", {
      fetchImpl: () =>
        Promise.resolve(
          Object.assign({ status: 204, statusText: "No Content" }, { elapsedMs: 5000 }) as HttpResponse,
        ),
    });
    expect(runResult.verdict).toBe("Healthy");
    expect(fact(runResult, "Response time")?.value).toContain("slow");
  });

  test("transport-provided timing is preferred over the run wall clock", async () => {
    const runResult = await run("https://timing.test", {
      fetchImpl: () =>
        Promise.resolve(
          Object.assign({ status: 204, statusText: "No Content" }, { elapsedMs: 137 }) as HttpResponse,
        ),
    });
    expect(fact(runResult, "Response time")?.value).toContain("137 ms");
  });
});

