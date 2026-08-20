---
record_id: bug-c9d39c21fcd640948f061bf092488b1b
type: bug
date: 2026-08-20
title: NewerThan root cause and control config authority
key_conclusion: The real NewerThan failure was caused by an unparenthesized Test-Path boolean expression in Windows PowerShell 5.1, and the same startup path now preserves the existing control worktree config as authoritative instead of comparing it to the developer checkout.
topics:
  - qa-guardian
  - powershell
  - worktree
---

## Description

The user repeatedly hit a `NewerThan` DateTime binding error only during real worktree startup, even
though DryRun succeeded. After that error was fixed, startup reached a config mismatch guard between
the canonical target and the control worktree.

## Root Cause

PowerShell 5.1 parsed this expression:

```powershell
if (Test-Path -LiteralPath $sourceGuardianConfig -and (...))
```

as a `Test-Path` dynamic parameter binding. The `-and` token became `-NewerThan`, and the following
SHA-256 hash was converted to DateTime. This branch only executes during real snapshot setup.

The subsequent config mismatch was also incorrect: the control worktree is the authoritative Guardian
config location. Its trusted authors and runtime settings may intentionally differ from the canonical
developer checkout.

## Solution

- Removed the ambiguous boolean cmdlet expression by parenthesizing the `Test-Path` invocation.
- Added regression coverage for PowerShell cmdlet boolean parsing.
- Preserved an existing control `.qa/guardian/config.json` without comparing hashes to the canonical
  config; only missing control config is initialized from the canonical checkout.

## Verification

- PowerShell parameter-binding trace reproduced the exact `NewerThan` binding and SHA-to-DateTime
  conversion.
- Focused launcher tests passed: 21/21.
- Full Guardian suite passed: 455/455 before the final test assertion cleanup; final focused tests
  passed after cleanup.
- PowerShell parser check passed.
- Real `-SchedulerOnly -Yes` advanced past the NewerThan failure and exposed the next config-authority
  guard, which was then corrected.
