---
type: bug
record_id: bug-665c5e3813704655bb4ba809fec628fc
date: 2026-08-26
title: Dirty recovery state alignment gaps
source: user-report
severity: high
status: resolved
key_conclusion: Launcher and Supervisor dirty-worktree checks now align with router/runtime recovery semantics for INVESTIGATING plan-scope recovery and finalization untracked test files.
topics: [qa-guardian, launcher, supervisor, recovery]
---

## Bug Description

After runtime branch preparation was fixed, restarting the scheduler still failed in launcher preflight:

```text
control worktree 存在计划外工作区修改：issue #324 当前状态 INVESTIGATING 不允许恢复 dirty fixer，已停止：D:\tuantuanrent.qa-guardian-control
```

#324 had already been rewritten by the router into `INVESTIGATING` with `last_phase=plan-scope-recovery`, while the control worktree was still on `fix/issue-324` with plan-scoped fixer changes.

## Root Cause

This was another split-brain dirty recovery rule:

- the router/runtime accepted `INVESTIGATING + plan-scope-recovery` as the continuation state after recovering the old handback;
- `scheduler-start.ps1` only allowed dirty branches in `GATE_1_WAIT`, `FIXING`, `VERIFYING`, `GATE_2_WAIT`, or the original exact `HANDED_BACK + changed-file-not-in-plan` shape;
- a broader scan also found `Supervisor.exec({ operation: 'worktree-files' })` still used `git status --porcelain=v1 -z` without `-uall`, leaving finalization exposed to the same untracked-directory collapse already fixed in launcher and branch prep.

## Solution

Aligned the remaining dirty-worktree checks:

- launcher now permits `INVESTIGATING` dirty recovery only when `last_phase=plan-scope-recovery`, fixer `last_error=changed-file-not-in-plan`, and the approved plan identity still matches the current plan hash/revision;
- launcher still requires current branch `fix/issue-<n>` and all product dirty paths in expanded plan scope;
- Supervisor finalization `worktree-files` now uses `git status --porcelain=v1 -z -uall` so newly added planned tests remain file-granular during isolation checks.

## Prevention Measures

Added regression tests covering:

- launcher acceptance of router-rewritten `INVESTIGATING + plan-scope-recovery` only with matching plan identity;
- finalization worktree inspection using `-uall`;
- existing dirty recovery tests still passing for handback, current-branch planned dirty, and untracked test expansion.

## Related Changes

- `tools/guardian/scheduler-start.ps1`
- `tools/guardian/supervisor-exec.mjs`
- `tests/guardian/bat-launchers.test.mjs`
- `tests/guardian/supervisor-exec.test.mjs`

Verified with:

- `node --test tests/guardian/bat-launchers.test.mjs tests/guardian/supervisor-exec.test.mjs tests/guardian/guardian-start.test.mjs` passed 65/65.
- `node --test "tests/guardian/*.test.mjs"` passed 751/751.
- LSP diagnostics were clean for changed JavaScript test/implementation files.
- Before committing, DryRun only failed at the expected Guardian-tools dirty gate, not at the #324 control dirty state rule.
