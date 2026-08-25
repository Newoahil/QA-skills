---
type: digest
kind: phase
date: 2026-08-19
number: 004
title: Three-role architecture, actor routing & Phase 4 webhook/authorization seams
status: completed
source_records:
  - changes/2026-08-19-change-24402a071a3a4c84a3a6f56e78cca33b-role-architecture-contract.md
  - changes/2026-08-19-change-bcabf0f8e62b4a45b47b7823b934848e-supervisor-verdict-comment-protocol.md
  - changes/2026-08-19-change-62abfd75f0104cce826232f15679e2d3-actor-routing-authorization-separation.md
  - changes/2026-08-19-change-5e5f9e3456464cb598ba51d705ffc945-phase4-webhook-architecture-ledger.md
  - changes/2026-08-19-change-eb83465c334b4e88b55e83d019123930-phase4-webhook-ingest-wake-drain.md
  - changes/2026-08-19-change-df0e3cad054847b7a529c6246bd4d603-phase4-union-wake-candidates-seam.md
  - changes/2026-08-19-change-d68ddced82a4440492d038e2b4aa8975-heartbeat-critical-section.md
  - changes/2026-08-19-change-4e17ae8322d944be9acbbd5f14780594-review-remediation.md
  - bugs/2026-08-19-bug-68ea53ff66ef4f62b7f680db1ecebf19-silent-plan-gate.md
  - bugs/2026-08-19-bug-7cebbfc6c8794207aee4ccebd7974edf-gate1-approval-persistence.md
  - bugs/2026-08-19-bug-8a392be541a943bdad199b2dd863ca7c-plan-evidence-id-schema.md
  - bugs/2026-08-19-bug-8a5db6c7aa0447189f0e23d02741516c-gate2-verdict-state-preservation.md
  - bugs/2026-08-19-bug-a47057aaf97145de807476aef76844e3-missing-verdict-artifact-import.md
  - bugs/2026-08-19-bug-aebf3f8b068f48b59ce275467409fa20-fixer-branch-verdict-finalization.md
coverage:
  from: 2026-08-19
  to: 2026-08-19
coverage_hash: d431c6b5442593e6f826eb16fea197f79c18c8af52263c9765d995b8b72776bd
---

## Phase Scope
Establishing the QA/Fixer/Supervisor identity boundaries in code, the actor-routing policy that keeps machine actors from authorizing out-of-role effects, and the Oracle-approved Phase 4 webhook design (webhook as a durable wake-up producer only, scheduler stays sole writer). Includes the Gate 1/Gate 2 state-persistence bugs found by running the flow end-to-end.

## Core Conclusions
- QA Guardian is split into **QA / Fixer / Supervisor** roles; the split began as docs-only contracts (zero runtime change) so later phases can separate identities without reopening frozen invariants.
- The **Supervisor is the sole writer of `[QA_VERIFIED]`/`[QA_FAILED]` verdict comments**; QA stays zero-side-effect, and a verdict marker can never be re-parsed as an authorization command.
- An **actor-routing policy layer + bot denylist** enforces identity boundaries in code (machine actors can never authorize or perform out-of-role GitHub effects) without needing a per-App-token cutover; child-agent shell authority was replaced by supervisor-owned direct argv operations.
- **Phase 4 webhook is a durable wake-up producer only** — never a state writer. The design is a pure 3-layer idempotency ledger + webhook ingest (durable dedupe by `delivery_id`) + a scheduler wake-drain planner (coalesce + application-token guard), and a local `unionWakeCandidates` seam that merges relay wake targets into the scheduler's candidate list, returning it unchanged when no relay is wired. This preserves single-writer N=1 and comment-chronology authorization; only the deployment-coupled live relay remains.
- The **N=1 lease heartbeat must cover the whole critical section** (investigation + fixer + QA + PR), not just the fixer spawn — otherwise a long investigation goes lease-stale mid-run and is misjudged STALLED.
- Gate 1/Gate 2 state must be **persisted and re-read**: non-autonomous plans persist GATE_1_WAIT (uncertainty→HIGH, structured human-approval comment, then exit) instead of silently staying DISCOVERED; trusted approve/revise authorization is persisted so it survives scheduler restart / a second plan-gate evaluation; and the QA verdict is re-read after persistence and before GATE_2_WAIT so `qa_verdict_path`/status/hash survive the PR transition.

## Key Decisions and Changes
- Role-architecture contract (scheme A, docs-only); verdict→Supervisor→GitHub comment protocol; actor-routing policy + bot denylist; supervisor-owned argv effects.
- Phase 4: architecture doc + unified idempotency ledger, webhook ingest + wake-drain planner, `unionWakeCandidates` seam.
- Independent-review remediation batch (Guardian suite 396/396): context-bound fail-closed SDK sessions and Gate 1 approvals, capabilities enforced at mutation seams, Feishu actions bound to trusted users, state/GitHub I/O hardened.
- Fixed the Gate 1 silent-gate, Gate 1 approval persistence, plan `evidence_ids` schema (enum from dossier IDs), Gate 2 verdict erasure, missing verdict-artifact import, and fixer branch/verdict finalization bugs; heartbeat extended to the whole critical section.

## Current State
Identity boundaries, single-writer verdict comments, and the webhook design are locked in code; only the deployment-coupled live webhook relay is outstanding. Gate 1/Gate 2 persistence is correct across restarts. Execution-profile enforcement and later PM-adapter neutrality build on these seams (digest-008/009).

## Recommended Next Reads
- digest-003 — the SDK sessions these roles execute within.
- digest-008 — the extensibility refactor that makes these seams hot-pluggable and PM-ready.
- digest-009 — later Gate 1 recovery and pre-QA evidence completing the verdict flow.

## Source Coverage
14 records (8 changes + 6 bugs), all dated 2026-08-19, covering role split, authorization, Phase 4 webhook, and Gate 1/Gate 2 persistence.
