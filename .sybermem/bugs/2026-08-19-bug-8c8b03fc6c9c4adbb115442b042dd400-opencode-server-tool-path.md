---
type: bug
record_id: bug-8c8b03fc6c9c4adbb115442b042dd400
date: 2026-08-19
title: Shared OpenCode server lacked Node npm and Git in its PATH
severity: high
status: resolved
key_conclusion: Made the standalone OpenCode server launcher resolve and inject absolute Node, npm, and Git paths so attached fixer/QA/specialist sessions can test, branch, commit, and push without depending on another window's PATH mutations.
topics: [opencode-server, windows, qa-guardian]
related: [bug-682f269c0050412797459f52712af366]
---

## Bug Description

The #211 fixer SDK session applied the source/test patch but then reported that `git`, `node`, and
`npm` were unavailable. The shared OpenCode server was launched in its own PowerShell window and
did not inherit the PATH additions performed by `scheduler-start.ps1`.

## Root Cause

`opencode-server.ps1` resolved only the OpenCode executable. Tool PATH initialization lived in the
separate scheduler window, but attached sessions execute inside the server environment.

## Solution

- Added independent `Find-Node`, `Find-Npm`, and `Find-Git` resolution to the server launcher.
- Added each tool directory to the server process PATH before starting `opencode serve`.
- Added `-DryRun` to expose resolved paths for machine testing.

## Prevention Measures

- Regression test runs the server script in a PowerShell process whose PATH excludes Node/npm/Git
  and asserts all four tool paths resolve.
- Visible runtime processes must initialize their own environment; they must not rely on sibling
  window mutations.

## Related Changes

- `tools/guardian/opencode-server.ps1`
- `tests/guardian/scheduler-visible.test.mjs`
- Full suite: 301/301 green.
