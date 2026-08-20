---
record_id: bug-9ea4fabc7f0948ac9dcdf159659e61de
type: bug
date: 2026-08-20
title: Control worktree porcelain path offset
key_conclusion: scheduler-start.ps1 now parses trimmed git porcelain output from the correct status-column offset, so Guardian-owned .qa/guardian state is ignored without hiding real external control-worktree changes.
topics:
  - qa-guardian
  - git
  - worktree
---

## Description

The launcher continued to stop with `control worktree 存在 Guardian 状态之外的工作区修改` even
though the only reported change was `.qa/guardian/config.json`, which is Guardian-owned state.

## Root Cause

`Invoke-Git` returns `status.output` after calling `.Trim()`. Git porcelain output normally starts with
two status columns followed by a space, for example ` M .qa/guardian/config.json`. Trimming removes
the leading space, leaving `M .qa/guardian/config.json`. The new filter still used `Substring(3)`,
which removed the first character of the path and produced `qa/guardian/config.json`; that no longer
matched the `.qa/guardian/` allowlist.

## Solution

The control worktree filter now trims each line and uses `Substring(2)` after the two remaining status
columns. Guardian-owned paths are correctly ignored, while paths outside `.qa/guardian/`, `.sybermem/`,
and the explicit state filenames continue to block startup.

## Verification

- Added a regression assertion for the trimmed porcelain parsing offset.
- Launcher tests passed: 14/14.
- Full Guardian suite passed: 445/445 before this test-only offset follow-up.
- PowerShell parser check passed.
- Real launcher DryRun moved past the control worktree dirty check and stopped at the expected empty
  `command_authors` fail-closed guard.
