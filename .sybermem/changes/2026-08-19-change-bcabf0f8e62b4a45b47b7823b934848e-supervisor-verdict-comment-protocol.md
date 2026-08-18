---
type: change
record_id: change-bcabf0f8e62b4a45b47b7823b934848e
date: 2026-08-19
title: Make the Supervisor sole writer of QA verdict comments (Phase 2)
status: done
key_conclusion: Implemented the verdict->Supervisor->GitHub comment protocol so the Supervisor is the only writer of [QA_VERIFIED]/[QA_FAILED] comments, keeping QA zero-side-effect and proving a verdict marker can never be re-parsed as an authorization command.
topics: [qa-guardian, verdict-protocol, injection-safety]
author: goudaren0528
related_files: [tools/guardian/verdict-comment.mjs, tools/guardian/scheduler.mjs, tools/guardian/state.mjs, tests/guardian/verdict-comment.test.mjs, tests/guardian/verdict-comment-integration.test.mjs, docs/qa-guardian-role-architecture.md]
related: [change-24402a071a3a4c84a3a6f56e78cca33b]
---

## Change Content
Phase 2 of the QA/Fixer/Supervisor split, on branch auto-qa (commit 961937c).
Implemented the verdict->Supervisor->GitHub comment protocol in code:
- New `tools/guardian/verdict-comment.mjs`: a pure builder emitting
  `[QA_VERIFIED]` / `[QA_FAILED]` marker comments with an allow-listed JSON
  metadata envelope (protocol / marker / agent / issue / status / branch /
  pr_url / run_id / attempt / report_hash / verified_at only — never code,
  diffs, or secrets, only a report_hash fingerprint). Also `markerForApproval`,
  `assertMarkerIsNotCommand`, `assertSafeMeta`, `hashVerdictComment`.
- New state field `last_verdict_comment_hash` (backward-compatible, no
  schema_version bump) for verdict-comment idempotency.
- `scheduler.mjs` gains a `writeVerdictComment` helper wired into two verdict
  transitions: an unapproved verdict in enforced mode -> `[QA_FAILED]`, and
  after a PR is opened -> `[QA_VERIFIED]`. Idempotent via the hash, best-effort
  so a gh delivery failure never crashes the resident loop.

## Reason for Change
Phase 1 fixed the roles as a contract; Phase 2 turns the load-bearing rule
into code: QA produces only a local `qa-verdict.json`, and the Supervisor is
the SOLE writer of the GitHub verification comment. This keeps QA a clean,
independent judge with zero GitHub side effects and keeps the injection
surface small. It also structurally guarantees that bot-authored status facts
never enter the human `/guardian` authorization channel.

## Impact Scope
Adds one new module + two test files, one new nullable state field, and a
wiring block in scheduler.mjs at the existing verdict/PR seam. No change to the
STATES enum, labels, discovery, or runtime dispatch. QA agent still has zero
`gh` write permission. The Fixer still never writes the verdict comment.

## Implementation
The builder mirrors the style of `notify.mjs` (pure decision + allow-listed
keys). The idempotency mirrors `last_notified_state`. The scheduler helper
reads state, skips if the intended comment hash equals the stored hash, posts
via an injected `ghComment`, then persists the hash; on delivery failure it
logs and swallows (so the loop survives) and does NOT persist the hash so a
retry can succeed.

## Test Verification
Full suite: 221/221 green (204 baseline + 17 new: 12 builder unit tests + 5
scheduler integration tests). The critical regression test proves
`commands.mjs` `selectCommand()` never parses a `[QA_VERIFIED]`/`[QA_FAILED]`
marker as a `/guardian` command, even from a trusted author — the whole safety
of the protocol rests on this. Integration tests prove exactly one comment per
verdict transition, cross-tick idempotency, and best-effort retry after a
delivery failure.

## Notes
Phase 2 of a 4-phase split; implements the protocol documented in
`docs/qa-guardian-role-architecture.md` §3 + §3A (added in this phase). Phase 3
and Phase 4 planned, not started.
