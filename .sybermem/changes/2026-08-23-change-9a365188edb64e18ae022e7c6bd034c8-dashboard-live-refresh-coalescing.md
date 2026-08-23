---
type: change
record_id: change-9a365188edb64e18ae022e7c6bd034c8
date: 2026-08-23
title: Coalesce dashboard live refresh bursts
status: done
source: implementation
key_conclusion: The read-only dashboard TUI now coalesces bursty live SSE events into one pending refresh, preventing unbounded refresh queue growth while preserving live buffer updates.
topics: [qa-guardian, dashboard-tui, live-events, refresh-coalescing]
author: Sisyphus
related_files: [tools/guardian/dashboard-tui.mjs, tests/guardian/dashboard-tui-cli.test.mjs]
---

## Change Content
Added a live refresh timer in `dashboard-tui.mjs` so incoming SSE events append to the bounded live buffer immediately but schedule at most one pending `refreshNow('live')` while the current burst is still in the same event-loop turn.

Added a regression that emits 20 matching live events in a burst and proves the TUI performs only initial refresh + live-tab selection refresh + one coalesced live refresh while still surfacing the full burst buffer.

## Reason for Change
The review found that every live SSE event directly called `refreshNow('live')`. Under a large OpenCode event burst, this could enqueue many snapshot reloads and make the interactive dashboard lag behind the event stream.

## Impact Scope
This affects only the interactive read-only dashboard TUI live tab. Event filtering, bounded buffering, reconnect behavior, and manual/auto refresh queues remain unchanged.

## Implementation
Introduced `liveRefreshTimer` plus `scheduleLiveRefresh()`. While the timer is pending, additional live events only append to the event buffer. Cleanup now clears the pending live refresh timer alongside auto-refresh and escape-flush timers.

## Test Verification
- `node --test "tests/guardian/dashboard-tui-cli.test.mjs"` passed 9/9.
- `node --check "tools/guardian/dashboard-tui.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 574/574.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.
- LSP diagnostics for `.mjs` remained unavailable because the TypeScript LSP server is not installed.

## Notes
Committed as `aab4aa4 Coalesce dashboard live refresh bursts`. This resolves the review blocker for bounded refresh scheduling under SSE bursts.
