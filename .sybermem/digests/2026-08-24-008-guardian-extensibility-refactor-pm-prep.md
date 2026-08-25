---
type: digest
kind: phase
date: 2026-08-24
number: 008
title: Guardian extensibility refactor: registry, seams & PM-adapter prep
status: completed
source_records:
  - changes/2026-08-24-change-3045c5709920400db10cd5ae1215f1e0-guardian-p7-second-implementations.md
  - changes/2026-08-24-change-5063b13c015545409c92f8f26913ace8-guardian-agent-registry.md
  - changes/2026-08-24-change-55e41d2949a84e69a7525fbf771f2201-guardian-lifecycle-recovery.md
  - changes/2026-08-24-change-5f631dd8a8904afdac92cb71e142bb75-guardian-stage-runner.md
  - changes/2026-08-24-change-7b7985f66af5482f884cad18d2381c18-guardian-fencing-and-compatibility.md
  - changes/2026-08-24-change-d5addda959474f75977877eb0f8f624d-guardian-task-ref.md
  - changes/2026-08-24-change-e31b414019474806aaf53ece0cf10e71-guardian-effect-sink.md
  - changes/2026-08-24-change-eef1ebfd562a4bc5b2d86a6af9b4762a-guardian-github-task-source.md
  - changes/2026-08-24-change-fd28379b349a4ea497f38b24065c1109-guardian-router-observations.md
  - changes/2026-08-24-change-75e3992edeb9459c93b83f20311e4e4e-pm-adapter-prep-tier-ab.md
  - decisions/2026-08-24-decision-b531cef4d0f44652917eb044fbc0a31e-guardian-extensibility-plan.md
  - decisions/2026-08-24-decision-e8c0d364373b42a890557ce99762e7c8-pm-adapter-prep-work.md
coverage:
  from: 2026-08-24
  to: 2026-08-24
coverage_hash: 12879fb0f8009551dc5a4a980d789fe6bf8e804947d4c6f8f6913fe9ab0462d0
---

## Phase Scope
The staged compatibility-seam refactor that makes QA Guardian hot-pluggable — a second task source and a second pipeline stage prove the extensibility seams — while keeping GitHub behavior byte-identical, plus the preparatory decoupling that makes a future PM (project-management) execution adapter pure-increment work.

## Core Conclusions
- Guardian gains **task-source and agent hot-plug extensibility through staged compatibility seams**: new sources and stages register by manifest + restart, and GitHub behavior stays byte-identical (proven by a second `TaskSource` and a second pipeline stage that require no durable string task ids and no default-behavior change).
- The extensibility seams are concrete abstractions: a **`TaskSource` contract + GitHub adapter** (normalizes issue facts before router migration; poll imports stay compatible), routing that **consumes normalized `TaskObservation` data** (raw GitHub command parsing isolated in the adapter), a **manifest-backed specialist agent registry** (no more duplicated hard-coded role lists), a **stage manifest + stage runner** for the SDK fixer→QA sequence (preserving state writes/artifacts/legacy execution/post-QA finalization), an in-memory **`TaskRef`** value object, and an **`EffectSink`** that authorizes each effect before I/O while keeping the EFFECTS vocabulary and low-level GitHub adapters unchanged.
- **PM prerequisite (decided):** before building a PM execution adapter, Guardian must first de-number its task identity (the single hard prerequisite, "P8"); after that, facts-spec extension, `in_review` semantics, executionType profile routing, and pre-registered PM effects can proceed in parallel.
- The Tier A+B PM-prep delivery decoupled numeric task identity and the fix-only lifecycle as 6 focused commits (A1–A3, B1–B3) with GitHub behavior byte-identical (full guardian suite 650/650 green).
- **Lost-lock and late session results are fenced**: notification transition claims are serialized and unsupported non-GitHub execution is rejected before side effects, so future PM adapters attach through neutral seams instead of partial GitHub execution; recoverable STALLED and QA-failure outcomes are persisted so retries/hand-backs are explicit rather than silently leaving active work.

## Key Decisions and Changes
- Second TaskSource + second pipeline stage (P7 "second implementations"); manifest-backed agent registry; lifecycle recovery outcomes; stage manifest + stage runner; fencing + source-compatibility guards; TaskRef value object; EffectSink abstraction; GitHub TaskSource adapter; router consumes TaskObservation; PM-adapter prep Tier A+B (identity de-numbering, exec spec, read-only lock, IN_REVIEW, profile routing, PM effects).
- Two decisions record the dual hot-plug extensibility plan and the PM-prep prerequisite ordering.

## Current State
Guardian's task-source and agent/stage layers are hot-pluggable behind neutral seams; task identity is de-numbered; a PM execution adapter is now pure-increment work. GitHub behavior is unchanged. The routing/profile enforcement that consumes these seams lands in digest-009.

## Recommended Next Reads
- digest-009 — execution-profile enforcement, PM source reservation, and outcome routing that build directly on these seams.
- digest-004 — the role/authorization boundaries these seams preserve.
- digest-007 — the runtime substrate the stage runner executes on.

## Source Coverage
12 records (10 changes + 2 decisions), all dated 2026-08-24, covering the extensibility-seam refactor and PM-adapter preparatory work.
