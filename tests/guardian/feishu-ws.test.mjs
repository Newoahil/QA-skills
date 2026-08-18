import assert from 'node:assert/strict';
import test from 'node:test';

import { CARD_ACTION_EVENT, createFeishuWsRuntime } from '../../tools/guardian/feishu-ws.mjs';

function fakeSdk(captured) {
  class EventDispatcher {
    register(routes) {
      captured.routes = routes;
      return this;
    }
  }
  class WSClient {
    constructor(options) { captured.options = options; }
    start(options) { captured.start = options; }
    close() { captured.closed = true; }
  }
  return { EventDispatcher, WSClient };
}

test('Feishu WS registers card.action.trigger and posts normalized approve comment', async () => {
  const captured = {};
  const calls = [];
  const runtime = await createFeishuWsRuntime({
    appId: 'cli_test',
    appSecret: 'secret_test',
    repo: 'o/r',
    seen: new Set(),
    sdk: fakeSdk(captured),
    postComment: async (repo, issue, body) => {
      calls.push({ repo, issue, body });
      return { id: 1, url: 'https://github.test/comment/1' };
    },
    logger: { error() {} },
  });

  assert.ok(captured.options);
  assert.equal(captured.options.appId, 'cli_test');
  assert.equal(captured.options.appSecret, 'secret_test');
  assert.equal(Object.prototype.hasOwnProperty.call(captured.routes, CARD_ACTION_EVENT), true);
  runtime.start();
  assert.ok(captured.start);

  const response = await captured.routes[CARD_ACTION_EVENT]({
    header: { event_id: 'event-1' },
    action: { value: { issue: 191, verb: 'approve' } },
  });
  assert.equal(calls[0].body, '/guardian approve');
  assert.equal(response.toast.type, 'success');
  await runtime.close();
  assert.equal(captured.closed, true);
});

test('Feishu WS carries revise input text into the GitHub command', async () => {
  const captured = {};
  const calls = [];
  await createFeishuWsRuntime({
    appId: 'a', appSecret: 'b', repo: 'o/r', seen: new Set(), sdk: fakeSdk(captured),
    postComment: async (_repo, _issue, body) => { calls.push(body); return { id: 1, url: 'u' }; },
    logger: { error() {} },
  });
  await captured.routes[CARD_ACTION_EVENT]({
    header: { event_id: 'event-2' },
    action: { value: { issue: 191, verb: 'revise' }, input_value: '改用 dev 作为目标分支' },
  });
  assert.equal(calls[0], '/guardian revise 改用 dev 作为目标分支');
});

test('Feishu WS rejects malformed actions without posting', async () => {
  const captured = {};
  const calls = [];
  await createFeishuWsRuntime({
    appId: 'a', appSecret: 'b', repo: 'o/r', seen: new Set(), sdk: fakeSdk(captured),
    postComment: async () => { calls.push(true); return { id: 1, url: 'u' }; },
    logger: { error() {} },
  });
  const response = await captured.routes[CARD_ACTION_EVENT]({ action: { value: { issue: 191, verb: 'merge' } } });
  assert.equal(calls.length, 0);
  assert.equal(response.toast.type, 'fail');
});

test('Feishu WS deduplicates repeated event id through shared executor', async () => {
  const captured = {};
  let posts = 0;
  await createFeishuWsRuntime({
    appId: 'a', appSecret: 'b', repo: 'o/r', seen: new Set(), sdk: fakeSdk(captured),
    postComment: async () => { posts += 1; return { id: 1, url: 'u' }; },
    logger: { error() {} },
  });
  const event = { header: { event_id: 'same' }, action: { value: { issue: 1, verb: 'retry' } } };
  await captured.routes[CARD_ACTION_EVENT](event);
  await captured.routes[CARD_ACTION_EVENT](event);
  assert.equal(posts, 1);
});
