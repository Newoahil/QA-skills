---
record_id: bug-01f49ed7e02b41eba58ccc630c6170d0
type: bug
date: 2026-08-20
title: scheduler-start git fetch stderr
key_conclusion: scheduler-start.ps1 now captures git stderr without PowerShell promoting successful fetch progress to a terminating error, so launcher preflight can continue after benign fetch output.
topics:
  - qa-guardian
  - launcher
  - powershell
---

## Description

The Windows QA Guardian launcher failed during startup after the tool repository became clean. During
`git fetch`, Git wrote a benign progress line such as `From https://github.com/Newoahil/QA-skills` to
stderr. Because `scheduler-start.ps1` runs with `$ErrorActionPreference = "Stop"`, Windows PowerShell
5.1 promoted that native stderr record to a terminating `NativeCommandError` before the script could
inspect `$LASTEXITCODE`.

## Root Cause

`Invoke-Git` redirected stderr with `2>&1` while the global error action preference was `Stop`. In
Windows PowerShell 5.1, native command stderr can still surface as an error record under this setting,
even when the process exits successfully. The wrapper therefore treated a successful fetch with
progress output as a script failure.

## Solution

`Invoke-Git` now temporarily sets `$ErrorActionPreference` to `Continue` only around the native Git
call, restores the previous preference in `finally`, and continues to make success/failure decisions
from `$LASTEXITCODE`. A launcher regression test pins this boundary so benign Git stderr remains
captured output rather than a terminating launcher error.

## Verification

- Added a regression assertion in `tests/guardian/bat-launchers.test.mjs`.
- `node --test "tests/guardian/bat-launchers.test.mjs"` passed: 6/6.
- `node --test "tests/guardian/*.test.mjs"` passed: 433/433.
- PowerShell parser check for `tools/guardian/scheduler-start.ps1` passed.
