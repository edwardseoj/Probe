/**
 * Redirect handling for the default transport (ticket #7): follow the
 * chain and ANNOUNCE it. The loop drives a manual-mode fetch boundary
 * (undici's manual redirect mode returns the actual 3xx response, not an
 * opaque one, so each hop's status + Location stay readable) and returns
 * the FINAL destination response — what every check grades. Each followed
 * hop rides the response as `redirectHops`, announced as Facts by run()
 * (one per hop, never moving the Verdict). Location resolves against the
 * requesting URL (relative and absolute both); a 3xx without a usable
 * Location ends the chain and is graded as-is. Every hop shares the
 * caller's one budget clock via the same signal (no second timers) and
 * the same hop cap as fetch's automatic following: a chain still
 * redirecting at the cap faults like fetch's own guard.
 */

import { fetch as undiciFetch } from "undici";
import type { HttpResponse, RedirectHop } from "./checks/reachable.js";

/**
 * Redirect statuses the fetch spec follows (undici's redirectStatusSet).
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Same hop cap as fetch's automatic following. */
const MAX_REDIRECTS = 20;

/**
 * The transport-level fetch boundary the redirect loop drives. Structurally
 * the run seam's FetchLike; declared here to keep the seam single and the
 * import direction run -> redirects. Tests substitute it (unit pins) the
 * same way run() substitutes FetchLike.
 */
export type RedirectFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<HttpResponse>;

/** Default RedirectFetch: undici fetch pinned to manual redirect mode. */
export async function undiciManualFetch(
  input: string,
  init?: { signal?: AbortSignal },
): Promise<HttpResponse> {
  return undiciFetch(input, { ...init, redirect: "manual" }).then(toHttpResponse);
}

export async function followRedirects(
  transport: RedirectFetch,
  input: string,
  init?: { signal?: AbortSignal },
): Promise<HttpResponse> {
  const hops: RedirectHop[] = [];
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // Unparseable input is graded as a fault upstream; hand it back to the
    // transport so the error surfaces through the same seam as before.
    return transport(input, init);
  }

  let response = await transport(input, init);
  while (REDIRECT_STATUSES.has(response.status) && hops.length < MAX_REDIRECTS) {
    const location = response.headers?.get("location") ?? null;
    if (location === null || location === "") {
      break;
    }
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      // Unusable Location: the 3xx response itself is the final destination.
      break;
    }
    url = next;
    hops.push({ status: response.status, location: next.href });
    response = await transport(next.href, init);
  }

  if (REDIRECT_STATUSES.has(response.status) && hops.length >= MAX_REDIRECTS) {
    throw new Error("Too many redirects");
  }

  return hops.length > 0 ? { ...response, redirectHops: hops } : response;
}

async function toHttpResponse(
  res: Awaited<ReturnType<typeof undiciFetch>>,
): Promise<HttpResponse> {
  return {
    status: res.status,
    statusText: res.statusText,
    httpVersion: "httpVersion" in res ? String(res.httpVersion) : undefined,
    headers: res.headers,
    body: await res.text(),
  };
}
