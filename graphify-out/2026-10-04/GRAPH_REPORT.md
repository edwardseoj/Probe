# Graph Report - Probe  (2026-10-04)

## Corpus Check
- Corpus is ~4,132 words - fits in a single context window. You may not need a graph.

## Summary
- 87 nodes · 125 edges · 7 communities
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.84)
- Token cost: 8,880 input · 11,150 output

## Community Hubs (Navigation)
- Ask Matt Skill Router
- Probe CLI Dev Stack
- Issue Tracking Wayfinding
- Phase Boundaries Handoff
- Domain Docs ADRs
- Implementation Workflow Skills
- Repo Setup Core Flow

## God Nodes (most connected - your core abstractions)
1. `Ask Matt` - 29 edges
2. `Lightweight TypeScript CLI Stack` - 12 edges
3. `Phase boundary` - 9 edges
4. `/grill-with-docs` - 8 edges
5. `Probe` - 8 edges
6. `Five Canonical Triage Roles` - 7 edges
7. `/grilling (interview primitive)` - 6 edges
8. `/triage` - 6 edges
9. `/to-tickets` - 5 edges
10. `/implement` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Use the Glossary's Vocabulary` --semantically_similar_to--> `Spec-Driven Openness (checks/output left to spec process)`  [INFERRED] [semantically similar]
  docs/agents/domain.md → README.md
- `Issue tracker (GitHub issues on edwardseoj/Probe via gh CLI)` --conceptually_related_to--> `/triage`  [INFERRED]
  AGENTS.md → .agents/skills/ask-matt/SKILL.md
- `Default canonical triage labels` --conceptually_related_to--> `/triage`  [INFERRED]
  AGENTS.md → .agents/skills/ask-matt/SKILL.md
- `/setup-matt-pocock-skills` --conceptually_related_to--> `Domain docs layout (root GLOSSARY.md + docs/adr/)`  [INFERRED]
  .agents/skills/ask-matt/SKILL.md → AGENTS.md
- `Domain docs layout (root GLOSSARY.md + docs/adr/)` --conceptually_related_to--> `/grill-with-docs`  [INFERRED]
  AGENTS.md → .agents/skills/ask-matt/SKILL.md

## Hyperedges (group relationships)
- **Main flow: idea to ship (grill, spec, tickets, implement, review, retro)** — agents_skills_ask_matt_skill_main_flow, agents_skills_ask_matt_skill_grill_with_docs, agents_skills_ask_matt_skill_handoff, agents_skills_ask_matt_skill_prototype, agents_skills_ask_matt_skill_to_spec, agents_skills_ask_matt_skill_to_tickets, agents_skills_ask_matt_skill_implement, agents_skills_ask_matt_skill_implement_spec, agents_skills_ask_matt_skill_tdd, agents_skills_ask_matt_skill_code_review, agents_skills_ask_matt_skill_pr, agents_skills_ask_matt_skill_retro [EXTRACTED 1.00]
- **Skills that run the /grilling interview primitive internally** — agents_skills_ask_matt_skill_grilling, agents_skills_ask_matt_skill_grill_me, agents_skills_ask_matt_skill_grill_with_docs, agents_skills_ask_matt_skill_triage, agents_skills_ask_matt_skill_wayfinder, agents_skills_ask_matt_skill_improve_codebase_architecture [EXTRACTED 1.00]
- **The five phase-boundary options** — agents_skills_ask_matt_phase_boundaries_phase_boundary, agents_skills_ask_matt_phase_boundaries_continue, agents_skills_ask_matt_phase_boundaries_clear, agents_skills_ask_matt_phase_boundaries_handoff, agents_skills_ask_matt_phase_boundaries_subagent, agents_skills_ask_matt_phase_boundaries_compact [EXTRACTED 1.00]
- **Probe TypeScript CLI Toolchain** — readme_typescript, readme_nodejs, readme_commanderjs, readme_undici, readme_chalk, readme_ora, readme_vitest, readme_tsup, readme_pnpm, readme_github_actions [EXTRACTED 0.95]
- **Wayfinding Map Flow (map, child tickets, blocking, frontier query)** — docs_agents_issue_tracker_wayfinding_operations, docs_agents_issue_tracker_wayfinder_map, docs_agents_issue_tracker_wayfinder_child_ticket, docs_agents_issue_tracker_native_issue_dependencies, docs_agents_issue_tracker_frontier_query [EXTRACTED 0.90]
- **Domain Docs Exploration Flow (glossary, ADRs, vocabulary, conflict flagging)** — docs_agents_domain_glossary, docs_agents_domain_glossary_map, docs_agents_domain_adr, docs_agents_domain_glossary_vocabulary_rule, docs_agents_domain_flag_adr_conflicts [EXTRACTED 0.90]

