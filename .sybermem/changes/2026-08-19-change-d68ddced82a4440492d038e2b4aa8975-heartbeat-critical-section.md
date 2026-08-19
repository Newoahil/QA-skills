---
type: change
record_id: change-d68ddced82a4440492d038e2b4aa8975
date: 2026-08-19
title: Heartbeat the N=1 lease across the whole scheduler critical section
status: done
key_conclusion: Fixed a second real bug found by the E2E run: the N=1 lease heartbeat only covered the fixer spawn, so a long investigation went lease-stale mid-run and was judged STALLED; the heartbeat now covers the whole critical section (investigation + fixer + QA + PR).
topics: [qa-guardian, lock, n1-concurrency]
author: goudaren0528
related_files: [tools/guardian/scheduler.mjs]
related: [change-9075ddb15f55461cba237c8f6c302f95]
---

## Change Content
Fixed a concurrency bug in `tools/guardian/scheduler.mjs` found by the real E2E
run of issue #205. The N=1 scheduler lock heartbeat (`renewLock` every 30s) was
only started inside `runInvocation` (the fixer spawn), NOT during
`prepareInvestigation` (the investigation phase). Because the whole critical
section — acquireLock → investigate → fixer → releaseLock — holds one lock but
only the fixer part heartbeated it, an investigation longer than `lease_ms`
(30 min) went lease-stale mid-run, and the next poll judged it STALLED (with
stall_retries capped at 1 → handed back / restarted). This was the true root
cause of #205's guardian-code timing out despite raising the specialist budget.

The fix moves the heartbeat OUT of `runInvocation` and starts an outer
critical-section interval right after `acquireLock` succeeds, cleared in the
`finally` alongside `releaseLock`. It renews the lease for the WHOLE critical
section (investigation + fixer + QA + PR), owner-guarded by the handle token.

## Reason for Change
This is the exact "extend the lock to cover the whole reconciliation critical
section (read → route → state write → launch decision)" gap that both Metis and
the Phase 4 Oracle consultation flagged. A long, legitimate investigation must
not be interrupted by its own lease expiry. Raising the specialist budget alone
did not help because the interruption came from the lease, not the budget.

## Impact Scope
Localized to scheduler.mjs (13 insertions / 6 deletions). The lock primitive
(lock.mjs) is unchanged; the fix only wires the existing `renewLock` over the
full critical section. No change to STATES, labels, dispatch, authorization, or
the N=1 exclusive-acquire guarantee (still atomic). Full suite stays green.

## Implementation
Removed the inner `setInterval(renewLock)` from `runInvocation` and added a
`criticalBeat` interval after `acquireLock`, cleared in the `finally` with
`releaseLock`. Both share `HEARTBEAT_MS` (30s). Owner-guard by token is
preserved. `runInvocation` now only owns its child-timeout timer.

## Test Verification
Full suite: 263/263 green. The lock primitive already has a regression
("renew keeps a long run live past the lease so N=1 still holds"). The wiring is
validated by the real E2E rerun: #205's investigation must no longer be judged
STALLED by lease expiry.

## Notes
Second of two real bugs found by the E2E run (the first was the Windows opencode
spawn). Both only surface under a real long-running investigation; unit tests
inject spawn/lock and could not catch the missing heartbeat wiring.
