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
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa', repo_dir: 'D:/repo', issue: 211, role: 'qa', permission_policy_version: 2 }, specialists: {}, inflight: null } };
  client.prompt = async (params) => { client.promptText = params.parts[0].text; return new Promise(() => {}); };
  let reads = 0;
  client.getMessages = async (id) => {
    calls.messages.push(id);
    reads += 1;
    if (reads === 1) return { kind: 'ok', messages: [] };
    if (reads === 2) {
      return {
        kind: 'ok',
        messages: [{ info: { id: 'msg_prompt', role: 'user', time: { created: Date.now() } }, parts: [{ type: 'text', text: client.promptText }] }],
      };
    }
    return {
      kind: 'ok',
      messages: [
        { info: { id: 'msg_prompt', role: 'user', time: { created: Date.now() } }, parts: [{ type: 'text', text: client.promptText }] },
        { info: { id: 'msg_final', role: 'assistant', parentID: 'msg_prompt', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] },
      ],
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

test('ignores a non-verdict prompt response and waits for the final verdict message', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa', repo_dir: 'D:/repo', issue: 211, role: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async (params) => { client.promptText = params.parts[0].text; return { kind: 'ok', result: { text: 'Checking the diff.' } }; };
  let reads = 0;
  client.getMessages = async (id) => {
    calls.messages.push(id);
    reads += 1;
    if (reads < 3) return { kind: 'ok', messages: [] };
    return {
      kind: 'ok',
      messages: [
        { info: { id: 'msg_prompt', role: 'user', time: { created: Date.now() } }, parts: [{ type: 'text', text: client.promptText }] },
        { info: { id: 'msg_final', role: 'assistant', parentID: 'msg_prompt', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] },
      ],
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
  assert.ok(calls.messages.length >= 3);
});

test('correlates the final verdict through assistant parentID', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async () => ({ kind: 'ok', result: { info: { id: 'msg_prompt', role: 'user' }, text: 'Checking the diff.' } });
  let reads = 0;
  client.getMessages = async () => {
    reads += 1;
    if (reads === 1) return { kind: 'ok', messages: [] };
    return { kind: 'ok', messages: [
      { info: { id: 'unrelated', role: 'assistant', parentID: 'other-prompt', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] },
      { info: { id: 'current', role: 'assistant', parentID: 'msg_prompt', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: FAIL' }] },
    ] };
  };
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 200, pollIntervalMs: 1 });
  assert.equal(result.verdict, 'FAIL');
});

test('ignores an unrelated PASS that arrives before the prompt response is correlated', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  let promptResolve;
  client.prompt = async () => new Promise((resolve) => { promptResolve = resolve; });
  let reads = 0;
  client.getMessages = async () => {
    reads += 1;
    if (reads === 1) return { kind: 'ok', messages: [] };
    if (reads === 2) return { kind: 'ok', messages: [{ info: { id: 'stale-pass', role: 'assistant', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] }] };
    return { kind: 'ok', messages: [{ info: { id: 'prompt-user', role: 'user', time: { created: Date.now() }, }, parts: [{ type: 'text', text: client.promptText }] }] };
  };
  client.prompt = async (params) => {
    client.promptText = params.parts[0].text;
    return new Promise((resolve) => { promptResolve = () => resolve({ kind: 'ok', result: { info: { id: 'prompt-user', role: 'user' }, text: 'accepted' } }); });
  };
  setTimeout(() => promptResolve(), 8);
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 80, pollIntervalMs: 1 });
  assert.notEqual(result.verdict, 'PASS');
});

test('discovers the current user message then accepts only its assistant child', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async (params) => ({ kind: 'ok', result: { info: { id: 'prompt-user', role: 'user' }, text: 'accepted' }, promptText: params.parts[0].text });
  let reads = 0;
  client.getMessages = async () => {
    reads += 1;
    if (reads === 1) return { kind: 'ok', messages: [] };
    if (reads === 2) return { kind: 'ok', messages: [{ info: { id: 'prompt-user', role: 'user', time: { created: Date.now() } }, parts: [{ type: 'text', text: client.promptText }] }] };
    return { kind: 'ok', messages: [
      { info: { id: 'wrong', role: 'assistant', parentID: 'other', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] },
      { info: { id: 'right', role: 'assistant', parentID: 'prompt-user', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: FAIL' }] },
    ] };
  };
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 200, pollIntervalMs: 1 });
  assert.equal(result.verdict, 'FAIL');
});

test('uses assistant parentID as the current user id for an intermediate response', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async () => ({ kind: 'ok', result: { info: { id: 'assistant-intermediate', role: 'assistant', parentID: 'prompt-user' }, text: 'Checking the diff.' } });
  client.getMessages = async () => ({ kind: 'ok', messages: [{ info: { id: 'final', role: 'assistant', parentID: 'prompt-user', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] }] });
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 100, pollIntervalMs: 1 });
  assert.equal(result.verdict, 'PASS');
});

