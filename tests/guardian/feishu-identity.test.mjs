// Tests for tools/guardian/feishu-identity.mjs — actor identity binding.

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFeishuActorId, resolveFeishuAuthorizer } from '../../tools/guardian/feishu-identity.mjs';

test('extracts open_id from operator', () => {
  const event = { operator: { open_id: 'ou_123' } };
  assert.equal(extractFeishuActorId(event), 'ou_123');
});

test('extracts user_id/union_id fallbacks', () => {
  assert.equal(extractFeishuActorId({ operator: { user_id: 'u1' } }), 'u1');
  assert.equal(extractFeishuActorId({ operator: { union_id: 'un1' } }), 'un1');
});

test('extracts actor from action.operator and event.operator', () => {
  assert.equal(extractFeishuActorId({ action: { operator: { open_id: 'ou_a' } } }), 'ou_a');
  assert.equal(extractFeishuActorId({ event: { operator: { open_id: 'ou_b' } } }), 'ou_b');
});

test('missing or malformed actor returns null', () => {
  assert.equal(extractFeishuActorId(null), null);
  assert.equal(extractFeishuActorId({}), null);
  assert.equal(extractFeishuActorId({ operator: {} }), null);
});

test('mapped actor that is also a command author is allowed', () => {
  const result = resolveFeishuAuthorizer({
    actorId: 'ou_123',
    feishuAuthorizers: { ou_123: 'goudaren0528' },
    commandAuthors: ['goudaren0528'],
  });
  assert.deepEqual(result, { allowed: true, githubLogin: 'goudaren0528' });
});

test('array form of feishu_authorizers is supported', () => {
  const result = resolveFeishuAuthorizer({
    actorId: 'ou_123',
    feishuAuthorizers: [{ feishu_id: 'ou_123', github_login: 'goudaren0528' }],
    commandAuthors: ['goudaren0528'],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.githubLogin, 'goudaren0528');
});

test('missing actor id is rejected', () => {
  const result = resolveFeishuAuthorizer({ actorId: null, feishuAuthorizers: {}, commandAuthors: ['g'] });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'missing-actor');
});

test('unmapped actor is rejected', () => {
  const result = resolveFeishuAuthorizer({ actorId: 'ou_unknown', feishuAuthorizers: { ou_123: 'g' }, commandAuthors: ['g'] });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'unmapped-actor');
});

test('mapped actor not in command_authors is rejected', () => {
  const result = resolveFeishuAuthorizer({ actorId: 'ou_123', feishuAuthorizers: { ou_123: 'someone' }, commandAuthors: ['goudaren0528'] });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'not-command-author');
});
