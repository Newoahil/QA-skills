---
type: change
record_id: change-997b498ea9e54fe594fe0e7f1d2a4bed
date: 2026-08-23
title: Document all-open Guardian discovery contract
status: done
source: implementation
key_conclusion: QA Guardian docs and agent guidance now describe all-open issue discovery as the single authoritative model, with labels limited to visible projections and a live E2E release gate checklist documented.
topics: [qa-guardian, issue-discovery, documentation, e2e-checklist]
author: Sisyphus
related_files: [tools/guardian/README.md, docs/qa-guardian-requirements-and-design.md, qa-skill/agents/qa-guardian.md]
---

## Change Content
Updated Guardian operator docs, architecture docs, and the `qa-guardian` agent guidance to remove stale `--label qa-guardian`, `watch_mode=labeled`, and `new-open` baseline language from the current discovery contract.

The documented authority is now: every open GitHub issue is a scheduler candidate; `.qa/guardian/<issue>.json`, GitHub issue state/comments, and the N=1 lock are authoritative; `qa-guardian:*` labels are visible Supervisor projections only.

Added a live E2E release gate checklist to `tools/guardian/README.md`, covering all-open discovery, artifacts, fixer/QA gate order, GitHub effects, Gate 2 human stop, and dashboard/session observability.

## Reason for Change
The review found conflicting documentation that still implied a labeled or new-open-baseline discovery model, while the implementation had already moved to all-open discovery. This could cause operators to misconfigure or under-verify release readiness.

## Impact Scope
Documentation and agent guidance only. Runtime behavior, state machine code, GitHub effects, permissions, and label projection code were not changed.

## Test Verification
- `findstr` confirmed the edited docs no longer contain stale `--label qa-guardian`, live labeled issue, or creation baseline wording.
- `node --test "tests/guardian/*.test.mjs"` passed 574/574.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.
- Markdown LSP diagnostics were unavailable because no `.md` LSP server is configured.

## Notes
Committed as `0c1f51c Document all-open Guardian discovery contract`. This closes both documentation todos: authoritative all-open discovery contract and live E2E residual release gate checklist.
