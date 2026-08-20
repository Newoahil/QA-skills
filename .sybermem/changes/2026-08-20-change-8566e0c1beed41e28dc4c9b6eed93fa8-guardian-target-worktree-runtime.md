---
record_id: change-8566e0c1beed41e28dc4c9b6eed93fa8
type: change
date: 2026-08-20
title: Guardian target worktree and QA runtime separation
key_conclusion: QA Guardian now supports a one-time persisted launcher choice that isolates dirty target projects into a clean control worktree plus selected QA runtime snapshot, so unattended fixing remains safe while QA can test an explicit current snapshot.
topics:
  - qa-guardian
  - worktree
  - runtime-qa
---

## Change Content

The Windows scheduler launcher now keeps exactly two daily BAT entrypoints while supporting a
first-run interactive choice between strict mode and worktree/current-snapshot mode. The choice is
stored in the gitignored `tools/guardian/scheduler.config.json`; later starts reuse it without asking.

Worktree mode separates the target project into three roles:

- the canonical developer checkout, which may remain dirty and is never reset, stashed, committed,
  pushed, or cleaned by Guardian startup;
- a persistent clean control worktree, which owns `.qa/guardian` authoritative state, fixer branches,
  commits, and PR operations;
- a QA snapshot, reset to the configured clean base and populated only with the tracked canonical
  diff plus explicitly selected repository-relative runtime input files.

Specialist and plan sessions receive the QA runtime path, while fixer, supervisor, state, GitHub,
commit, push, PR, dashboard, and session resolution remain on the control path. Runtime input paths
are validated against traversal, protected directories, symlink/reparse escapes, and destination
overwrite; secret contents are never printed or persisted.

## Reason

The previous clean-target preflight treated any uncommitted developer work as a startup blocker. A
separate tools-repository worktree would not solve that problem because the scheduler, OpenCode
agents, state store, and PR finalization all used the target repository path. The new path model keeps
the developer checkout available as a read-only snapshot source without allowing its unfinished work
to leak into Guardian fixer commits or PRs.

## Impact Scope

- `scheduler-start.ps1` persists the one-time mode and manages control/QA worktrees.
- `scheduler.mjs` and investigation adapters carry the optional QA runtime path while preserving
  control-state and fixer/PR behavior.
- Dashboard and session viewer resolve the authoritative control worktree.
- Binding/path validation and launcher regression tests cover unsafe paths, first-run DryRun behavior,
  control branch reuse, and specialist path routing.
- Chinese launcher/deployment documentation describes the two BAT workflow and no-repeat selection.

## Safety Boundaries

- No third daily BAT was introduced.
- `-DryRun` does not prompt, write binding metadata, or create worktrees when first-run selection is
  missing.
- `-Yes` cannot invent a missing first-run mode.
- Human Gate 1/Gate 2 approval, read-only QA, supervisor-only GitHub mutations, no auto-merge, and no
  auto-close remain unchanged.

## Verification

- `node --test "tests/guardian/*.test.mjs"`: 443/443 passed.
- Focused launcher/binding/investigation tests: 22/22 passed.
- Node syntax checks passed for all changed MJS files.
- PowerShell parser checks passed for scheduler and dashboard launchers.
- Real first-run `-DryRun -Yes` failed closed in Chinese and created neither control nor QA worktree.
