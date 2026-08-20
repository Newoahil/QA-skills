---
record_id: change-43665fbe15694f7a94ae63d97c21396e
type: change
date: 2026-08-20
title: All-open Guardian discovery and doing projection
key_conclusion: QA Guardian now considers every OPEN issue without requiring a discovery label, claims new issues under the existing N=1 lock, projects qa-guardian:doing for active states, and sources command authors from the per-project launcher binding.
topics:
  - qa-guardian
  - issue-discovery
  - doing
---

## Change Content

The resident scheduler now queries all OPEN GitHub issues without `--label qa-guardian` and ignores
the old `watch_mode`/new-open watermark gate. Existing terminal records remain governed by the router:
DONE and HANDED_BACK are skipped unless their explicit followup/retry commands apply. A previously
unknown OPEN issue such as #205 becomes a discovered START candidate.

New candidates are claimed inside the existing atomic N=1 critical section by persisting a
`DISCOVERED` state with `claim_source: discovered`. The GitHub label `qa-guardian:doing` is a visible
projection for active Guardian states only; state JSON and the N=1 lock remain authoritative. The
label is removed when the state leaves active processing.

The launcher binding now accepts optional non-empty `command_authors`, prompts once when missing, and
propagates the binding authors into the control runtime config. This prevents canonical/control config
differences from changing the trusted command source.

## Reason

Issue #205 was OPEN but unlabeled and created before the `new-open` baseline, so the previous discovery
logic ignored it. The requested behavior is automatic OPEN issue coverage with a visible doing marker,
without making labels authoritative or weakening human approval and QA safety boundaries.

## Impact Scope

- `scheduler.mjs` all-open candidate discovery and initial discovered claim.
- `label-io.mjs` active-state `qa-guardian:doing` projection.
- `worktree-binding.mjs` and `scheduler-start.ps1` per-project command author persistence/propagation.
- New discovery, binding, label, and historical issue regression tests.
- README/DEPLOY configuration language updated for all-open behavior and doing visibility.

## Safety Boundaries

- N=1 atomic lock remains the concurrency authority.
- Labels remain projections, not state authority.
- Gate 1/Gate 2 human approvals, read-only QA, supervisor-only GitHub mutations, no auto-merge and no
  auto-close remain unchanged.
- No third BAT was added.

## Verification

- Full Guardian suite: 465/465 passed.
- Focused discovery/label/binding/launcher tests: 41/41 passed.
- Node syntax checks and PowerShell parser checks passed.
- Read-only GitHub check confirmed issue #205 is OPEN with no labels; local regression proves it routes
  to START without state.
