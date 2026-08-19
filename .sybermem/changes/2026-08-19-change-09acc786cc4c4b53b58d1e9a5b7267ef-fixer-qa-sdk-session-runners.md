---
type: change
record_id: change-09acc786cc4c4b53b58d1e9a5b7267ef
date: 2026-08-19
title: Add fixer and QA SDK session runners (方案 A)
status: done
key_conclusion: Added independent fixer and QA OpenCode SDK session runners with create-or-reuse session continuity, human-note-as-untrusted-data injection, and deadline-abort, so the same issue's fixer/QA sessions are reused across human approval and rework/followup flows.
topics: [qa-guardian, opencode-sdk, session-continuity]
author: goudaren0528
related_files: [tools/guardian/fixer-session-runner.mjs, tools/guardian/qa-session-runner.mjs, tools/guardian/session-resolver.mjs, qa-skill/agents/qa-guardian.md]
related: [change-2d00718e55fc479195377618f8fe8527]
---

## Change Content
Added the fixer and QA SDK session runners for 方案 A (full Oracle design):
- New `tools/guardian/session-resolver.mjs`: pure create-vs-reuse decision per role
  (fixer->qa-guardian, qa->qa, per-round specialists). 404->recreate+context_loss,
  5xx->retryable, role/agent never swapped.
- New `tools/guardian/fixer-session-runner.mjs`: runs the write-capable fixer through a
  persistent OpenCode session reused across Gate 1 approve/revise, QA FAIL, Gate 2 rework, and
  followup. Prompts with dossier/plan paths + human note as UNTRUSTED DATA (never in
  system/agent/permission). Deadline aborts the session (session.abort), never kills the serve.
  Persists session id in state.opencode.fixer.
- New `tools/guardian/qa-session-runner.mjs`: runs the read-only QA agent through a persistent
  session reused across verification attempts. Collects the `Overall Status:` verdict. Persists
  session id in state.opencode.qa. Deadline aborts.
- `qa-skill/agents/qa-guardian.md`: updated VERIFYING to reflect 方案 A — the fixer no longer
  dispatches the `qa` agent internally; the scheduler runs an independent read-only qa session
  and collects the verdict. The fixer only writes code + pushes the branch.

## Reason for Change
The user chose 方案 A (full Oracle design): fixer AND qa are both independent SDK sessions, and
QA is invoked by the scheduler, not fixer-internal dispatch. This makes QA truly independent of
the fixer (matching the original QA/Fixer-independence goal) and gives both roles session
continuity across human approval and rework/followup flows.

## Impact Scope
Additive: three new modules + their tests + an agent-doc update. The frozen STATES enum,
state-router, commands authorization, verdict-comment, qa-gate, and Supervisor-sole-verdict-writer
are untouched. The scheduler wiring (replacing runInvocation spawn with these runners) is the
next slice.

## Implementation
Each runner uses session-resolver to decide create vs reuse, then prompts the session with the
role's structured prompt. Human revise/rework notes are passed as a clearly-delimited
HUMAN_NOTE untrusted-data block in the prompt's user/content part. A deadline races the prompt
against a timer that calls session.abort on timeout.

## Test Verification
Full suite: 293/293 green. New tests lock: session-resolver create/reuse/404/5xx/agent-mismatch/
per-round; fixer-session-runner create-once + reuse + human-note-as-data + deadline-abort;
qa-session-runner create-once + reuse + verdict collection + deadline-abort.

## Notes
方案 A slice 2. The scheduler wiring (fixer/QA via these runners, replacing runInvocation spawn)
and the 14-behavior fake-SDK test matrix are the next slice.
