---
type: change
record_id: change-7dc3767885cd4c9cb2ff5a1b5d8ca73d
date: 2026-08-21
title: Guardian surfaces OpenCode provider failures and settles specialists
status: completed
source: manual
key_conclusion: Guardian now treats OpenCode info.error responses as provider failures and waits for all investigation specialists so model cooldown no longer appears as JSON parse failure or stale running state.
topics: [guardian-runtime, opencode, provider-errors]
author: Sisyphus
related_files: [tools/guardian/opencode-client.mjs, tools/guardian/investigation-process.mjs, tools/guardian/investigation-runtime.mjs, tools/guardian/scheduler.mjs, tools/guardian/dashboard-tui-progress.mjs]
---

## Change Content

QA Guardian now recognizes OpenCode `POST /session/:id/message` responses that return HTTP 200 but include `info.error` as provider failures. The client returns `provider-error` with safe fields only (`name`, `message`, `statusCode`, `code`, `reset_seconds`, `reset_time`) and does not expose raw provider response bodies.

The investigation runner now reports provider prompt failures directly for specialists and plan building, instead of attempting to parse empty `parts=[]` responses as JSON. `prepareInvestigation` waits for every started specialist with `Promise.allSettled`, then fails closed with `specialist_failures` and `specialist_durations_ms`, preventing concurrent specialists from remaining indefinitely `running` after a sibling fails. Scheduler failure persistence uses those metadata when writing state.

The Logs tab now explains that shared OpenCode server / SDK sessions do not create local mirrored `progress/<issue>/<agent>.log` files, and points users to Transcript and Live for read-only runtime evidence.

## Reason for Change

Runtime evidence from issue #205 showed OpenCode returning `200 OK` with `info.error.name=APIError`, `statusCode=429`, `code=model_cooldown`, `parts=[]`, and zero tokens. Guardian previously treated that as a successful prompt, causing `Unexpected end of JSON input` and leaving unrelated specialists with stale `running` state. Users needed the true provider cooldown and all role outcomes to be visible.

## Impact Scope

The change affects Guardian's shared-server OpenCode client path, investigation failure reporting, concurrent specialist cleanup, scheduler failure metadata, and read-only Logs guidance. It does not alter target/control repository writes, GitHub command routing, PR creation, or the TUI's read-only boundary.

## Implementation

- Added provider-error detection in `opencode-client.prompt()` for `data.info.error` responses.
- Normalized provider errors to a safe whitelist and parsed only cooldown hints from structured response JSON.
- Updated specialist and plan runner prompt failure messages to surface provider/model cooldown instead of JSON parse symptoms.
- Changed `prepareInvestigation()` to collect specialist outcomes with `Promise.allSettled` and throw metadata-rich failures after all roles settle.
- Updated scheduler investigation failure persistence to use thrown `specialist_failures` and `specialist_durations_ms` metadata.
- Added Logs tab guidance for shared-server SDK mode without local progress mirror files.

## Test Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 536/536.
- `node --check` passed for all changed Guardian modules.
- `git diff --check` reported only expected CRLF conversion warnings.
- Read-only smoke against the live OpenCode server reproduced `provider-error` with `model_cooldown` and reset time, and showed the new shared-server Logs guidance.

## Notes

Dify recall was attempted again and still failed because `D:\QA-skills\.opencode\tools\dify_recall.py` is missing.
