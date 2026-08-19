// Tests for tools/guardian/session-resolver.mjs — pure create-vs-reuse decision per role.
// Locks the Oracle session-continuity rules: fixer/qa sessions reused across gates/rework/followup,
// per-round specialist sessions, 404->recreate+context_loss, 5xx->retryable, role/agent never swapped.

import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalRepoDir, resolveSessionForRole, ROLE_AGENTS } from '../../tools/guardian/session-resolver.mjs';
import { PERMISSION_POLICY_VERSION, permissionRulesFor } from '../../tools/guardian/opencode-client.mjs';

const binding = { repoDir: 'D:/Repo', issue: 211, role: 'fixer' };
const liveFixer = { kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian', directory: 'd:/repo', permission: permissionRulesFor('qa-guardian') } };

test('ROLE_AGENTS maps fixer->qa-guardian and qa->qa (never swapped)', () => {
  assert.equal(ROLE_AGENTS.fixer, 'qa-guardian');
  assert.equal(ROLE_AGENTS.qa, 'qa');
});

test('canonicalRepoDir treats Windows drive paths case-insensitively', () => {
  assert.equal(canonicalRepoDir('C:\\Repo\\'), canonicalRepoDir('c:/repo'));
});

test('canonicalRepoDir preserves case for POSIX paths', () => {
  assert.notEqual(canonicalRepoDir('/srv/Repo/'), canonicalRepoDir('/srv/repo'));
});

test('POSIX binding case differences do not reuse a session', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer', repoDir: '/srv/repo', issue: 211,
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', repo_dir: '/srv/Repo', issue: 211, role: 'fixer' } },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian', directory: '/srv/Repo' } }),
  });
  assert.equal(decision.action, 'create');
  assert.equal(decision.contextLoss, true);
});

test('no persisted session -> create', async () => {
  const decision = await resolveSessionForRole({ role: 'fixer', opencode: { fixer: null } });
  assert.equal(decision.action, 'create');
  assert.equal(decision.agent, 'qa-guardian');
});

test('valid persisted session -> reuse (not recreate)', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer',
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', permission_policy_version: PERMISSION_POLICY_VERSION } },
    ...binding,
    getSession: async () => liveFixer,
  });
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.sessionId, 'ses_fixer');
});

test('current permission policy version reuses same-issue session continuity', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer', repoDir: 'D:/repo', issue: 211, round: 2,
    expectedPermissionPolicyVersion: PERMISSION_POLICY_VERSION,
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', repo_dir: 'D:/repo', issue: 211, role: 'fixer', permission_policy_version: PERMISSION_POLICY_VERSION } },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian', directory: 'D:/repo' } }),
  });
  assert.equal(decision.action, 'reuse');
});

test('explicit old permission policy version recreates with context_loss', async () => {
  let lookedUp = false;
  const decision = await resolveSessionForRole({
    role: 'fixer', repoDir: 'D:/repo', issue: 211,
    expectedPermissionPolicyVersion: PERMISSION_POLICY_VERSION,
    opencode: { fixer: { session_id: 'ses_old', agent: 'qa-guardian', repo_dir: 'D:/repo', issue: 211, role: 'fixer', permission_policy_version: PERMISSION_POLICY_VERSION - 1 } },
    getSession: async () => { lookedUp = true; return { kind: 'ok', session: { agent: 'qa-guardian', directory: 'D:/repo' } }; },
  });
  assert.equal(decision.action, 'create');
  assert.equal(decision.contextLoss, true);
  assert.equal(lookedUp, false);
});

test('unversioned legacy session with broad allow or bash allow recreates', async () => {
  for (const permission of [
    [{ permission: '*', action: 'allow', pattern: '*' }],
    [{ permission: 'bash', action: 'allow', pattern: '*' }],
  ]) {
    const decision = await resolveSessionForRole({
      role: 'fixer', repoDir: 'D:/repo', issue: 211,
      expectedPermissionPolicyVersion: PERMISSION_POLICY_VERSION,
      opencode: { fixer: { session_id: 'ses_legacy', agent: 'qa-guardian', repo_dir: 'D:/repo', issue: 211, role: 'fixer' } },
      getSession: async () => ({ kind: 'ok', session: { agent: 'qa-guardian', directory: 'D:/repo', permission } }),
    });
    assert.equal(decision.action, 'create');
    assert.equal(decision.contextLoss, true);
  }
});

