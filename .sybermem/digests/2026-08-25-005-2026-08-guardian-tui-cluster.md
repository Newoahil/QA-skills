---
type: digest
kind: phase
date: 2026-08-25
number: 005
title: 2026-08 guardian-tui cluster
status: completed
source_records:
  - changes/2026-08-21-change-cd0869b5cfa74261b9cf4655935f2317-guardian-tui-opencode-observability.md
  - changes/2026-08-21-change-f78313d32e614657bce29b72264e20fb-guardian-tui-current-filter.md
coverage:
  from: 2026-08-21
  to: 2026-08-21
coverage_hash: 154433eaba30f726945ef5f934f483e7a5d6eab07d7130dba63c2009e04b3a73
---

## Phase Scope

This phase covers the 2026-08-21 read-only Guardian TUI work that made runtime liveness, OpenCode transcript ambiguity, and current-vs-history queue state explicit to operators.

## Core Conclusions

- The Guardian TUI must distinguish unread or unavailable OpenCode transcripts from absence of work. Session token usage plus empty or failed message reads is an ambiguity to surface, not a reason to render a blank transcript.
- Persisted `running` specialist state is not proof of live work. The dashboard should compare state with current `opencode.inflight` and scheduler lock freshness/PID liveness before implying activity.
- The default queue view should show current attention items (`active` + `waiting`) rather than terminal history, because historical DONE records can persist locally after the remote issue is closed or deleted.
- History remains audit material and should be reachable via an explicit `all` filter instead of being deleted or hidden permanently.

## Key Decisions and Changes

- Preserved non-404 OpenCode message endpoint failures as `message-endpoint-error` and rendered guidance when metadata suggests unread transcripts.
- Added Live tab lines for inflight operation state and scheduler lock liveness while redacting lock tokens.
- Marked persisted `running` records as non-live when no runtime inflight marker exists.
- Added semantic state filters: `current`, `active`, `waiting`, and `all`; made `current` the default and used `t/T` to cycle filters.
- Updated header, footer, help text, refresh behavior, and regression coverage around the new filter model.

## Current State

The read-only dashboard now defaults to the current Guardian queue, keeps terminal records available for audit, and gives operators explicit signals for stale locks, non-live persisted states, and unread OpenCode transcripts.

## Recommended Next Reads

- `changes/2026-08-21-change-cd0869b5cfa74261b9cf4655935f2317-guardian-tui-opencode-observability.md`
- `changes/2026-08-21-change-f78313d32e614657bce29b72264e20fb-guardian-tui-current-filter.md`

## Source Coverage

2 records listed in frontmatter `source_records`.
