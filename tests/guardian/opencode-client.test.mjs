// Tests for tools/guardian/opencode-client.mjs — SDK wrapper for the shared OpenCode server.
// Locks the Oracle-designed seam: createSession (no-ask permission), prompt (agent+parts+format),
// abort, getSession, and error normalization (retryable vs unusable-session). Injected fake SDK,
// no real network.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { createOpencodeClient, createLongLivedSdkConfig, isPermissionCompatible, PERMISSION_POLICY_VERSION, permissionRulesFor } from '../../tools/guardian/opencode-client.mjs';

test('prompt sends model as an object providerID/modelID, not a raw string', async () => {
  let sentBody = null;
  const sdk = {
    _client: { post: async (params) => { sentBody = params.body; return { data: { parts: [{ type: 'text', text: 'OK' }] } }; } },
    session: { create: async () => ({ id: 'ses_m' }) },
  };
  const client = createOpencodeClient({ sdk });
  const r = await client.prompt({ sessionId: 'ses_m', agent: 'guardian-code', parts: [], model: 'cpa/gpt-5.5' });
  assert.equal(r.kind, 'ok');
  // OpenCode POST /session/:id/message expects model: { providerID, modelID } — a raw string is silently ignored.
  assert.deepEqual(sentBody.model, { providerID: 'cpa', modelID: 'gpt-5.5' });
});

test('prompt splits only the first slash so model ids with slashes survive', async () => {
  let sentBody = null;
  const sdk = {
    _client: { post: async (params) => { sentBody = params.body; return { data: { parts: [{ type: 'text', text: 'OK' }] } }; } },
    session: { create: async () => ({ id: 'ses_m2' }) },
  };
  const client = createOpencodeClient({ sdk });
  await client.prompt({ sessionId: 'ses_m2', agent: 'guardian-code', parts: [], model: 'openrouter/anthropic/claude' });
  assert.deepEqual(sentBody.model, { providerID: 'openrouter', modelID: 'anthropic/claude' });
});

test('createLongLivedSdkConfig disables undici header/body timeouts for long prompts', () => {
  const config = createLongLivedSdkConfig({ baseUrl: 'http://127.0.0.1:4096' });
  assert.equal(config.baseUrl, 'http://127.0.0.1:4096');
  assert.equal(typeof config.fetch, 'function');
  // The dispatcher must be an undici Agent configured with no header/body timeout so a
  // multi-minute specialist prompt is not aborted with `fetch failed` at ~300s.
  assert.ok(config.dispatcher, 'a dispatcher must be provided');
  const opts = config.dispatcher[Symbol.for('undici.dispatcher.options')] ?? config.dispatcherOptions;
  assert.ok(opts, 'dispatcher options should be inspectable for the test');
  assert.equal(opts.headersTimeout, 0);
  assert.equal(opts.bodyTimeout, 0);
});

test('createOpencodeClient passes the long-lived fetch config to the SDK factory', () => {
  let received = null;
  createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096', sdkFactory: (cfg) => { received = cfg; return { _client: {}, session: {} }; } });
  assert.ok(received, 'sdk factory should be called when no sdk is injected');
  assert.equal(typeof received.fetch, 'function');
  assert.equal(received.baseUrl, 'http://127.0.0.1:4096');
});

test('createOpencodeClient exposes dispatcher close for long-lived fetch cleanup', async () => {
  let closed = 0;
  let received = null;
  const dispatcher = { close: async () => { closed += 1; } };
  const client = createOpencodeClient({
    baseUrl: 'http://127.0.0.1:4096',
    sdkFactory: (cfg) => {
      received = cfg;
      return { _client: {}, session: {} };
    },
    sdkConfigFactory: ({ baseUrl }) => ({ baseUrl, fetch: async () => new Response('{}'), dispatcher, dispatcherOptions: {} }),
  });

  assert.equal(typeof client.close, 'function');
  assert.equal(received.dispatcher, undefined, 'dispatcher internals must not leak into SDK config');
  await client.close();
  assert.equal(closed, 1);
});

