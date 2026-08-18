---
type: change
record_id: change-62abfd75f0104cce826232f15679e2d3
date: 2026-08-19
title: Add actor routing and structural human-only authorization separation (Phase 3)
status: done
key_conclusion: Introduced a reversible actor-routing policy layer and a bot denylist so machine actors can never authorize or perform out-of-role GitHub effects, enforcing the QA/Fixer/Supervisor identity boundaries in code without a per-App-token cutover.
topics: [qa-guardian, authorization, actor-routing]
author: goudaren0528
related_files: [tools/guardian/actor-routing.mjs, tools/guardian/commands.mjs, docs/qa-guardian-role-architecture.md, docs/qa-guardian-actor-effect-matrix.md, tests/guardian/actor-routing.test.mjs, tests/guardian/commands.test.mjs]
related: [change-24402a071a3a4c84a3a6f56e78cca33b, change-bcabf0f8e62b4a45b47b7823b934848e]
---

## Change Content
Phase 3 of the QA/Fixer/Supervisor split, on branch auto-qa. Five decisions
were locked before any code (recorded in role-architecture doc §5A):
1. `trustedAuthors` is human-only, always.
2. Phase 3 is policy/actor-routing scaffolding, NOT a per-App-token transport
   cutover (reversible; still single-PAT gh/REST).
3. Identity is asserted twice (credential/route + visible artifact author).
4. PR comments never authorize; only issue comments feed selectCommand.
5. Fact channel and authorization channel are structurally distinct via an
   explicit actor taxonomy.

Then implemented:
- New `docs/qa-guardian-actor-effect-matrix.md`: a read-only audit mapping all
  12 GitHub side-effect seams to files/functions and proposed actors; notes
  that only `selectCommand` authorizes.
- New `tools/guardian/actor-routing.mjs` (pure): ACTORS taxonomy
  (human_authorizer / bot_fact_writer / bot_executor / supervisor), EFFECTS
  classes, a capability matrix, `assertActorMayPerform`, `isAuthorizerActor`,
  and `sourceMayAuthorize` (PR source never authorizes). merge/close are
  human-only for EVERY actor.
- `commands.mjs`: added an optional `opts.botAuthors` denylist to
  `selectCommand`; bot logins are SUBTRACTED before the trust check, so a
  mis-whitelisted bot can never become a trusted authorizer (denylist wins).

## Reason for Change
The prior single all-in-one identity meant permissions were only conceptually
separable, not enforced. Metis flagged the top risk as "ambient gh identity
leakage" and "a bot author entering the human authorization lane". This phase
makes the QA/Fixer/Supervisor boundaries a code-structural guarantee: a machine
actor cannot authorize (decision 1/5) and cannot perform an out-of-role effect
(e.g. the QA-App route has no PR-create capability), even before real per-App
tokens exist. The reversible scaffolding (decision 2) lets the true token
cutover ship later without redoing the policy.

## Impact Scope
Adds one pure policy module + one audit doc + tests, and one backward-compatible
optional parameter to `selectCommand` (existing 4-arg callers and all prior
tests unaffected). No change to STATES, labels, discovery, runtime dispatch, or
the fail-closed empty-whitelist rule. The Supervisor-sole-verdict-writer rule
and the marker-is-never-a-command grammar are unchanged and strengthened.

## Implementation
The actor-routing module mirrors the pure-policy style of verdict-comment.mjs /
notify.mjs. The bot denylist is applied by filtering bot logins out of the
trusted set before the existing eligibility loop, so the change is additive and
fail-safe toward "no bot authorization".

## Test Verification
Full suite: 233/233 green (221 baseline + 12 new: 8 actor-routing capability
tests + 4 commands botAuthors regression tests). Key proofs: only
human_authorizer may authorize; merge/close forbidden for every actor; QA App
cannot PR/merge; Fixer App cannot project qa labels; a bot `/guardian approve`
is ignored even when the bot is also mistakenly whitelisted (denylist wins);
empty whitelist still authorizes nothing; PR source never authorizes.

## Notes
Phase 3 of a 4-phase split. Phase 4 (webhook primary trigger + scheduler
compensation + unified 3-layer idempotency) is next and will consult Oracle on
the concurrency/idempotency model before any code.
