---
record_id: change-cabd52ea36184a8885927911ff2e029e
type: change
date: 2026-08-20
title: Launcher project switching and tool version warning
key_conclusion: Guardian launcher now remembers independent bindings per project and allows a clean local tools checkout to run when behind upstream with a warning, so project switching is explicit and local runtime availability is not blocked by tool-version drift.
topics:
  - qa-guardian
  - launcher
  - operations
---

## Change Content

The local launcher configuration now stores a `projects` map keyed by canonical target path and a
`last_target_repo` fallback. Explicit scheduler or dashboard project paths select only the matching
entry; no-argument starts reuse the last target. Legacy single-project bindings remain readable and
are migrated on the next write.

The Guardian tools repository preflight still requires a clean worktree, but no longer blocks when the
active local branch differs from its upstream revision. It reports a Chinese warning and continues
using the checked-out local tool version. The target value repository keeps its strict clean/latest
check.

## Reason

The previous single global binding made switching projects awkward and could reject a valid project
because another project's control worktree was stored globally. The strict tools-version equality
check also prevented a locally clean, usable scheduler from running merely because the remote had
newer Guardian code.

## Impact Scope

- Scheduler and Dashboard resolve project-specific control paths.
- No-argument behavior remains convenient through `last_target_repo`.
- Tool repository version drift becomes an operational warning.
- Target repository safety and all human/QA/PR authorization boundaries remain strict.

## Verification

- Full Guardian tests: 449/449 passed.
- PowerShell parser checks passed.
- Explicit/legacy/cross-project binding tests passed.
- Worktree remains clean before this follow-up commit.
