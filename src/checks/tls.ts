/**
 * HTTPS/TLS — shallow TLS grading: certificate validity window (not
 * expired, not yet valid) and hostname match. Shallow depth only; no
 * manual chain walking (ticket #4).
 *
 * Pinned decisions:
 * - Plain-HTTP Targets pass trivially with a structured note — no
 *  Diagnosis, no skip. The Check has nothing to grade over plain HTTP,
 *   and `probe http://...` must stay capable of Healthy.
 * - Certificate data is unreachable through the fetch response, so the
 *   probe runs out-of-band via node:tls: `rejectUnauthorized: false` so
 *   the socket can hand over the certificate for inspection instead of
 *   refusing, `servername` pinned to the hostname, and the port taken
 *   from the Target URL (443 default). The probe is bounded by the
 *   remaining Run budget (run.ts; shared-budget skip semantics are owned
 *   by ticket #6).
 * - TLS trouble is a failed Check -> Degraded (trouble short of
 *   unreachable) — never Unreachable. Diagnoses state the fact: no
 *   advice, no emoji, no chain walking.
 */

import { connect as tlsConnect } from "node:tls";
import type { TLSSocket } from "node:tls";
import type { CheckResult } from "../check.js";

export const TLS_CHECK_NAME = "HTTPS/TLS";

/** Cert-shaped data the probe lifts off the socket; dates are the essence. */
export interface TlsCertInfo {
  readonly validFrom: string;
  readonly validTo: string;
  readonly hostnameMatches: boolean;
}

export interface TlsProbeInput {
  readonly hostname: string;
  readonly port: number;
  readonly timeoutMs: number;
}

export type TlsProbe = (input: TlsProbeInput) => Promise<TlsCertInfo>;

/**
 * Grades synthetic-or-real cert data against `now`. Validity window first,
 * then hostname. Unreadable dates fail rather than passing on garbage.
 */
export function tlsCheck(cert: TlsCertInfo, now: Date = new Date()): CheckResult {
  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);

  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    return fail("Certificate validity unreadable");
  }
  if (validTo.getTime() < now.getTime()) {
    return fail("Certificate expired");
  }
  if (validFrom.getTime() > now.getTime()) {
    return fail("Certificate not yet valid");
  }
  if (!cert.hostnameMatches) {
    return fail("Certificate hostname mismatch");
  }

  return { name: TLS_CHECK_NAME, passed: true };
}

/**
 * Plain-HTTP case: a trivial pass carrying a structured note (tests
 * assert on `note` being defined, never on its copy). Presentation of the
 * note is owned by the output tickets (#2), the same as Facts.
 */
export function plainHttpTlsCheck(): CheckResult {
  return {
    name: TLS_CHECK_NAME,
    passed: true,
    note: "not applicable over plain HTTP",
  };
}

/**
 * Default out-of-band probe: one node:tls connection, certificate
 * inspected and normalized to TlsCertInfo. Bounded by the remaining Run
 * budget via timeoutMs (no second clock of its own beyond that one
 * connection's timer); a timeout surfaces as a probe failure so run() can
 * degrade the check, never mark the Target unreachable.
 */
export const defaultTlsProbe: TlsProbe = ({ hostname, port, timeoutMs }) => {
  return new Promise<TlsCertInfo>((resolve, reject) => {
    const socket: TLSSocket = tlsConnect({
      host: hostname,
      port: port,
      servername: hostname,
      rejectUnauthorized: false,
    });

    function settle(error?: Error, cert?: TlsCertInfo): void {
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(cert as TlsCertInfo);
    }

    const timer = setTimeout(() => {
      settle(
        Object.assign(new Error("TLS probe timed out"), {
          code: "TLS_PROBE_TIMEOUT",
        }),
      );
    }, Math.max(1, timeoutMs));

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (
        typeof cert.valid_from !== "string" ||
        typeof cert.valid_to !== "string"
      ) {
        settle(new Error("no peer certificate presented"));
        return;
      }
      settle(undefined, {
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        hostnameMatches: socket.authorized,
      });
    });

    socket.once("error", (error: Error) => {
      settle(error);
    });
  });
};

function fail(diagnosis: string): CheckResult {
  return { name: TLS_CHECK_NAME, passed: false, diagnosis: diagnosis };
}
