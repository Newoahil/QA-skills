---
type: bug
record_id: bug-432ac9e0feec425a91229512c7603ac9
date: 2026-08-24
title: Launcher blocked recovery of a plan-scoped dirty fixer worktree
source: Restart attempt while recovering LambdaTheory/tuantuanrent issue #263
severity: high
status: resolved
key_conclusion: Updated the launcher to resume only plan-scoped dirty fix branches and decode Guardian JSON artifacts explicitly as UTF-8, preserving fail-closed protection while allowing interrupted fixer work to continue.
topics: [qa-guardian, launcher, recovery]
related: [bug-db865da450a5498fab70e7815cd3332b]
---

## Bug Description

After repairing the #263 fixer plan scope, restarting the scheduler failed because the control
worktree contained the four product files intentionally modified by the active fixer. The launcher
treated every non-Guardian dirty path as unknown and stopped. A first scoped-recovery implementation
then failed on Windows PowerShell 5.1 because `Get-Content` decoded UTF-8 no-BOM Chinese plan JSON
using the system ANSI encoding, causing `ConvertFrom-Json` to reject the corrupted text.

## Root Cause

`Ensure-ControlWorktree` had no concept of an interrupted active `fix/issue-N` branch. Its safety
check only distinguished Guardian-owned state paths from all other paths. It did not compare product
changes with the authoritative plan scope. The recovery code also relied on PowerShell's default
file decoding instead of the repository's explicit UTF-8 artifact contract.

## Solution

- When non-Guardian dirty paths exist, the launcher now requires the control branch to match
  `fix/issue-N`, loads that issue's authoritative state and plan, requires a recoverable state, and
  permits startup only when every dirty product path is declared in `plan.affected_files`.
- Any unknown branch, missing state/plan, non-recoverable state, or plan-external product path still
  blocks startup fail-closed.
- State and plan JSON are read with explicit UTF-8 decoding for Windows PowerShell 5.1.
- Regression tests lock the active-plan allowlist and UTF-8 reader contract; full Guardian suite
  passed 665/665.

## Prevention Measures

- Treat a dirty control worktree as recoverable only when branch, state, and plan jointly prove
  ownership.
- Never use PowerShell default encoding for Guardian JSON artifacts.
- Keep unknown or out-of-plan product modifications blocking startup.

## Related Changes

- `7173bac Allow scoped Guardian fixer worktree recovery`
- `6e5e522 Read Guardian recovery artifacts as UTF-8`
