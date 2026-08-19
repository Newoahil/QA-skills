---
type: bug
record_id: bug-aebf3f8b068f48b59ce275467409fa20
date: 2026-08-19
title: Fixer completion did not commit push sync branch or persist QA verdict
severity: high
status: resolved
key_conclusion: Made the fixer commit/push its issue branch, synchronized the actual Git branch into state, and fixed QA verdict hashing so an independent QA PASS can reach the machine gate and PR creation.
topics: [qa-guardian, fixer, qa-verdict]
related: [bug-682f269c0050412797459f52712af366, change-9c651671735d41ca84cb71a1c1bd2213]
---

## Bug Description

The #211 fixer completed the source/test changes and the independent QA session returned
`Overall Status: PASS`, but no verdict artifact or PR appeared. The working tree was on
`fix/issue-211`, yet state.branch was null and no commit/remote branch existed.

## Root Cause

- The SDK fixer prompt did not explicitly require commit + push, so the agent intentionally stopped
  with an uncommitted diff.
- Scheduler never synchronized the checked-out Git branch into issue state.
- QA verdict hashing referenced `crypto.createHash` without importing `crypto`, causing the
  scheduler to fail after QA PASS and before writing `qa-verdict.json`.

## Solution

- Fixer prompt now requires commit + push to `fix/issue-<n>` and explicitly forbids PR creation.
- Added shell-free `currentBranch()` and scheduler branch synchronization after fixer completion.
- Scheduler imports and uses `createHash` directly for the QA report hash.

## Prevention Measures

- Tests lock fixer commit/push and no-PR instructions.
- Tests lock shell-free branch detection.
- Independent QA and PR creation remain scheduler-owned.

## Related Changes

- `tools/guardian/fixer-session-runner.mjs`
- `tools/guardian/pr-io.mjs`
- `tools/guardian/scheduler.mjs`
- `tests/guardian/fixer-session-runner.test.mjs`
- `tests/guardian/pr-io.test.mjs`
- Full suite: 302/302 green.
