// Tests for tools/guardian/opencode-client.mjs — SDK wrapper for the shared OpenCode server.
// Locks the Oracle-designed seam: createSession (no-ask permission), prompt (agent+parts+format),
// abort, getSession, and error normalization (retryable vs unusable-session). Injected fake SDK,
// no real network.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpencodeClient } from '../../tools/guardian/opencode-client.mjs';

function fakeSdk() {
  const calls = { create: [], prompt: [], abort: [], get: [], messages: [] };
  const sdk = {
    _client: {
      post: async (params) => {
        if (params.url.endsWith('/message')) {
          calls.prompt.push(params);
          return { data: { info: { structured: { ok: true } }, parts: [{ type: 'text', text: 'fallback' }] } };
        }
        calls.abort.push(params);
        return { data: true };
      },
      get: async (params) => {
        calls.get.push(params);
        if (params.url.endsWith('/message')) {
          calls.messages.push(params);
          return { data: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'done' }] }] };
        }
        return { data: { id: 'ses_existing', agent: 'qa-guardian' } };
      },
    },
    session: {
      create: async (params) => { calls.create.push(params); return { id: 'ses_new' }; },
    },
  };
  return { sdk, calls };
}

test('createSession passes no-ask permission and returns the session id', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  const id = await client.createSession({ title: 'fixer', agent: 'qa-guardian' });
  assert.equal(id, 'ses_new');
  assert.equal(calls.create.length, 1);
  const body = calls.create[0].body;
  assert.equal(body.title, 'fixer');
  assert.equal(body.agent, 'qa-guardian');
  // no-ask: every permission rule must be allow/deny, never ask (headless hang guard).
  assert.ok(Array.isArray(body.permission));
  assert.equal(body.permission.some((p) => p.action === 'ask'), false);
});

test('fixer session permissions allow edits but deny irreversible and install actions', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  await client.createSession({ title: 'fixer', agent: 'qa-guardian', directory: 'D:/repo' });
  const rules = calls.create[0].body.permission;
  assert.equal(rules.some((r) => r.permission === 'apply_patch' && r.action === 'allow'), true);
  assert.equal(rules.some((r) => r.permission === 'bash' && r.pattern === 'gh pr merge*' && r.action === 'deny'), true);
  assert.equal(rules.some((r) => r.permission === 'bash' && r.pattern === 'npm install*' && r.action === 'deny'), true);
  assert.equal(rules.some((r) => r.permission === 'task' && r.pattern === '*' && r.action === 'deny'), true);
});

test('qa and specialist session permissions are read-only and never ask', async () => {
  for (const agent of ['qa', 'guardian-code']) {
    const { sdk, calls } = fakeSdk();
    const client = createOpencodeClient({ sdk });
    await client.createSession({ title: agent, agent, directory: 'D:/repo' });
    const rules = calls.create[0].body.permission;
    assert.equal(rules.some((r) => r.action === 'ask'), false);
    assert.equal(rules.some((r) => r.permission === 'edit' && r.action === 'deny'), true);
    assert.equal(rules.some((r) => r.permission === 'apply_patch' && r.action === 'deny'), true);
  }
});

test('createSession passes the target directory so agents work in the right repo', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  await client.createSession({ title: 'specialist', agent: 'guardian-code', directory: 'D:/tuantuanrent' });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].query.directory, 'D:/tuantuanrent');
});

test('prompt passes agent, parts, and json_schema format to the session', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  await client.prompt({
    sessionId: 'ses_1',
    agent: 'guardian-code',
    parts: [{ type: 'text', text: 'investigate' }],
    format: { type: 'json_schema', schema: { type: 'object', properties: { specialist: { type: 'string' } } } },
  });
  assert.equal(calls.prompt.length, 1);
  const call = calls.prompt[0];
  assert.equal(call.url, '/session/ses_1/message');
  assert.equal(call.body.agent, 'guardian-code');
  assert.deepEqual(call.body.parts, [{ type: 'text', text: 'investigate' }]);
  assert.equal(call.body.format.type, 'json_schema');
  const result = await client.prompt({
    sessionId: 'ses_1',
    agent: 'guardian-code',
    parts: [{ type: 'text', text: 'investigate' }],
    format: { type: 'json_schema', schema: { type: 'object' } },
  });
  assert.deepEqual(result.result.structured, { ok: true });
});

test('abort and getSession delegate to the SDK', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  await client.abort('ses_1');
  assert.equal(calls.abort[0].url, '/session/ses_1/abort');
  const session = await client.getSession('ses_existing');
  assert.equal(session.kind, 'ok');
  assert.equal(session.session.id, 'ses_existing');
  assert.equal(calls.get[0].url, '/session/ses_existing');
});

test('getMessages reads session messages through the explicit SDK URL', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  const result = await client.getMessages('ses_existing');
  assert.equal(result.kind, 'ok');
  assert.equal(result.messages[0].parts[0].text, 'done');
  assert.equal(calls.messages[0].url, '/session/ses_existing/message');
});

test('normalizes a 404 session as unusable (recreate) vs a 5xx as retryable', async () => {
  const sdk = {
    _client: {
      post: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
      get: async () => { throw Object.assign(new Error('server error'), { status: 500 }); },
    },
    session: { create: async () => ({ id: 'ses_new' }) },
  };
  const client = createOpencodeClient({ sdk });
  const promptResult = await client.prompt({ sessionId: 'ses_missing', agent: 'qa', parts: [] });
  assert.equal(promptResult.kind, 'unusable-session');
  const getResult = await client.getSession('ses_unknown');
  assert.equal(getResult.kind, 'retryable');
});
