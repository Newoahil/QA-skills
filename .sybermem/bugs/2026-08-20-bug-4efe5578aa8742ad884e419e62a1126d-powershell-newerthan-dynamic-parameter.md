---
record_id: bug-4efe5578aa8742ad884e419e62a1126d
type: bug
key_conclusion: Parenthesizing Test-Path before boolean operators fixes the real worktree-only failure where PowerShell 5.1 interpreted -and as Test-Path dynamic parameter NewerThan and tried to parse a SHA-256 string as DateTime.
topics:
  - qa-guardian
  - powershell
  - worktree
---

## Description

The launcher succeeded in DryRun but failed in real worktree startup with:

```text
Cannot bind parameter 'NewerThan'
Cannot convert value <SHA-256> to System.DateTime
```

The failure appeared at the config comparison stage after the control and QA worktrees were entered.

## Root Cause

Windows PowerShell 5.1 parses an unparenthesized command in a boolean expression such as:

```powershell
if (Test-Path -LiteralPath $sourceGuardianConfig -and (...))
```

as a `Test-Path` invocation whose dynamic provider parameter is `-NewerThan`. The following SHA-256
value is then bound to `NewerThan` and converted to `DateTime`. This is why the error mentioned a
hash and only occurred on the non-DryRun worktree path.

## Solution

The command is now explicitly parenthesized:

```powershell
if ((Test-Path -LiteralPath $sourceGuardianConfig) -and (...))
```

A regression test prevents the unparenthesized form from returning. All similar cmdlet/boolean
patterns in the launcher were scanned.

## Verification

- PowerShell parameter-binding trace reproduced the exact `NewerThan` binding and SHA-to-DateTime
  conversion.
- Focused launcher tests passed: 20/20.
- Full Guardian suite passed: 453/453 before this follow-up guard.
- PowerShell parser check passed.
- Current DryRun remained successful; the failing expression is only exercised by real worktree mode.
