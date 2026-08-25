---
type: decision
record_id: decision-832596314b274789ab3bf5f8e354d69d
date: 2026-08-25
title: What to clear (and not clear) when resetting a single QA Guardian issue
status: accepted
source: issue #263 live retest sessions
supersedes: []
key_conclusion: Resetting one Guardian issue only requires backing up and removing its authoritative .qa/guardian/<n>.json plus <n>/ directory; the issue lease lives inside <n>.json so it clears automatically, and prior GitHub /guardian comments do not need deletion. .scheduler.lock is auto-released on a clean Ctrl+C stop, but a force-killed scheduler leaves a STALE lock that must be removed only after verifying its owner pid is dead. config.json, other issues, watch-state.json, and .sybermem must never be touched.
topics: [qa-guardian, testing, recovery, lease]
related: [decision-f177ceabeded4a5193afa0f2b58b6c13, change-5330fd1c1188484fa1647010616d8195]
---

## Context

During repeated live retesting of issue #263 the operator asked whether the issue lease and the GitHub issue comment must be cleared separately in addition to the issue state, because after restarting the scheduler the issue kept routing to `SKIP in-progress-fresh-lease`. That skip was not a stuck state: the lease from the previous failed investigation had not yet expired. This record captures exactly which files/artifacts a single-issue reset must touch, so future resets are not over- or under-scoped.

## Considered Options

1. Treat the lease as a separate artifact and clear it independently. Rejected: the lease is not a standalone file.
2. Also delete the GitHub `/guardian approve` comment on every reset. Rejected: unnecessary and destroys audit history.
3. Only back up and remove the authoritative `<n>.json` and `<n>/` directory, and rely on the state record to carry the lease and the consumed-comment cursor. Accepted.

## Final Decision

To reset a single Guardian issue for a fresh investigation:

- Must remove (after a timestamped backup): `.qa/guardian/<n>.json` and `.qa/guardian/<n>/`.
- The issue lease is NOT a separate file. It is computed from `<n>.json` (`updated_at` + `lease_ms`). Deleting `<n>.json` clears the lease automatically, so the next poll routes `START -> INVESTIGATING` with no lingering `in-progress-fresh-lease`.
- The N=1 `.qa/guardian/.scheduler.lock` does NOT need manual deletion in the normal case. The scheduler heartbeats and releases it on a clean `Ctrl+C` stop. BUT if the scheduler process is force-killed (Task Manager kill / `Stop-Process`, not `Ctrl+C`), the lock file is left behind as a STALE lock; before resetting or restarting you must verify the lock's owner pid is dead and then remove the stale lock (see Stale lock recovery below).
- The GitHub issue `/guardian` comments (e.g. a prior `approve`) do NOT need deleting. The router tracks consumption via `last_consumed_comment_id` inside `<n>.json`; deleting `<n>.json` drops that cursor, so an old approve is not re-consumed. Only re-delete/re-post a comment when the intent is specifically to retest the approve flow.
- Never touch `config.json`, other issues' `<m>.json`, `watch-state.json`, or `.sybermem/` during a single-issue reset; those are global or belong to other issues.

## Stale lock recovery (force-killed scheduler)

If a reset/restart reports `lock_exists=True` after you believe the scheduler is stopped, do NOT blindly delete the lock and do NOT reset issue state while a live scheduler still holds it (that races the running writer). Instead:

1. Read `.qa/guardian/.scheduler.lock`; it is JSON `{ "pid": <n>, "token": ..., "acquired_at": ..., "renewed_at": ... }`.
2. Check whether the owner pid is still alive (PowerShell: `Get-Process -Id <pid> -ErrorAction SilentlyContinue`).
3. If the pid is ALIVE, a scheduler is still running — stop it first (prefer `Ctrl+C`), then re-check.
4. If the pid is DEAD, the lock is a stale residue from a force-killed process — it is safe to `Remove-Item` the lock file, then proceed with the single-issue reset.

Observed example (issue #263, 2026-08-25): lock recorded `pid 33844`; `Get-Process -Id 33844` returned nothing (dead) → removed the stale `.scheduler.lock`, then backed up and removed `263.json` + `263/`, and poll routed `START -> INVESTIGATING`. Prefer `Ctrl+C` over force-kill to avoid creating stale locks in the first place.

## Impact and Consequences

Operators can reset one issue with a minimal, safe footprint and understand that `in-progress-fresh-lease` after a restart means the previous lease has not expired yet, not that the pipeline is broken. It prevents unnecessary deletion of the scheduler lock or GitHub comments, and prevents accidental damage to shared config, watch state, or SyberMem memory. The trade-off is that an operator must wait for lease expiry OR perform the state reset to force an immediate retry.

## Related

- Full retest procedure (stash plan-scoped product edits + backup + remove): `decision-f177ceabeded4a5193afa0f2b58b6c13`.
- Diagnosability: rejected plans are now persisted as `.qa/guardian/<n>/plan-invalid.json` for inspection instead of being silently discarded.

## Notes

`in-progress-fresh-lease` is derived: state is active (INVESTIGATING/FIXING/...) AND `now - updated_at < lease_ms` (default 1800000 ms = 30 min). To force an immediate retry without waiting for expiry, perform the single-issue reset above; the running scheduler re-discovers the issue on the next tick as a new `START`.
