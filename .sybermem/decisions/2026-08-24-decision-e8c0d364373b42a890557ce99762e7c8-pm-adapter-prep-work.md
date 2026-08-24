---
type: decision
record_id: decision-e8c0d364373b42a890557ce99762e7c8
date: 2026-08-24
title: Preparatory core changes to make a future PM execution adapter cheap to plug in
status: accepted
source: architecture assessment cross-validated by Oracle over current Guardian task-source/state/actor abstractions vs the PM Intent->Plan->Result-DAG workflow
supersedes: []
key_conclusion: Before building a PM execution adapter, Guardian must first decouple its numeric task identity and fix-only lifecycle so the adapter becomes pure-increment work; the single hard prerequisite is de-numbering task identity (P8), after which facts-spec extension, in_review semantics, executionType profile routing, and pre-registered PM effects can proceed in parallel.
topics: [qa-guardian, pm-integration, extensibility]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Context

A future PM (project-management) system will connect Guardian as an execution
agent inside an Intent -> Plan Draft -> Result-DAG -> Ready -> Execute ->
Evidence -> Human-Acceptance -> Unlock-downstream workflow, using real MCP tools
(pm_bind_project, pm_get_work, pm_add_evidence, pm_submit_acceptance,
pm_update_status, pm_submit_plan_draft, pm_get_intent).

A mechanism-level fitness assessment (my reading + an Oracle cross-check) reached
a converged verdict: **GO for a phased PM execution adapter starting with
executionType=coding; NO-GO for feeding arbitrary executionType through the
current core.** The current Guardian is a single-purpose FIX orchestrator in
three concrete ways: (1) numeric task identity is hardcoded
(numericSchedulerIssue = Number(ref.taskId), `${Number(issue)}.json`,
`fix/issue-<n>`, followup scan `/^\d+\.json$/`, ledger tokens + OpenCode session
bindings all keyed on Number(issue) -- the P8-deferred work); (2) state routing
assumes investigate/fix/verify/merge and terminal.status==='completed' at
GATE_2_WAIT models "human merged"; (3) the pipeline assumes qa-guardian fixer ->
independent qa. The good seams: TaskSource cleanly isolates discovery/read; N=1
one-task execution is compatible with PM Ready Work; EffectSink + actor/effect
matrix are the right safety foundation; human-only final acceptance already
matches the separation-of-powers principle.

This record captures WHAT preparatory processing to do NOW so a future adapter
becomes an increment ("write an adapter + a PM sink + a profile") rather than a
core rewrite.

## Considered Options

1. **Do nothing now; build the whole PM adapter later in one shot.** Rejected:
   the numeric-identity coupling and fix-only lifecycle would force the adapter
   to either fight the core or ship a fragile UUID->numeric surrogate map, which
   Oracle flagged as an acceptable one-off prototype only, never an architecture
   (durable+transactional mapping, dual identities in logs/branches, wrong-Result
   resume risk under unattended execution).

