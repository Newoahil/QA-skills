---
type: bug
record_id: bug-daf85c0ffd3c498aafbc345a9b78eefe
date: 2026-08-26
title: QA snapshot canonical Guardian diff poisoned startup
source: user-report
severity: high
status: resolved
key_conclusion: Worktree-mode QA snapshot patching now filters Guardian-owned canonical target churn before git apply, preventing SyberMem or Guardian state files from blocking planned dirty recovery.
topics: [qa-guardian, launcher, snapshot, worktree-recovery]
---

## Bug Description

After the launcher began accepting #324's planned dirty recovery state, startup advanced to QA snapshot sync and failed:

```text
无法将 tracked diff 应用到 QA snapshot；已停止，未修改 canonical target。
```

Runtime evidence showed the canonical target had only tracked SyberMem churn:

```text
M .sybermem/.recall-debug.jsonl
```

The old snapshot sync generated `git diff HEAD --binary` from the canonical target and applied it to the QA snapshot. `git apply --check` against the live QA snapshot failed on `.sybermem/.recall-debug.jsonl`.

## Root Cause

Worktree-mode startup had another dirty/snapshot split-brain:

- `Assert-CleanAndUpstreamLatest` intentionally ignores Guardian-owned `.sybermem/` churn in the Guardian tools repo;
- control worktree recovery also ignores `.qa/guardian/**`, `.sybermem/**`, `.scheduler.lock`, and `watch-state.json`;
- QA snapshot patching still copied every tracked canonical target diff, including Guardian-owned runtime/memory files that should not be part of the read-only QA snapshot.

This made harmless canonical SyberMem churn fatal, and it risked contaminating the QA snapshot with Guardian-owned state.

## Solution

Changed `scheduler-start.ps1` to build the canonical snapshot patch with explicit pathspec excludes:

```text
:(exclude).qa/guardian/*
:(exclude).sybermem/*
:(exclude).scheduler.lock
:(exclude)watch-state.json
```

The launcher still preserves intentional tracked product diffs from the canonical checkout, but no longer applies Guardian-owned churn to the QA snapshot.

## Prevention Measures

Added a launcher regression test asserting:

- snapshot patch args are assembled as an explicit argv array;
- Guardian-owned canonical paths are excluded before `git apply`;
- the old unfiltered `git -C $TargetRepo diff HEAD --binary --output=...` shape does not return.

Updated the launcher README to document that the QA snapshot receives only the canonical target's tracked product diff plus selected runtime inputs.

## Verification

- `node --test tests/guardian/bat-launchers.test.mjs tests/guardian/supervisor-exec.test.mjs tests/guardian/guardian-start.test.mjs` passed 66/66.
- `node --test "tests/guardian/*.test.mjs"` passed 752/752.
- PowerShell parser check for `tools/guardian/scheduler-start.ps1` returned `parse_ok`.
- Live filtered patch probe against `D:\tuantuanrent` returned `patch_length=0` for the `.sybermem`-only canonical diff.
- `scheduler-start.ps1 -TargetRepo D:\tuantuanrent -Yes -DryRun ...` passed with Guardian `clean/latest 8d7f291`.
