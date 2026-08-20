---
record_id: change-5cb23fed3750411f9d0a01fddae5f6de
type: change
date: 2026-08-20
title: Per-project Guardian launcher bindings
key_conclusion: Guardian launcher bindings are now stored independently per canonical target path, so explicitly switching projects selects only that project's mode, control worktree, QA snapshot, and configuration while no-argument launches reuse the last target.
topics:
  - qa-guardian
  - launcher
  - multi-project
---

## Change Content

The local-only `tools/guardian/scheduler.config.json` launcher configuration now supports a version 2
`projects` map keyed by canonical target path, plus `last_target_repo` for no-argument starts.

Explicit project paths always select the matching project entry:

```bat
tools\guardian\scheduler-start.bat D:\project-one
tools\guardian\dashboard-start.bat D:\project-one
```

Each project independently remembers strict or worktree mode, control worktree, QA snapshot, base
branch, and selected runtime inputs. A project with no saved entry requires its own first-run choice;
another project's binding is never used as a fallback. Existing version 1 single-binding files remain
readable for their exact target and migrate into the project map when the launcher writes.

## Reason

The previous launcher stored one global binding. After configuring `D:\tuantuanrent`, switching to a
different target either rejected the binding as mismatched or risked reusing the wrong control
worktree/config. The user needs to monitor multiple projects while retaining the two-BAT daily
workflow.

## Impact Scope

- `scheduler-start.ps1` selects, validates, migrates, and persists per-project bindings.
- `dashboard-start.ps1` resolves only the explicitly selected project's control worktree.
- `worktree-binding.mjs` supports v2 project maps and legacy v1 exact-target lookup.
- Tests cover distinct bindings, explicit selection, no-argument last-target behavior, legacy lookup,
  dashboard routing, and cross-project isolation.
- README, DEPLOY, and the example launcher config document independent project memory and switching.

## Safety Boundaries

- Exactly two daily BAT entrypoints remain.
- Explicit target paths never use another project's binding.
- Missing binding for an explicit project remains fail-closed for `-Yes` and `-DryRun`.
- Canonical target repositories are not reset, stashed, committed, pushed, or cleaned by binding
  selection.
- Existing human approval, read-only QA, supervisor mutation, PR, merge, and close boundaries remain
  unchanged.

## Verification

- `node --test "tests/guardian/*.test.mjs"`: 449/449 passed.
- PowerShell parser checks passed for scheduler and dashboard launchers.
- `node --check tools/guardian/worktree-binding.mjs` passed.
- `git diff --check` passed.
