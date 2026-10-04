# Probe

**Deploy → Probe → Know.**

A lightweight CLI for performing a post-deployment sanity check on an HTTP
service: deploy, run Probe, know. It answers four questions quickly — is the
service reachable, is it responding, does it appear healthy, did the deployment
come up — without a test suite, a monitoring platform, or a load tool.

## Install

```bash
npm install -g @edwardseoj/probe
```

Or run it without installing:

```bash
npx @edwardseoj/probe https://staging.example.com
```

## Example

```bash
probe https://staging.example.com
```

```text
✓ Reachable
✓ HTTPS/TLS
✓ Content sanity
Deployment looks healthy.
```

Glyphs: `✓` pass, `✖` fail, `-` skipped. A failing check gets one Diagnosis
line beneath it, stating a fact — e.g. `HTTP 502 (Bad Gateway)` — never advice.

## Usage

```bash
probe <target> [flags]
```

A schemeless target gets an implicit `https://` prefix. Non-HTTP schemes and
unknown flags are usage errors (exit 3) rejected before any network I/O.

| Flag | Effect |
| --- | --- |
| `--path <p>` | Point check one health path; repeatable. Must start with `/`. |
| `--timeout <seconds>` | Run budget in seconds (default 10). |
| `--verbose` | Adds Facts and passing-check detail to the default output. |
| `--quiet` | Prints only the Verdict line. |
| `--json` | Full machine-readable output (stable shape). |

## Docker image

The image ships on GitHub Container Registry:

```bash
docker pull ghcr.io/edwardseoj/probe
```

Reach for the image when the Target is only reachable from inside the deploy
network — a same-host post-deploy check, a k8s Job, or a `docker compose run`.
The image runs as non-root with `probe` as the entrypoint, so the Target and
flags pass through plainly, no shell wrapper:

```bash
docker run --rm ghcr.io/edwardseoj/probe <target> [flags]
docker run --rm ghcr.io/edwardseoj/probe https://staging.example.com --json
```

Tags mirror the package releases in lockstep: pin a semver
(`ghcr.io/edwardseoj/probe:1.2.3`) or move with `latest` — both are published
on each Release.

## Checks

One Run grades a fixed set of checks, in order, over one shared Run budget —
a single clock that bounds every network touch. A check that would exceed the
budget is skipped with a reason line instead of blindly timing out.

1. **Reachable** — validates the Target root's HTTP status class; reachability
   is validated at the root only. Fails with a Diagnosis on connection faults,
   refused connections, invalid responses, or a host that never answers.
2. **HTTPS/TLS** — certificate validity window (not expired, not yet valid) and
   hostname match. Shallow depth only. Plain-HTTP Targets pass trivially.
3. **Content sanity** — validates the root response body.
4. **Point check `<path>`** — one per `--path`; validates that path's HTTP
   status class.

A failing check blocks the checks after it: they are skipped with the reason
named, and the Run grades Degraded.

## Verdicts and exit codes

| Verdict | Meaning | Exit code |
| --- | --- | --- |
| Healthy | All graded checks pass | `0` |
| Degraded | Alongside completed checks: a graded check failed, or a check faulted, or checks were skipped | `1` |
| Unreachable | The service could not be reached, or zero checks completed | `2` |
| Usage error | Invalid input (bad scheme, unknown flag) rejected before a Run | `3` |

Skips are not failures: alongside completed checks, budget-exhausted skips
degrade the Run (exit 1), they never fail it. Zero completed checks grade
Unreachable (exit 2) — budget exhaustion before any check completes included.
Latency never gates the Verdict — it is a Fact, not a check outcome.

## Output tiers

The default tier prints check lines and the Verdict line, nothing more.
`--verbose` adds Facts (latency, HTTP version, `Server` header, the redirect
chain) and full passing-check detail. `--quiet` prints only the Verdict line.

`--json` carries the full machine shape — every check, every Fact, run
metadata — and supersedes the text tiers. Default-tier text omits Facts, so
text output shows less than `--json`; the JSON is not a mirror of the text.

Contract stability: the exit codes, the `--json` shape, the flag names, and
the verdict vocabulary (Healthy, Degraded, Unreachable) are stable. Everything
else — glyphs, verdict-line copy, Diagnosis phrasing — may change between
releases, and scripts must not parse it.

```json
{"schema":"probe/v1","target":"https://staging.example.com","verdict":"Healthy","exitCode":0,"checks":[{"name":"Reachable","passed":true,"status":"graded","detail":"HTTP 204 (No Content)"},{"name":"HTTPS/TLS","passed":true,"status":"graded"},{"name":"Content sanity","passed":true,"status":"graded"}],"facts":[{"name":"Response time","value":"10 ms (fast)"},{"name":"Server","value":"probe-smoke"}],"metadata":{"budgetSeconds":10}}
```

## What Probe is not

Probe is deliberately narrow — quick post-deployment sanity checking. It is
not an API testing framework, a load-testing tool, a monitoring platform, an
observability system, or a browser tester.

## Development

```bash
pnpm install
pnpm test        # vitest
pnpm build       # tsup -> dist/cli.js
pnpm typecheck   # tsc --noEmit
```

Node 20+. MIT — see [LICENSE](LICENSE).
