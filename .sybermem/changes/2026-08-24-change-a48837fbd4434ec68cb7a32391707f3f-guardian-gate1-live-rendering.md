---
type: change
record_id: change-a48837fbd4434ec68cb7a32391707f3f
date: 2026-08-24
title: Fix Guardian Gate1 and live TUI rendering
status: done
source: implementation
key_conclusion: QA Guardian now renders structured Gate1 plan fields and persisted live-tab context as readable text so operators no longer see [object Object] comments or empty connected live views after investigation stops.
topics: [qa-guardian, gate1-comment, dashboard-tui, observability]
author: Sisyphus
related_files: [tools/guardian/gate1-comment.mjs, tools/guardian/dashboard-tui-model.mjs, tests/guardian/gate1-comment.test.mjs, tests/guardian/dashboard-tui-model.test.mjs]
---

## Change Content
Updated the Gate 1 approval comment builder to compact structured plan and dossier values before rendering them into the GitHub issue comment. Object-shaped `risk`, `root_cause`, `affected_files`, and `unresolved_facts` now render meaningful preferred fields and supporting key/value details instead of JavaScript's default `[object Object]` string.

Updated the single-terminal dashboard live tab so an empty connected SSE event buffer no longer implies there is no useful information. When the selected issue has persisted OpenCode specialist sessions or local progress logs, the live tab now shows recent sessions and recent progress context alongside the scheduler/inflight status.

Added focused regressions for both user-visible failures: Gate 1 comments with object-shaped fields must not contain `[object Object]`, and the connected live tab with no new SSE events must still surface persisted issue session/progress context.

## Reason for Change
Live issue #205 exposed two operator-facing observability defects after the Guardian run produced real state. The GitHub Gate 1 comment directly interpolated object values, hiding the actual plan and unresolved-fact content, while the TUI live pane only displayed future SSE buffer contents and stayed empty after investigation had already completed.

## Impact Scope
Runtime behavior is limited to Guardian observability surfaces: Gate 1 issue comments and the read-only dashboard TUI live tab. The state machine, command authorization, scheduler routing, fixer/QA execution, PR creation, and GitHub command grammar are unchanged.

## Test Verification
- `node --test "tests/guardian/gate1-comment.test.mjs"` passed 2/2.
- `node --test "tests/guardian/dashboard-tui-model.test.mjs"` passed 13/13.
- `node --check "tools/guardian/gate1-comment.mjs"` passed.
- `node --check "tools/guardian/dashboard-tui-model.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 576/576.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.
- `.mjs` LSP diagnostics were unavailable because the TypeScript LSP server is not installed.

## Notes
Committed as `fbada84 Fix Guardian Gate1 and live TUI rendering`.
