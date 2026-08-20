---
record_id: bug-d6d62a18f2394518ad9ee12f20e35315
key_conclusion: Fixed scheduler-start.ps1 dropping git argv because it used PowerShell's reserved $Args name, so launcher preflight now runs real git subcommands and accepts GitHub URLs.
topics:
  - qa-guardian
  - windows-launcher
  - powershell
---

# Bug: scheduler-start.ps1 executed bare git during preflight

## Description

Starting Guardian through the Windows launcher failed during clean/latest preflight with a full `git` usage banner from `D:\QA-skills`. The operator had entered `https://github.com/LambdaTheory/tuantuanrent` at the GitHub repository prompt.

## Root cause

`Invoke-Git` declared its array parameter as `[string[]]$Args`. In PowerShell, `$Args` is an automatic variable, and a runtime probe showed that calling a function with this parameter name caused the passed array to be empty (`Count = 0`). As a result, `& git -C $Repo @Args` executed bare `git -C D:\QA-skills`, producing the usage banner instead of running `rev-parse` or `status`.

The launcher also only accepted `owner/repo` cleanly at the prompt, even though operators naturally paste full GitHub URLs.

## Solution

- Renamed the `Invoke-Git` parameter to `$GitArgs` and splatted `@GitArgs`.
- Added `Normalize-GitHubRepo` to accept `owner/repo`, `https://github.com/owner/repo`, and `git@github.com:owner/repo.git` forms.
- Applied normalization to `-GitHubRepo`, inferred remotes, and interactive GitHub repo input.
- Added regression tests that forbid `[string[]]$Args` in the launcher and assert URL normalization wiring.

## Verification

- PowerShell parser check for `tools/guardian/scheduler-start.ps1` -> pass
- Runtime probe with a `$GitArgs` array parameter returned count `2` and `rev-parse,--is-inside-work-tree`
- `node --test "tests/guardian/bat-launchers.test.mjs"` -> pass
- `node --test "tests/guardian/*.test.mjs"` -> 432/432 pass
- `scheduler-start.ps1 -TargetRepo D:\tuantuanrent -GitHubRepo https://github.com/LambdaTheory/tuantuanrent -DryRun -Yes` no longer produces bare git usage; it proceeds to the expected clean/latest preflight and stops because the Guardian tool repo is currently dirty
