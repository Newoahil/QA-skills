---
type: change
record_id: change-7b7985f66af5482f884cad18d2381c18
date: 2026-08-24
title: Guardian fencing and source compatibility guards
status: accepted
source: implementation remediation after orchestration review
key_conclusion: QA Guardian now fences lost-lock and late session results, serializes notification transition claims, and rejects unsupported non-GitHub execution before side effects so future PM adapters can attach through neutral seams instead of partial GitHub execution.
topics: [qa-guardian, fencing, pm-integration]
author: Sisyphus
related_files: [tools/guardian/scheduler.mjs, tools/guardian/fixer-session-runner.mjs, tools/guardian/qa-session-runner.mjs, tools/guardian/notify-io.mjs, tools/guardian/stage-runner.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e, decision-e8c0d364373b42a890557ce99762e7c8]
---

## Change Content
Implemented the lock-loss, late-completion, notification, and source-compatibility remediation phase for the Guardian orchestration. A scheduler-owned lease fence now aborts active work when lock ownership is lost and blocks later state, artifact, verdict, PR, and effect writes. Fixer and QA session runners reject fenced completions before writing downstream prose artifacts. Notification transitions claim once per process and preserve retryability on delivery failure. Non-GitHub TaskRefs are carried into the runtime boundary and fail closed before the GitHub-only coding pipeline executes.

## Reason for Change
The review found that the lock primitive detected ownership loss but the scheduler ignored it, timed-out or late sessions could still write artifacts, notifications could race before durable markers, and source-neutral discovery could otherwise fall into numeric GitHub assumptions. These changes close those hazards without implementing a PM adapter or pretending arbitrary non-coding execution is supported.

## Impact Scope
Scheduler lease lifecycle, SDK fixer/QA session result handling, notification closeout, TaskRef/spec propagation, and stage profile selection. Existing GitHub coding behavior and EffectSink authorization remain the active path; PM TaskSource/EffectSink bodies, non-coding profiles, and full P8 identity migration remain deferred.

## Implementation
- Added a run-local lease fence tied to lock renewal and AbortSignal propagation.
- Added runner-level active-run checks before artifact writes and result acceptance.
- Added ordered Gate 1 closeout and per-transition notification claims.
- Added source-qualified TaskRef propagation and deterministic unsupported-source blocking.
- Added regression coverage for lock replacement, late Fixer/QA results, duplicate notification delivery, closeout retryability, and unsupported source execution.

## Test Verification
- `npm run test:guardian` — 678 passed, 0 failed.
- Focused notification/source/fencing suites — 60 passed, 0 failed.
- `node --check` on changed JavaScript modules — passed.
- LSP diagnostics on changed files — no diagnostics.
- `git diff --check` — passed.

## Notes
Commit: d1bdcb9. This change preserves the accepted PM preparation decisions; it does not ship the future PM adapter.
