# SPEC.md

The authoritative specification for Probe: what the tool does, how it behaves, and what counts as done. If this file conflicts with `README.md`, **this file wins**; the README is the intro and pitch, not the contract. Implementation rationale lives in `docs/DESIGN.md`, vocabulary in `GLOSSARY.md`, and the exit-code decision record in `docs/adr/0001-graduated-exit-codes.md`.

## Purpose

Probe is a lightweight CLI for performing a **post-deployment sanity check** on an HTTP service: deploy, run Probe, know. It answers four questions quickly — is the service reachable, is it responding, does it appear healthy, did the deployment come up — without requiring a test suite, monitoring platform, or load tool.

**Scope constraints.** Probe stays a small, focused developer utility. It is not a replacement for: API testing frameworks, load-testing tools, monitoring platforms, observability systems, or browser testing. No feature is added unless it serves quick post-deploy sanity checking.

## The command

One verb, no subcommands:

```
probe <target> [flags]
```

### Targets

- Only `http://` and `https://` schemes are accepted.
- Schemeless input (`probe staging.example.com`) gets an implicit `https://` prefix.
- Any other scheme (`ftp://`, `data:`) is rejected with a clear error **before any network I/O**, with exit code 3 (see "Contract stability" and `docs/adr/0002-usage-error-exit-code.md`); usage errors are not verdicts.

### Flags

| Flag | Effect |
|---|---|
| `--path <p>` (repeatable) | Adds a **point check** against a user-supplied health path |
| `--timeout <s>` | **Run budget** in seconds (default 10) |
| `--json` | Full machine-readable output |
| `--verbose` | Adds Facts and passing-check detail to the default output |
| `--quiet` | Prints only the verdict line (CI log-friendly) |

## Checks, Facts, and the Verdict

A **Run** produces two categories of output:

- **Check** — an assertion that can pass or fail; a failing check degrades the Verdict.
- **Fact** — a reported value that never affects the Verdict (latency, HTTP version, `Server` header, redirect chain).

### Checks (fixed set for v1)

1. **Reachable** — validates the target root's HTTP status class; reachability is validated at the root only. Fails with a Diagnosis on connection faults, refused connections, invalid responses, or a host that never answers.
2. **HTTPS/TLS** — validity window (not expired, not yet valid) and hostname match. Shallow depth only.
3. **Content sanity (body sniffing)** — catches the 200-with-error-page brownout: inspects the body for common framework/infra failure markers.
4. **Response time (non-gating)** — emits a Fact plus a rough adjective (fast / ok / slow). Never fails the Verdict under the default budget.
5. **Point checks (`--path`)** — each supplied health path is checked individually and reported by name.

### Budget and lifecycle

- One hard **Run budget** — default 10s, overridable via `--timeout`. Every network touch honors it.
- Checks evaluate in dependency order. After a blocker fails or the budget expires, remaining checks are **announced as skipped** — never failed, never silent.
- Redirects are followed and the chain announced (`→ 301 https://…`); the final destination is graded.

### The verdict

| Verdict | Meaning | Exit code |
|---|---|---|
| **Healthy** | Everything checked passed; no skips | `0` |
| **Degraded** | Reached and responded, but signs of trouble: failed check, failed point check, error status, TLS trouble short of unreachable, or a skip from an exhausted budget | `1` |
| **Unreachable** | Could not be reached at all (DNS fault, connection refused, timeout with zero successful I/O), or the run completed with zero completed checks | `2` |

Outside the verdict model:

| Situation | Exit code |
|---|---|
| **Usage error** — input rejected before a Run could begin (non-HTTP scheme, unknown flag) | `3` |

- **Skips are not failures.** If everything that completed passed but something was skipped, the Verdict is Degraded — incomplete evidence cannot yield full confidence.
- **Latency never gates the Verdict.**
- The verdict→exit mapping is owned by the verdict module; no check sets its own exit code. See `docs/adr/0001-graduated-exit-codes.md`.
- **Usage errors exit `3`, before any network I/O, and outside the verdict→exit mapping** — they are not a Verdict and never pass through it. See `docs/adr/0002-usage-error-exit-code.md`.

## Output

- **Default**: check-line list (README style), a Diagnosis line appended to failing checks, and the final verdict line.
- **`--verbose`**: adds Facts and full passing-check detail. Never auto-on.
- **`--quiet`**: verdict line only.
- **`--json`**: the full shape — Verdict, Target, every Check with name/passed, every Fact with its value, plus metadata. Nothing dropped; consumers can derive minimal projections but cannot reconstruct detail from a minimal shape.

### Degraded environments

- **Non-TTY (piped, CI)**: auto-degrade — glyphs kept, color disabled, no spinner. (`NO_COLOR` is respected by the color library.)
- **`--json`**: never colored, never spun; always clean machine output.

## Contract stability

Two different stability classes:

- **Stable contract (breaking changes are version-breaking)**: exit codes (per ADR-0001, this is a published contract; exit 3 for usage errors per ADR-0002), the `--json` shape, flag names and semantics, and the verdict vocabulary (Healthy / Degraded / Unreachable).
- **Not a contract**: human-facing copy — verdict lines, Diagnosis phrasing, adjectives, glyphs. These may be tuned; scripts must not parse them. Scripts use `--json` or exit codes.

## Tech stack

TypeScript, Node.js, `commander` (CLI parsing), `undici` (HTTP), `chalk` + `ora` (terminal output), Vitest (tests), tsup (build), pnpm (package manager), GitHub Actions (CI). Package name: `@edwardseoj/probe` (`probe` is taken on npm). The stack is intentionally lightweight — no additional infrastructure or frameworks without a clear reason.

## Definition of done (v1)

v1 is done when all of the following hold:

1. `probe <url>` runs with the flag table above fully implemented and doc-checkable (`--help` reflects it).
2. Target scheme validation rejects non-HTTP(S) input before any network I/O.
3. All five checks from the fixed set are implemented and behave per this spec.
4. The verdict→exit-code mapping (0/1/2) matches ADR-0001, and skip/budget-exhaustion semantics match the "Skips are not failures" rule.
5. All four output modes (default, `--verbose`, `--quiet`, `--json`) are implemented, including the non-TTY degradations.
6. Tests cover checks, verdict mapping, budget/skip behavior, and output modes (Vitest).
7. CI (GitHub Actions) is green: build, typecheck, tests.
8. The package builds and installs as `@edwardseoj/probe` via tsup/pnpm.
9. `README.md` may be rewritten only when the tool's actual behavior matches it — until then, `SPEC.md` is the truth agents follow.