2. **Generalize everything now (arbitrary executionType, user-programmable
   pipelines).** Rejected: contradicts the accepted extensibility ADR non-goals
   (no arbitrary state transitions / effects / recovery -- "a second programming
   language"); premature for a use case that starts at coding-only.

3. **Do the bounded decoupling now (identity + lifecycle seams), defer the
   adapter body.** Accepted: removes the two real blockers with byte-identical
   GitHub behavior preserved, and turns the future adapter into pure-increment
   work.

## Final Decision

Do the preparatory work in three tiers.

### Tier A -- do now, zero-risk decoupling (the enablers)

- **A1 (HARD PREREQUISITE) De-number task identity (P8 core).** Introduce a
  storage identity `storageKey(ref)` = filesystem-safe encoding of
  `source + ":" + taskId`, separate from a human `displayId`. Persist the full
  TaskRef, not a numeric projection. GitHub keeps readable names
  (e.g. github-issue-123) mapping to existing numeric filenames so current
  behavior stays byte-identical. Replace numeric assumptions in state-file
  naming, branch/artifact naming, ledger/idempotency keys, OpenCode session
  binding, candidate discovery, and the followup scan/record loading.
- **A2 Extend TaskObservation.facts into a source-neutral execution spec.** Grow
  `{title, body}` to also carry executionType, acceptanceCriteria[],
  expectedEvidence, owner/ownerType, repoContext, sourceMeta. GitHub source fills
  existing fields; the rest stay empty (no behavior change) and reserve slots for
  a PM source.
- **A3 Mechanically lock the read-only specialist boundary.** Add regression
  tests proving a registry specialist cannot reach write-capable tools even with
  unusual-but-valid manifest values, plus a coordinator/runner assertion that the
  specialist permission profile is read-only. Closes the earlier defense-in-depth
  caveat (read-only currently enforced by prompt + opencode perms, not by the
  registry) before more agents arrive.

### Tier B -- design-first contracts now, full impl deferred

- **B1 Separate "execution complete" from "human acceptance".** Reserve an
  `in_review` state meaning "agent finished, awaiting human acceptance"; make
  DONE unreachable by an agent. RED LINE: a future adapter must never map a
  pm_submit_acceptance proposal to Guardian DONE / merge.
- **B2 Define executionType -> execution profile routing (implement coding
  only).** Refactor the single-pipeline shape of loadRuntimePipelineManifest into
  a profile-selection interface (executionType -> profile). Built-in implements
  coding = current fixer->qa->notify; all other types explicitly resolve to
  blocked(unsupported-execution-type). Adding research/design/ops later = add a
  profile, not touch the core.
- **B3 Pre-register PM effect kinds + actor authorization (matrix now, dispatch
  later).** Predefine in actor-routing.mjs: evidence_add, acceptance_propose,
  result_status_update, with bot_executor allowed to add evidence / propose
  criterion status / set in_progress|in_review|blocked, and `accepted` performable
  by NO actor (human-only, reusing the merge/close pattern). GitHub sink no-ops or
  throws on these kinds until a PM sink implements them.

### Tier C -- explicitly NOT now

Do not write the PM TaskSource adapter body yet; do not implement non-coding
profiles; do not let Guardian own/duplicate the PM DAG (PM owns dependency
readiness + downstream unlock; Guardian consumes only pm_get_work() ready-set);
do not use a UUID->numeric surrogate as a permanent design; do not broaden the
read-only investigation registry into a generic write-capable agent registry.

### Sequencing

A1 is the only hard prerequisite. A2/A3/B1/B2/B3 may proceed in parallel after
A1. When Tier A+B are in place, the PM adapter is pure-increment: a PM TaskSource
+ a PM EffectSink + a coding profile, with no changes to the state-machine core
or the identity system.

## Impact and Consequences

Turns the future PM integration from a risky core rewrite into additive adapter
work, while keeping the GitHub + QA line byte-identical (A1 preserves numeric
filenames for GitHub; A2/B3 add empty/unused slots; B2 keeps coding = today's
pipeline). Locks safety boundaries early: new PM effects go through the fail-closed
actor/effect matrix rather than bypassing it as "just MCP calls", and human-only
final acceptance is preserved. Main trade-off is doing identity de-numbering (A1)
before there is a second source that strictly needs it -- justified because it is
the unavoidable prerequisite and is cheapest to do while behavior can be pinned
byte-identical.

## Related Changes

- Builds on the accepted extensibility plan: decision-b531cef4d0f44652917eb044fbc0a31e.
- Design reference: docs/qa-guardian-extensibility-design.md (P8 = string-ID migration; §5.3 YAGNI line).
- Relevant current code: tools/guardian/scheduler.mjs (numericSchedulerIssue, followup scan),
  tools/guardian/task-ref.mjs, tools/guardian/task-source.mjs, tools/guardian/state-router.mjs,
  tools/guardian/actor-routing.mjs, tools/guardian/stage-runner.mjs, tools/guardian/pipeline.manifest.mjs.

## Notes

No code was changed while producing this record; it is a planning/decision
artifact. Implementation begins only on an explicit go for a named tier
(e.g. "start A1").
