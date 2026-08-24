---
type: change
record_id: change-eef1ebfd562a4bc5b2d86a6af9b4762a
date: 2026-08-24
title: Guardian GitHub task source adapter
status: implemented
source: P2 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian now has a TaskSource contract and GitHub adapter so issue facts can be normalized before router migration while existing poll imports remain compatible.
topics: [qa-guardian, task-source, github]
author: Sisyphus
related_files: [tools/guardian/task-source.mjs, tools/guardian/github-task-source.mjs, tools/guardian/poll.mjs, tests/guardian/github-task-source.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Added `tools/guardian/task-source.mjs` with the normalized observation helper and `tools/guardian/github-task-source.mjs` with the first TaskSource implementation. The GitHub adapter reads legacy GitHub issue facts, maps numeric issues to `TaskRef`, converts closed issues to terminal facts, and calls the unchanged `commands.mjs` parser to expose trusted `/guardian` comments as normalized control events.

`tools/guardian/poll.mjs` now imports and re-exports `defaultGhReader` from the GitHub adapter so existing scheduler and poll callers keep the same API.

## Reason for Change

P2 of the extensibility plan needs a task-source seam before `routeIssue` is moved off the raw `{ closed, comments }` GitHub shape. Extracting the GitHub reader first keeps behavior compatible and creates the source adapter that P3 can target.

## Impact Scope

This phase is additive except for moving the `defaultGhReader` implementation behind the adapter. `commands.mjs`, `state-router.mjs`, scheduler decisions, persisted state, and GitHub side effects remain unchanged.

## Implementation

`buildGitHubTaskObservation` produces `{ identity, terminal, controlEvents, facts, cursor }` observations. `createGitHubTaskSource` supports injected list/read/state functions for tests and future scheduler wiring. `defaultGhReader` preserves the legacy gh CLI JSON mapping.

## Test Verification

- `node --test "tests/guardian/github-task-source.test.mjs" "tests/guardian/poll.test.mjs"` passed: 13/13.
- `node --test "tests/guardian/*.test.mjs"` passed: 585/585.
- LSP diagnostics on `github-task-source.mjs`, `task-source.mjs`, `poll.mjs`, and the new test reported no diagnostics.
- `git diff -- tools/guardian/commands.mjs` was empty, proving the GitHub command parser stayed unchanged.

## Notes

P3 will update the router to consume `TaskObservation`; this P2 change only introduces and verifies the source adapter seam.
