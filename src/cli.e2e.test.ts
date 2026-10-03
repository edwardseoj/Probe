import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { main } from "./cli.js";

const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);

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
    const exitCode = await main(["https://healthy.test"]);
    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("✓");
  });

  test("5xx target exits 1 with a fail glyph", async () => {
    agent.get("https://broken.test").intercept({ method: "GET", path: "/" }).reply(502, "");
    const exitCode = await main(["https://broken.test"]);
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
    const exitCode = await main(["schemeless.test"]);
    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("✓");
  });

  test("--timeout <s> is accepted", async () => {
    agent.get("https://timed.test").intercept({ method: "GET", path: "/" }).reply(204, "");
    const exitCode = await main(["https://timed.test", "--timeout", "5"]);
    expect(exitCode).toBe(0);
  });

  test("unknown flag is a usage error: exit 3", async () => {
    const exitCode = await main(["https://healthy.test", "--verbose"]);
    expect(exitCode).toBe(3);
    expect(stdout.join("")).toBe("");
  });

  test("missing target is a usage error: exit 3", async () => {
    const exitCode = await main([]);
    expect(exitCode).toBe(3);
  });
});
