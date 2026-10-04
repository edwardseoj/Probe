/**
 * run(target, options) -> RunResult is the orchestrator seam: Target +
 * options in, verdict/checks out. The network is injected behind a single
 * fetch-like boundary (the default transport follows redirects and
 * announces the chain — see redirects.ts) and the TLS probe behind a
 * tls-probe-like boundary (default runs node:tls out-of-band — see
 * checks/tls.ts). No check ever sets an exit code; the verdict module
 * owns verdict derivation and the verdict -> exit mapping (ADR-0001).
 *
 * Run budget: ONE shared clock (AbortSignal.timeout) bounds every network
 * touch. Checks run in dependency order over that clock; a check that never
 * produces evidence is announced (skipped/faulted), never failed and never
 * silent. Zero completed checks -> Unreachable.
 */

import { reachableCheck } from "./checks/reachable.js";
import { contentSanityCheck } from "./checks/content-sanity.js";
import type { HttpResponse } from "./checks/reachable.js";
import { followRedirects, undiciManualFetch } from "./redirects.js";
import {
  TLS_CHECK_NAME,
  tlsCheck,
  plainHttpTlsCheck,
  defaultTlsProbe,
} from "./checks/tls.js";
import type { TlsProbe } from "./checks/tls.js";
import { pointCheck } from "./checks/point.js";
import { skippedCheck, faultedCheck, isCompleted } from "./check.js";
import type { CheckResult } from "./check.js";
import { deriveVerdict } from "./verdict.js";
import type { Verdict } from "./verdict.js";

export type { Verdict } from "./verdict.js";
export { exitCodeFor, deriveVerdict } from "./verdict.js";
export { skippedCheck, faultedCheck, isCompleted, statusOf } from "./check.js";
export type { CheckResult, CheckStatus } from "./check.js";

export interface RunOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutSeconds?: number;
  readonly tlsProbe?: TlsProbe;
  /** Health paths from repeatable --path; one Point check per path. */
  readonly paths?: readonly string[];
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<HttpResponse>;

/**
 * A Fact: a reported value from a Run that never affects the Verdict
 * (latency, HTTP version, Server header, the redirect chain).
 */
export interface Fact {
  readonly name: string;
  readonly value: string;
}

export interface RunResult {
  readonly target: string;
  readonly verdict: Verdict;
  readonly checks: readonly CheckResult[];
  /** Present on every completed run (a response answered); absent on faults. */
  readonly facts?: readonly Fact[];
  /**
   * The Run budget actually applied to this Run (seconds), threaded
   * explicitly from RunOptions for run metadata — no globals (ticket #9:
   * --json metadata must report how the run was bounded).
   */
  readonly budgetSeconds?: number;
}

const DEFAULT_BUDGET_SECONDS = 10;

/**
 * Latency adjective thresholds — a non-contract tunable (SPEC "Contract
 * stability"): they shape the Fact's value copy only, never the Verdict.
 */
const FAST_MS = 300;
const OK_MS = 1000;

/**
 * A single unit of network work over the shared budget clock. The check
 * performs its fetches/probes against `signal`; returning a CheckResult
 * grades it. Tickets adding checks to the epic register them here as
 * sequenced steps.
 */
interface CheckStep {
  readonly name: string;
  perform(signal: AbortSignal): Promise<CheckResult>;
}

