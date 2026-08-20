---
type: digest
kind: phase
date: 2026-08-20
number: 001
title: undated qa-guardian cluster
status: completed
source_records:
  - bugs/2026-08-18-bug-19e5ffff30db46ccbca9f8ca73551ad1-security-review-blockers.md
  - changes/2026-08-18-change-260993fcf6504e8eb9e54f84f0dd45f4-investigation-runtime.md
coverage:
  from: 2026-08-18
  to: 2026-08-18
coverage_hash: 4a1410fc04e3e1a21dd3976129a0cfafc07c52ba3b312cb73b9b83e2d89963dd
---

## Phase Scope

QA Guardian runtime hardening: fixing Phase 11 security-review blockers and wiring the
investigation runtime adapter. Two records covering production-image secret safety and the
scheduler investigation runtime.

## Core Conclusions

- Production hardening addressed secrets leakage, unattended legacy gate bypass, non-atomic
  stale-lock takeover, and non-idempotent STALLED rerun risk.
- `investigation-runtime.mjs` chains the injected specialist runner, coordinator dossier synthesis,
  artifact persistence, plan builder, and plan validation into a callable runtime adapter.

## Key Decisions and Changes

- Added `.dockerignore` and env-only production loader to keep local secrets out of images.
- Defaulted investigation mode to enforced so legacy cannot silently bypass the plan gate.
- Made stale-lock takeover atomic and guarded STALLED reruns against non-idempotent restarts.
- Introduced a single `investigation-runtime` seam for specialist→dossier→plan→validation.

## Current State

Phase 11 blockers mitigated; machine QA enforcement, timeout, and state persistence were still
open follow-ups at the time these records were written.

## Recommended Next Reads

- `changes/2026-08-18-change-260993fcf6504e8eb9e54f84f0dd45f4-investigation-runtime.md`
- `bugs/2026-08-18-bug-19e5ffff30db46ccbca9f8ca73551ad1-security-review-blockers.md`

## Source Coverage

- `bugs/2026-08-18-bug-19e5ffff30db46ccbca9f8ca73551ad1-security-review-blockers.md`
- `changes/2026-08-18-change-260993fcf6504e8eb9e54f84f0dd45f4-investigation-runtime.md`
