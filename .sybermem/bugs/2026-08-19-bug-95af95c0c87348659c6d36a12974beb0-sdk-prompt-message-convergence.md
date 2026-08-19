---
type: bug
record_id: bug-95af95c0c87348659c6d36a12974beb0
date: 2026-08-19
title: Completed SDK session remained blocked on the prompt HTTP request
severity: high
status: resolved
key_conclusion: QA session completion now converges from completed assistant messages when the synchronous prompt HTTP request remains open, with baseline message IDs and cancellation ensuring correct round isolation and no leaked polling timers.
topics: [opencode-sdk, qa-session, session-continuity]
related: [bug-682f269c0050412797459f52712af366, bug-aebf3f8b068f48b59ce275467409fa20]
---

## Bug Description

The #211 QA session completed server-side and emitted `Overall Status: PASS`. Its assistant message
had a completed timestamp in OpenCode storage, but the synchronous `POST /session/{id}/message`
HTTP request never returned. The scheduler remained inside `runQaSession` until its long deadline,
so it could not write `qa-verdict.json`, pass the QA gate, or create the PR.

## Root Cause

The SDK runner treated completion of the long-lived prompt HTTP request as the only completion
signal. OpenCode can finish and persist the assistant message while that transport remains open.

## Solution

- Added `getMessages()` using the official `GET /session/{id}/message` endpoint.
- QA runner records completed assistant-message IDs before each prompt.
- Prompt completion now races the synchronous request against discovery of a new completed
  assistant message, extracting text from whichever finishes first.
- Completed intermediate `tool-calls` messages are ignored; only a message containing a valid
  `Overall Status:` verdict can complete the QA run.
- Polling cancellation covers success and deadline-abort paths so no timer keeps Node alive.
- SDK `{ kind: 'ok' }` results are normalized to runner `status: 'ok'`.

## Prevention Measures

- Regression test reproduces a permanently hanging prompt request while messages reveal a new
  completed intermediate tool-call response followed by `Overall Status: PASS`.
- Deadline regression verifies the session is aborted and polling is released.

## Related Changes

- `tools/guardian/opencode-client.mjs`
- `tools/guardian/qa-session-runner.mjs`
- `tests/guardian/opencode-client.test.mjs`
- `tests/guardian/qa-session-runner.test.mjs`
- Full suite: 304/304 green.
