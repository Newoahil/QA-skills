---
name: project-qa-memory
description: Lightweight project QA memory storing human-validated Quality Rules and reusable failure patterns plus when to reapply them. YAML-based .qa/memory store (index.yaml + rules/ + patterns/ + feedback/ + rejected/), retrieval capped at 0-3 indexed items, planning-hint-only, feeds qa_planning_inputs, never PASS evidence.
---

# Project QA Memory (Lightweight, Human-Validated)

Use this skill from [`using-project-qa`](../using-project-qa/SKILL.md) to read durable, human-validated project QA memory before planning, and to propose memory writes only after current execution evidence and explicit human approval exist. This is a deliberately thin mechanism: it records approved project QA rules and reusable failure patterns a human QA would otherwise re-derive on every run, plus when to reapply them. It is not a general knowledge base, a chat/user-said log, or an evidence store.

Persistent memory lives under `.qa/memory` per [`../references/project-qa-workspace.md`](../references/project-qa-workspace.md) when the `.qa/` workspace is authorized; otherwise memory is report-only/external storage. Each retrievable memory item is also emitted as a `qa_planning_inputs` record per [`../references/qa_planning_inputs.md`](../references/qa_planning_inputs.md).

## What Memory Is

Memory is a planning hint only. It stores human-validated project QA rules and reusable failure patterns, plus when to reapply them. It may:

- Surface a known module, key flow, or risk that a prior approved rule or pattern already classified.
- Generate a Must/Should check (from `rules/`) or a risk/Should check (from `patterns/`) in the QA plan.
- Record a durable project QA fact that does not change between runs.

Memory must never:

- Be chat/user-said memory. Only human-validated rules and reusable failure patterns are stored.
- Count as Execution Evidence or Module Results, or support `PASS` by itself or with other planning hints.
- Override or suppress a current objective finding.
- Be written from GitHub external context alone; GitHub external context alone is never memory evidence. A memory write also cannot happen without current execution evidence.

## Approved Memory Structure

When authorized, `.qa/memory/` uses this fixed layout:

```
.qa/memory/
├── index.yaml              # only retrieval entry / source of truth; do not recursively scan
├── rules/                  # approved Quality Rule cards (<module>.yaml); can generate Must/Should checks
│   ├── order.yaml
│   ├── payment.yaml
│   ├── auth.yaml
│   └── cache.yaml
├── patterns/               # reusable failure pattern cards (<pattern>.yaml); mainly risk/Should checks
│   ├── cache-inconsistency.yaml
│   ├── permission-bypass.yaml
│   └── race-condition.yaml
├── feedback/               # raw human feedback provenance (QA-<n>.md); must not directly drive planning
│   ├── QA-001.md
│   ├── QA-002.md
│   └── QA-003.md
└── rejected/               # rejected/stale/inapplicable candidates; not applied
    └── rejected-rules.yaml
```

Folder semantics:

- `feedback/` is raw provenance. It captures the human's words about an observed issue. It must not directly drive QA planning; it exists so a rule/pattern write can be traced to human feedback.
- `rules/` holds approved Quality Rules. A rule can generate Must/Should checks in the QA plan.
- `patterns/` holds reusable failure patterns. A pattern is mainly a risk/Should check unless it is escalated by an approved rule.
- `rejected/` holds rejected, stale, or inapplicable candidates. They are not applied and are kept only to prevent repeated bad suggestions.

## Approved Workflow

```
QA -> find issue -> human feedback -> feedback/QA-001.md
   -> skill extracts a Quality Rule -> human approval
   -> rules/order.yaml -> index.yaml -> next QA retrieval
```

1. QA finds an issue during a run.
2. The human gives raw feedback on the issue; it is recorded as a `feedback/QA-<n>.md` provenance file.
3. The skill extracts a candidate Quality Rule or failure pattern from that feedback.
4. The candidate is proposed and requires explicit human approval before it becomes a rule or pattern.
5. An approved rule is written as `rules/<module>.yaml` (or a pattern as `patterns/<pattern>.yaml`).
6. `index.yaml` is updated to reference the new item.
7. On the next run, retrieval reads `index.yaml` and reopens the indexed rules/patterns.

