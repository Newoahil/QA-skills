---
type: change
record_id: change-9a4b5837878a4ecb8b3f19802d8933cf
date: 2026-08-23
title: Skip git fetch during scheduler dry run
status: done
source: implementation
key_conclusion: `scheduler-start.ps1 -DryRun` now avoids network-mutating `git fetch` during clean/latest preflight while preserving the normal startup fetch behavior.
topics: [qa-guardian, scheduler-launcher, dry-run, git]
author: Sisyphus
related_files: [tools/guardian/scheduler-start.ps1, tests/guardian/bat-launchers.test.mjs]
---

## Change Content
Added a `-SkipFetch` switch to scheduler launcher clean/latest checks and wired it to `-DryRun` for both Guardian tools and strict target repo preflight. Normal non-DryRun startup still fetches before comparing local and upstream commits.

Added a launcher regression that asserts DryRun calls the preflight helpers with `-SkipFetch:$DryRun` and that the fetch invocation is guarded by `if (-not $SkipFetch)`.

## Reason for Change
The review found that `scheduler-start.ps1 -DryRun` could still execute `git fetch`, making a supposedly non-mutating preview perform network I/O and mutate remote-tracking refs.

## Impact Scope
This affects scheduler launcher dry runs. Dashboard behavior and normal scheduler startup remain unchanged.

## Implementation
`Assert-CleanAndLatest()` now accepts `[switch]$SkipFetch`; `Assert-CleanAndUpstreamLatest()` forwards it. The DryRun call sites pass `-SkipFetch:$DryRun`, keeping DryRun local-only while leaving regular launch preflight unchanged.

## Test Verification
- `node --test "tests/guardian/bat-launchers.test.mjs"` passed 27/27.
- `node --test "tests/guardian/*.test.mjs"` passed 573/573.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.
- LSP diagnostics for `.ps1` were unavailable because no PowerShell LSP server is configured.

## Notes
Committed as `fc1ca08 Skip git fetch during scheduler dry run`. This resolves the review blocker requiring DryRun to be non-mutating unless an explicit fetch opt-in is added.
