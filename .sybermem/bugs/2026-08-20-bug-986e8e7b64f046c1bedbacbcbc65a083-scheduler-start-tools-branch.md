---
record_id: bug-986e8e7b64f046c1bedbacbcbc65a083
type: bug
date: 2026-08-20
title: scheduler-start tools branch preflight
key_conclusion: scheduler-start.ps1 now checks the Guardian tools repository against the current branch upstream instead of hardcoding main, because local auto-qa launcher fixes must be runnable before they are merged to main.
topics:
  - qa-guardian
  - launcher
  - git
---

## Description

After the Git stderr handling fix, `scheduler-start.ps1 -TargetRepo D:\tuantuanrent -DryRun -Yes`
advanced to the next preflight and failed with `Guardian工具仓库 本地 main 与 origin/main 不一致`. The
checkout was clean and running on the `auto-qa` branch, but the launcher still hardcoded the Guardian
tools repository check to compare local `main` with `origin/main`.

## Root Cause

The launcher used `Assert-CleanAndLatest $GuardianRepo 'main' 'Guardian工具仓库'` for the tools repo.
That is too strict for development and local operations, where the runnable launcher fixes live on
the current branch. It also produced misleading guidance about `main` even when the active branch was
`auto-qa`.

## Solution

Added `Current-GitBranch` and `Assert-CleanAndUpstreamLatest` so the Guardian tools repository is
verified against its current branch and matching `origin/<current-branch>`. The target project still
uses the configured `base_branch`, preserving the deployment safety check for the repository being
watched.

## Verification

- Added a launcher regression assertion that the Guardian tools preflight uses current branch logic
  rather than `Assert-CleanAndLatest $GuardianRepo 'main'`.
- `node --test "tests/guardian/bat-launchers.test.mjs"` passed: 7/7.
- PowerShell parser check for `tools/guardian/scheduler-start.ps1` passed.
