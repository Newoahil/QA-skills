---
type: bug
record_id: bug-a963fe15ad034a94b1a2fe43dd75838e
date: 2026-08-25
title: Control dirty preflight blocked plan-scope recovery
source: user-report
severity: high
status: resolved
key_conclusion: Scheduler startup now permits the same changed-file-not-in-plan handback recovery as the router, so issue #324 dirty fixer work can continue without resetting state.
topics: [qa-guardian, launcher, recovery]
---

## Bug Description

After fixing the command author preflight, launching Guardian for `D:\tuantuanrent` failed earlier than the scheduler router:

```text
control worktree 存在计划外工作区修改：issue #324 当前状态 HANDED_BACK 不允许恢复 dirty fixer，已停止：D:\tuantuanrent.qa-guardian-control
```

The live #324 state was intentionally recoverable by the Node router because it was `HANDED_BACK` with `last_error_class=fixer-completion-unverified` and fixer `last_error=changed-file-not-in-plan`.

## Root Cause

`scheduler-start.ps1` performs control worktree dirty safety checks before `scheduler.mjs` and `state-router.mjs` can run. Its PowerShell preflight allowlist only accepted `GATE_1_WAIT`, `FIXING`, `VERIFYING`, and `GATE_2_WAIT`, so it blocked the newly supported `plan-scope-recovery` state before the router could resume investigation.

The same guard also compared dirty product files only to `plan.affected_files`. Old #324 plans had the new regression test in `primary_files` and `test_commands`, but not in `affected_files`, which was the original incomplete-scope bug being recovered.

## Solution

Aligned the PowerShell launcher guard with runtime recovery semantics:

- Permit dirty recovery for `HANDED_BACK` only when it exactly matches `fixer-completion-unverified` plus `changed-file-not-in-plan`.
- Continue to reject ordinary `HANDED_BACK` states and all other terminal dirty worktrees.
- Compare dirty paths against expanded plan scope from `affected_files`, object/string `primary_files`, and JavaScript test files named in `test_commands`.

## Prevention Measures

Added a launcher regression test that checks the `changed-file-not-in-plan` handback allowance and expanded plan-scope extraction are present in `Ensure-ControlWorktree`.

## Related Changes

- `tools/guardian/scheduler-start.ps1`
- `tests/guardian/bat-launchers.test.mjs`

Verified with:

- `node --test tests/guardian/bat-launchers.test.mjs tests/guardian/guardian-start.test.mjs` passed 41/41.
- `node --test "tests/guardian/*.test.mjs"` passed 744/744.
- Real `scheduler-start.ps1 -DryRun` for `D:\tuantuanrent` no longer fails at the #324 `HANDED_BACK` dirty-control guard; while the QA-skills repo was intentionally dirty with the uncommitted fix, the remaining preflight failure moved to the normal Guardian-tools clean-worktree gate.
