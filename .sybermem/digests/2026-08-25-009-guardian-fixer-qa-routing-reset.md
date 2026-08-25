---
type: digest
kind: phase
date: 2026-08-25
number: 009
title: Guardian fixer/QA outcome routing, evidence & full-retest reset
status: completed
source_records:
  - changes/2026-08-23-change-bc32a227720045119b782db221dbe469-qa-before-finalization.md
  - changes/2026-08-23-change-f0555262f35442e0bf044d5402b00108-fixer-text-json-completion.md
  - changes/2026-08-25-change-17308a56b3624791a0d2d64f2f049455-guardian-qa-outcome-routing.md
  - changes/2026-08-25-change-87e938ab00a2459ba4cf6e70a1042c40-guardian-fixer-base-freshness.md
  - changes/2026-08-25-change-9b2bd6d959c648cda2fd598bc20215fa-guardian-pre-qa-evidence.md
  - changes/2026-08-25-change-f0b58f56a9aa4db49863cfe04ea14b5d-guardian-profile-and-pm-routing.md
  - changes/2026-08-25-change-fc6f4a6d2cb045139598ab804c0355e3-guardian-plan-validation-retry.md
  - changes/2026-08-25-change-fd7c109124a64af4893e087a8d7ea768-guardian-fixer-retry-context.md
  - bugs/2026-08-24-bug-897d6e684d654aafba07f30dc5079f44-gate1-schema-generation-loop.md
  - bugs/2026-08-24-bug-db865da450a5498fab70e7815cd3332b-fixer-scope-unverified-lease.md
  - bugs/2026-08-25-bug-209c918349934460abcb4741bece9f0d-missing-gate1-proposal-recovery.md
  - decisions/2026-08-25-decision-1d9031b7f2b54e31b9bad620b1b3c7a7-keep-qa-guardian-as-fixer-runtime-agent.md
  - decisions/2026-08-25-decision-832596314b274789ab3bf5f8e354d69d-guardian-issue-reset-scope.md
  - decisions/2026-08-25-decision-f177ceabeded4a5193afa0f2b58b6c13-guardian-full-retest-reset.md
coverage:
  from: 2026-08-23
  to: 2026-08-25
coverage_hash: eec92f64429f5ca6d239fe08cd54b4687dafc92b71fecd9d9418105cceb5566e
---

## Phase Scope
The most recent Guardian arc: enforcing independent-QA-before-PR with real evidence provenance, routing all four QA outcomes through explicit lifecycle states, keeping the Fixer working from a fresh/safe base with recovery context, and the operational reset procedures for retesting a single issue or the whole flow end-to-end.

## Core Conclusions
- **Independent QA runs before PR/finalization**: commit/push finalization is behind an audited QA PASS, QA acceptance prose is forwarded into verdict comments, and the Supervisor captures real status/diff + scoped-test evidence *before* QA, then reuses the validated command plan only after PASS — so PR timing and evidence provenance stay explicit.
- QA outcomes route through **explicit lifecycle states — PASS / FAIL / BLOCKED / NEEDS_HUMAN_REVIEW** — bounding code-actionable retries and handing environment/manual blockers back without leaving active-state residue.
- The **Fixer must start from a safe, fresh base**: the Supervisor fetches and verifies the configured base before edits, refreshing only clean stale branches and failing dirty plans closed; prior QA report + Supervisor test evidence are injected as **untrusted DATA** into the reused Fixer session for exact recovery context without a new session.
- **Generation boundaries must satisfy strict validators**: specialist evidence and plan risk conform before publication (preventing an accepted Gate 1 plan from being consumed then silently reset to GATE_1_WAIT); specialist evidence namespaces are canonicalized from the scheduled role and one locally-invalid plan is retried with exact validator errors before hand-back.
- **Fixer completions are normalized and fail-closed**: `affected_files` objects become scoped path strings; validated fixer completions are accepted from text JSON as well as structured output (shared-server no-format path) without weakening validation; unverified completions persist their reason and exit FIXING instead of appearing permanently in progress.
- Restored GATE_1_WAIT records **republish the detailed proposal once** using a dedicated comment hash, because generic `last_notified_state` cannot prove the plan was shown to the human.
- Guardian **enforces execution profiles**, completes Gate 1 dual-channel closeout, fences finalization effects, marks new claims active, validates scheduler timing, and **reserves `source=pm` as an explicit no-side-effect route** so future PM integration stays additive.
- **Reset procedures (decided):** resetting one issue only requires backing up + removing its authoritative `.qa/guardian/<n>.json` + `<n>/` dir (the lease lives inside `<n>.json` so it clears automatically; prior `/guardian` comments need not be deleted; `config.json`/other issues/`watch-state.json`/`.sybermem` must never be touched; a force-killed scheduler leaves a STALE `.scheduler.lock` removable only after verifying the owner PID is dead). A full end-to-end retest additionally preserves plan-scoped product work in a path-scoped stash and removes the authoritative issue record + artifact dir so the next poll starts at START→INVESTIGATING. **qa-guardian is kept as the runnable Fixer agent for now** (fixer-agent.md is only a role contract; a safe rename needs compatibility migration).

## Key Decisions and Changes
- QA-before-finalization + verdict-comment forwarding; fixer text-JSON completion acceptance; QA outcome lifecycle routing; fixer base freshness; pre-QA Supervisor evidence; profile enforcement + PM source reservation; plan-validation retry; fixer retry context injection.
- Bugs: Gate 1 schema-generation loop, fixer-scope unverified-lease, missing Gate 1 proposal recovery.
- Decisions: keep qa-guardian as Fixer runtime agent; single-issue reset scope; safe full-retest reset.

## Current State
This is the current head of Guardian development: independent QA gates PR, outcomes route by explicit lifecycle, the Fixer starts safe with recovery context, and operators have documented single-issue and full-retest reset procedures. PM integration remains an additive, reserved route.

## Recommended Next Reads
- digest-008 — the extensibility seams and PM-prep this phase's profile routing consumes.
- digest-004 — the Gate 1/Gate 2 and verdict-comment protocol this completes.
- digest-001 — the original QA verdict / plan-gate contracts now fully enforced.

## Source Coverage
14 records (8 changes + 3 bugs + 3 decisions), 2026-08-23 to 2026-08-25, covering fixer/QA outcome routing, pre-QA evidence, and reset procedures.
