---
type: change
record_id: change-24402a071a3a4c84a3a6f56e78cca33b
date: 2026-08-19
title: Introduce three-role architecture contract for QA Guardian (Phase 1)
status: done
key_conclusion: Split QA Guardian into QA/Fixer/Supervisor roles as docs-only contracts (scheme A, zero runtime change) so later phases can separate identities without reopening frozen invariants.
topics: [qa-guardian, architecture, role-split]
author: goudaren0528
related_files: [qa-skill/agents/fixer-agent.md, docs/qa-guardian-role-architecture.md, tools/guardian/README.md, tools/guardian/DEPLOY.md]
---

## Change Content
Phase 1 of the QA/Fixer/Supervisor architecture split, on branch auto-qa
(commit 61dddef). Documentation and role vocabulary only — no runtime code
change. Added `qa-skill/agents/fixer-agent.md` as a NON-runnable role-contract
doc (deliberately no frontmatter, so opencode does not register a second
runnable agent) that points at the existing write-capable `qa-guardian`
runtime. Added `docs/qa-guardian-role-architecture.md` as the normative single
source of truth mapping three roles:
- QA Agent = the read-only `qa` agent (zero GitHub side effects).
- Fixer Agent = the write-capable `qa-guardian` agent (never self-grades,
  never merges/closes).
- Guardian Supervisor = the existing `scheduler-core` / `state-router` /
  `commands` decision layer (owns events, state, N=1, the human command gate,
  the machine QA gate, PR creation, and is the sole writer of the QA verdict
  comment).
Added role-terminology + label-freeze + global-sync notes to README.md and
DEPLOY.md.

## Reason for Change
The prior all-in-one `qa-guardian` conflated investigation, fixing, grading,
and orchestration. A single lapse (prompt injection via issue text, a model
misstep) could carry a bad change to trunk with no real gate. Making the three
roles explicit — and mechanically constrained by opencode permissions — means
no single compromised step can cross the next boundary. Scheme A (rename +
make existing boundaries explicit, keep the STATES enum) was chosen over a
full state-machine rewrite because it is functionally equivalent but avoids
rewriting 204 tests.

## Impact Scope
Docs and one non-runnable agent role doc only. Frozen and unchanged: the
STATES enum, the `qa-guardian` discovery label, projected `qa-guardian:*`
labels, and the `opencode run --agent qa-guardian` runtime dispatch. No `gh`
write permission added to the read-only QA agent. Also synced all 8 agent
files to `~/.config/opencode/agents/` and corrected a pre-existing stale
global `qa-guardian.md` drift (an older 279-line copy vs the repo's 292-line
authoritative version).

## Implementation
A-plan decisions locked before editing (via Metis pre-analysis + a full
rename blast-radius audit): compat alias = keep `qa-guardian` as runtime
canonical + `fixer-agent.md` as role doc; zero runtime literal changes;
supervisor as a docs contract, not a runnable agent. The audit confirmed
`poll.mjs` hard-codes `--agent qa-guardian` and `poll.test.mjs` asserts it, so
any runtime rename would have broken tests — validating the docs-only path.

## Test Verification
Full suite stayed green at 204/204 after the change (docs-only, no runtime
touched). Verified fixer-agent.md has no frontmatter (non-runnable) and that
repo↔global agent hashes match after sync.

## Notes
Phase 1 of a 4-phase split. Phase 2 (verdict-comment protocol) shipped in
commit 961937c. Phase 3 (two GitHub App identities + fact-vs-authorization
channel separation, trustedAuthors stays human-only) and Phase 4 (webhook
primary trigger + scheduler compensation + unified 3-layer idempotency) are
planned but not started.