## index.yaml (Source of Truth)

`index.yaml` is the only retrieval entry and source of truth. Do not recursively scan `rules/`, `patterns/`, `feedback/`, or `rejected/`. An item file is opened only when it is referenced by `index.yaml`. Each index entry points to a rule, pattern, or rejected item:

| Field | Required record |
|---|---|
| `id` | Stable unique item id. |
| `type` | `rule` / `pattern` / `rejected`. |
| `scope` | The module, feature, key flow, or risk this item applies to. |
| `triggers` / `match` | Conditions or signals that select this item for a run. |
| `review_status` | `current` / `stale` / `under_review`. |
| `path` | Relative path to the item file (e.g. `rules/auth.yaml`). |

Example:

```yaml
items:
  - id: rule-auth-001
    type: rule
    scope: auth
    triggers:
      - scope: auth
        signal: login/logout flow changed
    review_status: current
    path: rules/auth.yaml
```

## Templates

### rules/<module>.yaml — Approved Quality Rule card

| Field | Required record |
|---|---|
| `id` | Stable unique rule id. |
| `type` | `rule`. |
| `scope` | Module, feature, key flow, or risk this rule applies to. |
| `trigger` | When to reapply this rule. |
| `rule` | The approved, specific QA rule (never generic). |
| `checks` | The Must/Should checks the rule can generate. |
| `source` | Provenance: feedback file ref + current execution evidence IDs. |
| `confidence` | `high` / `medium` / `low`. |
| `last_verified_at` | Date/run the rule was last verified. |
| `times_applied` | Count of times the rule was applied. |
| `times_confirmed` | Count of times the rule was confirmed. |

Example:

```yaml
id: rule-order-001
type: rule
scope: order
trigger: any change touching order total calculation
rule: The order total must equal the sum of line items after discounts and before tax.
checks:
  - level: Must
    check: recompute order total from line items and compare
source: feedback/QA-001.md; evidence E-001
confidence: high
last_verified_at: "2026-08-11"
times_applied: 0
times_confirmed: 0
```

The full rule card supports a bounded `match` block and typed `checks` so an approved rule can turn into concrete regression checks during planning:

```yaml
id: rule-order-cache-001
type: rule
scope: order, cache
match:
  paths:
    - "src/order/**"
    - "src/cache/**"
  symbols:
    - order_status
    - order_update
  keywords:
    - cache
    - invalidate
    - status
applies_when:
  - change may modify order status persistence
  - change may affect read-after-write behavior
do_not_apply_when:
  - change is docs-only
  - change does not affect persisted order status or cache
rule: After an order status update, the cache must be invalidated or refreshed and a re-read must return the new status.
checks:
  must:
    - re-read order status after update returns the new value
    - cache entry is invalidated or refreshed on status change
  should:
    - concurrent update does not leave a stale cached status
source: feedback/QA-001.md; evidence E-001
confidence: high
review_status: current
last_verified_at: "2026-08-11"
times_applied: 3
times_confirmed: 2
```

`match` (paths/symbols/keywords) is the coarse selector; `applies_when` / `do_not_apply_when` decide whether the rule actually applies to the current change; `checks.must` / `checks.should` are the regression checks it can generate.

### patterns/<pattern>.yaml — Reusable failure pattern card

| Field | Required record |
|---|---|
| `id` | Stable unique pattern id. |
| `type` | `pattern`. |
| `scope` | Module, feature, key flow, or risk. |
| `trigger` | When to reapply this pattern. |
| `pattern` | The reusable failure pattern (a risk/Should check unless escalated by a rule). |
| `source` | Provenance: feedback file ref + current execution evidence IDs. |
| `confidence` | `high` / `medium` / `low`. |
| `last_verified_at` | Date/run last verified. |
| `times_applied` | Count applied. |
| `times_confirmed` | Count confirmed. |

### feedback/QA-001.md — Raw human feedback template