export async function run(
  target: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const budgetSeconds = options.timeoutSeconds ?? DEFAULT_BUDGET_SECONDS;
  const budgetMs = budgetSeconds * 1000;
  // Default transport: follow redirects and collect each hop as Facts
  // (src/redirects.ts); an injected fetchImpl IS the whole transport.
  const doFetch: FetchLike =
    options.fetchImpl ??
    ((input, init) => followRedirects(undiciManualFetch, input, init));

  const budgetSignal = AbortSignal.timeout(budgetMs);
  const startedAt = Date.now();

  let targetUrl: URL | null = null;
  try {
    targetUrl = new URL(target);
  } catch {
    // Scheme validation is the CLI's job pre-network (usage error, exit 3);
    // run() defensively grades an unparseable Target like a fault, as before.
  }

  // The root response grades multiple checks (Reachable, Content sanity,
  // Response-time Fact), so the root fetch is its own step and later steps
  // consume the shared evidence instead of re-touching the network.
  let rootResponse: HttpResponse | undefined;
  // ALPN negotiated by the out-of-band TLS probe, captured from the probe
  // step (see factsFor for how the HTTP version Fact composes from it).
  let alpnProtocol: string | undefined;

  const steps: CheckStep[] = [
    {
      name: "Reachable",
      perform: async () => {
        if (targetUrl === null) {
          throw Object.assign(new Error("invalid target URL"), {
            code: "ERR_INVALID_URL",
          });
        }
        // Latency is a Fact, never a check: time the root fetch so the
        // Response-time Fact can report it (transport-provided elapsedMs
        // wins when the seam supplies one).
        const rootFetchStartedAt = performance.now();
        rootResponse = await doFetch(target, { signal: budgetSignal });
        rootResponse = {
          ...rootResponse,
          elapsedMs: rootResponse.elapsedMs ?? performance.now() - rootFetchStartedAt,
        };
        return reachableCheck(rootResponse);
      },
    },
    {
      name: TLS_CHECK_NAME,
      perform: async () => {
        // HTTPS/TLS (ticket #4): https Targets get one out-of-band TLS
        // probe graded shallowly (validity window + hostname, no chain
        // walking). TLS trouble degrades — it never maps to Unreachable,
        // so probe failures are graded here, never thrown. Plain-HTTP
        // Targets pass trivially with a note (pinned in checks/tls.ts).
        if (targetUrl !== null && targetUrl.protocol === "https:") {
          try {
            const cert = await (options.tlsProbe ?? defaultTlsProbe)({
              hostname: targetUrl.hostname,
              port: Number(targetUrl.port) || 443,
              timeoutMs: budgetMs - (Date.now() - startedAt),
            });
            // The probe connection's negotiated ALPN (additive on the cert
            // shape) feeds the HTTP version Fact when the transport reports
            // none — a shallow approximation of the graded fetch, so the
            // transport-provided value always wins in factsFor.
            alpnProtocol = cert.alpnProtocol;
            return tlsCheck(cert);
          } catch (error) {
            return {
              name: TLS_CHECK_NAME,
              passed: false,
              diagnosis: probeFailureDiagnosis(error),
            };
          }
        }
        return plainHttpTlsCheck();
      },
    },
    {
      name: "Content sanity",
      perform: async () => contentSanityCheck(rootResponse as HttpResponse),
    },
    ...buildPointCheckSteps(target, options.paths ?? [], doFetch),
  ];

  const checks: CheckResult[] = [];
  /**
   * Set by the check that blocked the run (graded failure or fault); the
   * remaining steps are then skipped with a reason naming it — the true
   * cause, never the default budget reason. Budget expiry still wins when
   * the clock is gone: those skips are genuine budget-expiry skips.
   */
  let blockerReason: string | undefined;
  for (const step of steps) {
    if (budgetSignal.aborted) {
      // Genuine budget exhaustion: skippedCheck's default reason.
      checks.push(skippedCheck(step.name));
      continue;
    }
    if (blockerReason !== undefined) {
      checks.push(skippedCheck(step.name, blockerReason));
      continue;
    }
    try {
      const check = await step.perform(budgetSignal);
      checks.push(check);
      // Only a graded failure blocks the remaining steps; skipped and
      // faulted check results announce missing evidence without starving
      // later steps of their own turn.
      if (isCompleted(check) && !check.passed) {
        blockerReason = `${check.name} failed`;
      }
    } catch (error) {
      if (budgetExpired(budgetSignal, error)) {
        // Never blindly timed out into a failure: a budget-expired abort is
        // announced as skipped (zero completed checks then grade Unreachable
        // through the shared derivation).
        checks.push(skippedCheck(step.name));
      } else {
        checks.push(faultedCheck(step.name, faultDiagnosis(error)));
        blockerReason = `${step.name} faulted`;
      }
    }
  }

  return {
    target: target,
    verdict: deriveVerdict(checks),
    checks: checks,
    // Facts attach only to completed runs (a root response answered);
    // faulted runs have no response to report values from.
    facts:
      rootResponse !== undefined
        ? factsFor(rootResponse, alpnProtocol)
        : undefined,
    budgetSeconds: budgetSeconds,
  };
}

/**
 * The redirect chain announces one Fact per hop; both run.ts (producers) and
 * output.ts (presenter) key on this single name.
 */
export const REDIRECT_FACT_NAME = "Redirect";

/**
 * Facts from a completed response. The redirect chain is announced one Fact
 * per hop, name "Redirect", value "<status> <url>" — hop order, first hop
 * first. Chain hops are Fact-only: they never move the Verdict; the final
 * destination's grade is what checks carry. Response time is always present
 * (latency is a Fact, never a check, measured over the whole root fetch
 * including hops); HTTP version and the Server header appear only when a
 * source captured them.
 *
 * HTTP version composition (additive, transport first): a transport-provided
 * httpVersion always wins. Otherwise, over https the out-of-band TLS probe
 * negotiated a protocol on its own connection — a shallow approximation of
 * the graded fetch (they can differ; see checks/tls.ts): "h2" reports
 * HTTP/2, anything else (including empty) reports HTTP/1.1. No probe result
 * or plain-HTTP Target: no HTTP version Fact.
 */
