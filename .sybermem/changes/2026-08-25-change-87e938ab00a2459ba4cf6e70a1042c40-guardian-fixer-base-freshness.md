---
type: change
record_id: change-87e938ab00a2459ba4cf6e70a1042c40
date: 2026-08-25
title: Guardian fixer base freshness
status: implemented
source: T1 implementation on feature/guardian-extensibility
key_conclusion: Guardian Supervisor now fetches and verifies the configured base before Fixer edits, refreshing only clean stale branches and failing dirty plans closed so fixes never start from an unsafe snapshot.
topics: [qa-guardian, supervisor, branch-freshness]
author: Sisyphus
related_files: [tools/guardian/supervisor-exec.mjs, tools/guardian/stage-runner.mjs, tests/guardian/supervisor-exec.test.mjs, tests/guardian/stage-runner.test.mjs]
implements: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content
Added Supervisor-owned Fixer branch preparation that fetches `origin/<base_branch>`, checks worktree cleanliness, verifies the fix branch merge-base, creates new branches from the latest base, and hard-resets only clean stale branches to that base. `runFixerStage` now passes the configured base branch into this seam.

## Reason for Change
Fixer edits must not begin on a stale branch. Dirty stale work cannot be safely auto-merged or rebased, so the Supervisor must fail closed with a recoverable status while preserving the no-shell agent boundary.

## Impact Scope
Only Supervisor branch preparation and its Fixer-stage call site changed. TaskRef, TaskSource, EffectSink, PM reservation, QA timing, and GitHub effect ownership remain unchanged.

## Implementation
`prepareFixBranch` uses fixed git argv operations only. Clean stale branches return `stale-clean-branch-refreshed`; dirty work returns `stale-dirty-fix-branch` with `recoverable: true` and no branch mutation. New and already-current branches remain supported.

## Test Verification
- `node --test tests/guardian/supervisor-exec.test.mjs tests/guardian/stage-runner.test.mjs` passed: 36/36.
- `npm run test:guardian` passed: 704/704.
- `node --check` passed for both modified implementation modules.
- LSP diagnostics reported no errors for both implementation and direct test files.
- `git diff --check` passed.

## Notes
QA remains an independent pre-PR session after Fixer completion; this phase changes only branch freshness before Fixer edits.
