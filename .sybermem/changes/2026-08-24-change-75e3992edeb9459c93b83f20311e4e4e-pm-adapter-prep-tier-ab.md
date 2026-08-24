---
type: change
record_id: change-75e3992edeb9459c93b83f20311e4e4e
date: 2026-08-24
title: Implement PM-adapter preparatory Tier A + B (identity de-numbering, exec spec, read-only lock, IN_REVIEW, profile routing, PM effects)
status: done
source: implementation of decision-e8c0d364 (PM-adapter prep plan), executed on feature/guardian-extensibility
key_conclusion: Decoupled Guardian's numeric task identity and fix-only lifecycle so a future PM execution adapter becomes pure-increment work; delivered as 6 focused commits (A1-A3, B1-B3) with GitHub behavior byte-identical (full guardian suite 650/650 green).
topics: [qa-guardian, pm-integration, extensibility]
author: Sisyphus
related_files: [tools/guardian/task-ref.mjs, tools/guardian/state.mjs, tools/guardian/scheduler.mjs, tools/guardian/task-source.mjs, tools/guardian/capabilities.mjs, tools/guardian/stage-runner.mjs, tools/guardian/actor-routing.mjs, docs/qa-guardian-extensibility-design.md]
related: [decision-e8c0d364373b42a890557ce99762e7c8]
---

## Change Content

Implemented all of Tier A and Tier B of the PM-adapter preparatory plan (decision-e8c0d364), as six
focused commits on `feature/guardian-extensibility`:

- **A1 (429352c) — de-number task identity.** Added `storageKey(ref)` + `isNumericStorageKey` in
  task-ref.mjs: a source-qualified, filesystem-safe storage key separate from `displayId`. GitHub
  keeps bare-numeric `<n>.json`; non-github sources get `<source>__<taskId>` (e.g. `pm__<uuid>`).
  state.mjs persists a `task_ref` and derives the filename from the storage key. scheduler.mjs
  discovery + followup scan now accept both numeric and source-qualified `.json` files and rebuild a
  faithful TaskRef (`schedulerStateKey`, `followupTaskRef`); the old P8 numeric hard-reject
  (`numericSchedulerIssue`) is removed.
- **A2 (14763a9) — source-neutral execution spec.** `createTaskObservation` + `normalizeExecutionSpec`
  add an optional `spec` top-level field (executionType, acceptanceCriteria, expectedEvidence,
  owner/ownerType, suggestedRole, repoContext, sourceMeta). `facts` stays exactly `{title, body}`;
  github/http leave `spec` null.
- **A3 (59885b5) — lock read-only specialist tools.** `assertReadOnlyInvestigationTools` + a
  write-capable deny-list; `availableInvestigationTools` routes through it, so a specialist's tool
  whitelist can never contain a mutating tool even if a future edit/manifest widens it.
- **B1 (387293c) — IN_REVIEW state.** Reserved `IN_REVIEW` (execution-complete-awaiting-human) +
  `isAwaitingHumanAcceptance` + `assertAgentMayTransitionTo` (fails closed on agent->DONE). Not
  wired into the GitHub fix flow.
- **B2 (e315476) — executionType -> profile.** `selectPipelineProfile` + `SUPPORTED_EXECUTION_TYPES`:
  coding/null -> builtin pipeline byte-identical; other types -> explicit unsupported (blocked, not
  forced through fixer). Selection-only; runPipeline untouched.
- **B3 (d350933) — pre-register PM effects.** Added `evidence_add` / `acceptance_propose` /
  `result_status_update` (authorized to `bot_executor`) and `accept_result` (human-only, joins
  merge/close) to the actor/effect matrix. GitHub sink still fails closed on these kinds.

## Reason for Change

A future PM system will connect Guardian as an execution agent. The fitness assessment (decision-e8c0d364)
found two real blockers -- numeric task identity and a fix-only lifecycle -- that would otherwise force
a fragile UUID->numeric surrogate or a core rewrite. Doing the bounded decoupling now, while GitHub
behavior can be pinned byte-identical, turns the future adapter into additive work.

## Impact Scope

Guardian tools only (task-ref, state, scheduler, task-source, capabilities, stage-runner,
actor-routing) + design doc. GitHub + QA line behavior unchanged (byte-identical). No PM adapter
body, no non-coding profiles, no ledger/session string-ID migration, no DAG ownership -- all
explicitly deferred. New public surface (storageKey, spec, IN_REVIEW, selectPipelineProfile, PM
effects) is additive and inert on the current GitHub path.

## Implementation

Each tier is one commit with its own regression tests. Design doc updated with a new section 9
mapping tier -> files -> commit and the explicit "NOT done yet" list. Only self-authored files were
staged per commit (a concurrent in-progress change to gate1-comment/investigation-process on the same
branch was left untouched).

## Test Verification

- Full guardian suite green after A1 (636/636) and after B3 (650/650, +14 new tests).
- New/updated tests: task-ref storageKey, task-source spec, capabilities read-only deny-list,
  state IN_REVIEW + assertAgentMayTransitionTo, stage-runner profile selection, actor-routing PM
  effects. `lsp_diagnostics` clean on every changed source file.
- One legacy assertion each in scheduler-discovery / actor-routing was updated to match the
  intentionally reversed/extended contract (non-numeric ids now accepted; accept_result now
  human-only) -- not test deletion; surrounding coverage retained.

## Notes

Next step when the PM system is ready: write a PM TaskSource + PM EffectSink + a coding profile
consumer; the state machine core and identity system should not need further change. Full string-ID
migration (ledger tokens, artifact paths, OpenCode session bindings) remains the deferred P8 tail.
