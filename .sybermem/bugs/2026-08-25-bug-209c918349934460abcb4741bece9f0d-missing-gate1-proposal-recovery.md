---
type: bug
record_id: bug-209c918349934460abcb4741bece9f0d
date: 2026-08-25
title: Restored Gate 1 state omitted the detailed proposal comment
status: resolved
source: live runtime evidence from tuantuanrent issue #263
key_conclusion: Restored GATE_1_WAIT records now republish the valid detailed proposal once using a dedicated comment hash, because generic last_notified_state cannot prove the plan was shown to the human.
topics: [qa-guardian, gate1, recovery]
related: [decision-b531cef4d0f44652917eb044fbc0a31e, change-f0b58f56a9aa4db49863cfe04ea14b5d]
---

## Description
Issue #263 was restored to GATE_1_WAIT with valid dossier/plan artifacts and last_notified_state=GATE_1_WAIT, but GitHub had zero comments. The scheduler emitted only a generic gate1-waiting notification and never republished the detailed plan, leaving humans unable to review the proposed fix.

## Root Cause
Detailed Gate 1 proposal publication shared the generic notification transition marker. Manual/reset recovery could set the waiting state and notification marker without proving that buildGate1Comment had ever been posted. Later ticks therefore treated the state as already notified and skipped proposal delivery.

## Solution
Added a dedicated deterministic Gate 1 comment hash and proposal claim. First Gate 1 entry and restored waiting compensation now share publishGate1Proposal. The marker is persisted only after successful GitHub comment delivery, failures remain retryable, valid artifact status is required, and generic comment/webhook notification idempotency remains separate.

## Verification
- Live evidence: issue #263 comments were empty while state and artifacts were valid.
- Injected #263-shaped Scheduler compensation publishes the full plan once, persists the marker, and skips the second call.
- Invalid plan/dossier status does not republish.
- Full Guardian suite: 701 passed, 0 failed.
- Commit: 1f7f924.
