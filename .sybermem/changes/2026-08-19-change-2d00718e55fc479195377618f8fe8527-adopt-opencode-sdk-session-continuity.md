---
type: change
record_id: change-2d00718e55fc479195377618f8fe8527
date: 2026-08-19
title: Adopt OpenCode SDK multi-session runtime with session continuity
status: done
key_conclusion: Replaced the unreliable multi-process `opencode run --attach` fan-out with the official one-serve + @opencode-ai/sdk pattern, and added per-issue OpenCode session metadata so human-approval and rework/followup flows continue the prior fixer/QA session with full context.
topics: [qa-guardian, opencode-sdk, session-continuity]
author: goudaren0528
related_files: [tools/guardian/opencode-client.mjs, tools/guardian/state.mjs, tools/guardian/investigation-process.mjs, tools/guardian/scheduler.mjs, package.json]
related: [change-9075ddb15f55461cba237c8f6c302f95, change-d68ddced82a4440492d038e2b4aa8975]
---

## Change Content
Adopted the official OpenCode multi-agent runtime pattern (confirmed via official
docs + upstream issues) and added session continuity for human-approval and
rework/followup flows.

- New `tools/guardian/opencode-client.mjs`: wraps `@opencode-ai/sdk` around one
  long-lived `opencode serve`. Exposes createSession (with no-ask permission to
  prevent headless hangs, issue #16367), prompt (agent + parts + json_schema
  structured output), abort, getSession, and error normalization into
  retryable vs unusable-session. SDK client injectable for unit tests.
- `state.mjs`: added an `opencode` structure (schema_version 1) with
  `fixer` / `qa` / `specialists` / `inflight` session metadata. `normalizeState`
  deep-merges it so older records get defaults; `startFollowupRound` preserves
  fixer/qa session ids (round-local reset only).
- `investigation-process.mjs`: `processSpecialistRunner` now uses the SDK client
  to create a session and prompt with json_schema structured output; falls back
  to the child-process path when no shared server is configured.
- `scheduler.mjs`: creates the shared opencode client per tick from
  `QA_GUARDIAN_OPENCODE_SERVER_URL` and injects it into the specialist runner.
- Added `@opencode-ai/sdk@1.18.18` dependency.

## Reason for Change
The prior runtime spawned multiple `opencode run --attach` child processes
against one server; under concurrency only one connection stayed active and the
rest hung (upstream issues #16367 permission-ask hang, #21215/#15188 SQLite
contention). Official docs recommend one serve + SDK with multiple sessions and
json_schema structured output. Separately, the user required that for a given
issue, human approval (Gate 1/2) and rework/supplemental-test flows CONTINUE the
prior OpenCode session so the fixer/QA keep full context across gates — the old
runtime created a fresh conversation every run and lost all prior context.

## Impact Scope
Additive: one new module + one new test file + state schema extension + SDK
dependency. The frozen STATES enum, state-router, commands authorization,
verdict-comment, qa-gate, and Supervisor-sole-verdict-writer are untouched.
Specialist execution now goes through SDK sessions when a shared server is
configured; the child-process path remains as fallback.

## Implementation
Oracle-designed seam: one fixer session + one qa session per issue (reused
across Gate 1 approve/revise, QA FAIL, Gate 2 rework, followup), per-round
specialist sessions, human note as untrusted data, session-id validation with
context_loss on 404, no-ask permissions. The opencode-client wrapper normalizes
SDK/network errors so the scheduler can decide recreate vs retry without leaking
SDK details.

## Test Verification
Full suite: 278/278 green. New tests lock: opencode-client createSession no-ask
permission + prompt json_schema + abort/getSession + error normalization
(404=unusable, 5xx=retryable); state opencode structure + followup preserves
fixer/qa ids + normalizeState backfills; processSpecialistRunner SDK path
creates one session and prompts with json_schema. Removed a temporary
"specialists sequential" test that contradicted the Oracle design (specialists
should run concurrently via independent SDK sessions).

## Notes
This is the first slice of the SDK adoption. Fixer/QA role-session wiring in
scheduler.mjs (create fixer/qa only at first role transition, resolve existing
session id before continuation, deadline + session.abort) and the 14-behavior
fake-SDK test matrix are the next slice.
