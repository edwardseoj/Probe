import { describe, expect, test } from "vitest";
import { TLS_CHECK_NAME, plainHttpTlsCheck, tlsCheck } from "./tls.js";
import type { TlsCertInfo } from "./tls.js";

const NOW = new Date("2026-01-05T00:00:00Z");

/**
 * Cert-shaped fixtures: dates are the essence (validity window), and the
 * hostname question is a boolean lifted off the socket — never a real
 * certificate and never a real socket (tests must not open sockets).
 */
function certFixture(overrides: Partial<TlsCertInfo> = {}): TlsCertInfo {
  return {
    validFrom: "Jan 1 00:00:00 2020 GMT",
    validTo: "Jan 1 00:00:00 2030 GMT",
    hostnameMatches: true,
    ...overrides,
  };
}

describe("HTTPS/TLS check", () => {
  test("carries the name HTTPS/TLS on its result", () => {
    expect(tlsCheck(certFixture(), NOW).name).toBe("HTTPS/TLS");
    expect(TLS_CHECK_NAME).toBe("HTTPS/TLS");
  });

  test("passes a certificate whose window covers now with a matching hostname", () => {
    const check = tlsCheck(certFixture(), NOW);
    expect(check.passed).toBe(true);
  });

  test("passes without a Diagnosis (absent for passing checks, by design)", () => {
    const check = tlsCheck(certFixture(), NOW);
    expect(check.diagnosis).toBeUndefined();
  });

  test("fails an expired certificate", () => {
    const check = tlsCheck(
      certFixture({ validTo: "Jan 1 00:00:00 2020 GMT" }),
      NOW,
    );
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toBeDefined();
  });

  test("fails a certificate that is not yet valid", () => {
    const check = tlsCheck(
      certFixture({ validFrom: "Jan 1 00:00:00 2050 GMT" }),
      NOW,
    );
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toBeDefined();
  });

  test("fails a hostname mismatch", () => {
    const check = tlsCheck(certFixture({ hostnameMatches: false }), NOW);
    expect(check.passed).toBe(false);
    expect(check.diagnosis).toBeDefined();
  });

  test("fails unreadable validity dates instead of passing on garbage", () => {
    const check = tlsCheck(certFixture({ validFrom: "not-a-date" }), NOW);
    expect(check.passed).toBe(false);
  });

  test("does not carry an exit code (the verdict module owns those)", () => {
    const check = tlsCheck(
      certFixture({ hostnameMatches: false }),
      NOW,
    );
    expect(Object.keys(check)).not.toContain("exitCode");
  });
});

describe("HTTPS/TLS check on plain-HTTP targets", () => {
  test("passes trivially with a structured note", () => {
    const check = plainHttpTlsCheck();
    expect(check.name).toBe("HTTPS/TLS");
    expect(check.passed).toBe(true);
    expect(check.note).toBeDefined();
  });

  test("carries no Diagnosis and no skip on plain HTTP", () => {
    const check = plainHttpTlsCheck();
    expect(check.diagnosis).toBeUndefined();
  });
});
