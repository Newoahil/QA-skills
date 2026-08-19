// Tests for tools/guardian/opencode-client.mjs — SDK wrapper for the shared OpenCode server.
// Locks the Oracle-designed seam: createSession (no-ask permission), prompt (agent+parts+format),
// abort, getSession, and error normalization (retryable vs unusable-session). Injected fake SDK,
// no real network.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpencodeClient } from '../../tools/guardian/opencode-client.mjs';

function fakeSdk() {
  const calls = { create: [], prompt: [], abort: [], get: [] };
  const sdk = {
    session: {
      create: async (params) => { calls.create.push(params); return { id: 'ses_new' }; },
      prompt: async (params) => { calls.prompt.push(params); return { text: '{"ok":true}' }; },
      abort: async (params) => { calls.abort.push(params); return {}; },
      get: async (params) => { calls.get.push(params); return { id: 'ses_existing', agent: 'qa-guardian' }; },
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
  assert.equal(call.path.sessionID, 'ses_1');
  assert.equal(call.body.agent, 'guardian-code');
  assert.deepEqual(call.body.parts, [{ type: 'text', text: 'investigate' }]);
  assert.equal(call.body.format.type, 'json_schema');
});

test('abort and getSession delegate to the SDK', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  await client.abort('ses_1');
  assert.equal(calls.abort[0].path.sessionID, 'ses_1');
  const session = await client.getSession('ses_existing');
  assert.equal(session.kind, 'ok');
  assert.equal(session.session.id, 'ses_existing');
  assert.equal(calls.get[0].path.sessionID, 'ses_existing');
});

test('normalizes a 404 session as unusable (recreate) vs a 5xx as retryable', async () => {
  const sdk = {
    session: {
      create: async () => ({ id: 'ses_new' }),
      prompt: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
      abort: async () => ({}),
      get: async () => { throw Object.assign(new Error('server error'), { status: 500 }); },
    },
  };
  const client = createOpencodeClient({ sdk });
  const promptResult = await client.prompt({ sessionId: 'ses_missing', agent: 'qa', parts: [] });
  assert.equal(promptResult.kind, 'unusable-session');
  const getResult = await client.getSession('ses_unknown');
  assert.equal(getResult.kind, 'retryable');
});
