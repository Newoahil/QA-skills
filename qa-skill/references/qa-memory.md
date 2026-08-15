# Cross-run QA memory (`.qa/`)

This is an **optional** capability. It applies only when the project has a `.qa/` directory. Most one-off QA never touches this — if there is no `.qa/`, ignore all of this and stay purely report-only.

`.qa/` is a project-level, cross-run store of *how this project should be QA'd*: reusable check cases and team conventions accumulated over many QA runs. Think of it as the project's QA memory, not a test suite.

## When it is active

- **`.qa/` exists** → memory is enabled. Before QA, read it and reuse any relevant cases/conventions. After QA, append what you learned (see below).
- **`.qa/` does not exist** → do **not** create it. Stay report-only and do not write to the project. If this run produced cases worth keeping, note it once, neutrally, in the report — e.g. *"These cases were not persisted. If the project adds a `.qa/` directory, future QA can reuse and accumulate them."* State it; do not sell it, and do not create the directory yourself. The user (or an explicitly instructed agent) creates `.qa/` once to opt in; after that, read/write is automatic and never re-prompts.

## Two kinds of entries, two entry paths

1. **Objective cases** — backed by code/behavior evidence you actually observed (e.g. "empty `!!null` scalar must not crash", "single-char name must pass validation"). You may sediment these **automatically**, because the evidence justifies them.
2. **Convention entries** — team preferences with no code-level right/wrong answer (e.g. "these buttons should be left-aligned", "error text must be red", "API responses must be snake_case"). You **cannot** discover or judge these yourself. They enter the store **only when a human states the convention**. Once recorded, checking against them on later runs is automatic. Record its **source** (who stated it, when/where) — with no code evidence, the source is its warrant.

So human judgment happens only at the *convention entry point*, never on every sediment or every reuse.

## Minimum shape (so entries stay readable and manageable cross-run)

Each entry must let a later reader (agent or human) see at least:

- **target** — which module / feature it concerns
- **scenario** — the situation being checked
- **expected** — the expected behavior / rule
- **kind** — `objective` or `convention`
- (convention only) **source** — who stated it, when

Beyond these fields, how you organize `.qa/` (file layout, grouping, level of detail) is yours to decide — a `.qa/cases/` + `.qa/conventions/` split is a reasonable default, not a required schema. Do **not** build a rigid schema or a matching tool; judge relevance and reuse in-context.

## Reuse and related-module regression

- Before QA, read the store and reuse any case/convention relevant to the current change instead of re-deriving it.
- Consider what the change reaches **through code links** — modules whose behavior this change can affect — and regress the related, already-sedimented cases for those. *How* you trace those links (dependency/graph tooling, import/call-site search, sub-agents cross-checking, etc.) is yours to decide; do not maintain a static dependency map here — trace it against the current code.

## Test rot

Sedimented cases can go stale as code evolves (a case asserting old behavior, an over-loose case that no longer catches regressions). When you notice this during QA, treat it as a QA finding: say the case is stale and **design** the corrected case to a directly-implementable degree (target/scenario/expected). QA stays read-only about product test files — it does not rewrite them itself. Implementing, committing, or maintaining executable tests is a builder role: leave that to an authorized agent after the QA verdict.
