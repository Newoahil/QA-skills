---
type: change
record_id: change-d5addda959474f75977877eb0f8f624d
date: 2026-08-24
title: Guardian TaskRef value object
status: implemented
source: P1 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian now has an in-memory TaskRef value object so later task-source adapters can share identity helpers without changing persisted issue state.
topics: [qa-guardian, task-identity, extensibility]
author: Sisyphus
related_files: [tools/guardian/task-ref.mjs, tests/guardian/task-ref.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Added `tools/guardian/task-ref.mjs` with `makeTaskRef`, `taskRefKey`, and `githubIssueToTaskRef` helpers. The helpers normalize task identity into frozen in-memory references and map GitHub issue numbers into the canonical `{ source:'github', taskId:'<n>', displayId:'#<n>' }` shape.

## Reason for Change

P1 of the extensibility plan requires a source-neutral identity value object before extracting task sources. Keeping the value object in memory only preserves the current GitHub numeric state schema, state filenames, branch names, ledger tokens, and session bindings.

## Impact Scope

The change is additive and does not touch `state.mjs`, persisted `.qa/guardian/<n>.json` records, router behavior, scheduler behavior, or GitHub effects. It only introduces a helper module and direct unit tests.

## Implementation

`makeTaskRef` trims and stringifies identity fields, rejects blank fields, and freezes the result. `taskRefKey` derives a stable `source:taskId` key without using display labels. `githubIssueToTaskRef` accepts only positive integer GitHub issue numbers.

## Test Verification

- `node --test "tests/guardian/task-ref.test.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed: 581/581.
- LSP diagnostics on `tools/guardian/task-ref.mjs` and `tests/guardian/task-ref.test.mjs` reported no diagnostics.
- `git diff -- tools/guardian/state.mjs` was empty, proving P1 did not alter persisted state schema.

## Notes

P8 remains the deferred phase for persisting `task_id` and migrating non-numeric durable identities.
