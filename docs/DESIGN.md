# Probe — Design

The settled design, from the grilling session (see `GLOSSARY.md` for vocabulary, `docs/adr/0001` for the exit-code contract). This is the working spec. The README gets rewritten only when reality matches it.

## One verb

Probe is one command:

```
probe <target> [flags]
```

Flags:

| Flag | Effect |
|---|---|
| `--path <p>` (repeatable) | Adds a point check against a user-supplied health path |
| `--timeout <s>` | Run budget in seconds (default 10) |
| `--json` | Full machine-readable output |
| `--verbose` | Adds Facts and passing-check detail to the default output |
| `--quiet` | Prints only the verdict line (CI log-friendly) |

## Targets

- Accepted schemes: `http://` and `https://` only.
- Schemeless input (`probe staging.example.com`) gets an implicit `https://` prefix.
- Any other scheme (`ftp://`, `data:`) is rejected with a clear error before any network I/O.

## Checks, Facts, and the Verdict

Two categories of output from a Run:

- **Check** — can pass/fail; a failing check degrades the Verdict.
- **Fact** — a reported value that never affects the Verdict.

### Checks (fixed set for v1)

1. **Reachable** — validates the target root's HTTP status class against 2xx/3xx (3xx are followed via the redirect rule below). Reachability is validated at the root only; point checks cover any deeper paths. Fails with a Diagnosis on connection faults, refused connections, invalid responses, or a host that never answers.
2. **HTTPS/TLS** — validity window (not expired, not yet valid) and hostname match. Shallow depth only. Failure → Degraded, with the cert problem as the Diagnosis.
3. **Content sanity / body sniffing** — catches the 200-with-error-page brownouts: inspects the response body for common framework/infra failure markers (Framework-generated 502/503 pages, "Application Error"–class strings).
4. **Response time (non-gating)** — emits a Fact + rough adjective (fast / ok / slow). Cannot fail the Verdict under the default run budget unless the budget expires first.
5. **Point checks** (`--path`) — each supplied health path is checked individually and reported by name; any failing point check degrades the Verdict.

### Facts

Latency (with its adjective), HTTP version, `Server` header, the redirect chain. Facts never move the Verdict.

### The verdict

- **Healthy** → exit `0`. Everything checked passed; no skips.
- **Degraded** → exit `1`. reachable-and-sane but showing signs of trouble: failed check, failed point check, error status, TLS trouble short of unreachable, skip due to exhausted run budget.
- **Unreachable** → exit `2`. The Target could not be reached at all (DNS fault, connection refused, timeout with zero successful I/O), or the Run completed with zero completed checks — no completed evidence of a live Target to grade.

**Budget exhaustion semantics (confirmed):** Check skips are not check failures. If everything that completed passed but something was skipped, the Verdict is Degraded — incomplete evidence cannot yield full confidence. If nothing completed at all, Verdict is Unreachable.

**Latency gating (confirmed):** Response time never gates the Verdict. It is a Fact plus adjective.

## The Run lifecycle

- One hard **Run budget** — default 10s, overridable via `--timeout`.
- Checks are evaluated in dependency order; after a blocker fails or the budget expires, remaining checks are announced as skipped — never failed, never silent.
- Redirects: follow, announce the chain (`→ 301 https://…`), grade the final destination.
- Every network touch honors the shared budget; a check that would exceed it is skipped with a reason line instead of blindly timing out.

## Output

- **Default**: the check-line list (README style), with a Diagnosis line appended to failing checks, and the final Verdict line.
- **`--verbose`**: adds Facts (HTTP version, server header, latency detail) and full passing-check detail on top of default output. Never auto-on.
- **`--quiet`**: Verdict line only; CI-log-friendly.
- **`--json`**: the full shape — Verdict, Target, every Check with name/passed, every Fact with its value, plus metadata. Nothing is dropped; consumers can derive minimal projections but not reconstruct detail from a minimal shape.

## Packaging and process decisions

- Package name: `@edwardseoj/probe` (`probe` and `probe-cli` on npm are taken); the display name stays "Probe".
- Stack: TypeScript + Node.js runtime, `commander` (CLI parsing — no subcommand wiring for v1, `probe <url>` is the whole story), `undici` (HTTP), `chalk` + `ora` (terminal output), `Vitest` (tests), `tsup` (build), `pnpm`, GitHub Actions CI.
- Module layout: flat `src/` with `cli.ts`, `run.ts`, `verdict.ts`, `check.ts`, `checks/` as a directory with one file per Check (the showcase surface); presenter/input wiring in dedicated small modules (`output.ts`, `exit.ts` may be folded into `verdict.ts`/`output.ts` later if small).
- Exit-code mapping is owned by the verdict module — no Check sets its own exit code (per ADR-0001).
- Documentation order: `DESIGN.md` (this file) is the working spec; the README is rewritten only when the tool's behavior matches what it says. The tool is the demo — no separate demo asset for v1 "done".
