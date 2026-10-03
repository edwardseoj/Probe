# Graduated exit codes map to the three-verdict model

Probe's contract with CI and scripts is that the process exit code mirrors the run verdict: Healthy → 0, Degraded → 1, Unreachable → 2. We deliberately chose not to adopt the common two-code convention (success/failure). A distinguishing code for "could not connect at all" (e.g. DNS slip, wrong staging host) versus "the deployment answered but is unhealthy" lets a pipeline react differently to infrastructure failure versus application failure — which is Probe's whole reason to exist as a post-deploy check. Skipped checks (run budget exhausted) count as incomplete evidence and push the verdict down to Degraded rather than passing silently; a run in which no check completed yields Unreachable.

## Considered options

- Binary exit code (0 healthy / 1 everything else): simpler, but discards the infra-vs-app distinction that motivated Probe.
- Reason-per-check exit codes: rejected — every consumer would have to enumerate them.

## Consequences

- Exit-code mapping is a published contract: changing it later is a breaking change, not an internal tweak.
- The verdict→exit mapping is owned by `verdict.ts`; no check may set an exit code directly.
- Exit 3 is an *outside-the-verdict-model* code for input rejected before a Run begins — see `docs/adr/0002-usage-error-exit-code.md`. It does not amend this mapping; 0/1/2 remain verdict-only.
