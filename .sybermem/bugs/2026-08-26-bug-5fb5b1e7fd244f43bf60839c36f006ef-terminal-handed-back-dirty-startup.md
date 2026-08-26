---
type: bug
record_id: bug-5fb5b1e7fd244f43bf60839c36f006ef
date: 2026-08-26
title: Terminal handed-back dirty plan blocked launcher startup
source: user-report
severity: high
status: resolved
key_conclusion: Ensure-ControlWorktree now treats a terminal HANDED_BACK (fix-rounds-exceeded / reject / stalled) dirty fix branch as a stale residual that must not block startup, while still failing closed for any path outside the active plan scope.
topics: [qa-guardian, launcher, worktree-recovery, handed-back]
---

## Bug Description

After #324 reached terminal `HANDED_BACK` with `handed_back_reason=fix-rounds-exceeded`, the scheduler launcher stopped every startup with:

```text
control worktree 存在计划外工作区修改：issue #324 当前状态 HANDED_BACK 不允许恢复 dirty fixer，已停止
```

## Root Cause

`Ensure-ControlWorktree` dirty-recovery gate only allowed a *non-terminal* `HANDED_BACK` (specifically `last_error_class=fixer-completion-unverified`), and the runtime scheduler never auto-resumes a terminal `HANDED_BACK` (`SKIP handed-back-terminal`). The stale planned fixer files left by the terminal state were treated as blocking, so startup was permanently stuck even though the state could never recover.

## Solution

Added a `terminalHandedBackDirty` recovery path that allows `HANDED_BACK` with `handed_back_reason` in `('fix-rounds-exceeded', 'reject', 'stalled')`. Because a terminal `HANDED_BACK` never auto-resumes, its residual dirt is inert and must not block startup; the existing `unplannedDirty` check still fails closed for any product path outside the active plan scope.

## Prevention Measures

Added a launcher regression test asserting:

- `terminalHandedBackDirty` recognizes `fix-rounds-exceeded` / `reject` / `stalled` `HANDED_BACK`;
- the state gate now also exempts `terminalHandedBackDirty`;
- the earlier `recoverablePlanScopeHandback` and `recoverablePlanScopeInvestigation` gates remain intact.

## Related Changes

- `tools/guardian/scheduler-start.ps1`
- `tests/guardian/bat-launchers.test.mjs`

Verified with:

- `node --test tests/guardian/bat-launchers.test.mjs` passed 36/36.
- `node --test "tests/guardian/*.test.mjs"` passed 753/753.
- PowerShell parser check returned `parse_ok`.
- Real launcher `scheduler-start.ps1 -TargetRepo D:\tuantuanrent -Yes ...` now starts and #324 routes `SKIP handed-back-terminal` without throwing.
