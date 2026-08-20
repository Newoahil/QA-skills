---
record_id: bug-1a8b3cf22fc9424ba73e009dd9c4556d
type: bug
date: 2026-08-20
title: Worktree command authors bootstrap
key_conclusion: scheduler-start.ps1 now repairs an existing control config with empty command_authors by asking once for the trusted GitHub login and persisting it, so first-run worktree setup can continue safely after an interrupted attempt.
topics:
  - qa-guardian
  - launcher
  - authorization
---

## Description

After selecting worktree mode, the launcher created the control worktree and an empty
`.qa/guardian/config.json`. On the next setup step it saw that the config file already existed, so it
skipped the existing missing-config prompt. The config then had no `command_authors`, and startup
stopped with the fail-closed authorization error.

## Root Cause

The bootstrap prompt was guarded only by `Test-Path $configPath` and therefore handled a missing file,
but not an existing incomplete file. Worktree mode can create the control directory before the config
is populated, so an interrupted or partial first run exposed this gap.

## Solution

After loading the config, the launcher now checks `command_authors` independently. If the list is
empty, interactive startup asks once for trusted GitHub login(s), writes them back using the existing
UTF-8 no-BOM JSON path, and continues. Non-interactive `-Yes` remains fail-closed and gives a direct
instruction to run once interactively, preserving the authorization boundary.

## Verification

- Added launcher regression coverage for repairing an existing empty-author config.
- Launcher focused tests passed: 13/13.
- PowerShell parser check passed.
- The existing control config was observed with empty `command_authors`, confirming the reported
  reproduction state without modifying the canonical target repository.
