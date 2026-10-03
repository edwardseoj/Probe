/**
 * run(target, options) -> RunResult is the orchestrator seam: Target +
 * options in, verdict/checks out. The network is injected behind a single
 * fetch-like boundary (default wraps undici's fetch) and the TLS probe
 * behind a tls-probe-like boundary (default runs node:tls out-of-band —
 * see checks/tls.ts). No check ever sets an exit code; the verdict module
 * owns the verdict -> exit mapping (ADR-0001). Run budget bounds the
 * network call via an abort signal; abort maps to Unreachable (the Target
 * never answered).
 */

import { fetch as undiciFetch } from "undici";
import { reachableCheck } from "./checks/reachable.js";
import type { HttpResponse, CheckResult } from "./checks/reachable.js";
import {
  TLS_CHECK_NAME,
  tlsCheck,
  plainHttpTlsCheck,
  defaultTlsProbe,
} from "./checks/tls.js";
import type { TlsProbe } from "./checks/tls.js";
import type { Verdict } from "./verdict.js";

export type { Verdict } from "./verdict.js";
export { exitCodeFor } from "./verdict.js";

export interface RunOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutSeconds?: number;
  readonly tlsProbe?: TlsProbe;
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<HttpResponse>;

export interface RunResult {
  readonly target: string;
  readonly verdict: Verdict;
  readonly checks: readonly CheckResult[];
}

const DEFAULT_BUDGET_SECONDS = 10;

export async function run(
  target: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const budgetSeconds = options.timeoutSeconds ?? DEFAULT_BUDGET_SECONDS;
  const budgetMs = budgetSeconds * 1000;
  const doFetch: FetchLike =
    options.fetchImpl ??
    ((input, init) =>
      undiciFetch(input, init).then((res) => ({
        status: res.status,
        statusText: res.statusText,
      })));

  const budgetSignal = AbortSignal.timeout(budgetMs);
  const startedAt = Date.now();

  let response: HttpResponse;
  try {
    response = await doFetch(target, { signal: budgetSignal });
  } catch (error) {
    return faultResult(target, error);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    // Scheme validation is the CLI's job pre-network (usage error, exit 3);
    // run() defensively grades an unparseable Target like a fault, as before.
    return faultResult(
      target,
      Object.assign(new Error("invalid target URL"), { code: "ERR_INVALID_URL" }),
    );
  }

  const checks: CheckResult[] = [reachableCheck(response)];

  // HTTPS/TLS (ticket #4): https Targets get one out-of-band TLS probe,
  // graded shallowly (validity window + hostname, no chain walking). TLS
  // trouble degrades — it never maps to Unreachable. Plain-HTTP Targets
  // pass trivially with a note (decision pinned in checks/tls.ts).
  if (targetUrl.protocol === "https:") {
    await addHttpsTlsCheck(
      checks,
      targetUrl,
      options.tlsProbe ?? defaultTlsProbe,
      budgetMs - (Date.now() - startedAt),
    );
  } else {
    checks.push(plainHttpTlsCheck());
  }

  const verdict: Verdict = checks.every((check) => check.passed)
    ? "Healthy"
    : "Degraded";
  return { target: target, verdict: verdict, checks: checks };
}

/**
 * Ticket #6 owns shared-budget skip semantics and the per-check clock.
 * Until that machinery is merged, the probe is simply bounded by the
 * remaining Run budget: a probe that cannot finish in time fails the
 * check (Degraded), it never becomes Unreachable, and nothing here starts
 * a second budget clock.
 */
async function addHttpsTlsCheck(
  checks: CheckResult[],
  targetUrl: URL,
  probe: TlsProbe,
  remainingBudgetMs: number,
): Promise<void> {
  try {
    const cert = await probe({
      hostname: targetUrl.hostname,
      port: Number(targetUrl.port) || 443,
      timeoutMs: remainingBudgetMs,
    });
    checks.push(tlsCheck(cert));
  } catch (error) {
    checks.push({
      name: TLS_CHECK_NAME,
      passed: false,
      diagnosis: probeFailureDiagnosis(error),
    });
  }
}

function probeFailureDiagnosis(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "TLS_PROBE_TIMEOUT") {
    return "TLS probe timed out";
  }
  return "TLS handshake failed";
}

function faultResult(target: string, error: unknown): RunResult {
  const check: CheckResult = {
    name: "Reachable",
    passed: false,
    diagnosis: faultDiagnosis(error),
  };
  return { target: target, verdict: "Unreachable", checks: [check] };
}

function faultDiagnosis(error: unknown): string {
  const cause =
    error instanceof Error && "cause" in error
      ? (error.cause as { code?: string; name?: string; message?: string })
      : undefined;
  const name = error instanceof Error ? error.name : undefined;

  if (name === "AbortError" || cause?.name === "AbortError") {
    return "Request timed out";
  }
  if (name === "ConnectTimeoutError" || cause?.name === "ConnectTimeoutError") {
    return "Request timed out";
  }

  const code = (error as { code?: string })?.code ?? cause?.code;
  if (code === "ECONNREFUSED") {
    return "Connection refused";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return "DNS lookup failed";
  }

  return "Request failed";
}
