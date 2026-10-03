# Usage errors exit with code 3, outside the verdict model

Probe rejects invalid input (non-HTTP scheme, unknown flags) before any network I/O. Such an invocation never begins a Run, so no Verdict exists to grade — but the process must still exit, and the contract reserves 0 Healthy, 1 Degraded, 2 Unreachable for verdict outcomes only (see ADR-0001). We assign **3** to usage errors: invalid input rejected before a Run could begin (bad scheme, unknown flag), so no Verdict was reached.

This extends the exit-code surface beyond ADR-0001's three codes. It does not contradict ADR-0001 — 0/1/2 remain verdict-owned, mapped only by the verdict module — because a usage error is not a verdict outcome; the new code covers input the verdict model never touches. ADR-0001's mapping stays intact and unchanged.

## Considered options

- Verdict-model conforming exit codes 0/1/2 — rejected: reusing verdict codes for non-verdict states is ambiguity. A script seeing exit 1 cannot distinguish "the deployment answered but is degraded" from "my CI job passed a malformed URL" — and the former is exactly what Probe reports.
- Reusing exit 2 for bad input — rejected for the same reason: exit 2 is the contract for Unreachable, and a bad-scheme failure is not "could not reach the target"; nothing was ever probed.
- Exit 2 with a distinct stderr message — rejected: scripts follow exit codes, not stderr copy, so the ambiguity would land precisely in the pipeline logic Probe is built to disambiguate.

## Consequences

- Exit 3 joins the published contract: breaking it later is version-breaking, not an internal tweak.
- Usage errors are validated before any network I/O, so exit 3 is always reachable with zero requests made.
- The 0/1/2 mapping stays owned by the verdict module (ADR-0001); the CLI's input-validation path owns exit 3 and never falls through to the verdict path once input is rejected.
