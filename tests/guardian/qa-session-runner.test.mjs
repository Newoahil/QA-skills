// Tests for tools/guardian/qa-session-runner.mjs — independent QA SDK session runner (方案 A).
// Locks: create-or-reuse qa session, prompt with fix diff + intended behavior, collect
// qa-verdict.json, persist session id in state.opencode.qa, deadline + abort (never kill serve).

import assert from 'node:assert/strict';
import test from 'node:test';

import { runQaSession } from '../../tools/guardian/qa-session-runner.mjs';

function fakeClient() {
  const calls = { create: [], prompt: [], abort: [], messages: [] };
  const client = {
    createSession: async ({ title, agent }) => { calls.create.push({ title, agent }); return 'ses_qa'; },
    prompt: async (params) => { calls.prompt.push(params); return { kind: 'ok', result: { text: 'Overall Status: PASS' } }; },
    abort: async (id) => { calls.abort.push(id); },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_qa', agent: 'qa' } }),
    getMessages: async (id) => { calls.messages.push(id); return { kind: 'ok', messages: [] }; },
  };
  return { client, calls };
}

test('creates a qa session on first verification and persists its id', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  const result = await runQaSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    branch: 'fix/issue-211',
    diffSummary: 'changed color to pink',
    intendedBehavior: 'bad debt amount shows pink',
    round: 1,
  });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].agent, 'qa');
  assert.equal(result.sessionId, 'ses_qa');
  assert.equal(result.state.opencode.qa.session_id, 'ses_qa');
  assert.equal(result.state.opencode.qa.agent, 'qa');
});

test('recovers a completed QA result from messages when the prompt HTTP request hangs', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async () => new Promise(() => {});
  let reads = 0;
  client.getMessages = async (id) => {
    calls.messages.push(id);
    reads += 1;
    if (reads === 1) return { kind: 'ok', messages: [] };
    return {
      kind: 'ok',
      messages: [{
        info: { role: 'assistant', time: { created: 200, completed: 220 } },
        parts: [{ type: 'text', text: 'Overall Status: PASS' }],
      }],
    };
  };
  const result = await runQaSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    branch: 'fix/issue-211',
    diffSummary: 'changed color to pink',
    intendedBehavior: 'bad debt amount shows pink',
    round: 1,
    deadlineMs: 500,
    pollIntervalMs: 5,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.verdict, 'PASS');
  assert.equal(calls.abort.length, 0);
  assert.ok(calls.messages.length >= 2);
});

test('reuses an existing valid qa session across verification attempts', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  const result = await runQaSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    branch: 'fix/issue-211',
    diffSummary: 'changed color to pink',
    intendedBehavior: 'bad debt amount shows pink',
    round: 1,
  });
  assert.equal(calls.create.length, 0, 'must not recreate a valid qa session');
  assert.equal(result.sessionId, 'ses_qa');
});

test('collects the QA verdict from the prompt result', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  const result = await runQaSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    branch: 'fix/issue-211',
    diffSummary: 'changed color to pink',
    intendedBehavior: 'bad debt amount shows pink',
    round: 1,
  });
  assert.equal(result.verdict, 'PASS');
});

test('aborts the qa session on deadline instead of killing the serve', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  client.prompt = async () => new Promise(() => {});
  const result = await runQaSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    branch: 'fix/issue-211',
    diffSummary: 'changed color to pink',
    intendedBehavior: 'bad debt amount shows pink',
    round: 1,
    deadlineMs: 50,
  });
  assert.equal(result.status, 'aborted');
  assert.equal(calls.abort.length, 1);
  assert.equal(calls.abort[0], 'ses_qa');
});
