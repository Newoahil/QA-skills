---
type: bug
record_id: bug-ac4f62c6d7ed46e196cdc5acce8ff015
date: 2026-08-25
title: Control dirty status collapsed planned untracked tests
source: user-report
severity: high
status: resolved
key_conclusion: Control dirty recovery now uses detailed git status output so planned untracked test files match plan scope instead of being rejected as parent directories.
topics: [qa-guardian, launcher, git-status]
---

## Bug Description

After allowing #324 `changed-file-not-in-plan` recovery, scheduler startup still failed on the control worktree:

```text
control worktree 存在计划外工作区修改：backend/services/components-center/src/test/node/。已停止以避免覆盖现有修改
```

The actual intended dirty file was `backend/services/components-center/src/test/node/send-sms-controller-simple-send.test.js`, which exists in #324's `primary_files` and `test_commands` plan scope.

## Root Cause

`scheduler-start.ps1` used `git status --porcelain` for control dirty inspection. Git collapses untracked directories in that mode, so the launcher saw `?? backend/services/components-center/src/test/node/` instead of the planned test file path. The plan-scope check then compared a directory path to file-level plan entries and rejected it as unplanned.

## Solution

Changed the control worktree dirty scan to use `git status --porcelain -uall`, which expands untracked directories into individual file paths before matching them against the expanded plan scope.

## Prevention Measures

Added launcher regression coverage asserting that `Ensure-ControlWorktree` uses `-uall` and no longer relies on collapsed untracked-directory status when matching planned test files.

## Related Changes

- `tools/guardian/scheduler-start.ps1`
- `tests/guardian/bat-launchers.test.mjs`

Verified with:

- `git status --porcelain` reproduced the collapsed `?? backend/services/components-center/src/test/node/` path.
- `git status --porcelain -uall` showed `?? backend/services/components-center/src/test/node/send-sms-controller-simple-send.test.js`.
- `node --test tests/guardian/bat-launchers.test.mjs tests/guardian/guardian-start.test.mjs` passed 42/42.
- `node --test "tests/guardian/*.test.mjs"` passed 745/745.
- Real `scheduler-start.ps1 -DryRun` no longer failed on the target control dirty path; with the fix uncommitted, the only remaining preflight blocker was the expected Guardian tools repo dirty gate.
