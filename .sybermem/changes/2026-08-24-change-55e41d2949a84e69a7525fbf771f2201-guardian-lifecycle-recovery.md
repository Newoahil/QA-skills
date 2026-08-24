---
type: change
record_id: change-55e41d2949a84e69a7525fbf771f2201
date: 2026-08-24
title: Guardian lifecycle recovery outcomes
status: accepted
source: implementation remediation after orchestration review
key_conclusion: QA Guardian now persists recoverable STALLED and QA-failure outcomes so retries and hand-backs are explicit instead of silently leaving active work, while preserving the TaskRef/TaskSource/EffectSink PM migration seams.
topics: [qa-guardian, lifecycle, recovery]
author: Sisyphus
related_files: [tools/guardian/state-router.mjs, tools/guardian/scheduler-core.mjs, tools/guardian/scheduler.mjs, tools/guardian/stage-runner.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e, decision-e8c0d364373b42a890557ce99762e7c8]
---

## Change Content
Implemented the first lifecycle remediation phase after the GitHub Agent orchestration review. Persisted STALLED records now have an explicit next-poll route: they resume investigation while the bounded stall retry budget remains, or transition to HANDED_BACK with a stable stalled reason after exhaustion. QA FAIL outcomes now either persist a bounded FIXING retry with an incremented fix round or hand the issue back when MAX_FIX_ROUNDS is reached.

## Reason for Change
The previous state machine persisted STALLED without a corresponding router branch, causing the next poll to return an unhandled SKIP. QA FAIL could also leave the issue in an active-looking state without an explicit retry or hand-back outcome. These behaviors violated the product requirement that unattended work must either continue deterministically or become human-actionable. The implementation preserves the existing source-neutral TaskRef, TaskSource, EffectSink, and execution-profile seams so future PM adapter work remains additive rather than requiring another lifecycle rewrite.

## Impact Scope
Guardian polling, scheduler commandless transitions, fixer-to-QA stage outcomes, retry counters, and related regression tests. GitHub happy-path behavior, PM adapter bodies, non-coding execution profiles, and full non-numeric identity migration were intentionally left unchanged.

## Implementation
- Added persisted STALLED routing to the state router.
- Added commandless RESUME target-state persistence before scheduler launch.
- Added QA FAIL bounded retry and fix-round-exceeded hand-back behavior.
- Added focused router, scheduler-state, and stage-runner regression coverage.

## Test Verification
- `npm run test:guardian` — 671 passed, 0 failed.
- Targeted lifecycle suites — 69 passed, 0 failed.
- `git diff --check` — passed.
- LSP diagnostics on all changed JavaScript files — no diagnostics.

## Notes
Commits: d241c8e, b6318bd, f09f663. This change implements the accepted Guardian extensibility and PM preparation decisions without claiming PM runtime support.
