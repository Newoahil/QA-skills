---
type: decision
record_id: decision-f177ceabeded4a5193afa0f2b58b6c13
date: 2026-08-25
title: Safe QA Guardian issue reset for full end-to-end retesting
status: accepted
source: repeated live testing and issue #263 recovery work
supersedes: []
key_conclusion: A full Guardian retest must preserve plan-scoped product work in a path-scoped stash, back up issue state/artifacts, then remove the authoritative issue record and artifact directory so the next poll starts at START->INVESTIGATING instead of reusing GATE_1_WAIT.
topics: [qa-guardian, testing, recovery]
related: [bug-209c918349934460abcb4741bece9f0d, decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Context
Guardian issue testing can become stuck in an existing lifecycle state such as GATE_1_WAIT. Clearing only notification or proposal markers retests compensation behavior but does not retest the full issue-to-investigation flow. Issue #263 also demonstrated that plan-scoped Fixer edits may already exist in the control worktree and must not be lost or mixed into a fresh investigation.

## Considered Options
1. Clear only Gate 1 notification/comment markers. Rejected for full E2E retests because the router still immediately returns gate1-waiting.
2. Delete state/artifacts and discard product edits. Rejected because it destroys recoverable Fixer work.
3. Preserve product edits in a path-scoped stash, back up state/artifacts, then remove the authoritative issue record and issue artifact directory. Accepted because it gives a clean START while retaining complete recovery paths.

## Final Decision
For a full Guardian issue retest:

1. Confirm no Guardian scheduler process is running and `.qa/guardian/.scheduler.lock` is absent.
2. Inspect the control worktree and identify the exact plan-scoped product files from the current valid plan.
3. Save only those files with a descriptive path-scoped stash, including untracked planned test scripts:

```powershell
$env:GIT_MASTER='1'; git stash push --include-untracked -m "qa-guardian issue-<n> pre-retest scoped fix" -- <planned files...>
```

4. Create a timestamped backup directory under `.qa/guardian/`, copying `<n>.json` and `<n>/` in full.
5. Remove only the authoritative `.qa/guardian/<n>.json` and `.qa/guardian/<n>/` paths.
6. Preserve `.qa/guardian/config.json`, other issue records, watch state, SyberMem state, and the stash.
7. Verify GitHub issue is still OPEN, the issue state/artifact paths are absent, no scheduler lock exists, and the planned product paths are clean.
8. Restart Guardian. The expected route is `START -> INVESTIGATING`, not `SKIP gate1-waiting`.

For testing only Gate 1 proposal recovery, do not perform a full reset: keep valid artifacts and GATE_1_WAIT, clear only `gate_1_comment_hash`, `last_gate_1_proposal_hash`, and optionally `last_notified_state` depending on the notification scenario.

## Impact and Consequences
This procedure separates two different test goals: compensation retesting versus full lifecycle retesting. It prevents accidental data loss, prevents stale Fixer edits from contaminating a new investigation, and gives an explicit restore point. The trade-off is that operators must manage the scoped stash and timestamped backup until the retest is accepted.

## Related Changes
- Gate 1 detailed proposal recovery: commits `1f7f924`, `12356a7`, `75ccc78`.
- Issue #263 full-retest backup example: `.qa/guardian/263.full-retest-20260825-110224.bak`.
- Issue #263 scoped stash example: `qa-guardian issue-263 pre-retest scoped fix`.

## Notes
Restore the saved product edits only when needed:

```powershell
$env:GIT_MASTER='1'; git stash apply 'stash@{<index>}'
```

Prefer locating the stash by its descriptive message before applying, because stash indexes change over time. Do not use destructive `git reset --hard` or delete unrelated dirty state.
