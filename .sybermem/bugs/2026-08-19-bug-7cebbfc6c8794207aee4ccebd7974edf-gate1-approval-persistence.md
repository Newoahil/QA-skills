---
type: bug
record_id: bug-7cebbfc6c8794207aee4ccebd7974edf
date: 2026-08-19
title: Trusted Gate 1 approval was consumed but did not unlock the plan gate
severity: high
status: resolved
key_conclusion: Persist trusted approve/revise authorization in issue state and let structurally valid plans enter FIXING after human approval, preventing consumed commands from being lost across scheduler restart or a second plan-gate evaluation.
topics: [qa-guardian, gate1, session-continuity]
related: [bug-68ea53ff66ef4f62b7f680db1ecebf19]
---

## Bug Description

Issue #211 received a trusted `/guardian approve`; the scheduler consumed the comment and updated
`last_consumed_comment_id`, but then re-evaluated the same plan as not autonomous-ready and returned
to `GATE_1_WAIT`. The approval fact was not persisted, so it could not be re-consumed or recovered.

## Root Cause

Plan gate logic only recognized autonomous readiness. It did not distinguish a valid plan that had
received trusted human approval. Scheduler persisted command consumption but not the corresponding
Gate 1 authorization.

## Solution

- Persist `gate_1_approved_comment_id` and opaque `gate_1_revision_data` in issue state.
- On trusted approve/revise, advance state to FIXING and persist authorization before running.
- `assessFixingEntry` permits `valid + humanApproved`, but never bypasses structural errors.
- A new Gate 1 or followup round clears the old approval to prevent cross-round authorization.

## Prevention Measures

- Tests cover valid non-autonomous plan before/after approval and prove approval cannot bypass an
  invalid plan.
- Followup test proves fixer/QA sessions persist while Gate 1 approval fields reset.

## Related Changes

- `tools/guardian/plan-gate.mjs`
- `tools/guardian/state.mjs`
- `tools/guardian/scheduler.mjs`
- `tests/guardian/plan-gate.test.mjs`
- `tests/guardian/state.test.mjs`
- Full suite: 298/298 green.
