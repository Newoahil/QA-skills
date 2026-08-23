---
type: change
record_id: change-ccc37d2238b34c2c847a647079a7d498
date: 2026-08-23
title: Harden scheduler lock corruption and races
status: done
source: implementation
key_conclusion: Hardened scheduler lock parsing, corrupt-lock reclaim, and heartbeat ownership checks so malformed locks can recover and stale owners cannot overwrite replacement locks.
topics: [qa-guardian, scheduler-lock, reliability]
author: Sisyphus
related_files: [tools/guardian/lock.mjs, tests/guardian/lock.test.mjs]
---

## Change Content
Updated `tools/guardian/lock.mjs` so lock payload parsing converts invalid JSON and malformed payloads into typed corrupt-lock failures. `acquireLock()` now treats corrupt canonical lock files like reclaimable stale locks through the existing atomic rename plus exclusive-create path.

Added a second owner-token read before heartbeat writes in `renewLock()`, and made both `renewLock()` and `releaseLock()` fail closed on corrupt payloads instead of throwing or mutating the canonical lock.

## Reason for Change
The review found that malformed `.scheduler.lock` JSON could permanently break scheduler acquisition and that heartbeat renewal used a read-then-write sequence that could clobber a replacement lock if ownership changed between validation and write.

## Impact Scope
This change is limited to the Guardian N=1 scheduler lock implementation and its direct tests. Scheduler callers keep the same public API: acquire returns a handle or null, renew/release return booleans, and ownership remains token-based.

## Implementation
`readLockRaw()` now validates `pid`, `token`, `acquired_at`, and `renewed_at` and raises `LockError('corrupt')` for invalid payloads. Acquisition catches that corrupt state and attempts the same atomic takeover path used for stale locks. Renewal and release catch corrupt state and return `false`, and renewal verifies the token twice before writing the refreshed heartbeat.

## Test Verification
- `node --test "tests/guardian/lock.test.mjs" "tests/guardian/scheduler-core.test.mjs" "tests/guardian/scheduler-state.test.mjs"` passed 26/26.
- `node --check "tools/guardian/lock.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 565/565.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed as `d668daa Harden scheduler lock corruption and races`. This resolves the review blockers for corrupt lock recovery and stale-owner heartbeat overwrite risk.
