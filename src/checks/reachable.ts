/**
 * Reachable — validates the target root's HTTP status class.
 * 2xx/3xx pass; 1xx/4xx/5xx fail with a Diagnosis. Network faults are
 * not graded here: they surface as Unreachable at the verdict level
 * (run.ts maps them), because a check never carries an exit code (ADR-0001).
 */

import { STATUS_CODES } from "node:http";

/**
 * The HTTP seam shape run() hands to checks. Every field past status/statusText
 * is optional and additive — a transport fills what it can (ticket #8 owns this
 * shape; other tickets extend options/additively and reconcile at merge).
 *
 * - `httpVersion` / `headers` / `body`: captured when the transport provides them.
 * - `elapsedMs`: transport-provided response timing; run() falls back to its own
 *   wall clock when the seam omits it.
 */
export interface HttpResponse {
  status: number;
  statusText: string;
  httpVersion?: string;
  headers?: { get(name: string): string | null };
  body?: string;
  elapsedMs?: number;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  diagnosis?: string;
  /** Verbose-tier detail for passing checks; never rendered in the default tier. */
  detail?: string;
}

export function reachableCheck(response: HttpResponse): CheckResult {
  const name = "Reachable";
  const ok = response.status >= 200 && response.status < 400;

  if (ok) {
    return { name: name, passed: true, detail: statusLine(response.status) };
  }

  return {
    name: name,
    passed: false,
    diagnosis: statusLine(response.status),
  };
}

function statusLine(status: number): string {
  const statusText = STATUS_CODES[status];
  if (statusText === undefined) {
    return `HTTP ${status}`;
  }
  return `HTTP ${status} (${statusText})`;
}
