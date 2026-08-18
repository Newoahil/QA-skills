---
type: change
record_id: change-5e5f9e3456464cb598ba51d705ffc945
date: 2026-08-19
title: Add Phase 4 webhook architecture doc and unified idempotency ledger core
status: done
key_conclusion: Locked the Oracle-approved Phase 4 design (webhook = durable wake-up producer only, scheduler stays sole writer) and implemented the pure 3-layer idempotency ledger, so later webhook wiring cannot violate single-writer state or comment-chronology authorization.
topics: [qa-guardian, webhook, idempotency]
author: goudaren0528
related_files: [docs/qa-guardian-webhook-idempotency.md, tools/guardian/ledger.mjs, tests/guardian/ledger.test.mjs]
related: [change-62abfd75f0104cce826232f15679e2d3]
---

## Change Content
Phase 4 (first slice) of the QA/Fixer/Supervisor split, on branch auto-qa.
After an Oracle consultation on the concurrency/idempotency fork, locked the
design and implemented its pure core:
- New `docs/qa-guardian-webhook-idempotency.md` (normative): webhook is a
  durable wake-up producer ONLY (never a state writer, never an authorization
  evaluator); the scheduler stays the sole consumer + sole writer; the cloud
  callback-server durably ingests deliveries by delivery_id and the local
  scheduler pulls/acks; NO distributed locking (the local lease is the only
  serialization point); crash-safe `in_progress`-before-launch semantics; the
  3-layer idempotency ledger; 5 regression test specs; escalation triggers.
- New `tools/guardian/ledger.mjs` (pure): the 3 distinct identity layers —
  ingestion (webhook delivery_id, atomic dedupe, subsumes the callback in-memory
  `seen` set), artifact (issue+comment_id / pr_number, never the delivery_id),
  and application (deterministic sha256 transition_token, stable across
  webhook/compensation trigger paths). Atomic write-temp+rename records under
  `.qa/guardian/ledger/{ingested,applied}/`; a `safeName` guard so an
  attacker-influenced delivery id/token can never escape the ledger dir.

## Reason for Change
Metis flagged the core Phase 4 hazard: webhook is concurrent, at-least-once,
and possibly out-of-order, which conflicts with the single-writer sequential-poll
idempotency model. Rather than guess, Oracle designed a minimal correct model
that keeps GitHub as the source of truth and the scheduler as the only writer.
Landing the doc + pure ledger first lets the webhook/scheduler wiring be built
against a locked contract and a tested idempotency core, and keeps that
deployment-dependent wiring out of this tested slice.

## Impact Scope
Additive: one normative doc + one pure module + its tests. No change to STATES,
labels, dispatch, the authorization model, or any existing runtime path. The
ledger is not yet wired into the scheduler/callback-server (next slice).

## Implementation
Token derivation is pure (hash in → string out) and independently testable.
Records use atomic temp+rename on the same volume. The application layer tracks
an `in_progress → committed/completed` lifecycle preserving `applied_at` across
updates, supporting Oracle's crash-recovery contract (retry the same token, at
most one active fixer under the lease).

## Test Verification
Full suite: 240/240 green (233 baseline + 7 ledger tests). Proofs: deterministic
transition_token (same across trigger paths), artifact vs application identity
distinct, ingestion replay dedupe (first inserts / replay does not), applied
lifecycle (in_progress not committed until marked, applied_at preserved), and
path-safety (a `../../../etc/evil` delivery id stays inside ledger/ingested with
no path separators surviving).

## Notes
Phase 4 first slice. The remaining wiring — webhook ingest in callback-server +
scheduler wake-drain — depends on the cloud deployment's persistence and
network path (Oracle rated the exact relay API medium-confidence), so it is
gated on a deployment decision before implementation.
