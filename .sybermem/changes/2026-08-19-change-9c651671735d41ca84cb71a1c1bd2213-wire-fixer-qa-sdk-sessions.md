---
type: change
record_id: change-9c651671735d41ca84cb71a1c1bd2213
date: 2026-08-19
title: Wire fixer and QA through independent SDK sessions in the scheduler (方案 A)
status: done
key_conclusion: The scheduler now runs the fixer through a persistent SDK session and invokes QA through an independent SDK session (instead of fixer-internal dispatch), so both roles keep context across human approval and rework/followup flows and QA is truly independent of the fixer.
topics: [qa-guardian, opencode-sdk, session-continuity]
author: goudaren0528
related_files: [tools/guardian/scheduler.mjs]
related: [change-09acc786cc4c4b53b58d1e9a5b7267ef]
---

## Change Content
Wired the scheduler's fixer/QA run path to the SDK session runners (方案 A):
- When a shared OpenCode server is configured (opencodeClient present), the fixer runs via
  `runFixerSession` (persistent session reused across Gate 1 approve/revise, QA FAIL, Gate 2
  rework, followup), and QA runs via `runQaSession` (independent session, scheduler-invoked).
  The QA verdict is collected by the scheduler and written to `qa-verdict.json`.
- The human revise/rework note is passed to the fixer as untrusted data (command_kind,
  command_comment_id, round, human_note).
- The legacy path (fixer spawns and internally dispatches qa) is preserved when no shared server
  is configured.

## Reason for Change
The user chose 方案 A (full Oracle design): fixer AND qa are both independent SDK sessions, and
QA is invoked by the scheduler, not fixer-internal dispatch. This makes QA truly independent of
the fixer (matching the original QA/Fixer-independence goal) and gives both roles session
continuity across human approval and rework/followup flows.

## Impact Scope
Localized to scheduler.mjs run block. The frozen STATES enum, state-router, commands
authorization, verdict-comment, qa-gate, and Supervisor-sole-verdict-writer are untouched. The
legacy spawn path remains as fallback when no shared server is configured.

## Implementation
The run block branches on opencodeClient presence: SDK path runs fixer then QA via the session
runners, persists both session ids in state.opencode, and writes qa-verdict.json from the QA
session's verdict; legacy path keeps the original runInvocation + fixer-internal-qa behavior.

## Test Verification
Full suite: 293/293 green. The scheduler imports cleanly; the runner modules are covered by
their own tests (fixer/qa create-once + reuse + human-note-as-data + deadline-abort).

## Notes
方案 A slice 3 (final wiring). The 14-behavior fake-SDK test matrix and the visible #211 E2E
rerun are the next steps.
