---
type: change
record_id: change-f0555262f35442e0bf044d5402b00108
date: 2026-08-23
title: Accept fixer text JSON completions
status: done
source: implementation
key_conclusion: Accepted validated fixer completions from text JSON as well as structured output so the shared-server no-format path can complete without weakening fail-closed validation.
topics: [qa-guardian, opencode-sdk, fixer-session]
author: Sisyphus
related_files: [tools/guardian/fixer-session-runner.mjs, tests/guardian/fixer-session-runner.test.mjs]
---

## Change Content
Updated `tools/guardian/fixer-session-runner.mjs` so fixer completion validation accepts either the existing structured response object or fallback JSON from `result.text` / `result.result.text`. The fallback supports plain JSON and fenced `json` blocks, then runs through the same `READY_FOR_FINALIZATION`, `pr_summary_markdown`, and plan-scoped `changed_files` checks as structured output.

Added a regression in `tests/guardian/fixer-session-runner.test.mjs` proving a shared-server-style response with `structured: null` and valid text JSON reaches supervisor finalization, while malformed text remains fail-closed.

## Reason for Change
The post-implementation review found that the latest shared OpenCode server no-format transport can return valid fixer JSON as text with `structured: null`. The previous fixer runner treated that as `unverified`, preventing finalization and blocking the issue-to-PR product flow even when the fixer supplied a valid completion payload.

## Impact Scope
This is limited to the fixer SDK session completion parsing path and its direct tests. It does not change prompt permissions, session creation/reuse, supervisor finalization semantics, QA gating, or PR creation.

## Implementation
The fixer runner now centralizes completion extraction in `fixerCompletionObject()`: structured output remains the preferred source; text JSON is parsed only when structured output is unavailable. Invalid JSON, empty text, arrays, missing fields, non-`READY_FOR_FINALIZATION` statuses, and out-of-plan changed files are still rejected by the existing validator.

## Test Verification
- `node --test "tests/guardian/fixer-session-runner.test.mjs" "tests/guardian/investigation-process.test.mjs"` passed 29/29.
- `node --check "tools/guardian/fixer-session-runner.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 557/557.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed as `d5a46d1 Accept fixer text JSON completions`. This addresses the shared-server no-format fixer completion blocker identified during the QA Guardian review.
