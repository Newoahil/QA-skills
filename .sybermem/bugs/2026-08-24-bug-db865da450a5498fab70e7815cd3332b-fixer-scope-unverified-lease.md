---
type: bug
record_id: bug-db865da450a5498fab70e7815cd3332b
date: 2026-08-24
title: Fixer completion rejected by described affected_files and left a fresh FIXING lease
source: Runtime investigation of LambdaTheory/tuantuanrent issue #263
severity: high
status: resolved
key_conclusion: Normalized generated affected_files objects into scoped path strings and made unverified fixer completions persist their reason and exit FIXING, preventing completed fixes from being rejected invisibly and appearing permanently in progress.
topics: [qa-guardian, fixer, state-recovery]
related: [bug-897d6e684d654aafba07f30dc5079f44]
---

## Bug Description

After the Gate 1 schema fix, issue #263 produced a valid plan, consumed `/guardian approve`, passed
the plan gate, and the fixer completed all four scoped file changes with a valid
`READY_FOR_FINALIZATION` JSON response. The scheduler nevertheless logged
`fixer.session_stopped status=unverified`, left state as `FIXING`, and subsequent polls reported
`in-progress-fresh-lease` for the remainder of the 30-minute lease.

## Root Cause

The generated plan represented `affected_files` as objects containing `{ file, 说明 }`. The strict
fixer completion validator built a Set directly from this array and compared fixer
`changed_files` strings by identity. Every changed file therefore appeared outside the approved
scope and produced `changed-file-not-in-plan`. The runner discarded that reason, persisted only
`last_status=unverified`, and the stage stopped without transitioning out of the active `FIXING`
state.

## Solution

- Plan generation now normalizes described `affected_files` entries (`file`, `path`, or
  `file_path`) into scoped relative path strings while preserving the original objects in
  `affected_file_details`.
- Fixer completion now returns and persists the exact validation reason as `completionError` /
  `opencode.fixer.last_error`.
- Any fail-closed fixer stop transitions to `HANDED_BACK` with `handed_back_reason=blocked` and a
  concrete `last_error_class`, rather than retaining a fresh active lease.
- For the already-completed #263 runtime, the current plan was backed up and mechanically repaired,
  its hash rebound to state, and the run returned to Gate 1 without discarding the four code edits
  or the fixer session.

## Prevention Measures

- Generated artifact schemas must normalize human-readable object entries before machine equality
  checks.
- Every `unverified` status must carry a stable reason through session state and logs.
- A stopped stage must not remain in an active heartbeat state unless a worker is actually alive.

## Related Changes

- `468bbe8 Normalize generated plan file scope for fixer validation`
- `56bc685 Expose fixer completion failures and release active state`
- Full Guardian suite: 664/664 passed.
- Runtime backup: `D:\tuantuanrent.qa-guardian-control\.qa\guardian\263.fixer-scope-repair-20260824-183253.bak`
