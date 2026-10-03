# BRAND.md

How Probe sounds and looks — the brand rules agents follow when writing copy, output lines, docs, or the future README. Companion to `SPEC.md` (behavior contract); vocabulary is defined in `GLOSSARY.md`. Copy is *not* a stable contract (see SPEC.md, "Contract stability") — but while it exists, it should match this file.

## Name

- Display name: **Probe** — capitalized, everywhere. Never `PROBE`, `ProBe`, or other stylizations.
- The binary/command is always lowercase: `probe`.
- Package name: `@edwardseoj/probe` (npm; `probe` and `probe-cli` are taken — do not cite alternatives).

## Tagline

> **Deploy → Probe → Know**

Use as the one-liner under the name. It is the only permitted slogan; no variants, no rhymes on it.

## Voice and tone

- **Purposeful, plain, brief.** Probe is a utility — copy should sound like one. Short declarative sentences; fragments are fine in output.
- Speak to developers as peers. No filler, no hype, no marketing superlatives ("blazing", "powerful", "ultimate").
- State what the tool does; never oversell what it might do. If something is out of scope (it usually is), say so plainly.
- Humor budget: near zero in official copy and output. No puns, no memes, no emoji — ever.
- When writing for the future **README voice**: open with the problem (post-deploy sanity checking is repetitive), show the one command, show the example output block, close with scope ("not a replacement for…"). Keep the README short — SPEC.md, not README, carries the behavioral detail.

## Output copy conventions

### Glyphs

| Mark | Meaning |
|---|---|
| `✓` | check passed |
| `✖` | check failed |
| `-` | check skipped |

- No emoji anywhere in output. Glyphs above only.
- Skipped checks are announced, never silent and never reported as failures (`- Skipped: <check name> (run budget exhausted)`).

### Verdict lines

The final line of a run:

| Verdict | Copy |
|---|---|
| Healthy | `Deployment looks healthy.` |
| Degraded | `Deployment is degraded.` |
| Unreachable | `Could not reach <target>.` |

### Diagnosis lines

- A failing check gets one **Diagnosis** line appended, e.g. `HTTP 502 (Bad Gateway)`.
- Diagnoses state the fact, not advice: no "try checking…", no solutions, no links.
- Absent for passing checks, by design.

### Facts

- Facts (latency, HTTP version, `Server` header, redirect chain) are reported quietly; they never shout. Latency gets its rough adjective (`fast` / `ok` / `slow`) and nothing more dramatic.

## Terminal style (chalk/ora rules)

- **Semantic colors only:**
  - green — passing checks, Healthy verdict
  - yellow — Degraded verdict, skipped checks
  - red — failed checks, Unreachable verdict
  - dim gray — Facts and secondary detail
- Plain verdict lines are loud (colored); everything else stays quiet. No bold-spam.
- **Non-TTY (piped, CI):** glyphs kept, color disabled, no spinner.
- **`--json`:** never colored, never spun — clean machine output.
- Error text for invalid input (bad scheme, bad flag) is red, one line, before any network I/O.

## Anti-scope (what Probe does not claim to be)

Probe's brand never implies it replaces:

- API testing frameworks
- Load-testing tools
- Monitoring platforms
- Observability systems
- Browser testing

Do not position Probe as "monitoring", a "health-check service", or a "testing tool". It is a **post-deployment sanity check** — say exactly that or less.
