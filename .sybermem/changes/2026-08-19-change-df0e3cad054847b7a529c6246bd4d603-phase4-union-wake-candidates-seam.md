---
type: change
record_id: change-df0e3cad054847b7a529c6246bd4d603
date: 2026-08-19
title: Add unionWakeCandidates local seam for scheduler wake consumption
status: done
key_conclusion: Added the final pure/local Phase 4 seam that merges relay wake targets into the scheduler's existing candidate list, returning the list unchanged when no relay is wired, so the only remaining webhook work is the deployment-coupled live relay connection.
topics: [qa-guardian, webhook, scheduler]
author: goudaren0528
related_files: [tools/guardian/wake-drain.mjs, tests/guardian/wake-drain.test.mjs]
related: [change-eb83465c334b4e88b55e83d019123930]
---

## Change Content
Added `unionWakeCandidates({ candidates, wakeRecords })` to
`tools/guardian/wake-drain.mjs` (pure). It merges drained relay wake targets
into the scheduler's existing candidate-list shape (as produced by
`listCandidates`): a wake-only issue not already in the compensation list is
appended once with `claim_source: 'webhook-wake'`; an issue already present
keeps its original compensation entry (labels/updatedAt/ordering preserved); a
null-issue delivery (pull_request/push) contributes no wake. Critically, when
there are no wake records it returns the compensation list UNCHANGED.

## Reason for Change
This is the last local seam the scheduler needs to consume webhook wakes. By
making it pure and a strict no-op when no relay is wired, it can land and be
test-locked NOW without changing any live runtime behavior. It shrinks the
Phase 4 blocked surface so the only remaining webhook work is the
deployment-coupled step: connecting a live relay drain into the resident tick()
loop, which depends on the cloud durable store + local pull path (a deployment
decision that was deliberately not guessed).

## Impact Scope
Additive: one pure exported function + 3 tests. Not yet called from the live
`tick()` loop (that is the deployment-coupled step). Zero behavior change to the
running scheduler. No change to STATES, labels, dispatch, or authorization.

## Implementation
The function dedupes wake-only issues among themselves and against the
compensation set, so a burst of duplicate deliveries for one issue yields one
appended candidate. The scheduler will still read fresh gh facts and route each
candidate through the existing pure state-router/commands seams.

## Test Verification
Full suite: 257/257 green (254 baseline + 3 new). Proofs: no wake records →
candidate list returned unchanged (zero behavior change); a wake for an issue
already in compensation keeps the compensation entry; a wake-only issue is
appended once as webhook-wake and null issues are dropped.

## Notes
Completes all pure/local Phase 4 seams (ledger, webhook-ingest, wake-drain,
unionWakeCandidates). Remaining: wire the live relay drain into tick() under the
existing N=1 lease — blocked on the relay deployment decision.