test('unversioned legacy session with compatible live permission adopts', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer', repoDir: 'D:/repo', issue: 211,
    expectedPermissionPolicyVersion: PERMISSION_POLICY_VERSION,
    opencode: { fixer: { session_id: 'ses_legacy', agent: 'qa-guardian', repo_dir: 'D:/repo', issue: 211, role: 'fixer' } },
    getSession: async () => ({ kind: 'ok', session: { agent: 'qa-guardian', directory: 'D:/repo', permission: permissionRulesFor('qa-guardian') } }),
  });
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.adopted, true);
  assert.equal(decision.permissionPolicyVersion, PERMISSION_POLICY_VERSION);
});

test('unversioned legacy session with missing live permission recreates', async () => {
  const decision = await resolveSessionForRole({
    role: 'qa', repoDir: 'D:/repo', issue: 211,
    expectedPermissionPolicyVersion: PERMISSION_POLICY_VERSION,
    opencode: { qa: { session_id: 'ses_legacy', agent: 'qa', repo_dir: 'D:/repo', issue: 211, role: 'qa' } },
    getSession: async () => ({ kind: 'ok', session: { agent: 'qa', directory: 'D:/repo' } }),
  });
  assert.equal(decision.action, 'create');
  assert.equal(decision.contextLoss, true);
});

test('same canonical repo, issue, and role reuses a bound session across rounds', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer', repoDir: 'D:/repo', issue: 211, round: 3,
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', repo_dir: 'd:\\REPO', issue: 211, role: 'fixer', permission_policy_version: PERMISSION_POLICY_VERSION, created_round: 1, last_used_round: 2 } },
    getSession: async () => liveFixer,
  });
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.adopted, false);
});

for (const [name, recordPatch] of [
  ['repo mismatch', { repo_dir: 'D:/other' }],
  ['issue mismatch', { issue: 212 }],
  ['role mismatch', { role: 'qa' }],
]) {
  test(`bound session ${name} creates with context_loss`, async () => {
    const decision = await resolveSessionForRole({
      role: 'fixer', repoDir: 'D:/repo', issue: 211,
      opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', repo_dir: 'D:/repo', issue: 211, role: 'fixer', created_round: 1, last_used_round: 1, ...recordPatch } },
      getSession: async () => liveFixer,
    });
    assert.equal(decision.action, 'create');
    assert.equal(decision.contextLoss, true);
  });
}

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
    opencode: { specialists: { 'guardian-code': { session_id: 'ses_spec', agent: 'guardian-code', permission_policy_version: PERMISSION_POLICY_VERSION, round: 1 } } },
    round: 1,
    repoDir: 'D:/repo', issue: 211,
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_spec', agent: 'guardian-code', directory: 'D:/repo' } }),
  });
  assert.equal(decision.action, 'reuse');
  const nextRound = await resolveSessionForRole({
    role: 'guardian-code',
    opencode: { specialists: { 'guardian-code': { session_id: 'ses_spec', agent: 'guardian-code', permission_policy_version: PERMISSION_POLICY_VERSION, round: 1 } } },
    round: 2,
    repoDir: 'D:/repo', issue: 211,
  });
  assert.equal(nextRound.action, 'create');
});

test('legacy unbound session is adopted only after live directory and agent match', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer', ...binding,
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' } },
    getSession: async () => liveFixer,
  });
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.adopted, true);
  assert.deepEqual(decision.binding, { repo_dir: 'd:/repo', issue: 211, role: 'fixer' });
});

test('legacy session with a mismatched live directory is not adopted', async () => {
  const decision = await resolveSessionForRole({
    role: 'fixer', ...binding,
    opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' } },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian', directory: 'D:/other' } }),
  });
  assert.equal(decision.action, 'create');
  assert.equal(decision.contextLoss, true);
});
