---
record_id: bug-72dbe209aad24697a5bf36ffdf0b7a88
type: bug
date: 2026-08-20
title: Stale launcher NewerThan error
key_conclusion: The reported NewerThan DateTime binding error came from a stale or different scheduler launcher because the current 578-line scheduler-start.ps1 contains no NewerThan call and its real DryRun succeeds; a regression now guards the current launcher against that obsolete path.
topics:
  - qa-guardian
  - launcher
  - windows
---

## Description

The user reported a PowerShell error binding a long hexadecimal value to the `NewerThan` parameter
as `System.DateTime` at `scheduler-start.ps1:502`. The current launcher at that path performs the
snapshot Git diff and contains no `NewerThan` symbol anywhere.

## Investigation

- Searched the tracked and working-tree Guardian launcher sources for `NewerThan`: no matches.
- Current `scheduler-start.ps1` has 578 lines; line 502 is the guarded `git apply` operation.
- Current launcher SHA256: `08799D488D493FFFEE90FFEB92E84FDCFB944668700C3E60D8269EF844E107BF`.
- The reported hexadecimal value does not match the current launcher file hash.
- Current real command `scheduler-start.ps1 -TargetRepo D:\tuantuanrent -DryRun -Yes` succeeds.

## Root Cause

The reported process ran a stale/different copy of the launcher, an older script or cached process,
not the current pushed scheduler-start.ps1. The obsolete copy used a `NewerThan`-based discovery
path that is absent from the current implementation.

## Solution

Added a regression guard asserting the current scheduler launcher contains no `NewerThan`-based
discovery. The launcher BAT continues to invoke the repository-local script with `-NoProfile`, and
the current script is verified through a real DryRun.

## Verification

- Full Guardian suite before this guard: 452/452 passed.
- Current real DryRun: passed through target binding, control worktree, QA snapshot planning, and
  Guardian preflight.
- PowerShell parser check: passed.
