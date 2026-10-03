import { describe, expect, test } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { run } from "./run.js";
import type { FetchLike, RunResult, RunOptions } from "./run.js";
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
    expect(runResult.checks).toHaveLength(2);
    expect(runResult.checks[0].passed).toBe(true);
    expect(runResult.checks[0].name).toBe("Reachable");
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
    expect(runResult.checks).toHaveLength(2);
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
    await run("https://drained.test", {
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
    expect(probed.timeoutMs).toBeLessThanOrEqual(0);
  });
});