```markdown
---
feedback_id: QA-001
run_id: <current run id>
source: <human>
---

## Observed Issue
<what the issue was>

## Human Feedback (verbatim)
<the human's raw words; record exactly, do not editorialize>

## Evidence Ref
<current execution evidence IDs from this run>
```

Raw feedback is provenance only. It does not directly drive QA planning and is never PASS evidence.

### rejected/rejected-rules.yaml — Rejected candidate template

| Field | Required record |
|---|---|
| `id` | Stable unique candidate id. |
| `type` | `rejected`. |
| `scope` | Module, feature, key flow, or risk. |
| `candidate` | The proposed rule/pattern that was not accepted. |
| `reason` | Why it was rejected, is stale, or is inapplicable. |
| `source` | Provenance (feedback ref + evidence IDs). |
| `date` | Date of rejection. |

A rejected candidate is not applied and is kept only to prevent repeated bad suggestions.

## Admission / Write Gate

A memory write (new rule, new pattern, or update) is admitted only when **all** of the following hold:

1. Current execution evidence from this run (Module Results or Execution Evidence) exists.
2. The learning is durable, project-specific, and not already recorded.
3. **Explicit human approval** is given before the write is performed. GitHub/external context alone is never sufficient; a `feedback/QA-<n>.md` file plus current execution evidence is required.
4. The learning is not generic. Reject generic memory (for example "tests should be run", "verify edge cases"). It must be specific to this project.

## Retrieval Rules

- Read memory during planning, before `project-qa-plan` finalizes the Risk and Verification Plan.
- Read only `.qa/memory/index.yaml` as the source of truth. Do not recursively scan directories.
- Open **at most 0-3** relevant indexed items per run. If more than 3 are relevant, select the top 3 by scope/trigger exactness and confidence, and surface the remaining relevant items for review rather than silently dropping them.
- Match by scope/trigger. Skip `stale` or `under_review` items as planning hints; surface them for review.
- A rule can generate a Must/Should check; a pattern is mainly a risk/Should check unless escalated by a rule. Memory never supports `PASS`; current evidence decides `PASS`/`FAIL`.
- Treat every indexed item as a hint to verify against current evidence, never as a conclusion.
- Handle index inconsistencies (dangling reference, review_status mismatch, unsafe path) as review items, not crashes.

## Match And Regression-Check Generation (Closed Loop)

This is the feedback -> rule -> match -> regression-check loop that makes memory a real planning lever rather than a passive note. It runs during planning, after retrieval, before `project-qa-plan` finalizes the Risk and Verification Plan.

1. **Collect the current change surface.** Gather the changed files/paths, changed symbols/functions, and touched key flows for this run (from the Diff, snapshot, or inventory). This is the match input.
2. **Coarse match via `match`.** For each retrieved `rule`/`pattern`, test its `match.paths` (glob, relative, under the repo), `match.symbols`, and `match.keywords` against the change surface. A rule with no `match` block falls back to `scope`/`trigger` text matching.
3. **Applicability gate via `applies_when` / `do_not_apply_when`.** A coarse match only proposes the item. The item applies only if at least one `applies_when` condition holds and no `do_not_apply_when` condition holds. If `do_not_apply_when` fires, the item is skipped and surfaced as "matched but not applicable".
4. **Generate regression checks.** For each applicable `rule`, emit its `checks.must` as candidate `Must Verify` checks and `checks.should` as candidate `Should Verify` checks. For each applicable `pattern`, emit a risk/`Should Verify` check. Each generated check carries provenance to its memory id and path.
5. **Hand off as planning inputs.** Emit the generated checks as `qa_planning_inputs` records (see [`../references/qa_planning_inputs.md`](../references/qa_planning_inputs.md)) with `source_type: memory`, `claim_type: memory_regression_check` (or `memory_historical_pattern` for pattern-only risk hints), `use_limit: planning_only`. `project-qa-plan` decides whether to adopt each generated check into the Risk and Verification Plan; adoption is the planner's decision, not automatic.
6. **Never auto-PASS.** A generated check is only a planned verification. It is verified against current execution evidence like any other check. Memory-generated checks never support `PASS` by themselves and never mark a `Must Verify` item satisfied without current evidence.

