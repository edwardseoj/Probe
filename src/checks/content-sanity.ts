/**
 * Content sanity — catches the 200-with-error-page brownout. A 2xx response
 * whose body carries a framework/infra error marker is a failing check with
 * a Diagnosis (Degraded verdict): the deployment answered, but not with the
 * page it should. Sniffs only when a body is available; a body with no
 * markers passes; passing checks carry no Diagnosis.
 */

import type { HttpResponse, CheckResult } from "./reachable.js";

/**
 * Error-marker list, kept modest and explainable: "Application Error"-class
 * application strings plus the titles of framework/infra-generated
 * 502/503 pages. Matching is case-insensitive. Extend only with markers a
 * deployment operator would recognize — not a general XSS/honeypot list.
 */
const ERROR_MARKERS: readonly string[] = [
  "Application Error",
  "Bad Gateway",
  "Service Unavailable",
];

const CHECK_NAME = "Content sanity";

export function contentSanityCheck(response: HttpResponse): CheckResult {
  if (response.body === undefined) {
    return { name: CHECK_NAME, passed: true };
  }

  const body = response.body.toLowerCase();
  const marker = ERROR_MARKERS.find((candidate) => body.includes(candidate.toLowerCase()));

  if (marker === undefined) {
    return { name: CHECK_NAME, passed: true };
  }

  return {
    name: CHECK_NAME,
    passed: false,
    diagnosis: `Error marker in response body (${marker})`,
  };
}
