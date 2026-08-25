---
type: decision
record_id: decision-832596314b274789ab3bf5f8e354d69d
date: 2026-08-25
title: What to clear (and not clear) when resetting a single QA Guardian issue
status: accepted
source: issue #263 live retest sessions
supersedes: []
key_conclusion: Resetting one Guardian issue only requires backing up and removing its authoritative .qa/guardian/<n>.json plus <n>/ directory; the issue lease lives inside <n>.json so it clears automatically, the .scheduler.lock and prior GitHub /guardian comments do not need manual deletion, and config.json, other issues, watch-state.json, and .sybermem must never be touched.
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
- The N=1 `.qa/guardian/.scheduler.lock` does NOT need manual deletion. The scheduler heartbeats and releases it on stop; only an abnormally killed process leaves a stale lock that then needs manual removal.
- The GitHub issue `/guardian` comments (e.g. a prior `approve`) do NOT need deleting. The router tracks consumption via `last_consumed_comment_id` inside `<n>.json`; deleting `<n>.json` drops that cursor, so an old approve is not re-consumed. Only re-delete/re-post a comment when the intent is specifically to retest the approve flow.
- Never touch `config.json`, other issues' `<m>.json`, `watch-state.json`, or `.sybermem/` during a single-issue reset; those are global or belong to other issues.

## Impact and Consequences

Operators can reset one issue with a minimal, safe footprint and understand that `in-progress-fresh-lease` after a restart means the previous lease has not expired yet, not that the pipeline is broken. It prevents unnecessary deletion of the scheduler lock or GitHub comments, and prevents accidental damage to shared config, watch state, or SyberMem memory. The trade-off is that an operator must wait for lease expiry OR perform the state reset to force an immediate retry.

## Related

- Full retest procedure (stash plan-scoped product edits + backup + remove): `decision-f177ceabeded4a5193afa0f2b58b6c13`.
- Diagnosability: rejected plans are now persisted as `.qa/guardian/<n>/plan-invalid.json` for inspection instead of being silently discarded.

## Notes

`in-progress-fresh-lease` is derived: state is active (INVESTIGATING/FIXING/...) AND `now - updated_at < lease_ms` (default 1800000 ms = 30 min). To force an immediate retry without waiting for expiry, perform the single-issue reset above; the running scheduler re-discovers the issue on the next tick as a new `START`.