## Communities (7 total, 0 thin omitted)

### Community 0 - "Ask Matt Skill Router"
Cohesion: 0.19
Nodes (19): Domain docs layout (root GLOSSARY.md + docs/adr/), Ask Matt openai.yaml interface config, Ask Matt, /diagnosing-bugs, /domain-modeling, GLOSSARY.md, /grill-me, /grill-with-docs (+11 more)

### Community 1 - "Probe CLI Dev Stack"
Cohesion: 0.12
Nodes (18): Chalk, Commander.js, Deploy -> Probe -> Know, Deployment Sanity Check, GitHub Actions, Health Check Responding (example check), Throwaway-Sized, Focused Scope Philosophy, Node.js (+10 more)

### Community 2 - "Issue Tracking Wayfinding"
Cohesion: 0.13
Nodes (16): Blocked-by Line Fallback, Frontier Query, gh CLI, GitHub Issue Tracker, GitHub Native Issue Dependencies (blocking), PRs as a Triage Surface (flag: no), Wayfinder Child Ticket (GitHub sub-issue), Wayfinder Map (issue labelled wayfinder:map) (+8 more)

### Community 3 - "Phase Boundaries Handoff"
Cohesion: 0.24
Nodes (10): /clear (boundary option), /compact (boundary option), Continue (boundary option), Boundary decision tree (five ordered questions), /handoff (boundary option), Phase, Phase boundary, Primary vs secondary source trade (+2 more)

### Community 4 - "Domain Docs ADRs"
Cohesion: 0.22
Nodes (10): Architecture Decision Records (docs/adr/), Context-Scoped ADRs (src/<context>/docs/adr/), domain-modeling skill, Flag ADR Conflicts, GLOSSARY.md, GLOSSARY-MAP.md, Use the Glossary's Vocabulary, Multi-Context Repo Layout (+2 more)

### Community 5 - "Implementation Workflow Skills"
Cohesion: 0.31
Nodes (9): Subagent (boundary option), /code-review, /codebase-design, /implement, /implement-spec, /retro, /tdd, /to-tickets (+1 more)

### Community 6 - "Repo Setup Core Flow"
Cohesion: 0.50
Nodes (5): Issue tracker (GitHub issues on edwardseoj/Probe via gh CLI), Main flow: idea to ship, /setup-matt-pocock-skills, Smart zone (~150k token window), Default canonical triage labels

## Knowledge Gaps
- **31 isolated node(s):** `Phase`, `Continue (boundary option)`, `/clear (boundary option)`, `/pr`, `/wizard` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 35 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Ask Matt` connect `Ask Matt Skill Router` to `Phase Boundaries Handoff`, `Implementation Workflow Skills`, `Repo Setup Core Flow`?**
  _High betweenness centrality (0.194) - this node is a cross-community bridge._
- **Why does `Phase boundary` connect `Phase Boundaries Handoff` to `Ask Matt Skill Router`, `Implementation Workflow Skills`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `Probe` connect `Probe CLI Dev Stack` to `Domain Docs ADRs`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `/grill-with-docs` (e.g. with `Domain docs layout (root GLOSSARY.md + docs/adr/)` and `/grill-me`) actually correct?**
  _`/grill-with-docs` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Phase`, `Continue (boundary option)`, `/clear (boundary option)` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Probe CLI Dev Stack` be split into smaller, more focused modules?**
  _Cohesion score 0.12418300653594772 - nodes in this community are weakly interconnected._
- **Should `Issue Tracking Wayfinding` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._