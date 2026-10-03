/**
 * Point check — validates one user-supplied health path's HTTP status
 * class. One point check exists per `--path` value; each is reported by
 * name (`Point check <path>`), and a failure degrades the verdict like
 * any other check. Grading shares the Reachable status-class rule.
 */

import type { HttpResponse, CheckResult } from "./reachable.js";
import { statusClassCheck } from "./reachable.js";

export function pointCheck(response: HttpResponse, path: string): CheckResult {
  return statusClassCheck(`Point check ${path}`, response);
}