test('scheduler closes shared OpenCode client at the end of each tick', () => {
  const source = readFileSync(new URL('../../tools/guardian/scheduler.mjs', import.meta.url), 'utf8');
  assert.match(source, /const opencodeClient = serverUrl \? createOpencodeClient/);
  assert.match(source, /finally \{\s*await opencodeClient\?\.close\?\.\(\);\s*\}/s);
});

test('prompt uses raw fetch with baseUrl and omits format to avoid OpenCode schema mutation', async () => {
  const requests = [];
  const sdk = {
    _client: { post: async () => { throw new Error('SDK post must not handle prompt messages when baseUrl is set'); } },
    session: { create: async () => ({ id: 'ses_raw' }) },
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    return new Response(JSON.stringify({ info: { structured: { ok: true } }, parts: [{ type: 'text', text: 'fallback' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096/', sdk, fetchImpl });
  const result = await client.prompt({
    sessionId: 'ses_raw',
    agent: 'guardian-code',
    parts: [{ type: 'text', text: 'investigate' }],
    format: { type: 'json_schema', schema: { type: 'object' } },
    model: 'cpa/gpt-5.5',
  });

  assert.equal(result.kind, 'ok');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:4096/session/ses_raw/message');
  assert.equal(requests[0].body.format, undefined);
  assert.deepEqual(requests[0].body.model, { providerID: 'cpa', modelID: 'gpt-5.5' });
  assert.deepEqual(result.result.structured, { ok: true });
});

test('exports the stable current permission policy version and compatibility helper', () => {
  assert.equal(PERMISSION_POLICY_VERSION, 2);
  assert.equal(isPermissionCompatible('fixer', permissionRulesFor('qa-guardian')), true);
  assert.equal(isPermissionCompatible('qa', permissionRulesFor('qa')), true);
  assert.equal(isPermissionCompatible('guardian-code', permissionRulesFor('guardian-code')), true);
  assert.equal(isPermissionCompatible('fixer', [{ permission: '*', action: 'allow', pattern: '*' }]), false);
  assert.equal(isPermissionCompatible('qa', [{ permission: 'bash', action: 'allow', pattern: '*' }]), false);
});

function fakeSdk() {
  const calls = { create: [], prompt: [], abort: [], get: [], messages: [] };
  const sdk = {
    _client: {
      post: async (params) => {
        if (params.url.endsWith('/message')) {
          calls.prompt.push(params);
          return { data: { info: { structured_output: { ok: true } }, parts: [{ type: 'text', text: 'fallback' }] } };
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
        if (params.url === '/agent') {
          return { data: { 'guardian-code': { name: 'guardian-code' }, 'guardian-runtime': { name: 'guardian-runtime' } } };
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
  assert.equal(rules.some((r) => r.permission === '*' && r.action === 'allow'), false);
  assert.equal(rules.some((r) => r.permission === 'bash' && r.action === 'allow'), false);
  for (const permission of ['read', 'grep', 'glob', 'codegraph']) {
    assert.equal(rules.some((r) => r.permission === permission && r.action === 'allow'), true);
  }
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
    assert.equal(rules.some((r) => r.permission === '*' && r.action === 'allow'), false);
    assert.equal(rules.some((r) => r.permission === 'bash' && r.action === 'allow'), false);
    for (const permission of ['read', 'grep', 'glob', 'codegraph']) {
      assert.equal(rules.some((r) => r.permission === permission && r.action === 'allow'), true);
    }
  }
});

test('specialist permissions have no broad allow and no bash permission', async () => {
  for (const agent of ['guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-docs']) {
    const { sdk, calls } = fakeSdk();
    const client = createOpencodeClient({ sdk });
    await client.createSession({ title: agent, agent, directory: 'D:/repo' });
    const rules = calls.create[0].body.permission;
    assert.equal(rules.some((r) => r.permission === '*' && r.action === 'allow'), false);
    assert.equal(rules.some((r) => r.permission === 'bash'), false);
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
  assert.deepEqual(result.result.prompt_response, {
    parts_count: 1,
    text_bytes: 8,
    has_structured: false,
    has_structured_output: true,
  });
});

test('prompt retries once without format when structured output contract is unavailable', async () => {
  const bodies = [];
  const events = [];
  const sdk = {
    _client: {
      post: async (params) => {
        bodies.push(params.body);
        if (bodies.length === 1) {
          return { data: { info: { error: { name: 'ProviderError', data: { message: 'Model did not produce structured output' } } }, parts: [] } };
        }
        return { data: { parts: [{ type: 'text', text: '{"ok":true}' }] } };
      },
    },
    session: { create: async () => ({ id: 'ses_json' }) },
  };
  const logger = { info: () => {}, warn: (event, fields) => events.push({ event, fields }), error: () => {} };
  const client = createOpencodeClient({ sdk, logger });
  const result = await client.prompt({
    sessionId: 'ses_json',
    agent: 'guardian-code',
    parts: [{ type: 'text', text: 'json' }],
    format: { type: 'json_schema', schema: { type: 'object' } },
    model: 'cpa/gpt-5.5',
    fallbackModels: ['cpa/gpt-5.6-sol'],
  });

  assert.equal(result.kind, 'ok');
  assert.equal(result.result.text, '{"ok":true}');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].format.type, 'json_schema');
  assert.equal(bodies[1].format, undefined);
  assert.deepEqual(bodies.map((b) => b.model), [
    { providerID: 'cpa', modelID: 'gpt-5.5' },
    { providerID: 'cpa', modelID: 'gpt-5.5' },
  ]);
  assert.equal(events.some((e) => e.event === 'prompt.format_fallback'), true);
  assert.equal(result.result.prompt_response.format_fallback, true);
  assert.match(result.result.prompt_response.format_fallback_reason, /structured output/i);
});

test('prompt treats OpenCode info.error responses as provider failures', async () => {
  const sdk = {
    _client: {
      post: async () => ({
        data: {
          info: {
            error: {
              name: 'APIError',
              data: {
                message: 'All credentials for model gpt-5.3-codex-spark are cooling down via provider codex',
                statusCode: 429,
                responseBody: '{"error":{"code":"model_cooldown","reset_time":"3h44m55s"},"secret":"must-not-leak"}',
              },
            },
          },
          parts: [],
        },
      }),
    },
    session: { create: async () => ({ id: 'ses_new' }) },
  };
  const client = createOpencodeClient({ sdk });
  const result = await client.prompt({ sessionId: 'ses_cooldown', agent: 'guardian-runtime', parts: [] });
  assert.equal(result.kind, 'provider-error');
  assert.equal(result.error.name, 'APIError');
  assert.equal(result.error.statusCode, 429);
  assert.equal(result.error.code, 'model_cooldown');
  assert.equal(result.error.reset_time, '3h44m55s');
  assert.match(result.error.message, /cooling down/);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
});

test('prompt does NOT fall back when provider error lacks retryable signal (null code/status)', async () => {
  const bodies = [];
  const sdk = {
    _client: {
      post: async (params) => {
        bodies.push(params.body);
        // info.error with no statusCode/code — an unknown non-transient error, not a cooldown.
        return { data: { info: { error: { name: 'APIError', data: { message: 'weird' } } } }, parts: [] };
      },
    },
    session: { create: async () => ({ id: 'ses_x' }) },
  };
  const client = createOpencodeClient({ sdk });
  const r = await client.prompt({ sessionId: 'ses_x', agent: 'guardian-code', parts: [], model: 'cpa/gpt-5.5', fallbackModels: ['cpa/gpt-5.6-sol'] });
  assert.equal(r.kind, 'provider-error');
  assert.equal(r.error.retryable, false);
  // Only ONE attempt: no wasteful downgrade to the fallback model on a non-transient error.
  assert.equal(bodies.length, 1);
});

test('prompt retries with fallback model on provider cooldown then succeeds', async () => {
  const bodies = [];
  const sdk = {
    _client: {
      post: async (params) => {
        bodies.push(params.body);
        if (bodies.length === 1) {
          return { data: { info: { error: { name: 'APIError', data: { statusCode: 429, responseBody: '{"error":{"code":"model_cooldown"}}' } } }, parts: [] } };
        }
        return { data: { parts: [{ type: 'text', text: 'ok-from-fallback' }] } };
      },
    },
    session: { create: async () => ({ id: 'ses_fb' }) },
  };
  const client = createOpencodeClient({ sdk });
  const result = await client.prompt({ sessionId: 'ses_fb', agent: 'guardian-code', parts: [], fallbackModels: ['cpa/gpt-5.4'] });
  assert.equal(result.kind, 'ok');
  assert.equal(result.result.text, 'ok-from-fallback');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].model, undefined);
  assert.deepEqual(bodies[1].model, { providerID: 'cpa', modelID: 'gpt-5.4' });
});

test('prompt logs a provider.fallback event when downgrading models', async () => {
  let n = 0;
  const events = [];
  const sdk = {
    _client: {
      post: async () => {
        n += 1;
        if (n === 1) return { data: { info: { error: { name: 'APIError', data: { statusCode: 429, responseBody: '{"error":{"code":"model_cooldown"}}' } } }, parts: [] } };
        return { data: { parts: [{ type: 'text', text: 'ok' }] } };
      },
    },
    session: { create: async () => ({ id: 'ses_log' }) },
  };
  const logger = { info: () => {}, warn: (event, fields) => events.push({ event, fields }), error: () => {} };
  const client = createOpencodeClient({ sdk, logger });
  await client.prompt({ sessionId: 'ses_log', agent: 'guardian-code', parts: [], fallbackModels: ['cpa/gpt-5.5'] });
  const fb = events.find((e) => e.event === 'provider.fallback');
  assert.ok(fb, 'provider.fallback should be logged');
  assert.equal(fb.fields.to_model, 'cpa/gpt-5.5');
  assert.equal(fb.fields.code, 'model_cooldown');
});

test('prompt returns provider-error after exhausting all fallback models', async () => {
  const bodies = [];
  const sdk = {
    _client: {
      post: async (params) => {
        bodies.push(params.body);
        return { data: { info: { error: { name: 'APIError', data: { statusCode: 429, responseBody: '{"error":{"code":"model_cooldown"}}' } } }, parts: [] } };
      },
    },
    session: { create: async () => ({ id: 'ses_fb2' }) },
  };
  const client = createOpencodeClient({ sdk });
  const result = await client.prompt({ sessionId: 'ses_fb2', agent: 'guardian-code', parts: [], fallbackModels: ['cpa/gpt-5.4', 'cpa/gpt-5.6-sol'] });
  assert.equal(result.kind, 'provider-error');
  assert.equal(bodies.length, 3);
  assert.deepEqual(bodies.map((b) => b.model), [undefined, { providerID: 'cpa', modelID: 'gpt-5.4' }, { providerID: 'cpa', modelID: 'gpt-5.6-sol' }]);
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

test('getMessages preserves bad request responses as message endpoint errors', async () => {
  const sdk = {
    _client: {
      get: async () => { throw Object.assign(new Error('bad request'), { status: 400 }); },
    },
    session: { create: async () => ({ id: 'ses_new' }) },
  };
  const client = createOpencodeClient({ sdk });
  const result = await client.getMessages('ses_bad');
  assert.equal(result.kind, 'message-endpoint-error');
  assert.equal(result.status, 400);
});

test('getAgents reads available agent names for a directory', async () => {
  const { sdk, calls } = fakeSdk();
  const client = createOpencodeClient({ sdk });
  const result = await client.getAgents('D:/repo');
  assert.equal(result.kind, 'ok');
  assert.deepEqual(result.agents, ['guardian-code', 'guardian-runtime']);
  assert.deepEqual(calls.get[0], { url: '/agent', query: { directory: 'D:/repo' } });
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
