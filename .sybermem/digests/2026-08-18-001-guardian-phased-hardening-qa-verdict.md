---
type: digest
kind: phase
date: 2026-08-18
number: 001
title: Strong Guardian phased hardening (P1–P11) & QA verdict contracts
status: completed
source_records:
  - changes/2026-08-18-change-559f7f25f2834bb2b50e4b7bcf9a3bfb-evidence-contract.md
  - changes/2026-08-18-change-494b8d8a5ef14682bd96aeefdd945693-plan-validator.md
  - changes/2026-08-18-change-47dc8b8da91e4b6fa99315f0e3712686-specialists.md
  - changes/2026-08-18-change-ab75b9ee58354673b48b9c875f91a889-investigation-coordinator.md
  - changes/2026-08-18-change-e34b035b981b4224a44621ba7457d5b2-runtime-budgets.md
  - changes/2026-08-18-change-0071a9a0e32c40c28601c3ff7d6ad8b6-plan-gate-runtime.md
  - changes/2026-08-18-change-d9e9344cce4a4afbb937c6c637a7931c-plan-gate.md
  - changes/2026-08-18-change-cc34c0f387b04539bef2107012ba5deb-phase9-runtime-integration.md
  - changes/2026-08-18-change-41675aeea2c446eea10506e55cbbd08d-phase10-docs.md
  - changes/2026-08-18-change-a43b7803dba74e9bae48e0bed222011c-recovered-phase-files.md
  - changes/2026-08-18-change-a1a8b1267e6946a098431b0dfbd102b6-review-runtime-fixes.md
  - changes/2026-08-18-change-0fcf1b08d1784c49b5e6ec1c2d6c527f-artifact-state.md
  - changes/2026-08-18-change-12b834a1483f4fad8368e33dfe64947a-qa-verdict-state.md
  - changes/2026-08-18-change-50ac1b7b0ba245bca6892a771e308eb1-qa-gate-contract.md
  - changes/2026-08-18-change-a42d82b9641948eab4109dd13795f675-qa-verdict-runtime.md
  - changes/2026-08-18-change-abb444d029c440fba6895ca3d3dc1946-prepr-qa-gate.md
  - changes/2026-08-18-change-a4cb962beea34d6491bc3c850bbd7590-artifact-quarantine.md
  - changes/2026-08-18-change-2955e2780a8b4097bfdf09d765453605-runtime-reliability.md
  - changes/2026-08-18-change-260993fcf6504e8eb9e54f84f0dd45f4-investigation-runtime.md
  - bugs/2026-08-18-bug-19e5ffff30db46ccbca9f8ca73551ad1-security-review-blockers.md
coverage:
  from: 2026-08-18
  to: 2026-08-18
coverage_hash: 8d15c878b80198e33a43552ebbb8c70c5804f63dd8b2db5994df7ddb5a011e92
---

## Phase Scope
The foundational "Strong Guardian" build-out (Phases 1–11) that turned QA Guardian from a concept into a plan-gated, evidence-driven autonomous fixing pipeline. Establishes the pure cores (evidence, budgets, plan validation, investigation coordination), the plan gate that decides whether a write-capable Guardian may run, the machine-readable QA verdict contract, and the artifact persistence layer — all delivered as test-backed cores before runtime wiring.

## Core Conclusions
- Guardian's decision-readiness is gated by an explicit **evidence contract** (`evidence.mjs`): hypotheses are scored, dossiers validated, and a bug/request cannot reach `autonomous-ready` while it has unresolved facts or an invalid dossier; a `request` may never default to LOW risk.
- The **plan gate** (`plan-gate.mjs`) maps three investigation modes — `legacy` / `shadow` / `enforced` — to write permission; under `enforced`, only a dossier-backed, decision-complete **LOW** plan may autonomously enter FIXING, and an incomplete/failed plan does not start a write-capable Guardian.
- The **plan validator** (`plan-validator.mjs`) requires root-cause evidence, affected files, non-goals, tests/acceptance, rollback, risk, and `evidence_ids` before a plan is accepted.
- QA outcomes are a **machine-readable verdict contract** (`qa-verdict` PASS/FAIL/BLOCKED with a report hash); under `enforced`, qa-guardian only emits `qa-verdict.json` and the scheduler validates issue/branch/plan-hash + `Overall Status: PASS` via `qa-gate`/`pr-io` before creating a PR and writing GATE_2_WAIT.
- Investigation uses an **investigation-coordinator** pure core that selects orthogonal read-only specialists by issue complexity and merges hypotheses/evidence/unresolved-facts into a dossier; specialists (`guardian-code`/`business`/`runtime`/`docs`) are read-only and all write/install/network escalation stays denied.
- **Artifacts are atomic and paired**: dossier and plan share an `investigation_id`, are read via `readArtifactPair` with revision/integrity checks, and inconsistent/half-written artifact pairs are quarantined and rebuilt.
- Phase 11 security review surfaced (and this phase began mitigating) risks of secrets in production images, unattended `legacy` bypassing the plan gate, non-atomic stale-lock takeover, and non-idempotent STALLED rerun — mitigations added (`.dockerignore`/env-only loader, `enforced` default, atomic stale-lock takeover, stall guard), with machine QA enforcement/timeout/state-persistence still owed to later phases.

## Key Decisions and Changes
- Delivered the pure cores first: `evidence.mjs`, `budgets.mjs` (standard/complex budgets, specialist count, deadlines, timeout classification), `plan-validator.mjs`, `plan-gate.mjs`, `investigation-coordinator`.
- Wired investigation runtime into the scheduler's shadow/enforced path (`investigation-runtime.mjs` / `investigation-process`): real read-only specialist subprocesses, dossier/plan artifact writes, plan-gate execution.
- Added the QA verdict machine contract + `qa-gate`/`pr-io` so PASS-before-PR is enforced and PR creation is gated on hash-bound verdicts.
- Hardened reliability: child-invocation `child_timeout_ms` + kill/timeout classification, investigation-failure persisted to dossier/plan (attempts/error/phase), specialist JSON trailing-object injection fixed, and the scheduler's post-lock investigation/plan/claim/run placed under a unified `finally` lock release.
- Recovered previously-uncommitted Phase 5 capability, Phase 9 pipeline harness, and schema-regression test fixes; migration docs (README/DEPLOY) explain legacy/shadow/enforced and rollback.

## Current State
The plan-gated core pipeline is in place and test-backed (test counts climbed 158 → ~204 across the phase). Investigation, plan gate, QA verdict, and artifact persistence are wired into the scheduler under shadow/enforced. Still owed after this phase: full machine QA enforcement at PR time, timeout policy, and durable state persistence hardening (delivered in later phases 003/004/007/009).

## Recommended Next Reads
- digest-003 — OpenCode SDK multi-session runtime (how investigation/fixer/QA actually execute).
- digest-004 — three-role split, webhook seams, and authorization that build on these contracts.
- digest-009 — later fixer/QA outcome routing that completes PASS-before-PR and reset semantics.

## Source Coverage
20 records (19 changes + 1 bug), all dated 2026-08-18, covering the P1–P11 Strong Guardian core build-out.
