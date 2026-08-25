---
type: digest
kind: phase
date: 2026-08-24
number: 006
title: All-open discovery, dashboard & TUI live observability
status: completed
source_records:
  - changes/2026-08-20-change-43665fbe15694f7a94ae63d97c21396e-open-issue-doing-flow.md
  - changes/2026-08-23-change-997b498ea9e54fe594fe0e7f1d2a4bed-all-open-discovery-docs.md
  - changes/2026-08-20-change-35fabb09ed8e4e00bb48259a4f4ee8af-guardian-dashboard-session-viewer.md
  - changes/2026-08-23-change-9a365188edb64e18ae022e7c6bd034c8-dashboard-live-refresh-coalescing.md
  - changes/2026-08-21-change-7e6fdf97764f412c921e2d9ab581c7b1-tui-live-event-view.md
  - changes/2026-08-21-change-cd0869b5cfa74261b9cf4655935f2317-guardian-tui-opencode-observability.md
  - changes/2026-08-21-change-f78313d32e614657bce29b72264e20fb-guardian-tui-current-filter.md
  - changes/2026-08-24-change-a48837fbd4434ec68cb7a32391707f3f-guardian-gate1-live-rendering.md
coverage:
  from: 2026-08-20
  to: 2026-08-24
coverage_hash: c0bbe4b8abc933d3d98e345c7fab9c556589dbc6c27d8d1784c02d7c9502a9b8
---

## Phase Scope
The observability surface: the all-open issue discovery model (labels are visible projections, not gating), the read-only dashboard, and the live TUI that streams specialist activity over official OpenCode SSE. This is how an operator sees what Guardian is doing in real time.

## Core Conclusions
- **Discovery is all-open**: Guardian considers every OPEN issue without requiring a discovery label, claims new issues under the existing N=1 lock, and projects `qa-guardian:doing` for active states. All-open is the single authoritative model; labels are limited to visible projections, and a live E2E release-gate checklist is documented.
- The **read-only TUI streams live specialist events via `client.event.subscribe()` SSE** (a "live" tab): tool calls / text / session-idle / error, filtered by the selected issue's session id, with a bounded buffer and auto-reconnect; it requires `--base-url` pointing at the shared serve or gives an enablement hint.
- The TUI **distinguishes unread OpenCode transcripts and stale runtime state** so users don't mistake missing messages or persisted "running" status for no work, and by default filters to `current` (active+waiting), hiding DONE / handed-back history (togglable to `all` for audit).
- The **read-only dashboard coalesces bursty live SSE events into one pending refresh**, preventing unbounded refresh-queue growth while preserving live buffer updates.
- Structured Gate 1 plan fields and persisted live-tab context **render as readable text**, so operators no longer see `[object Object]` comments or empty connected live views after investigation stops.

## Key Decisions and Changes
- All-open discovery + doing projection; command authors sourced from the per-project launcher binding; all-open discovery contract documented with E2E checklist.
- Dashboard session viewer + live-refresh coalescing.
- TUI live event view (SSE), OpenCode transcript/liveness ambiguity handling, default `current` filter, and Gate 1 live-rendering fix.

## Current State
Operators have a real-time, read-only window into Guardian: all-open discovery is authoritative, the TUI live tab streams specialist steps over SSE, and the dashboard is refresh-bounded. Depends on the shared OpenCode serve introduced in the runtime-reliability work (digest-007).

## Recommended Next Reads
- digest-007 — the shared `opencode serve` (Plan B) that the live tab attaches to.
- digest-003 — the SDK sessions whose events are streamed here.
- digest-005 — the launchers that start the dashboard/TUI.

## Source Coverage
8 change records, 2026-08-20 to 2026-08-24, covering all-open discovery, dashboard, and live TUI observability.
