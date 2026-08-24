---
type: change
record_id: change-fd28379b349a4ea497f38b24065c1109
date: 2026-08-24
title: Guardian router consumes task observations
status: implemented
source: P3 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian routing now consumes normalized TaskObservation data so raw GitHub command parsing is isolated in the source adapter while routing decisions stay unchanged.
topics: [qa-guardian, state-router, task-source]
author: Sisyphus
related_files: [tools/guardian/state-router.mjs, tools/guardian/poll.mjs, tests/guardian/state-router.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Updated `routeIssue` to consume normalized task observations with `terminal` and `controlEvents` instead of directly reading GitHub `{ closed, comments }` facts. `pollIssue` now normalizes GitHub facts with `buildGitHubTaskObservation` before calling the router.

The state-router tests now build observations through the GitHub adapter so the same acceptance scenarios validate the new router contract.

## Reason for Change

P3 of the extensibility plan moves the core routing seam away from GitHub-specific comments and close flags. This lets future task sources provide source-native control events while keeping the state machine and decisions source-neutral.

## Impact Scope

Routing behavior remains compatible: gate approvals, revisions, rework, retries, followups, closed-issue completion, stale leases, and terminal states all pass the existing acceptance tests. `commands.mjs` remains the GitHub adapter parser, not a router dependency. Persisted state schema is still unchanged.

## Implementation

`state-router.mjs` imports only `COMMANDS` metadata to validate normalized command events against state guards. The adapter owns selecting trusted commands and converting them to control events. `poll.mjs` is the legacy GitHub boundary that bridges current scheduler reads into the new router input.

## Test Verification

- `node --test "tests/guardian/state-router.test.mjs" "tests/guardian/poll.test.mjs" "tests/guardian/github-task-source.test.mjs"` passed: 35/35.
- `node --test "tests/guardian/*.test.mjs"` passed: 585/585.
- LSP diagnostics on `state-router.mjs`, `state-router.test.mjs`, and `poll.mjs` reported no diagnostics.
- `git diff -- tools/guardian/state.mjs` was empty, preserving P1-P7 no-persisted-schema-change compatibility.

## Notes

This phase prepares P4 by keeping routing pure and leaving effect emission untouched.
