---
type: change
record_id: change-eb83465c334b4e88b55e83d019123930
date: 2026-08-19
title: Add Phase 4 webhook ingest and scheduler wake-drain planner
status: done
key_conclusion: Implemented the webhook ingest (cloud, durable dedupe by delivery_id, never a state writer) and the scheduler wake-drain planner (coalesce + application-token guard) so webhook and compensation-poll triggers converge to exactly one application without breaking single-writer N=1 or comment-chronology authorization.
topics: [qa-guardian, webhook, idempotency]
author: goudaren0528
related_files: [tools/guardian/webhook-ingest.mjs, tools/guardian/wake-drain.mjs, tests/guardian/webhook-ingest.test.mjs, tests/guardian/wake-drain.test.mjs]
related: [change-5e5f9e3456464cb598ba51d705ffc945]
---

## Change Content
Phase 4 (second slice) of the QA/Fixer/Supervisor split, on branch auto-qa.
Built the two Oracle-designed halves against an injectable relay store (so the
real backing store — container FS / DB / managed queue — is a swap, not a
rewrite):
- New `tools/guardian/webhook-ingest.mjs` (cloud side): verifies the GitHub
  webhook HMAC-SHA256 signature (constant-time), extracts the TARGET ISSUE
  NUMBER only, durably inserts the delivery by `delivery_id` via an injected
  WakeStore, and returns 2xx after durable insert. It NEVER runs gh, calls
  selectCommand, reads/writes `.qa/guardian/<n>.json`, launches an agent, or
  posts a verdict. Includes a minimal in-memory WakeStore (tests/local) with a
  pending/ack pull contract; production injects a durable store.
- New `tools/guardian/wake-drain.mjs` (local side, pure): `planWakeTargets`
  coalesces relay wakes + interval-compensation issues into one deduped sorted
  set (a null-issue pull_request/push delivery contributes no wake), and
  `guardTransition` derives the deterministic application token and reports
  whether it is already committed (the skip-if-applied guard).

## Reason for Change
This lands the Phase 4 wiring on top of the tested pure ledger core, keeping
Oracle's invariants: webhook is a wake-up producer only; the scheduler stays the
sole consumer/writer and reads truth from GitHub at reconcile time; the
deterministic transition token makes webhook and compensation triggers converge
to exactly one application. Proceeded on the default injectable-store shape
because it is fully testable without touching real infrastructure and lets a
different backing store be swapped later.

## Impact Scope
Additive: two new modules + two test files. No change to STATES, labels,
dispatch, the authorization model, or existing runtime paths. The scheduler loop
and callback-server are NOT yet re-wired to call these seams (a later,
deployment-coupled step); this slice lands and locks the pure/injected logic.

## Implementation
Signature verification uses `crypto.timingSafeEqual`. Delivery ids and tokens
(attacker-influenced) are sanitized before any filesystem use (in the ledger).
`planWakeTargets` returns both the coalesced issue set and the consumed delivery
ids (to ack after a successful drain). `guardTransition` reuses the pure ledger
token derivation + `hasAppliedCommitted`.

## Test Verification
Full suite: 254/254 green (240 baseline + 14 new). The 5 Oracle regression
cases are proven: (1) delivery replay → one durable record + one wake target;
(2) webhook + compensation converge to one application via an identical
transition token; (3) an out-of-order webhook preserves comment-chronology
latest-wins (selectCommand picks the newest eligible comment, never arrival
order); (4) concurrent duplicate issue wakes coalesce to one reconcile target;
(5) an in_progress transition is retried by the same token, not a new run. Plus
signature verify, issue extraction, bad-signature 401, missing-delivery 400,
ping-ignored 202.

## Notes
Phase 4 second slice. Remaining: re-wire callback-server to call ingestWebhook
and the scheduler loop to drain/reconcile under the existing N=1 lease — that
step is coupled to the cloud deployment's durable store + the local pull path,
which is a deployment decision.
