# Records: JSON `facts` is always an array

In the `--json` shape (ticket #9 / PR #14), an earlier decision serialized Facts as **absent-or-array**: `facts` was omitted when a Run faulted (no response → no reported values), mirroring `RunResult.facts`. Before publication, the human reversed this: **JSON output now always emits `facts: []`**, even on faulted runs where no Facts could be collected. The reasoning: consumer ergonomics beat shape-fidelity-to-internals — with an always-present array, `json.facts.length` and iteration never crash or need existence guards, and the "no response" signal is already carried by the faulted check's `status: "fault"` in `checks[]`, so no information is lost by fabricating the empty list.

This is a pre-publication contract amendment: since no package has shipped, `facts` becomes *definitely-present-array* in the stable contract from day one, and the PR-body wording ("Facts are absent-or-array") is superseded by this ADR.

## Consequences

- `src/json.ts` emits `facts` unconditionally (empty array when the run had no Facts).
- Tests pinning `facts` absence on Unreachable fixtures (`json.test.ts`, `cli.e2e.test.ts`) flip to asserting presence as `[]`.
- GLOSSARY.md is unaffected: a Fact is still a *reported value*; an empty list is the absence of reported values, not a fabricated Fact.
