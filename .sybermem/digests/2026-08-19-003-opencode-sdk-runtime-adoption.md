---
type: digest
kind: phase
date: 2026-08-19
number: 003
title: OpenCode SDK multi-session runtime adoption & session-continuity bugs
status: completed
source_records:
  - changes/2026-08-19-change-2d00718e55fc479195377618f8fe8527-adopt-opencode-sdk-session-continuity.md
  - changes/2026-08-19-change-09acc786cc4c4b53b58d1e9a5b7267ef-fixer-qa-sdk-session-runners.md
  - changes/2026-08-19-change-9c651671735d41ca84cb71a1c1bd2213-wire-fixer-qa-sdk-sessions.md
  - changes/2026-08-19-change-1a149adf92854c34938da07409ba28a9-plan-builder-sdk.md
  - changes/2026-08-19-change-bf2f029768594b7097870069da715a0a-pass-target-directory.md
  - changes/2026-08-19-change-9075ddb15f55461cba237c8f6c302f95-windows-opencode-spawn-fix.md
  - bugs/2026-08-19-bug-09c23cce8bb443d7aadb0f5dea5ce3b7-sdk-session-path-template.md
  - bugs/2026-08-19-bug-682f269c0050412797459f52712af366-headless-permission-hang.md
  - bugs/2026-08-19-bug-95af95c0c87348659c6d36a12974beb0-sdk-prompt-message-convergence.md
  - bugs/2026-08-19-bug-b963cb3902ec472fba0747de51688475-sdk-response-envelope.md
  - bugs/2026-08-19-bug-8c8b03fc6c9c4adbb115442b042dd400-opencode-server-tool-path.md
  - bugs/2026-08-19-bug-26ad869551cf43f585bbfc062876eccc-structured-schema-validator-mismatch.md
coverage:
  from: 2026-08-19
  to: 2026-08-19
coverage_hash: 137fd81fda16101301a533cb9c998be896f17400b67457da10c37a01480dd2b0
---

## Phase Scope
Replacing the unreliable multi-process `opencode run --attach` fan-out with the official one-serve + `@opencode-ai/sdk` pattern, and hardening the SDK integration against the concrete failure modes of SDK 1.18.18 (broken path templates, envelope wrapping, permission hangs, structured-output schema drift).

## Core Conclusions
- Guardian runs specialists/fixer/QA against a **single shared OpenCode server via the SDK**, with per-issue session metadata so human-approval and rework/followup flows continue the prior fixer/QA session with full context; QA runs in an **independent** SDK session, not fixer-internal dispatch.
- SDK **1.18.18 path methods are broken** (they request `/session/%7Bid%7D/...`): the fix is to unwrap `createSession`'s `data.id` and call `prompt`/`get`/`abort` through the low-level client with explicit `/session/<id>/` URLs.
- SDK responses are **envelope-wrapped**: `createSession` returns `data.id`, and structured `json_schema` results must be read from `data.info.structured`, not from text parts.
- Headless sessions must ship **role-specific no-ask permission matrices**: fixer edits allowed, irreversible/install operations denied, QA/specialists read-only — otherwise sessions hang on permission prompts.
- QA session completion **converges from completed assistant messages** when the synchronous prompt HTTP request stays open, using baseline message IDs + cancellation for round isolation and no leaked polling timers.
- Structured-output `json_schema` definitions must **match the existing evidence/plan validators by construction** (evidence provenance fields, allowed kinds, risk restricted to LOW/HIGH).
- Two environment traps: SDK sessions were created in the scheduler's cwd (`QA-skills`) instead of the target repo (fixed by passing target directory), and Windows could not spawn `opencode` under `shell:false` (fixed by resolving the real `opencode.exe`); the standalone server also needed absolute Node/npm/Git injected into PATH so attached sessions can test/branch/commit/push.

## Key Decisions and Changes
- Adopted one-serve + SDK session continuity; added independent fixer and QA SDK session runners with create-or-reuse continuity, human-note-as-untrusted-data injection, and deadline-abort.
- Routed the plan builder through an SDK session with `json_schema` output (matching specialists), eliminating a leftover spawn/attach hang.
- Fixed the SDK wrapper (unwrap `data.id`, explicit low-level URLs, read `data.info.structured`), added the permission matrices, and tightened specialist/plan schemas.
- Fixed cwd/target-directory, Windows `opencode.exe` spawn, and shared-server PATH.

## Current State
The SDK-based multi-session runtime is the execution substrate for all later Guardian work. Fixer and QA are independent sessions with continuity across approval/rework. Provider-error resilience and timeouts on top of this substrate are covered in digest-007.

## Recommended Next Reads
- digest-007 — provider resilience, cooldown fallback, deadlines, and undici timeout on this SDK substrate.
- digest-004 — the role/authorization boundaries these sessions execute within.
- digest-001 — the plan/QA contracts the sessions fulfill.

## Source Coverage
12 records (6 changes + 6 bugs), all dated 2026-08-19, covering SDK adoption and its session-continuity bug class.
