// Tests for tools/guardian/actor-routing.mjs — §5A actor taxonomy + capability matrix.
// Proves the code-structural guarantees: which actor may perform which GitHub effect, that
// merge/close are human-only for EVERY actor, that only the human_authorizer class may authorize,
// and that PR comments never authorize.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTORS, EFFECTS, COMMENT_SOURCES, HUMAN_ONLY_EFFECTS,
  isKnownActor, allowedEffects, isAuthorizerActor, actorMayPerform,
  assertActorMayPerform, sourceMayAuthorize,
} from '../../tools/guardian/actor-routing.mjs';

test('only human_authorizer may authorize', () => {
  assert.equal(isAuthorizerActor(ACTORS.HUMAN_AUTHORIZER), true);
  for (const a of [ACTORS.BOT_FACT_WRITER, ACTORS.BOT_EXECUTOR, ACTORS.SUPERVISOR]) {
    assert.equal(isAuthorizerActor(a), false, `${a} must not authorize`);
    assert.equal(actorMayPerform(a, EFFECTS.AUTHORIZE), false);
  }
});

test('QA App (bot_fact_writer) can read/fact-comment but NOT label, PR, or write code', () => {
  const a = ACTORS.BOT_FACT_WRITER;
  assert.equal(actorMayPerform(a, EFFECTS.READ), true);
  assert.equal(actorMayPerform(a, EFFECTS.LABEL), false);
  assert.equal(actorMayPerform(a, EFFECTS.FACT_COMMENT), true);
  assert.equal(actorMayPerform(a, EFFECTS.PR_CREATE), false);
  assert.equal(actorMayPerform(a, EFFECTS.CODE_WRITE), false);
});

test('Fixer App (bot_executor) can write code but NOT GitHub mutations', () => {
  const a = ACTORS.BOT_EXECUTOR;
  assert.equal(actorMayPerform(a, EFFECTS.CODE_WRITE), true);
  assert.equal(actorMayPerform(a, EFFECTS.PR_CREATE), false);
  assert.equal(actorMayPerform(a, EFFECTS.FACT_COMMENT), false);
  assert.equal(actorMayPerform(a, EFFECTS.LABEL), false, 'Fixer must not add qa labels');
});

test('merge and close are human-only for EVERY actor (never automated)', () => {
  for (const a of Object.values(ACTORS)) {
    for (const e of HUMAN_ONLY_EFFECTS) {
      assert.equal(actorMayPerform(a, e), false, `${a} must never ${e}`);
    }
  }
  // B3 (decision-e8c0d364): ACCEPT_RESULT joins the human-only set alongside MERGE/CLOSE.
  assert.deepEqual(HUMAN_ONLY_EFFECTS, [EFFECTS.MERGE, EFFECTS.CLOSE, EFFECTS.ACCEPT_RESULT]);
});

test('assertActorMayPerform throws on out-of-role effect and on unknown actor', () => {
  assert.throws(() => assertActorMayPerform(ACTORS.BOT_FACT_WRITER, EFFECTS.PR_CREATE), /may not perform/);
  assert.throws(() => assertActorMayPerform(ACTORS.SUPERVISOR, EFFECTS.MERGE), /may not perform/);
  assert.throws(() => assertActorMayPerform('rogue', EFFECTS.READ), /unknown actor/);
  assert.equal(assertActorMayPerform(ACTORS.SUPERVISOR, EFFECTS.PR_CREATE), true);
});

test('supervisor may read/label/comment/webhook/pr but not code-write or authorize', () => {
  const a = ACTORS.SUPERVISOR;
  assert.equal(actorMayPerform(a, EFFECTS.FACT_WEBHOOK), true);
  assert.equal(actorMayPerform(a, EFFECTS.PR_CREATE), true);
  assert.equal(actorMayPerform(a, EFFECTS.CODE_WRITE), false);
  assert.equal(actorMayPerform(a, EFFECTS.AUTHORIZE), false);
});

test('PR comment source never authorizes; only issue source may (decision 4)', () => {
  assert.equal(sourceMayAuthorize(COMMENT_SOURCES.ISSUE), true);
  assert.equal(sourceMayAuthorize(COMMENT_SOURCES.PR), false);
});

test('isKnownActor / allowedEffects basics', () => {
  assert.equal(isKnownActor(ACTORS.HUMAN_AUTHORIZER), true);
  assert.equal(isKnownActor('nope'), false);
  assert.equal(allowedEffects('nope').length, 0);
  assert.ok(allowedEffects(ACTORS.HUMAN_AUTHORIZER).includes(EFFECTS.AUTHORIZE));
});

// --- B3 (decision-e8c0d364): pre-registered PM control-plane effects ---

test('B3: bot_executor may add evidence, propose acceptance, and update result status', () => {
  assert.equal(actorMayPerform(ACTORS.BOT_EXECUTOR, EFFECTS.EVIDENCE_ADD), true);
  assert.equal(actorMayPerform(ACTORS.BOT_EXECUTOR, EFFECTS.ACCEPTANCE_PROPOSE), true);
  assert.equal(actorMayPerform(ACTORS.BOT_EXECUTOR, EFFECTS.RESULT_STATUS_UPDATE), true);
  assert.doesNotThrow(() => assertActorMayPerform(ACTORS.BOT_EXECUTOR, EFFECTS.EVIDENCE_ADD));
});

test('B3: accept_result is human-only �� NO actor may perform it (like merge/close)', () => {
  assert.equal(HUMAN_ONLY_EFFECTS.includes(EFFECTS.ACCEPT_RESULT), true);
  for (const actor of Object.values(ACTORS)) {
    assert.equal(actorMayPerform(actor, EFFECTS.ACCEPT_RESULT), false, `${actor} must not accept a Result`);
    assert.throws(() => assertActorMayPerform(actor, EFFECTS.ACCEPT_RESULT), /may not perform effect/);
  }
});

test('B3: acceptance_propose is an agent proposal, never authorization', () => {
  // A proposal must not be confused with the human authorize effect.
  assert.notEqual(EFFECTS.ACCEPTANCE_PROPOSE, EFFECTS.AUTHORIZE);
  assert.equal(actorMayPerform(ACTORS.HUMAN_AUTHORIZER, EFFECTS.ACCEPTANCE_PROPOSE), false);
  // supervisor/fact-writer do not silently gain PM write effects.
  assert.equal(actorMayPerform(ACTORS.SUPERVISOR, EFFECTS.EVIDENCE_ADD), false);
  assert.equal(actorMayPerform(ACTORS.BOT_FACT_WRITER, EFFECTS.RESULT_STATUS_UPDATE), false);
});
