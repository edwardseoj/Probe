# AGENTS.md

## Repo state: pre-implementation

There is **no code yet** — the repo is docs and agent config only (no `package.json`, no `src/`, no CI workflows). The stack (TypeScript, commander, undici, chalk + ora, Vitest, tsup, pnpm) is decided in `SPEC.md` but not scaffolded. Do not run build/test commands or assume pnpm/npm scripts exist; if you scaffold, you create them.

## Doc hierarchy (read before any work)

- **`SPEC.md` is the contract.** If it conflicts with `README.md`, SPEC wins. The README describes intent, not current behavior — it predates the spec and is deliberately unconstrained ("exact checks, output, and behavior are intentionally left open").
- **`docs/DESIGN.md`** — working spec: module layout, lifecycle, packaging decisions.
- **`GLOSSARY.md`** — mandatory vocabulary. Use its terms (Run, Target, Check, Point check, Fact, Verdict, Diagnosis, Run budget) and avoid its banned synonyms (don't call a Verdict a "result" or a Fact a "metric"). Do not call the tool "the checker" or "the pinger".
- **`docs/adr/0001-graduated-exit-codes.md`** — the exit-code contract. Contradicting an ADR requires surfacing the contradiction explicitly.

## Bookkeeping rules (SPEC.md, not obvious from code)

- Three verdicts → three exit codes: Healthy `0`, Degraded `1`, Unreachable `2`. The mapping is a **published contract** owned by `verdict.ts`; no check ever sets its own exit code.
- **Skips are not failures**: budget-exhausted skips degrade (exit 1), not fail. Zero completed checks = Unreachable (exit 2).
- **Latency never gates the verdict** — it's a Fact, not a check outcome.
- Scheme validation happens **before any network I/O**.
- **Stable contract** (breaking = version-breaking): exit codes, `--json` shape, flag names, verdict vocabulary. Human copy (verdict lines, Diagnosis phrasing, glyphs) is **not** a contract and must not be parsed by scripts — tests asserting on copy are testing the wrong layer.
- `README.md` may only be rewritten once actual behavior matches it. Until then, SPEC/DESIGN are the truth.
- Scope guard: reject anything that doesn't serve quick post-deploy sanity checking (not API testing, load testing, monitoring, observability, or browser testing).

## Brand constraints (BRAND.md) — applies to code output and docs

- Name is always **Probe** (display) / `probe` (binary); never stylized.
- No emoji in output, ever. Glyphs: `✓` pass, `✖` fail, `-` skipped.
- Semantic colors only: green=pass/Healthy, yellow=Degraded/skips, red=fail/Unreachable, dim=Facts. Verdict lines get color; the rest stays quiet.
- Diagnosis lines state facts, never advice ("HTTP 502 (Bad Gateway)", not "try checking…").
- Tagline is exactly `Deploy → Probe → Know`.

## Planned module layout (docs/DESIGN.md)

Flat `src/`: `cli.ts`, `run.ts`, `verdict.ts`, `check.ts`, `checks/` (one file per check — the showcase surface), plus small `output.ts`/`exit.ts` which may fold into `verdict.ts`/`output.ts`.

## Branding/packaging facts to not get wrong

- npm package: **`@edwardseoj/probe`** — `probe` and `probe-cli` are taken on npm; do not propose alternatives.
- Package `name` in manifests is `probe` (binary), package identity is `@edwardseoj/probe`.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues on `edwardseoj/Probe` via the `gh` CLI. See `docs/agents/issue-tracker.md`. (PRs are *not* a request surface in this repo; wayfinding and blocking use GitHub sub-issues + native dependencies per that doc.)

### Triage labels

Default canonical triage labels (label string equals role name). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`. Follow its rule: use glossary vocabulary in all output, and surface ADR conflicts instead of silently overriding.

## Workspace notes

- `graphify-out/` is generated output (knowledge-graph artifact, hook via `.opencode/plugins/graphify.js` — configured in `.opencode/opencode.json`). Don't hand-edit or commit intent around it.
- Engineering skills installed via `.agents/skills/`, `skills-lock.json`; `/ask-matt` routes among them.
