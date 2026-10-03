import { describe, expect, test } from "vitest";
import { followRedirects } from "./redirects.js";
import type { HttpResponse } from "./checks/reachable.js";

/**
 * Unit pins for the redirect loop over a hand-rolled transport standing in
 * for undici in manual mode (the loop is seam-driven; no sockets, no ports).
 * The integration surface (MockAgent over run()) lives in run.test.ts.
 */
function fakeTransport(
  respond: (input: string) => HttpResponse,
  calls: { urls: string[]; signals: (AbortSignal | undefined)[] },
): Parameters<typeof followRedirects>[0] {
  return async (input, init) => {
    calls.urls.push(input);
    calls.signals.push(init?.signal);
    return respond(input);
  };
}

function response(status: number, location?: string): HttpResponse {
  return {
    status: status,
    statusText: "",
    headers: {
      get: (name: string) =>
        location !== undefined && name === "location" ? location : null,
    },
    body: "",
  };
}

describe("followRedirects over the manual-fetch boundary (ticket #7)", () => {
  test("follows each hop in order and records hops first-hop-first", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const transport = fakeTransport(
      (input) => {
        if (input === "https://chain.test/") return response(302, "/moved");
        if (input === "https://chain.test/moved") return response(301, "/landed");
        return response(200);
      },
      calls,
    );
    const result = await followRedirects(transport, "https://chain.test/");
    expect(result.status).toBe(200);
    expect(result.redirectHops).toEqual([
      { status: 302, location: "https://chain.test/moved" },
      { status: 301, location: "https://chain.test/landed" },
    ]);
    expect(calls.urls).toEqual([
      "https://chain.test/",
      "https://chain.test/moved",
      "https://chain.test/landed",
    ]);
  });

  test("every hop fetch carries the same caller signal (one budget clock)", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const signal = new AbortController().signal;
    const transport = fakeTransport(
      (input) => {
        if (input === "https://sig.test/") return response(302, "/moved");
        return response(200);
      },
      calls,
    );
    await followRedirects(transport, "https://sig.test/", { signal: signal });
    expect(calls.signals).toHaveLength(2);
    expect(calls.signals[0]).toBe(signal);
    expect(calls.signals[1]).toBe(signal);
  });

  test("a 3xx without a Location ends the chain and is graded as-is", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const transport = fakeTransport(() => response(302), calls);
    const result = await followRedirects(transport, "https://bare3xx.test/");
    expect(result.status).toBe(302);
    expect(result.redirectHops).toBeUndefined();
    expect(calls.urls).toHaveLength(1);
  });

  test("a non-redirect status is returned untouched with no hop record", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const transport = fakeTransport(() => response(404), calls);
    const result = await followRedirects(transport, "https://four.test/");
    expect(result.status).toBe(404);
    expect(result.redirectHops).toBeUndefined();
    expect(calls.urls).toHaveLength(1);
  });

  test("a 304 with a Location header is not followed (outside the redirect status set)", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const transport = fakeTransport(() => response(304, "/elsewhere"), calls);
    const result = await followRedirects(transport, "https://cachenotmodified.test/");
    expect(result.status).toBe(304);
    expect(result.redirectHops).toBeUndefined();
    expect(calls.urls).toHaveLength(1);
  });

  test("an unusable Location ends the chain at the 3xx response", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const transport = fakeTransport(() => response(302, "http://[invalid"), calls);
    const result = await followRedirects(transport, "https://badlocation.test/");
    expect(result.status).toBe(302);
    expect(result.redirectHops).toBeUndefined();
    expect(calls.urls).toHaveLength(1);
  });

  test("a chain still redirecting at the hop cap faults (fetch's own guard)", async () => {
    const calls: { urls: string[]; signals: (AbortSignal | undefined)[] } = {
      urls: [],
      signals: [],
    };
    const transport = fakeTransport(() => response(301, "/next"), calls);
    await expect(
      followRedirects(transport, "https://loop.test/"),
    ).rejects.toThrow("Too many redirects");
    // initial request + one per followed hop, capped
    expect(calls.urls).toHaveLength(21);
  });
});
