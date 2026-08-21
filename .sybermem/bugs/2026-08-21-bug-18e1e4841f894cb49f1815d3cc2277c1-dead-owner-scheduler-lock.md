---
type: bug
record_id: bug-18e1e4841f894cb49f1815d3cc2277c1
date: 2026-08-21
title: Dead-owner scheduler locks blocked new Guardian runs until lease expiry
status: resolved
source: manual
key_conclusion: QA Guardian scheduler lock acquisition treated any unexpired lease as live even when the owner PID was already gone, causing repeated `run.deferred_lock_live` for up to the full lease window; lock acquisition now requires both a live lease and an alive owner PID before deferring, reclaiming dead-owner locks immediately.
topics: [qa-guardian, scheduler, lock]
author: Sisyphus
related_files: [tools/guardian/lock.mjs, tests/guardian/lock.test.mjs]
---

## Description

After restarting the combined Guardian runtime, the scheduler repeatedly logged `run.deferred_lock_live` for issue 205 and never entered investigation. Runtime evidence showed the lock file still pointed at PID 30460, whose process no longer existed, while `renewed_at` was roughly 14 minutes old. The configured/default lease is 30 minutes, so the stale lock had not yet lease-expired.

## Root Cause

`acquireLock` only considered lease age when deciding whether an existing lock was live. If a Guardian process exited or was killed before releasing the lock, the lock could block all new runs until the full lease expired even though the owner process was gone. The earlier atomic stale-lock takeover handled expired leases, but not dead owners inside the lease window.

## Solution

`acquireLock` now checks owner PID liveness in addition to lease age. It defers only when the lease is fresh and the owner process is alive; otherwise it uses the existing atomic stale takeover path. This preserves N=1 for live owners and immediately recovers crashed/dead-owner locks.

## Verification

- Added a regression test proving a dead-owner lock is reclaimed before lease expiry.
- Updated existing live-lock tests to use `process.pid` so they model a real live owner.
- `node --test "tests/guardian/lock.test.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed: 552/552.
- `node --check "tools/guardian/lock.mjs"` passed.
- `git diff --check` passed.
