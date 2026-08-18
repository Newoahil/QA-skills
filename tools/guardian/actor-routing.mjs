// QA Guardian — actor routing & capability policy (Phase 3, pure).
//
// Locks the §5A decisions in code as a REVERSIBLE scaffolding layer (decision 2): GitHub
// side-effects still flow through the existing single-PAT gh/REST transport, but every effect is
// now assigned to an intended actor and out-of-role effects are forbidden at this boundary. No
// per-App token cutover here — this module is policy, not transport.
//
// Actor taxonomy (decision 5) — three structurally-distinct security domains:
//   - human_authorizer : a human GitHub login on trustedAuthors. The ONLY class that may drive a
//                        /guardian authorization transition. Never a machine.
//   - bot_fact_writer  : a machine identity that appends FACTS (verdict/notification/label). Its
//                        comments are never authorization commands. (future QA App)
//   - bot_executor     : a machine identity that performs code/PR side-effects. (future Fixer App)
//   - supervisor       : the orchestrator; reads, projects labels, posts facts, creates the PR
//                        after the machine QA gate. (today: the scheduler, local gh)
//
// This file is PURE (no gh, no fs, no network) so it is fully unit-testable.

export const ACTORS = Object.freeze({
  HUMAN_AUTHORIZER: 'human_authorizer',
  BOT_FACT_WRITER: 'bot_fact_writer',
  BOT_EXECUTOR: 'bot_executor',
  SUPERVISOR: 'supervisor',
});

// Effect classes — the audited GitHub side-effect kinds (see qa-guardian-actor-effect-matrix.md).
export const EFFECTS = Object.freeze({
  READ: 'read',                    // gh issue list/view
  LABEL: 'label',                  // gh issue edit --add/--remove-label
  FACT_COMMENT: 'fact_comment',    // verdict / notification / trace comment (never authorization)
  FACT_WEBHOOK: 'fact_webhook',    // curl webhook notify
  PR_CREATE: 'pr_create',          // gh pr create
  CODE_WRITE: 'code_write',        // branch commit + push
  AUTHORIZE: 'authorize',          // consume a /guardian command → state transition
  MERGE: 'merge',                  // gh pr merge  — HUMAN ONLY, never automated
  CLOSE: 'close',                  // gh issue close — HUMAN ONLY, never automated
});

// Capability matrix: which effects each actor MAY perform. Anything not listed is forbidden.
// MERGE/CLOSE appear for NO actor — they are human-only and never automated (mechanism + this).
const CAPABILITIES = Object.freeze({
  [ACTORS.HUMAN_AUTHORIZER]: Object.freeze([EFFECTS.AUTHORIZE]),
  [ACTORS.BOT_FACT_WRITER]: Object.freeze([EFFECTS.READ, EFFECTS.LABEL, EFFECTS.FACT_COMMENT]),
  [ACTORS.BOT_EXECUTOR]: Object.freeze([EFFECTS.READ, EFFECTS.CODE_WRITE, EFFECTS.PR_CREATE, EFFECTS.FACT_COMMENT]),
  [ACTORS.SUPERVISOR]: Object.freeze([
    EFFECTS.READ, EFFECTS.LABEL, EFFECTS.FACT_COMMENT, EFFECTS.FACT_WEBHOOK, EFFECTS.PR_CREATE,
  ]),
});

// Effects no actor may ever perform automatically (human-only, defense in depth alongside the
// mechanism-level `gh pr merge` / `gh issue close` deny in the agent permission frontmatter).
export const HUMAN_ONLY_EFFECTS = Object.freeze([EFFECTS.MERGE, EFFECTS.CLOSE]);

export function isKnownActor(actor) {
  return Object.values(ACTORS).includes(actor);
}

export function allowedEffects(actor) {
  return CAPABILITIES[actor] ?? [];
}

// Only the human_authorizer class may reach the authorization path. This is the code-structural
// guarantee behind decision 1 + 5: a machine actor can NEVER authorize, even if its login were
// mistakenly added to a whitelist.
export function isAuthorizerActor(actor) {
  return actor === ACTORS.HUMAN_AUTHORIZER;
}

export function actorMayPerform(actor, effect) {
  if (HUMAN_ONLY_EFFECTS.includes(effect)) return false; // never automated for any actor
  return allowedEffects(actor).includes(effect);
}

// Hard assertion for use at a side-effect boundary. Throws with a clear message so an out-of-role
// effect fails loudly at the routing layer rather than silently going out under ambient gh.
export function assertActorMayPerform(actor, effect) {
  if (!isKnownActor(actor)) throw new Error(`unknown actor: ${JSON.stringify(actor)}`);
  if (!actorMayPerform(actor, effect)) {
    throw new Error(`actor '${actor}' may not perform effect '${effect}'`);
  }
  return true;
}

// Classify a comment source. PR comments NEVER authorize (decision 4): only the issue-comment
// stream may feed the authorization path. Returns whether this source is eligible to carry a
// /guardian authorization command at all (independent of author trust, which selectCommand checks).
export const COMMENT_SOURCES = Object.freeze({ ISSUE: 'issue', PR: 'pr' });
export function sourceMayAuthorize(source) {
  return source === COMMENT_SOURCES.ISSUE;
}
