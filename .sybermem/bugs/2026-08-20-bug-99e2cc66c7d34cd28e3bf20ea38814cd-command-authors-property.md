---
record_id: bug-99e2cc66c7d34cd28e3bf20ea38814cd
type: bug
date: 2026-08-20
title: PowerShell missing command authors property
key_conclusion: scheduler-start.ps1 now adds a missing command_authors JSON property with Add-Member -Force instead of direct assignment, so Windows PowerShell 5.1 can persist the trusted author during worktree bootstrap.
topics:
  - qa-guardian
  - powershell
  - authorization
---

## Description

During the first worktree startup, the launcher correctly prompted for `goudaren0528` but then
failed with PowerShell 5.1 `SetValueInvocationException`: the `command_authors` property could not
be found on the object.

## Root Cause

`ConvertFrom-Json` returns a `PSCustomObject`. When the JSON file did not contain a
`command_authors` property, Windows PowerShell 5.1 did not allow the script to create it with direct
assignment (`$cfg.command_authors = ...`). The prompt had collected the value, but persistence failed
before the config could be written.

## Solution

The launcher now builds the author array separately and adds or replaces the property with
`Add-Member -NotePropertyName command_authors -NotePropertyValue $authors -Force`, which is compatible
with missing and existing JSON properties in Windows PowerShell 5.1. `-Yes` remains fail-closed when
the author list is absent.

## Verification

- Launcher regression asserts the `Add-Member -Force` path.
- Launcher tests passed: 14/14.
- Full Guardian suite passed: 445/445.
- PowerShell parser check passed.
