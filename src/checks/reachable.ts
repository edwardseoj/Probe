/**
 * Reachable — validates the target root's HTTP status class.
 * 2xx/3xx pass; 1xx/4xx/5xx fail with a Diagnosis. Network faults are
 * not graded here: they surface as Unreachable at the verdict level
 * (run.ts maps them), because a check never carries an exit code (ADR-0001).
 */

import { STATUS_CODES } from "node:http";

export interface HttpResponse {
  status: number;
  statusText: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  diagnosis?: string;
  /**
   * Structured note for checks that pass-with-note (e.g. the plain-HTTP
   * HTTPS/TLS check); optional, added by ticket #4. Presentation rules for
   * notes and Facts are owned by the output tickets — copy is not a contract.
   */
  note?: string;
}

export function reachableCheck(response: HttpResponse): CheckResult {
  const name = "Reachable";
  const ok = response.status >= 200 && response.status < 400;

  if (ok) {
    return { name: name, passed: true };
  }

  return {
    name: name,
    passed: false,
    diagnosis: diagnosisFor(response.status),
  };
}

function diagnosisFor(status: number): string {
  const statusText = STATUS_CODES[status];
  if (statusText === undefined) {
    return `HTTP ${status}`;
  }
  return `HTTP ${status} (${statusText})`;
}
