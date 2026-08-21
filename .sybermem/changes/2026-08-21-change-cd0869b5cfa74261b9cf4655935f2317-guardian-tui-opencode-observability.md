---
type: change
record_id: change-cd0869b5cfa74261b9cf4655935f2317
date: 2026-08-21
title: Guardian TUI surfaces OpenCode transcript and liveness ambiguity
status: completed
source: manual
key_conclusion: Guardian TUI now distinguishes unread OpenCode transcripts and stale runtime state so users do not mistake missing messages or persisted running status for no work.
topics: [guardian-tui, opencode, observability]
author: Sisyphus
related_files: [tools/guardian/opencode-client.mjs, tools/guardian/session-transcript.mjs, tools/guardian/dashboard-tui-model.mjs, tools/guardian/session-view.mjs]
---

## Change Content

QA Guardian's read-only dashboard and session viewer now expose the ambiguous OpenCode runtime states that caused issue #205 to look idle or blank. The OpenCode client preserves non-404 message endpoint failures as `message-endpoint-error`, transcript rendering treats `GET /session/:id/message` returning `[]` with nonzero session token usage as an unread transcript rather than no work, and the TUI marks persisted `running` specialist records as non-live when no `opencode.inflight` is present.

The Live tab now explains that an SSE connection only means future events can arrive, then shows current inflight state plus `.scheduler.lock` liveness without printing lock tokens. `session-view.mjs` now returns naturally with `process.exitCode` instead of calling `process.exit()` after async OpenCode SDK work, avoiding a Windows Node/OpenCode SDK handle assertion. Missing launcher binding paths are treated as no binding to avoid Node deprecation warnings in smoke scripts.

## Reason for Change

OpenCode official documentation identifies `GET /session/:id/message` as the transcript source, `GET /agent?directory=...` as the agent registry, and the event stream as real-time SSE delivery rather than proof of active work. Runtime evidence showed sessions with token usage but unreadable or empty message results, a stale scheduler lock, and persisted `running` specialist states; the UI needed to present those facts directly instead of implying no work was happening.

## Impact Scope

The change is limited to QA Guardian observability and read-only viewing. It does not alter scheduler state transitions, GitHub writes, agent prompts, or target/control worktree contents. User-visible effects are clearer Transcript, Summary, Logs, Live, and session-view diagnostics for stale or unread OpenCode sessions.

## Implementation

- Preserved `GET /session/:id/message` 400-class failures as distinct message endpoint errors.
- Added transcript guidance for sessions whose metadata shows token usage while the message endpoint returns an empty list.
- Labeled persisted `running` sessions as non-live in dashboard summary/detail/logs when no inflight operation exists.
- Added Live tab liveness lines for active inflight status and scheduler lock freshness/PID presence, redacting lock tokens.
- Replaced `session-view.mjs` direct `process.exit()` calls with `process.exitCode` returns after async work.
- Made absent binding-file arguments resolve to no binding instead of passing invalid values to `fs.existsSync`.

## Test Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 532/532.
- `node --check` passed for all changed Guardian modules.
- `git diff --check` reported only expected CRLF conversion warnings.
- Read-only smoke against `D:/tuantuanrent.qa-guardian-control` issue #205 showed explicit unread transcript guidance and stale scheduler lock diagnostics.

## Notes

Dify knowledge recall was attempted but unavailable because `D:\QA-skills\.opencode\tools\dify_recall.py` is missing.
