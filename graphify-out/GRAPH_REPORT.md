# Graph Report - Probe  (2026-10-04)

## Corpus Check
- Corpus is ~5,639 words - fits in a single context window. You may not need a graph.

## Summary
- 128 nodes · 167 edges · 14 communities (10 shown, 4 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Verdict and Check Semantics
- Probe Tech Stack
- Triage and Wayfinding Workflow
- Engineering Skills Surface
- Exit-Code Contract (ADR-0001)
- Conversation Boundary Guardrails
- Glossary and ADR Docs Layer
- Domain Docs Routing
- Issue Tracker Tooling
- Grilling and Question Pipeline
- Graphify Commit Hook
- Rejected: Binary Exit Codes
- Rejected: Per-Check Exit Codes
- Probe Identity

## God Nodes (most connected - your core abstractions)
1. `Ask Matt` - 29 edges
2. `Lightweight TypeScript CLI Stack` - 12 edges
3. `Phase boundary` - 9 edges
4. `/grill-with-docs` - 8 edges
5. `Probe` - 8 edges
6. `Check (individual assertion; failure degrades verdict)` - 8 edges
7. `Five Canonical Triage Roles` - 7 edges
8. `Flag set (--path, --timeout, --json, --verbose, --quiet)` - 7 edges
9. `/grilling (interview primitive)` - 6 edges
10. `/triage` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Use the Glossary's Vocabulary` --semantically_similar_to--> `Spec-Driven Openness (checks/output left to spec process)`  [INFERRED] [semantically similar]
  docs/agents/domain.md → README.md
- `/setup-matt-pocock-skills` --conceptually_related_to--> `Domain docs layout (root GLOSSARY.md + docs/adr/)`  [INFERRED]
  .agents/skills/ask-matt/SKILL.md → AGENTS.md
- `Domain docs layout (root GLOSSARY.md + docs/adr/)` --conceptually_related_to--> `/grill-with-docs`  [INFERRED]
  AGENTS.md → .agents/skills/ask-matt/SKILL.md
- `Issue tracker (GitHub issues on edwardseoj/Probe via gh CLI)` --conceptually_related_to--> `/triage`  [INFERRED]
  AGENTS.md → .agents/skills/ask-matt/SKILL.md
- `Default canonical triage labels` --conceptually_related_to--> `/triage`  [INFERRED]
  AGENTS.md → .agents/skills/ask-matt/SKILL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The five phase-boundary options** — agents_skills_ask_matt_phase_boundaries_phase_boundary, agents_skills_ask_matt_phase_boundaries_continue, agents_skills_ask_matt_phase_boundaries_clear, agents_skills_ask_matt_phase_boundaries_handoff, agents_skills_ask_matt_phase_boundaries_subagent, agents_skills_ask_matt_phase_boundaries_compact [EXTRACTED 1.00]
- **Main flow: idea to ship (grill, spec, tickets, implement, review, retro)** — agents_skills_ask_matt_skill_main_flow, agents_skills_ask_matt_skill_grill_with_docs, agents_skills_ask_matt_skill_handoff, agents_skills_ask_matt_skill_prototype, agents_skills_ask_matt_skill_to_spec, agents_skills_ask_matt_skill_to_tickets, agents_skills_ask_matt_skill_implement, agents_skills_ask_matt_skill_implement_spec, agents_skills_ask_matt_skill_tdd, agents_skills_ask_matt_skill_code_review, agents_skills_ask_matt_skill_pr, agents_skills_ask_matt_skill_retro [EXTRACTED 1.00]
- **Skills that run the /grilling interview primitive internally** — agents_skills_ask_matt_skill_grilling, agents_skills_ask_matt_skill_grill_me, agents_skills_ask_matt_skill_grill_with_docs, agents_skills_ask_matt_skill_triage, agents_skills_ask_matt_skill_wayfinder, agents_skills_ask_matt_skill_improve_codebase_architecture [EXTRACTED 1.00]
- **Probe TypeScript CLI Toolchain** — readme_typescript, readme_nodejs, readme_commanderjs, readme_undici, readme_chalk, readme_ora, readme_vitest, readme_tsup, readme_pnpm, readme_github_actions [EXTRACTED 0.95]
- **Domain Docs Exploration Flow (glossary, ADRs, vocabulary, conflict flagging)** — docs_agents_domain_glossary, docs_agents_domain_glossary_map, docs_agents_domain_adr, docs_agents_domain_glossary_vocabulary_rule, docs_agents_domain_flag_adr_conflicts [EXTRACTED 0.90]
- **Wayfinding Map Flow (map, child tickets, blocking, frontier query)** — docs_agents_issue_tracker_wayfinding_operations, docs_agents_issue_tracker_wayfinder_map, docs_agents_issue_tracker_wayfinder_child_ticket, docs_agents_issue_tracker_native_issue_dependencies, docs_agents_issue_tracker_frontier_query [EXTRACTED 0.90]
- **Three-verdict model mapped to graduated exit codes** — glossary_healthy, glossary_degraded, glossary_unreachable, glossary_verdict, docs_adr_0001_graduated_exit_codes_graduated_exit_codes, docs_adr_0001_graduated_exit_codes_adr [EXTRACTED 1.00]
- **Run lifecycle: run, checks, facts, verdict, run budget, one-verb CLI** — glossary_run, glossary_check, glossary_fact, glossary_verdict, glossary_run_budget, docs_design_one_verb_cli [EXTRACTED 1.00]
- **v1 fixed check set (Reachable, HTTPS/TLS, body sniffing, response time) reported with Diagnosis** — docs_design_reachable_check, docs_design_https_tls_check, docs_design_body_sniffing_check, docs_design_response_time_check, glossary_diagnosis [EXTRACTED 1.00]

## Communities (14 total, 4 thin omitted)

### Community 0 - "Verdict and Check Semantics"
Cohesion: 0.11
Nodes (23): Skip semantics in ADR: incomplete evidence pushes verdict down to Degraded; zero checks -> Unreachable, Content sanity / body sniffing (brownout catch), Budget exhaustion semantics: skips are not failures; incomplete evidence -> Degraded, Flag set (--path, --timeout, --json, --verbose, --quiet), HTTPS/TLS check (validity window + hostname match), Infra-vs-app failure distinction (why Probe exists), Latency gating decision: response time never gates the Verdict, One verb: probe <target> [flags] (+15 more)

### Community 1 - "Probe Tech Stack"
Cohesion: 0.12
Nodes (18): Chalk, Commander.js, Deploy -> Probe -> Know, Deployment Sanity Check, GitHub Actions, Health Check Responding (example check), Throwaway-Sized, Focused Scope Philosophy, Node.js (+10 more)

### Community 2 - "Triage and Wayfinding Workflow"
Cohesion: 0.13
Nodes (16): Blocked-by Line Fallback, Frontier Query, gh CLI, GitHub Issue Tracker, GitHub Native Issue Dependencies (blocking), PRs as a Triage Surface (flag: no), Wayfinder Child Ticket (GitHub sub-issue), Wayfinder Map (issue labelled wayfinder:map) (+8 more)

### Community 3 - "Engineering Skills Surface"
Cohesion: 0.21
Nodes (15): Ask Matt openai.yaml interface config, Subagent (boundary option), Ask Matt, /code-review, /codebase-design, /diagnosing-bugs, /implement, /implement-spec (+7 more)

### Community 4 - "Exit-Code Contract (ADR-0001)"
Cohesion: 0.17
Nodes (12): ADR-0001: Graduated exit codes map to the three-verdict model, Graduated exit codes (Healthy->0, Degraded->1, Unreachable->2), Consequence: exit-code mapping is a published contract (breaking change to alter), Consequence: verdict->exit mapping owned by verdict.ts; no check sets its own exit code, CI pipeline (exit-code consumer), Probe Design doc (working spec), Exit-code mapping (Healthy 0 / Degraded 1 / Unreachable 2), Flat src/ module layout (cli.ts, run.ts, verdict.ts, check.ts, checks/) (+4 more)

### Community 5 - "Conversation Boundary Guardrails"
Cohesion: 0.24
Nodes (10): /clear (boundary option), /compact (boundary option), Continue (boundary option), Boundary decision tree (five ordered questions), /handoff (boundary option), Phase, Phase boundary, Primary vs secondary source trade (+2 more)

### Community 6 - "Glossary and ADR Docs Layer"
Cohesion: 0.22
Nodes (10): Architecture Decision Records (docs/adr/), Context-Scoped ADRs (src/<context>/docs/adr/), domain-modeling skill, Flag ADR Conflicts, GLOSSARY.md, GLOSSARY-MAP.md, Use the Glossary's Vocabulary, Multi-Context Repo Layout (+2 more)

### Community 7 - "Domain Docs Routing"
Cohesion: 0.47
Nodes (6): Domain docs layout (root GLOSSARY.md + docs/adr/), /domain-modeling, GLOSSARY.md, /grill-with-docs, /research, /wait-what

### Community 8 - "Issue Tracker Tooling"
Cohesion: 0.47
Nodes (6): Issue tracker (GitHub issues on edwardseoj/Probe via gh CLI), Main flow: idea to ship, /setup-matt-pocock-skills, Smart zone (~150k token window), /triage, Default canonical triage labels

### Community 9 - "Grilling and Question Pipeline"
Cohesion: 0.40
Nodes (6): /grill-me, /grilling (interview primitive), /to-questionnaire, /to-spec, /to-tickets, /wayfinder

## Knowledge Gaps
- **40 isolated node(s):** `Phase`, `Continue (boundary option)`, `/clear (boundary option)`, `/pr`, `/wizard` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 53 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Ask Matt` connect `Engineering Skills Surface` to `Issue Tracker Tooling`, `Grilling and Question Pipeline`, `Conversation Boundary Guardrails`, `Domain Docs Routing`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `Verdict (overall outcome of a run)` connect `Verdict and Check Semantics` to `Exit-Code Contract (ADR-0001)`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `/grill-with-docs` (e.g. with `Domain docs layout (root GLOSSARY.md + docs/adr/)` and `/grill-me`) actually correct?**
  _`/grill-with-docs` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Phase`, `Continue (boundary option)`, `/clear (boundary option)` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Verdict and Check Semantics` be split into smaller, more focused modules?**
  _Cohesion score 0.11067193675889328 - nodes in this community are weakly interconnected._
- **Should `Probe Tech Stack` be split into smaller, more focused modules?**
  _Cohesion score 0.12418300653594772 - nodes in this community are weakly interconnected._
- **Should `Triage and Wayfinding Workflow` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._