test('fails closed when no trustworthy current prompt user id is available', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async () => ({ kind: 'ok', result: { info: { id: 'assistant-only', role: 'assistant' }, text: 'Checking the diff.' } });
  client.getMessages = async () => ({ kind: 'ok', messages: [{ info: { id: 'stale', role: 'assistant', parentID: 'other', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] }] });
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 30, pollIntervalMs: 1 });
  assert.notEqual(result.verdict, 'PASS');
  assert.ok(['aborted', 'unverified'].includes(result.status));
});

test('fails closed when getMessages is unavailable for baseline correlation', async () => {
  const { client } = fakeClient();
  delete client.getMessages;
  const result = await runQaSession({ client, state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } }, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 50, pollIntervalMs: 1 });
  assert.notEqual(result.verdict, 'PASS');
  assert.ok(['retry', 'aborted', 'unverified'].includes(result.status));
});

test('ignores an unrelated newer PASS message', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async () => ({ kind: 'ok', result: { info: { id: 'msg_prompt', role: 'user' }, text: 'Checking the diff.' } });
  client.getMessages = async () => ({ kind: 'ok', messages: [
    { info: { id: 'newer', role: 'assistant', parentID: 'other-prompt', time: { created: Date.now(), completed: Date.now() + 1 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] },
  ] });
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 20, pollIntervalMs: 1 });
  assert.notEqual(result.verdict, 'PASS');
  assert.ok(['aborted', 'unverified'].includes(result.status));
});

test('ignores a delayed verdict from an older operation when prompt id is unavailable', async () => {
  const { client } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa' }, specialists: {}, inflight: null } };
  client.prompt = async () => ({ kind: 'ok', result: { text: 'Checking the diff.' } });
  client.getMessages = async () => ({ kind: 'ok', messages: [
    { info: { id: 'old', role: 'assistant', time: { created: 1, completed: 2 } }, parts: [{ type: 'text', text: 'Overall Status: PASS' }] },
  ] });
  const result = await runQaSession({ client, state, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 20, pollIntervalMs: 1 });
  assert.notEqual(result.verdict, 'PASS');
});

test('baseline failure is unverified and never treated as an empty baseline', async () => {
  const { client, calls } = fakeClient();
  client.getMessages = async () => { calls.messages.push('baseline'); return { kind: 'retryable', error: new Error('serve unavailable') }; };
  const result = await runQaSession({ client, state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } }, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 100, pollIntervalMs: 1 });
  assert.equal(result.status, 'retry');
  assert.equal(calls.prompt.length, 0);
});

test('malformed, retryable, and unusable prompt results fail closed', async () => {
  for (const promptResult of [null, {}, { kind: 'retryable' }, { kind: 'unusable-session' }]) {
    const { client } = fakeClient();
    client.prompt = async () => promptResult;
    const result = await runQaSession({ client, state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } }, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 50, pollIntervalMs: 1 });
    assert.notEqual(result.verdict, 'PASS');
    assert.ok(['retry', 'unusable-session', 'aborted', 'unverified'].includes(result.status));
  }
});

test('polling is bounded by the deadline and does not scan without limit', async () => {
  const { client, calls } = fakeClient();
  client.prompt = async () => ({ kind: 'ok', result: { text: 'Checking the diff.' } });
  client.getMessages = async () => { calls.messages.push('poll'); return { kind: 'ok', messages: [] }; };
  const result = await runQaSession({ client, state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } }, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 25, pollIntervalMs: 2 });
  assert.ok(calls.messages.length < 30);
  assert.notEqual(result.verdict, 'PASS');
});

test('timeout cleanup catches abort failures without changing aborted result', async () => {
  const { client } = fakeClient();
  client.prompt = async () => new Promise(() => {});
  client.abort = async () => { throw new Error('abort failed: secret-token'); };
  const result = await runQaSession({ client, state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } }, issue: 211, repoDir: 'D:/repo', branch: 'fix/issue-211', diffSummary: 'x', intendedBehavior: 'y', deadlineMs: 10, pollIntervalMs: 1 });
  assert.equal(result.status, 'aborted');
  assert.match(result.error.message, /timed out/);
  assert.match(result.abortError.message, /abort failed/);
});

test('reuses an existing valid qa session across verification attempts', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: { session_id: 'ses_qa', agent: 'qa', repo_dir: 'D:/repo', issue: 211, role: 'qa', permission_policy_version: 2 }, specialists: {}, inflight: null } };
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
  assert.equal(result.state.opencode.qa.permission_policy_version, 2);
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
