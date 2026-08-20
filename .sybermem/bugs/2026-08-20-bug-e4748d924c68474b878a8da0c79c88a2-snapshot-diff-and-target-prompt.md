---
record_id: bug-e4748d924c68474b878a8da0c79c88a2
type: bug
date: 2026-08-20
title: Snapshot diff stderr and per-run target selection
key_conclusion: scheduler-start.ps1 now captures benign Git diff/apply stderr safely and always asks for a target directory when no explicit target is passed, so CRLF warnings do not abort worktree startup and projects cannot be switched accidentally.
topics:
  - qa-guardian
  - powershell
  - launcher
---

## Description

Worktree startup failed while building the QA snapshot because Git emitted a normal LF/CRLF warning
for `.qa/guardian/193.json`; Windows PowerShell treated the native stderr warning as a terminating
`NativeCommandError`. Separately, no-argument launcher starts were silently reusing
`last_target_repo`, while the operator needs to choose the project for every run.

## Root Cause

The snapshot code called native `git diff` and `git apply` directly under the script-wide
`$ErrorActionPreference = "Stop"`, unlike the safer `Invoke-Git` boundary. The target resolver also
treated the persisted last project as an automatic no-argument target.

## Solution

- Wrapped snapshot `git diff` and `git apply` calls in local `ErrorActionPreference = "Continue"`
  scopes and used `$LASTEXITCODE` for real failure decisions.
- Scheduler and Dashboard now prompt for the target directory on every no-argument start. Explicit
  `-TargetRepo`/BAT arguments remain the direct selection mechanism, while per-project bindings still
  prevent cross-project control worktree reuse.

## Verification

- Launcher focused tests passed: 18/18.
- Full Guardian suite passed: 452/452.
- PowerShell parser checks passed.
- No-argument scheduler probe prompted for a directory and cancelled on empty input as intended.
