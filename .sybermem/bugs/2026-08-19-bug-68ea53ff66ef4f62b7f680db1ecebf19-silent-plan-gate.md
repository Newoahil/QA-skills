---
type: bug
record_id: bug-68ea53ff66ef4f62b7f680db1ecebf19
date: 2026-08-19
title: Plan gate blocked without a visible Gate 1 state or comment
severity: high
status: resolved
key_conclusion: Fixed the SDK-mode plan gate so non-autonomous plans persist GATE_1_WAIT, promote uncertainty to HIGH, write a structured human-approval comment, and exit instead of silently leaving the issue DISCOVERED.
topics: [qa-guardian, gate1, human-approval]
related: [bug-26ad869551cf43f585bbfc062876eccc]
---

## Bug Description

The #211 E2E produced a valid dossier and valid plan, but unresolved facts made the LOW plan not
autonomous-ready. The scheduler released the lock and returned without writing `GATE_1_WAIT` or a
GitHub approval comment, leaving the issue silently `DISCOVERED` and impossible to resume via
`/guardian approve|revise|reject`.

## Root Cause

SDK-mode scheduler owned the plan gate, but the legacy human-gate side effects had lived inside
the old qa-guardian agent. `assessFixingEntry` returned `allowed:false`, while scheduler only
logged `run.blocked_plan_gate` and exited.

## Solution

- Added pure `buildGate1Comment` with `[GATE_1_WAIT]` marker, plan summary, affected files,
  unresolved facts, and the three trusted-human commands.
- Scheduler now writes state `GATE_1_WAIT`, sets risk HIGH for uncertainty, records validator
  errors, posts the Gate 1 comment, releases the lock, and exits.

## Prevention Measures

- Test locks the Gate 1 comment's structural marker, unresolved facts, and command vocabulary.
- SDK-mode ownership changes must move the full side-effect contract (state -> comment -> notify),
  not only the decision function.

## Related Changes

- `tools/guardian/gate1-comment.mjs`
- `tools/guardian/scheduler.mjs`
- `tests/guardian/gate1-comment.test.mjs`
- Full suite: 296/296 green.