### Executable Matcher

A deterministic, read-only helper implements this loop so it is not agent-improvised: [`../tools/match-memory.mjs`](../tools/match-memory.mjs). It reads `.qa/memory/index.yaml` (source of truth), opens only the indexed `rules/`/`patterns/` cards, matches them against a supplied change surface, applies the applicability gate, and emits `qa_planning_inputs` as JSON.

The change surface can be supplied three ways (exactly one, mutually exclusive):

```
# 1. explicit surface JSON
node "<skill>/tools/match-memory.mjs" --index "<.qa/memory/index.yaml>" --change "<change-surface.json>" --json

# 2. a saved unified diff file
node "<skill>/tools/match-memory.mjs" --index "<.qa/memory/index.yaml>" --diff "<change.diff>" --json

# 3. a git range (tool derives the surface from `git diff --unified=0 base...head`)
node "<skill>/tools/match-memory.mjs" --index "<.qa/memory/index.yaml>" --base "<ref>" --head "<ref>" [--repo "<dir>"] --json
```

`change-surface.json` is `{ "paths": [...], "symbols": [...], "keywords": [...] }`. In `--diff`/`--base`/`--head` modes the tool derives that surface from the unified diff: `paths` from file headers, `symbols`/`keywords` from added/removed identifiers and path segments. The git range mode only ever runs read-only `git diff` with validated refs (allowlisted characters, never starting with `-`), never a write or checkout.

The referenced `rules/`/`patterns/` cards are read by default from the memory root (the directory that contains `index.yaml`) using the same path-safety rules: only safe relative paths under the root, only `rules/*` for rules and `patterns/*` for patterns, `rejected/` never opened, and any `..`/absolute/drive/UNC path skipped. Missing or malformed card files never crash; they are surfaced as review items. So a real invocation like `--base main --head HEAD` needs no extra plumbing to produce matches.

The tool is planning-only: it never runs product code, never marks anything `PASS`, exits `0` on a successful match pass (even with zero matches), `1` on an invalid index, and `2` on usage/IO/unsafe-ref errors. When Node or git is unavailable, perform the same derive/match/apply/generate steps manually; do not install anything.

### Match Safety

- `match.paths` are relative globs interpreted under the project root only. Reject and surface (do not crash) any `..` traversal, absolute path, drive-qualified path, or UNC path.
- Matching reads only the change surface and `.qa/memory/` items referenced by `index.yaml`. It never opens `feedback/` for planning and never opens `rejected/` as an applicable item.
- A generated check that would require an unsafe/destructive/network/credential action is not auto-planned; it becomes a Human Gate candidate in `project-qa-plan`.

### Counter Update (Human-Approved Only)

- `times_applied` increments when a rule's generated check is actually adopted into the plan for a run.
- `times_confirmed` increments when the adopted check was verified by current execution evidence in that run.
- `last_verified_at` updates to the run/date when the check was confirmed by current evidence.
- These counter updates are memory writes and follow the Admission / Write Gate: they require the run's current evidence and explicit human approval. Counters are never auto-written from a benchmark or from planning alone.

## Planning-Only Rule

Everything in memory is planning/history only. Memory can create QA plan checks but can never support `PASS`. Current evidence decides `PASS`/`FAIL`.

## Persistence Target

- When the `.qa/` workspace is authorized under [`../references/project-qa-workspace.md`](../references/project-qa-workspace.md), approved memory persists under `.qa/memory/` (`index.yaml`, `rules/`, `patterns/`, `feedback/`, `rejected/`).
- When the `.qa/` workspace is not authorized, memory is report-only/external storage; no project-local write occurs.
- `.qa/` memory is planning/history only and never PASS evidence.

## Reporting

Record proposed and confirmed memory items in the project report's Reusable Learning / Memory section, including type (`rule` / `pattern` / `rejected`), the durable learning, provenance (evidence basis + feedback ref), confidence, use limit, confirmation, review_status, and persistence target. The report table is a summary; the persisted item file is the durable record.
