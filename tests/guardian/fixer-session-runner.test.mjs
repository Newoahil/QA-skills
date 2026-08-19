// Tests for tools/guardian/fixer-session-runner.mjs — fixer SDK session runner (方案 A).
// Locks: create-or-reuse fixer session, prompt with dossier/plan + human note as untrusted data,
// persist session id in state.opencode.fixer, deadline + abort (never kill serve).

import assert from 'node:assert/strict';
import test from 'node:test';

import { runFixerSession } from '../../tools/guardian/fixer-session-runner.mjs';

function fakeClient() {
  const calls = { create: [], prompt: [], abort: [] };
  const client = {
    createSession: async ({ title, agent }) => { calls.create.push({ title, agent }); return 'ses_fixer'; },
    prompt: async (params) => { calls.prompt.push(params); return { kind: 'ok', result: { text: 'fix applied' } }; },
    abort: async (id) => { calls.abort.push(id); },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian' } }),
  };
  return { client, calls };
}

test('creates a fixer session on first use and persists its id', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  const result = await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: null,
    round: 1,
  });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].agent, 'qa-guardian');
  assert.equal(result.sessionId, 'ses_fixer');
  assert.equal(result.state.opencode.fixer.session_id, 'ses_fixer');
  assert.equal(result.state.opencode.fixer.agent, 'qa-guardian');
});

test('reuses an existing valid fixer session (no recreate)', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' }, qa: null, specialists: {}, inflight: null } };
  const result = await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: null,
    round: 1,
  });
  assert.equal(calls.create.length, 0, 'must not recreate a valid session');
  assert.equal(result.sessionId, 'ses_fixer');
});

test('passes dossier/plan paths and human note as untrusted data in the prompt', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: { command_kind: 'rework', command_comment_id: 'c9', trusted_author_id: 'goudaren0528', round: 2, human_note: 'please also fix the color' },
    round: 2,
  });
  const prompt = calls.prompt[0];
  assert.equal(prompt.agent, 'qa-guardian');
  const text = prompt.parts[0].text;
  assert.equal(text.includes('dossier.json'), true);
  assert.equal(text.includes('plan.json'), true);
  // Human note is untrusted data, clearly delimited, never in system/agent/permission.
  assert.equal(text.includes('HUMAN_NOTE'), true);
  assert.equal(text.includes('please also fix the color'), true);
  assert.equal(prompt.system, undefined, 'human note must never be injected into system');
  assert.equal(text.includes('commit and push'), true);
  assert.equal(text.includes('Do not create a PR'), true);
});

test('aborts the session on deadline instead of killing the serve', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  // Simulate a prompt that never resolves until the deadline.
  client.prompt = async () => new Promise(() => {});
  const result = await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: null,
    round: 1,
    deadlineMs: 50,
  });
  assert.equal(result.status, 'aborted');
  assert.equal(calls.abort.length, 1);
  assert.equal(calls.abort[0], 'ses_fixer');
});
