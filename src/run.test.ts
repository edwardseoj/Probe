import { describe, expect, test } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { run } from "./run.js";
import type { FetchLike, Fact, RunResult, RunOptions } from "./run.js";
import type { HttpResponse } from "./checks/reachable.js";
import { TLS_CHECK_NAME } from "./checks/tls.js";
import type { TlsCertInfo } from "./checks/tls.js";

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

/**
 * Cert-shaped fixture for the TLS probe boundary: dates are the essence,
 * never a real certificate and never a real socket (tests must not open
 * sockets — the probe seam is injected below).
 */
const validTlsCert: TlsCertInfo = {
  validFrom: "Jan 1 00:00:00 2020 GMT",
  validTo: "Jan 1 00:00:00 2030 GMT",
  hostnameMatches: true,
};

/** Probe-over-fixture injection: the TLS boundary stands in for node:tls. */
function probeOver(cert: TlsCertInfo): RunOptions["tlsProbe"] {
  return () => Promise.resolve(cert);
}

describe("run() over the fetch-like boundary", () => {
  test("2xx grades Healthy", async () => {
    mockPool("https://two.test", 204);
    const runResult: RunResult = await run("https://two.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Healthy");
    expect(runResult.checks).toHaveLength(3);
    expect(runResult.checks[0].passed).toBe(true);
    expect(runResult.checks[0].name).toBe("Reachable");
    expect(runResult.checks[2].name).toBe("Content sanity");
    expect(runResult.checks[2].passed).toBe(true);
    expect(runResult.checks[2].diagnosis).toBeUndefined();
  });

  test("200 with an error-page body degrades the verdict with a failing Content sanity check", async () => {
    agent.get("https://brownout.test").intercept({ method: "GET", path: "/" }).reply(
      200,
      "<html><body>Application Error</body></html>",
    );
    const runResult = await run("https://brownout.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Degraded");
    const sanity = runResult.checks.find((c) => c.name === "Content sanity");
    expect(sanity).toBeDefined();
    expect(sanity?.passed).toBe(false);
    expect(sanity?.diagnosis).toBeDefined();
  });

  test("200 with a clean body stays Healthy with no Diagnosis on Content sanity", async () => {
    agent.get("https://cleanbody.test").intercept({ method: "GET", path: "/" }).reply(
      200,
      "<html><body>Welcome</body></html>",
    );
    const runResult = await run("https://cleanbody.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Healthy");
    const sanity = runResult.checks.find((c) => c.name === "Content sanity");
    expect(sanity?.passed).toBe(true);
    expect(sanity?.diagnosis).toBeUndefined();
  });

  test("Content sanity passes silently when no body is available", async () => {
    const runResult = await run("https://nobody.test", {
      tlsProbe: probeOver(validTlsCert),
      fetchImpl: () =>
        Promise.resolve({ status: 200, statusText: "OK" } as HttpResponse),
    });
    expect(runResult.verdict).toBe("Healthy");
    const sanity = runResult.checks.find((c) => c.name === "Content sanity");
    expect(sanity?.passed).toBe(true);
  });


  test("3xx following to a 2xx destination grades Healthy at the final destination", async () => {
    const pool = agent.get("https://redirect.test");
    pool.intercept({ method: "GET", path: "/" }).reply(301, "", {
      headers: { location: "https://redirect.test/landed" },
    });
    pool.intercept({ method: "GET", path: "/landed" }).reply(200, "");
    const runResult = await run("https://redirect.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Healthy");
  });

  test("4xx fails the check (Degraded) with a Diagnosis", async () => {
    mockPool("https://four.test", 404);
    const runResult = await run("https://four.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[0].passed).toBe(false);
    expect(runResult.checks[0].diagnosis).toContain("HTTP 404");
  });

  test("5xx fails the check (Degraded) with a Diagnosis", async () => {
    mockPool("https://five.test", 502);
    const runResult = await run("https://five.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[0].passed).toBe(false);
    expect(runResult.checks[0].diagnosis).toContain("HTTP 502");
  });

  test("1xx fails the check (Degraded) — informational-only is not evidence of a working deployment", async () => {
    const runResult = await run("https://one.test", {
      tlsProbe: probeOver(validTlsCert),
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
    expect(runResult.checks).toHaveLength(3);
    for (const check of runResult.checks) {
      expect(check.skipped).toBe(true);
      expect(check.fault).toBeUndefined();
    }
  });
});

describe("HTTPS/TLS check on run()", () => {
  function response204(statusText = ""): HttpResponse {
    return { status: 204, statusText: statusText };
  }

  test("https Targets get the HTTPS/TLS check after Reachable", async () => {
    const runResult = await run("https://tls.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.checks.map((check) => check.name)).toEqual([
      "Reachable",
      TLS_CHECK_NAME,
      "Content sanity",
    ]);
    expect(runResult.checks[1].passed).toBe(true);
  });
  test("a valid certificate on https grades Healthy", async () => {
    const runResult = await run("https://healthy.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Healthy");
  });

  test("an expired certificate degrades with a TLS Diagnosis", async () => {
    const runResult = await run("https://expired.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: probeOver({
        ...validTlsCert,
        validTo: "Jan 1 00:00:00 2020 GMT",
      }),
    });
    expect(runResult.verdict).toBe("Degraded");
    const tlsCheckLine = runResult.checks[1];
    expect(tlsCheckLine.name).toBe(TLS_CHECK_NAME);
    expect(tlsCheckLine.passed).toBe(false);
    expect(tlsCheckLine.diagnosis).toBeDefined();
  });

  test("a not-yet-valid certificate degrades", async () => {
    const runResult = await run("https://notyet.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: probeOver({
        ...validTlsCert,
        validFrom: "Jan 1 00:00:00 2050 GMT",
      }),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[1].passed).toBe(false);
    expect(runResult.checks[1].diagnosis).toBeDefined();
  });

  test("a hostname mismatch degrades", async () => {
    const runResult = await run("https://mismatch.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: probeOver({ ...validTlsCert, hostnameMatches: false }),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[1].passed).toBe(false);
    expect(runResult.checks[1].diagnosis).toBeDefined();
  });

  test("a failed TLS probe degrades — TLS trouble never grades Unreachable", async () => {
    const runResult = await run("https://probes-fails.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: () => Promise.reject(new Error("TLS handshake failed")),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks[1].passed).toBe(false);
    expect(runResult.checks[1].diagnosis).toBeDefined();
  });

  test("a TLS probe kept inside the budget never gates on latency", async () => {
    const runResult = await run("https://slow-probe.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: () =>
        new Promise((resolve) => setTimeout(() => resolve(validTlsCert), 50)),
    });
    expect(runResult.verdict).toBe("Healthy");
  });

  test("plain-HTTP Targets pass the check trivially with a note, and the probe never fires", async () => {
    let probeCalled = false;
    const runResult = await run("http://plain.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: () => {
        probeCalled = true;
        return Promise.resolve(validTlsCert);
      },
    });
    expect(probeCalled).toBe(false);
    expect(runResult.verdict).toBe("Healthy");
    expect(runResult.checks).toHaveLength(3);
    const tlsCheckLine = runResult.checks[1];
    expect(tlsCheckLine.name).toBe(TLS_CHECK_NAME);
    expect(tlsCheckLine.passed).toBe(true);
    expect(tlsCheckLine.note).toBeDefined();
    expect(tlsCheckLine.diagnosis).toBeUndefined();
  });

  test("the probe receives the hostname and the port from the Target (443 default)", async () => {
    const probed: { hostname?: string; port?: number } = {};
    await run("https://tlsport.test:8443", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: (input) => {
        probed.hostname = input.hostname;
        probed.port = input.port;
        return Promise.resolve(validTlsCert);
      },
    });
    expect(probed.hostname).toBe("tlsport.test");
    expect(probed.port).toBe(8443);

    await run("https://tlsport.test", {
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: (input) => {
        probed.port = input.port;
        return Promise.resolve(validTlsCert);
      },
    });
    expect(probed.port).toBe(443);
  });

  test("the probe is bounded by the remaining run budget (no second clock)", async () => {
    const probed: { timeoutMs?: number } = {};
    await run("https://bounded.test", {
      timeoutSeconds: 5,
      fetchImpl: () => Promise.resolve(response204()),
      tlsProbe: (input) => {
        probed.timeoutMs = input.timeoutMs;
        return Promise.resolve(validTlsCert);
      },
    });
    expect(probed.timeoutMs).toBeGreaterThan(0);
    expect(probed.timeoutMs).toBeLessThanOrEqual(5000);
  });

  test("with the run budget already exhausted the probe gets no remaining time", async () => {
    const probed: { timeoutMs?: number } = {};
    const runResult = await run("https://drained.test", {
      timeoutSeconds: 0,
      fetchImpl: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(response204()), 50),
        ),
      tlsProbe: (input) => {
        probed.timeoutMs = input.timeoutMs;
        return Promise.resolve(validTlsCert);
      },
    });
    // Under the shared budget clock, an exhausted budget skips every step
    // (skips are not failures); the probe never gets a second chance.
    expect(probed.timeoutMs).toBeUndefined();
    const tlsCheckLine = runResult.checks.find((c) => c.name === TLS_CHECK_NAME);
    expect(tlsCheckLine?.skipped).toBe(true);
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
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.checks).toHaveLength(5);
    expect(runResult.checks.map((c) => c.name)).toEqual([
      "Reachable",
      TLS_CHECK_NAME,
      "Content sanity",
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
      tlsProbe: probeOver(validTlsCert),
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
    expect(runResult.checks).toHaveLength(4);
    expect(runResult.checks[3].name).toBe("Point check /health");
    expect(runResult.checks[3].passed).toBe(true);
  });

  test("a failing point check among passing root checks degrades the verdict", async () => {
    const pool = agent.get("https://degradedpoint.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/health" }).reply(200, "");
    pool.intercept({ method: "GET", path: "/ready" }).reply(503, "");
    const runResult = await run("https://degradedpoint.test", {
      paths: ["/health", "/ready"],
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Degraded");
    expect(runResult.checks).toHaveLength(5);
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
    expect(runResult.checks[0].name).toBe("Reachable");
    expect(runResult.checks[0].fault).toBe(true);
    for (const check of runResult.checks.slice(1)) {
      expect(check.skipped).toBe(true);
    }
  });

  test("a point check failing with an HTTP error status (root passing) is Degraded, not Unreachable", async () => {
    const pool = agent.get("https://selfdegraded.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/down" }).reply(500, "");
    const runResult = await run("https://selfdegraded.test", {
      paths: ["/down"],
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.verdict).toBe("Degraded");
  });

  test("point checks share the run budget signal", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const runResult = await run("https://sharedbudget.test", {
      paths: ["/health"],
      tlsProbe: probeOver(validTlsCert),
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
      tlsProbe: probeOver(validTlsCert),
      fetchImpl: async (input) => {
        if (new URL(input).pathname === "/") {
          return { status: 204, statusText: "" };
        }
        throw Object.assign(new Error("getaddrinfo ENOTFOUND pointfault.test"), {
          code: "ENOTFOUND",
        });
      },
    });
    expect(runResult.checks).toHaveLength(4);
    const point = runResult.checks.find((c) => c.name === "Point check /health");
    expect(point?.passed).toBe(false);
    expect(point?.skipped).toBe(true);
    expect(point?.skipReason).toContain("DNS lookup failed");
    expect(runResult.verdict).toBe("Degraded");
  });

  test("no paths: identical to the single-check run", async () => {
    mockPool("https://nopath.test", 204);
    const runResult = await run("https://nopath.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(runResult.checks).toHaveLength(3);
    expect(runResult.checks[0].name).toBe("Reachable");
    expect(runResult.verdict).toBe("Healthy");
  });
});

