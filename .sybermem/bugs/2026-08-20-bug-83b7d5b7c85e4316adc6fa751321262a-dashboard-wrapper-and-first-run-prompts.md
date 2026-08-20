---
record_id: bug-83b7d5b7c85e4316adc6fa751321262a
type: bug
date: 2026-08-20
title: Dashboard wrapper parser and worktree prompt overload
key_conclusion: dashboard-start.ps1 now uses a PowerShell 5.1 parser-safe ASCII wrapper while the Node dashboard remains Chinese, and first-run worktree setup now asks only for the mode with safe default paths and automatic test-env detection.
topics:
  - qa-guardian
  - windows
  - launcher
---

## Description

After the target worktree mode was added, the Dashboard BAT failed before Node started with
PowerShell 5.1 errors such as `Unexpected token '}'`, reserved `<` syntax, and an unterminated
string. The first scheduler setup also asked separately for control worktree path, QA snapshot path,
and every runtime input file, making the promised one-time setup unnecessarily cumbersome.

## Root Cause

The Dashboard wrapper mixed UTF-8 Chinese text and PowerShell string quoting in a Windows PowerShell
5.1 parsing path. The wrapper is only a launcher, but its source encoding/quoting failure prevented
the Chinese Node dashboard from running. The worktree initializer exposed internal path and allowlist
details as separate prompts instead of using safe defaults.

## Solution

- Replaced the Dashboard wrapper's user-facing PowerShell strings with parser-safe ASCII output and
  simple concatenation; the launched Node dashboard remains the Chinese user interface.
- Reduced first-run worktree setup to one mode selection. Worktree and QA snapshot paths now use
  deterministic defaults next to the canonical target, and the initializer automatically detects
  only existing safe test-environment files (`.env.test`, `.env.local.test`, `config/test.json`, and
  `config/testing.json`).
- Existing path validation, no-overwrite behavior, canonical target immutability, and no-secret
  logging boundaries remain unchanged.

## Verification

- Real `dashboard-start.ps1 -TargetRepo D:\tuantuanrent` launched the Chinese Dashboard successfully
  and refreshed it until the manual timeout.
- PowerShell parser check passed for scheduler and dashboard wrappers.
- Launcher and binding tests passed: 15/15.
- Full Guardian suite passed: 443/443 before this wrapper-only follow-up; focused launcher tests passed
  after the follow-up.
