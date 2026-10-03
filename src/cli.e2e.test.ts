import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { main } from "./cli.js";
import type { TlsCertInfo } from "./checks/tls.js";

const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);

/**
 * Cert-shaped fixture for the TLS probe boundary: tests never open real
 * sockets — every https run that survives Reachable receives the probe
 * seam instead of the default node:tls one.
 */
const validTlsCert: TlsCertInfo = {
  validFrom: "Jan 1 00:00:00 2020 GMT",
  validTo: "Jan 1 00:00:00 2030 GMT",
  hostnameMatches: true,
};

let stdout: string[];
let stderr: string[];
let writeStdout: typeof process.stdout.write;
let writeStderr: typeof process.stderr.write;

beforeEach(() => {
  stdout = [];
  stderr = [];
  writeStdout = process.stdout.write.bind(process.stdout);
  writeStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = writeStdout;
  process.stderr.write = writeStderr;
});

describe("cli exit seam", () => {
  test("healthy 2xx target exits 0 with a pass glyph", async () => {
    agent.get("https://healthy.test").intercept({ method: "GET", path: "/" }).reply(204, "");
    const exitCode = await main(["https://healthy.test"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("✓");
  });

  test("5xx target exits 1 with a fail glyph", async () => {
    agent.get("https://broken.test").intercept({ method: "GET", path: "/" }).reply(502, "");
    const exitCode = await main(["https://broken.test"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("✖");
  });

  test("connection refused exits 2 with a fail glyph", async () => {
    const exitCode = await main(["https://refused.test"]);
    expect(exitCode).toBe(2);
    expect(stdout.join("")).toContain("✖");
  });

  test("non-HTTP scheme is a usage error: exit 3, one red error line, zero requests", async () => {
    const exitCode = await main(["ftp://elsewhere.test"]);
    expect(exitCode).toBe(3);
    expect(stderr.join("")).toContain("ftp");
    // no network was touched: nothing was intercepted for this origin
    expect(stdout.join("")).toBe("");
  });

  test("data: scheme is a usage error: exit 3", async () => {
    const exitCode = await main(["data:text/plain,hi"]);
    expect(exitCode).toBe(3);
  });

  test("schemeless input gets an implicit https:// prefix and runs", async () => {
    agent.get("https://schemeless.test").intercept({ method: "GET", path: "/" }).reply(204, "");
    const exitCode = await main(["schemeless.test"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("✓");
  });

  test("--timeout <s> is accepted", async () => {
    agent.get("https://timed.test").intercept({ method: "GET", path: "/" }).reply(204, "");
    const exitCode = await main(["https://timed.test", "--timeout", "5"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
  });

  test("--path repeats: a check line per point check, verdict stays exit-code driven", async () => {
    const pool = agent.get("https://multi.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/health" }).reply(200, "");
    pool.intercept({ method: "GET", path: "/ready" }).reply(200, "");
    const exitCode = await main(["https://multi.test", "--path", "/health", "--path", "/ready"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    const out = stdout.join("");
    expect(out).toContain("Point check /health");
    expect(out).toContain("Point check /ready");
    expect(out).toContain("✓");
  });

  test("a failing point check degrades: exit 1 with a fail glyph on that path's line", async () => {
    const pool = agent.get("https://pointdown.test");
    pool.intercept({ method: "GET", path: "/" }).reply(204, "");
    pool.intercept({ method: "GET", path: "/health" }).reply(503, "");
    const exitCode = await main(["https://pointdown.test", "--path", "/health"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(1);
    const out = stdout.join("");
    expect(out).toContain("Point check /health");
    expect(out).toContain("✖");
  });

  test("a point check path not starting with / is a usage error: exit 3, stderr, zero network", async () => {
    const exitCode = await main(["https://badpath.test", "--path", "health"]);
    expect(exitCode).toBe(3);
    expect(stderr.join("")).toContain("--path");
    expect(stdout.join("")).toBe("");
  });

  test("an empty --path value is a usage error: exit 3", async () => {
    const exitCode = await main(["https://emptypath.test", "--path", ""]);
    expect(exitCode).toBe(3);
    expect(stderr.join("")).toContain("--path");
    expect(stdout.join("")).toBe("");
  });

  test("budget exhausted mid-run: exit 1, skipped point checks announced with the skip glyph", async () => {
    // --timeout is integer-only at the CLI, so the smallest deterministic
    // budget is 1s: the root answers instantly, the point fetch hangs until
    // the shared budget clock aborts it (worst case ~1s, never flaky).
    const exitCode = await main(
      ["https://midrun-e2e.test", "--timeout", "1", "--path", "/health"],
      {
        tlsProbe: () => Promise.resolve(validTlsCert),
        fetchImpl: (input, init) => {
          if (new URL(input).pathname === "/") {
            return Promise.resolve({ status: 204, statusText: "" });
          }
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("This operation was aborted"), {
                  name: "AbortError",
                }),
              ),
            );
          });
        },
      },
    );
    expect(exitCode).toBe(1);
    const out = stdout.join("");
    expect(out).toContain("- Skipped:");
  });

  test("unknown flag is a usage error: exit 3", async () => {
    const exitCode = await main(["https://healthy.test", "--bogus"]);
    expect(exitCode).toBe(3);
    expect(stdout.join("")).toBe("");
  });

  test("missing target is a usage error: exit 3", async () => {
    const exitCode = await main([]);
    expect(exitCode).toBe(3);
  });
});

describe("cli output tiers", () => {
  function lines(): string[] {
    return stdout.join("").split("\n").filter((line) => line.length > 0);
  }

  test("default output stays check lines + verdict: no Facts, no pass detail", async () => {
    agent.get("https://tier-default.test").intercept({ method: "GET", path: "/" }).reply(204, "", {
      headers: { server: "nginx" },
    });
    const exitCode = await main(["https://tier-default.test"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    // check lines (Reachable, HTTPS/TLS, Content sanity) + verdict
    expect(lines()).toHaveLength(4);
    expect(stdout.join("")).not.toContain("nginx");
    expect(stdout.join("")).not.toContain("Response time");
  });

  test("--verbose adds Facts and passing-check detail", async () => {
    agent.get("https://tier-verbose.test").intercept({ method: "GET", path: "/" }).reply(204, "", {
      headers: { server: "nginx" },
    });
    const exitCode = await main(["https://tier-verbose.test", "--verbose"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    // pass glyph, pass detail, Fact lines (latency + Server), verdict
    expect(lines().length).toBeGreaterThan(2);
    expect(stdout.join("")).toContain("nginx");
    expect(stdout.join("")).toContain("Response time");
  });

  test("--quiet prints only the Verdict line, exit code unchanged", async () => {
    agent.get("https://tier-quiet.test").intercept({ method: "GET", path: "/" }).reply(502, "");
    const exitCode = await main(["https://tier-quiet.test", "--quiet"]);
    expect(exitCode).toBe(1);
    expect(lines()).toHaveLength(1);
    expect(stdout.join("")).not.toContain("✖");
  });

  test("--quiet wins over --verbose when both are given", async () => {
    agent.get("https://tier-both.test").intercept({ method: "GET", path: "/" }).reply(204, "");
    const exitCode = await main(["https://tier-both.test", "--verbose", "--quiet"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    expect(lines()).toHaveLength(1);
  });

  test("the redirect chain announces per hop under --verbose; the verdict grades the final destination", async () => {
    const pool = agent.get("https://chain-e2e.test");
    pool.intercept({ method: "GET", path: "/" }).reply(301, "", {
      headers: { location: "/landed" },
    });
    pool.intercept({ method: "GET", path: "/landed" }).reply(200, "");
    const exitCode = await main(["https://chain-e2e.test", "--verbose"], {
      tlsProbe: () => Promise.resolve(validTlsCert),
    });
    expect(exitCode).toBe(0);
    const out = stdout.join("");
    expect(out).toContain("→ 301 https://chain-e2e.test/landed");
  });
});