describe("Facts on completed runs (never gate the verdict)", () => {
  function fact(runResult: RunResult, name: string): Fact | undefined {
    return runResult.facts?.find((candidate) => candidate.name === name);
  }

  test("every completed run carries a response-time Fact with a fast/ok/slow adjective", async () => {
    mockPool("https://facts.test", 204);
    const runResult = await run("https://facts.test", {
      tlsProbe: probeOver(validTlsCert),
    });
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
      tlsProbe: probeOver(validTlsCert),
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
    const runResult = await run("https://no-server.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(fact(runResult, "Server")).toBeUndefined();
  });

  test("HTTP version is captured as a Fact when available", async () => {
    const runResult = await run("https://version.test", {
      tlsProbe: probeOver(validTlsCert),
      fetchImpl: () =>
        Promise.resolve({ status: 204, statusText: "No Content", httpVersion: "HTTP/1.1" } as HttpResponse),
    });
    expect(fact(runResult, "HTTP version")?.value).toBe("HTTP/1.1");
  });

  test("no HTTP version Fact when the seam provides none", async () => {
    mockPool("https://no-version.test", 204);
    const runResult = await run("https://no-version.test", {
      tlsProbe: probeOver(validTlsCert),
    });
    expect(fact(runResult, "HTTP version")).toBeUndefined();
  });

  test.each([
    [250, "fast"],
    [500, "ok"],
    [1500, "slow"],
  ])("latency adjective thresholds: %i ms -> %s", async (elapsedMs, adjective) => {
    const runResult = await run("https://latency.test", {
      tlsProbe: probeOver(validTlsCert),
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
      tlsProbe: probeOver(validTlsCert),
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
      tlsProbe: probeOver(validTlsCert),
      fetchImpl: () =>
        Promise.resolve(
          Object.assign({ status: 204, statusText: "No Content" }, { elapsedMs: 137 }) as HttpResponse,
        ),
    });
    expect(fact(runResult, "Response time")?.value).toContain("137 ms");
  });
});

