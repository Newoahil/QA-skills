# 2026-08-14 P9: Cross-run Memory (`.qa/`) Capability — Design Record

## 1. Purpose

Design (not yet verified) of the "full-test sedimentation" capability the user asked for: a project-level store that accumulates, across many QA runs, *how this project should be QA'd* — reusable check cases and team conventions — so later QA can reuse them and regress related modules instead of re-deriving everything each time.

This is the cross-run capability deliberately deferred in P8. It was designed under the same discipline as the rest of the redesign: give direction, not procedure; keep it light; do not rebuild the old 238-line `project-qa-memory` + 669-line `match-memory.mjs` machinery that was investigated earlier and found unused.

## 2. What the user actually wanted (clarified over the conversation)

- Not "auto-complete all project test coverage" (that is SDET/test-building, not QA).
- The real target: QA module A → sediment A's cases; later QA module B, which is linked to A through code → reuse A's sedimented cases as regression. A team (or a single agent, or CI) all using the skill keeps a growing, maintained case store.
- Classified as **cross-run knowledge (C) + reusable cases (B) + module-link awareness** — explicitly *not* "补全全项目测试" (A).

## 3. Design decisions (each from an explicit user choice)

1. **Storage: in-project `.qa/`.** Chosen because the memory must live with the code it describes; works for individual / team / agent users identically; git-tracking is the user's choice (personal-local vs team-shared vs CI-shared, same mechanism). A project-external cache was rejected (can't be team/CI-shared, cross-project bleed).
2. **Write permission: fine-grained.** Product files stay `edit: deny`; `.qa/**: allow`. Mechanism-enforced in `agents/qa.md`, so the read-only guarantee holds for product code while the memory dir is writable.
3. **Enable model: opt-in, "exists = enabled" (option A+).** QA never creates `.qa/` itself. If `.qa/` exists → memory active (read before, sediment after, no re-prompt). If absent → pure report-only, zero project intrusion (identical to current default). On the first run that produces keep-worthy cases with no `.qa/` present, QA states — neutrally, once, no sales pitch (option D wording) — that cases weren't persisted and that a `.qa/` dir would enable reuse. Authorization happens once (creating the dir = opting in), never per-entry.
4. **Two kinds of entries, two entry paths.** *Objective cases* (backed by observed code/behavior evidence) may be sedimented automatically. *Convention entries* (team preferences with no code-level right/wrong — e.g. "these buttons should be left-aligned") cannot be discovered or judged by QA; they enter **only when a human states the convention**, and must record their source. Human judgment is confined to the convention entry point — not every sediment, not every reuse. This was the pivotal realization: the store is a **QA-convention store**, not just a test store, and convention knowledge is exactly what an agent running code can never derive on its own.
5. **Minimum shape, no schema.** Each entry must expose at least: target / scenario / expected / kind (objective|convention) / (convention) source. Beyond that, `.qa/` organization is the agent's call (a `cases/` + `conventions/` split is a soft suggestion). No rigid YAML schema, no deterministic matching tool — relevance/reuse judged in-context. This mirrors the report-format solution (one hard anchor + soft suggested shape + free-form rest), the same balance the user asked for: "有一定规范方便 agent/人可读/管理，但又不影响能力."
6. **Related-module regression: direction only.** The skill says "consider modules the change reaches through code links and regress their sedimented cases." *How* to trace links (dependency/graph tooling like codegraph, import/call-site search, sub-agents cross-checking) is the agent's decision. No static dependency map is stored — a stored map would rot and cause silent missed-regressions, worse than test rot; tracing against current code is more trustworthy. Cross-repo linkage explicitly out of scope. This corrected a design drift where the orchestrator started specifying "how to trace" — link-tracing is "how", not "what".
7. **Responsibility split (test rot).** QA is read-only: it notices rot / insufficient coverage, and *designs* the corrected case to a directly-implementable degree (target/scenario/expected). It does not rewrite repo test files itself. Implementing / committing / maintaining executable tests is a builder role, handled by an authorized write-capable agent (the general agent already has this ability) after the QA verdict — preserving QA independence (no "grade your own exam") and the read-only main flow.

## 4. Where it lives (structure)

Placed as a **conditionally-loaded reference**, not inlined into the main skill, because it is the only one of the six concern-areas that is condition-triggered (relevant only when `.qa/` exists). Inlining would tax every ordinary QA (the vast majority, which have no `.qa/`) with content they never use.

```
skills/qa-skill/
├── SKILL.md              78 lines  (six-stage prior + one .qa trigger line in §6)
├── references/
│   └── qa-memory.md      23 lines  (sedimentation rules, loaded only when .qa/ exists)
agents/
├── qa.md                 35 lines  (edit: product deny / .qa/** allow; boundary prose updated)
└── qa-facet.md           31 lines
```

Total 167 lines (vs old full pack 3917; old memory module alone was 238 + 669).

## 5. Contract → implementation cross-check

| Contract point | Landed in | ✓ |
|---|---|---|
| opt-in, exists=enabled, never self-create | qa-memory.md + SKILL §6 | ✓ |
| first-run neutral statement (option D), no sell | qa-memory.md | ✓ |
| two kinds / two entry paths (objective auto / convention human-stated + source) | qa-memory.md | ✓ |
| minimum fields (target/scenario/expected/kind/source) | qa-memory.md | ✓ |
| no schema / no matching tool / soft org suggestion | qa-memory.md | ✓ |
| related-module regression = direction; link-tracing agent's call; no static map | qa-memory.md | ✓ |
| test rot: QA finds+designs, builder writes | qa-memory.md | ✓ |
| product read-only, only `.qa/**` writable (mechanism) | qa.md permission + prose | ✓ |

## 6. Status and honest limitation

- Designed and synced to global `skills/qa-skill`; source at `C:\works\QA-skill-new`.
- **Not yet verified.** The P8 5-case benchmark has no `.qa/`, so it never exercises this path. Verifying it requires a purpose-built cross-run scenario (QA module A → sediment → QA linked module B → reuse), which is a separate, larger validation than P8 and has not been run. No claim is made about its real-world effectiveness yet — only that the design follows the established discipline and lands in 23 reference lines rather than a heavy module.
