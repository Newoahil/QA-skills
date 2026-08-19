---
type: change
record_id: change-4e17ae8322d944be9acbbd5f14780594
date: 2026-08-19
title: Harden QA Guardian after independent review
status: completed
key_conclusion: Replaced child-agent shell authority with supervisor-owned direct argv operations, made SDK sessions and Gate 1 approvals context-bound and fail-closed, enforced actor capabilities at mutation seams, and hardened state/GitHub I/O; the Guardian suite passes 371/371.
topics: [qa-guardian, opencode-sdk, security, review-remediation]
related: [bug-95af95c0c87348659c6d36a12974beb0, bug-8a5db6c7aa0447189f0e23d02741516c]
---

## Scope

Resolved the blocking findings from the five-lane post-E2E review without changing the completed
issue #211 product fix or PR #222.

## Changes

- Removed generic bash access and broad allow rules from fixer, QA, facet, and specialist SDK
  sessions. Added permission policy versioning so legacy broad-permission sessions are recreated.
- Added a supervisor-owned, shell-free direct-argv executor for branch preparation, bounded test
  commands, scoped staging, deterministic commit, and normal push. It rejects wrappers, arbitrary
  commands, force push, `.codegraph`, and unrelated pre-staged files.
- Made fixer and QA prompt outcomes fail closed. Baseline reads, session validation, prompt
  execution, polling, and abort cleanup are deadline-bound.
- Correlated QA verdicts to the exact current user prompt through a unique operation marker and
  assistant `parentID`; stale, delayed, and unrelated PASS messages cannot satisfy a run.
- Bound persisted sessions to canonical repository, issue, role, round semantics, and permission
  policy version. Windows paths are case-insensitive; POSIX paths preserve case.
- Bound human Gate 1 approval to the exact current plan hash and investigation revision. QA verdict
  and PR gate carry the same plan identity.
- Enforced the actor/effect capability matrix at PR, comment, label, webhook, and REST mutation
  boundaries.
- Made issue state and scheduler watch state atomic via same-directory temp writes and rename.
- Migrated GitHub CLI PR/comment prose to UTF-8 Markdown `--body-file` transport with guaranteed
  cleanup on success and failure.
- Aligned Guardian docs: fixer edits/reports; supervisor finalizes commit/push, owns QA verdicts and
  PR creation; only humans approve, merge, or close.

## Verification

- Guardian test suite: 371/371 passing.
- Syntax checks: 13 modified runtime modules passed `node --check`.
- Static scans found no broad permission allow, child-agent bash allow, inline GitHub CLI `--body`,
  or contradictory fixer-owned PR wording.
- Live read-only issue #211 check: state remains `GATE_2_WAIT` with PASS artifact and PR #222; old
  unversioned broad-permission fixer/QA sessions resolve to `create + contextLoss` under policy v2,
  so future rework cannot reuse them.
- No force push, target-repository mutation, or `.codegraph` staging occurred.

## Residual Risk

- PR #222 was merged by a human while remediation was in progress. The old scheduler was stopped;
  after deployment the new scheduler should perform the normal closed-PR transition to DONE.
- Merchant-admin dependencies remain absent in the local target checkout, so its focused Jest and
  browser visual checks were not added to this Guardian-runtime remediation.
