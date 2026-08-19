// Tests for tools/guardian/session-resolver.mjs — pure create-vs-reuse decision per role.
// Locks the Oracle session-continuity rules: fixer/qa sessions reused across gates/rework/followup,
// per-round specialist sessions, 404->recreate+context_loss, 5xx->retryable, role/agent never swapped.

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSessionForRole, ROLE_AGENTS } from '../../tools/guardian/session-resolver.mjs';

test('ROLE_AGENTS maps fixer->qa-guardian and qa->qa (never swapped)', () => {
  assert.equal(ROLE_AGENTS.fixer, 'qa-guardian');
  assert.equal(ROLE_AGENTS.qa, 'qa');
});

test('no persisted session -> create', async () => {
  const decision = await resolveSessionForRole({ role: 'fixer', opencode: { fixer: null } });
  assert.equal(decision.action, 'create');
  assert.equal(decision.agent, 'qa-guardian');
});

test('valid persisted session -> reuse (not recreate)', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer',
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' } },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian' } }),
  });
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.sessionId, 'ses_fixer');
});

test('persisted session 404 -> recreate with context_loss', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer',
    opencode: { fixer: { session_id: 'ses_gone', agent: 'qa-guardian' } },
    getSession: async () => ({ kind: 'unusable-session' }),
  });
  assert.equal(decision.action, 'create');
  assert.equal(decision.contextLoss, true);
});

test('persisted session 5xx -> retryable (do not recreate yet)', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer',
    opencode: { fixer: { session_id: 'ses_x', agent: 'qa-guardian' } },
    getSession: async () => ({ kind: 'retryable' }),
  });
  assert.equal(decision.action, 'retry');
  assert.equal(decision.sessionId, 'ses_x');
});

test('persisted session with wrong agent -> unusable, recreate', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer',
    opencode: { fixer: { session_id: 'ses_wrong', agent: 'qa-guardian' } },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_wrong', agent: 'qa' } }),
  });
  assert.equal(decision.action, 'create');
  assert.equal(decision.contextLoss, true);
});

test('specialist sessions are per-round (reuse only within same round)', async () => {
  const decision = await resolveSessionForRole({
    role: 'guardian-code',
    opencode: { specialists: { 'guardian-code': { session_id: 'ses_spec', agent: 'guardian-code', round: 1 } } },
    round: 1,
  });
  assert.equal(decision.action, 'reuse');
  const nextRound = await resolveSessionForRole({
    role: 'guardian-code',
    opencode: { specialists: { 'guardian-code': { session_id: 'ses_spec', agent: 'guardian-code', round: 1 } } },
    round: 2,
  });
  assert.equal(nextRound.action, 'create');
});
