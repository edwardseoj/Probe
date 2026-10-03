# Probe

A lightweight CLI for performing a post-deployment sanity check on an HTTP service: deploy, run Probe, know.

## Language

### The tool

**Probe**:
The CLI tool itself.
_Avoid_: the checker, the pinger

### A run

**Run**:
A single invocation of Probe against one target.
_Avoid_: execution, session, check (a run contains checks)

**Target**:
The base URL a run points at.
_Avoid_: host, service, site (Probe never assumes what a target "is" beyond an HTTP base URL)

**Check**:
An individual assertion Probe evaluates during a run; checks can pass/fail and a failing check degrades the verdict.
_Avoid_: test, probe (lowercase), assertion

**Point check**:
A check against a user-supplied health path; reported individually by name, and a failure degrades the verdict like any other check.

**Fact**:
A reported value from a run that never affects the verdict (e.g. latency, HTTP version, server header, redirect chain).
_Avoid_: metric, datapoint, info

**Health path**:
An optional extra path probed in addition to the target root, supplied by the user rather than guessed.
_Avoid_: healthcheck, health endpoint (it is a user-supplied value, not something Probe discovers)

### The verdict

**Verdict**:
The overall outcome of a run: Healthy, Degraded, or Unreachable.
_Avoid_: result, status, score

**Healthy**:
The verdict that everything Probe checked showed no signs of trouble.

**Degraded**:
The verdict for a target that responded but showed signs of trouble (slow, error status, TLS problems short of unreachable).

**Unreachable**:
The verdict for a target Probe could not reach at all (DNS failure, connection refused, timeout).

**Diagnosis**:
The one-line explanation Probe prints when a check fails or degrades (e.g. `HTTP 502 (Bad Gateway)`). Absent for passing checks, by design.
_Avoid_: error message, hint, why

**Run budget**:
The total wall-clock time a run may spend; when exhausted, remaining checks are skipped and announced, not failed.
_Avoid_: timeout (reserved for the `--timeout` flag value), deadline