function factsFor(
  response: HttpResponse,
  alpnProtocol: string | undefined,
): Fact[] {
  const facts: Fact[] = [];
  for (const hop of response.redirectHops ?? []) {
    facts.push({
      name: REDIRECT_FACT_NAME,
      value: `${hop.status} ${hop.location}`,
    });
  }
  const elapsedMs = Math.round(response.elapsedMs ?? 0);
  facts.push({
    name: "Response time",
    value: `${elapsedMs} ms (${latencyAdjective(elapsedMs)})`,
  });

  const httpVersion = response.httpVersion ?? versionFromAlpn(alpnProtocol);
  if (httpVersion !== undefined) {
    facts.push({ name: "HTTP version", value: httpVersion });
  }

  const server = response.headers?.get("server");
  if (server !== null && server !== undefined && server !== "") {
    facts.push({ name: "Server", value: server });
  }

  return facts;
}

function versionFromAlpn(alpnProtocol: string | undefined): string | undefined {
  if (alpnProtocol === undefined) {
    return undefined;
  }
  return alpnProtocol === "h2" ? "HTTP/2" : "HTTP/1.1";
}

function latencyAdjective(elapsedMs: number): "fast" | "ok" | "slow" {
  if (elapsedMs < FAST_MS) {
    return "fast";
  }
  if (elapsedMs < OK_MS) {
    return "ok";
  }
  return "slow";
}

/**
 * One point check per path through the same fetch seam and the same
 * budget signal as the root check (ticket #5). A point-fetch fault never
 * grades Unreachable — the Target was proven reachable at the root — so
 * the fault is announced as a skipped check with a fault-appropriate
 * reason (skippedCheck's default reason is reserved for genuine budget
 * exhaustion).
 */
function buildPointCheckSteps(
  target: string,
  paths: readonly string[],
  doFetch: FetchLike,
): CheckStep[] {
  return paths.map((path) => ({
    name: `Point check ${path}`,
    perform: async (signal: AbortSignal) => {
      try {
        const response = await doFetch(`${target}${path}`, { signal: signal });
        return pointCheck(response, path);
      } catch (error) {
        const skipReason = budgetExpired(signal, error)
          ? undefined // genuine budget exhaustion: skippedCheck's default reason
          : faultDiagnosis(error);
        return skippedCheck(`Point check ${path}`, skipReason);
      }
    },
  }));
}

function probeFailureDiagnosis(error: unknown): string {
  if (errorShape(error).code === "TLS_PROBE_TIMEOUT") {
    return "TLS probe timed out";
  }
  return "TLS handshake failed";
}

/**
 * One place for the error-introspection shape the fault mapping uses: the
 * error's own name/code plus whatever name/code its `cause` carries
 * (transports wrap aborts and connect faults in causes).
 */
function errorShape(error: unknown): {
  name?: string;
  code?: string;
  causeName?: string;
  causeCode?: string;
} {
  const cast = error as
    | { name?: string; code?: string; cause?: { name?: string; code?: string } }
    | undefined;
  return {
    name: error instanceof Error ? error.name : undefined,
    code: cast?.code,
    causeName: cast?.cause?.name,
    causeCode: cast?.cause?.code,
  };
}

/**
 * The run budget is the only abort source: a deadline abort (or an abort-
 * shaped rejection from the fetch boundary) means budget exhausted, not a
 * Target fault.
 */
function budgetExpired(signal: AbortSignal, error: unknown): boolean {
  if (signal.aborted) {
    return true;
  }
  const shape = errorShape(error);
  return shape.name === "AbortError" || shape.causeName === "AbortError";
}

function faultDiagnosis(error: unknown): string {
  const shape = errorShape(error);

  if (shape.name === "AbortError" || shape.causeName === "AbortError") {
    return "Request timed out";
  }
  if (
    shape.name === "ConnectTimeoutError" ||
    shape.causeName === "ConnectTimeoutError"
  ) {
    return "Request timed out";
  }

  const code = shape.code ?? shape.causeCode;
  if (code === "ECONNREFUSED") {
    return "Connection refused";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return "DNS lookup failed";
  }

  return "Request failed";
}
