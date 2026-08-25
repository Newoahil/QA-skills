---
type: change
record_id: change-f754e6e4eea2414796b46ffebccb94f9
date: 2026-08-25
title: Guardian no-reset continuation recovery
status: completed
source: manual
key_conclusion: QA Guardian now resumes approved or revised work from reconciled local state and remote comments without reset, so Gate1 feedback and pre-fixer crash windows continue safely.
topics: [qa-guardian, state-machine, recovery]
author: Sisyphus
related_files:
  - tools/guardian/commands.mjs
  - tools/guardian/state-router.mjs
  - tools/guardian/scheduler.mjs
  - tools/guardian/plan-validator.mjs
  - tools/guardian/investigation-process.mjs
  - tools/guardian/gate1-comment.mjs
---

## Change Content

Changed QA Guardian continuation behavior in three areas:

- `/guardian revise <feedback>` now routes Gate1 feedback back through investigation and plan regeneration instead of treating the feedback as repair authorization.
- Plan normalization now includes declared `primary_files`, explicit `test_files`, and test command paths in the executable `affected_files` allowlist while preserving strict out-of-plan changed-file rejection.
- Router and scheduler recovery now detect approved pre-fixer half states, including crash windows before a fixer session exists, and resume them without deleting local issue records.

## Reason for Change

Issues #324 and #325 exposed stale or half-applied Guardian state transitions. #324 consumed human feedback as approval and then handed back because a valid test file was absent from `affected_files`; #325 had an approved plan identity but no fixer session, so a fresh active lease caused repeated skips. The desired behavior is to reconcile remote issue comments with local durable state at startup/poll time and continue the correct next step without reset.

## Impact Scope

The change affects QA Guardian command routing, plan scope validation, Gate1 comment copy, scheduler command-state persistence, and recovery decisions. It does not weaken command author authorization, N=1 locking, human Gate1/Gate2 controls, or fixer changed-file scope enforcement.

## Implementation

Implemented atomic fixes across the Guardian pipeline:

- Updated command metadata and route decisions so `revise` enters `INVESTIGATING`.
- Added scheduler `applyGateCommandState` to persist approve/revise transitions consistently, write a `fixer-start` inflight marker for approve crash recovery, and supersede old plan/dossier identity on revise.
- Added pure router recovery for approved pre-fixer states with matching plan identity and no branch/session, plus legacy `changed-file-not-in-plan` handback recovery.
- Extended plan builder prompts/schema with optional `test_files` and normalized declared plan/test paths into `affected_files`.

## Test Verification

Verified with focused and full Guardian regression suites:

- `node --test tests/guardian/commands.test.mjs tests/guardian/state-router.test.mjs tests/guardian/plan-validator.test.mjs tests/guardian/investigation-process.test.mjs tests/guardian/gate1-comment.test.mjs tests/guardian/scheduler-state.test.mjs` passed 117/117.
- `node --test "tests/guardian/*.test.mjs"` passed 742/742.
- LSP diagnostics were clean on changed Guardian source and test files.
- Real poll checks against `D:\tuantuanrent.qa-guardian-control` returned `RESUME -> INVESTIGATING` for #324 and `RESUME -> FIXING` for #325 without reset.

## Notes

The existing untracked `.sybermem/.memory-usage.jsonl` and `.sybermem/templates/digest-template.md.bak` files were present before this record and were left untouched.
