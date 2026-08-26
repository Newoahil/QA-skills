---
type: bug
record_id: bug-2568e67fe7524db7812159be0a37e959
date: 2026-08-26
title: Runtime branch prep rejected planned fixer changes
source: user-report
severity: high
status: resolved
key_conclusion: Runtime Fixer branch preparation now shares Gate plan scope and permits only current-issue, current-branch dirty files that are already plan-scoped.
topics: [qa-guardian, supervisor, plan-scope]
---

## Bug Description

After launcher preflight accepted #324 recovery, the resident runtime still failed when entering Fixer:

```text
prepare fix branch failed: cannot prepare fix/issue-324: dirty worktree outside Guardian-owned state (...SendSmsController.java, ...src/test/node/); recover by cleaning or preserving changes before retry
```

The dirty product files were the approved #324 fixer edits on `fix/issue-324`, not unrelated user work.

## Root Cause

The launcher dirty guard and runtime branch preparation used different scope semantics:

- launcher preflight expanded the old plan scope from `affected_files`, `primary_files`, and `test_commands`;
- runtime `runFixerStage` called `Supervisor.prepareFixBranch` without a normalized plan;
- `prepareFixBranch` used `git status --porcelain=v1` and rejected all non-Guardian product dirty files before considering whether they belonged to the current issue's approved plan.

This made a recoverable in-progress Fixer branch fail after startup even though the launcher had correctly identified the dirty files as planned.

## Solution

`runFixerStage` now validates the stored dossier/plan and passes the normalized plan to Supervisor. `prepareFixBranch` now uses `git status --porcelain=v1 -uall` and allows dirty product files only when all of these are true:

- the current branch is exactly `fix/issue-<n>`;
- every dirty product path is present in normalized `plan.affected_files`;
- Guardian-owned state paths remain separately allowlisted.

Otherwise the branch preparation still fails closed without switching, resetting, staging, or committing.

## Prevention Measures

Added regression tests covering:

- untracked directory expansion with `-uall`;
- planned dirty files resuming only on the current issue branch;
- planned dirty files being rejected on any other branch;
- `runFixerStage` passing the normalized plan scope into Supervisor branch preparation.

## Related Changes

- `tools/guardian/supervisor-exec.mjs`
- `tools/guardian/stage-runner.mjs`
- `tests/guardian/supervisor-exec.test.mjs`
- `tests/guardian/stage-runner.test.mjs`

Verified with:

- `node --test tests/guardian/supervisor-exec.test.mjs tests/guardian/stage-runner.test.mjs tests/guardian/plan-validator.test.mjs` passed 62/62.
- `node --test "tests/guardian/*.test.mjs"` passed 749/749.
- LSP diagnostics were clean for all changed implementation and test files.
- Direct #324 runtime-seam probe returned `planned-dirty-fix-branch-current` for `D:/tuantuanrent.qa-guardian-control` on `fix/issue-324`.
