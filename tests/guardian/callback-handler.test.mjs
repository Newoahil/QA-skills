// Tests for tools/guardian/callback-handler.mjs — end-to-end request handling (injected deps).

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleCallback } from '../../tools/guardian/callback-handler.mjs';
import { computeSignature } from '../../tools/guardian/feishu-callback.mjs';

const SECRETS = Object.freeze({
  feishu_verification_token: 'vtok',
  feishu_encrypt_key: 'ekey',
  github_token: 'ghtoken',
  github_repo: 'o/r',
});
const NOW = Date.parse('2026-08-18T12:00:00Z');

function sign(rawBody, nonce = 'n1') {
  const timestamp = String(Math.floor(NOW / 1000));
  const signature = computeSignature({ timestamp, nonce, encryptKey: SECRETS.feishu_encrypt_key, rawBody });
  return {
    'x-lark-request-timestamp': timestamp,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': signature,
  };
}

function recordingPoster() {
  const calls = [];
  const postComment = async (repo, issue, body) => {
    calls.push({ repo, issue, body });
    return { id: 1, url: `https://github.com/${repo}/issues/${issue}#c1` };
  };
  return { calls, postComment };
}

test('url_verification echoes challenge when token matches', async () => {
  const rawBody = JSON.stringify({ type: 'url_verification', token: 'vtok', challenge: 'abc' });
  const { postComment } = recordingPoster();
  const res = await handleCallback({ rawBody, headers: {}, secrets: SECRETS, postComment, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).challenge, 'abc');
});

test('url_verification rejects a wrong token', async () => {
  const rawBody = JSON.stringify({ type: 'url_verification', token: 'nope', challenge: 'abc' });
  const { postComment } = recordingPoster();
  const res = await handleCallback({ rawBody, headers: {}, secrets: SECRETS, postComment, now: NOW });
  assert.equal(res.status, 401);
});

test('valid signed approve action posts /guardian approve and returns success', async () => {
  const rawBody = JSON.stringify({ header: { event_id: 'e1' }, action: { value: { issue: 191, verb: 'approve' } } });
  const { calls, postComment } = recordingPoster();
  const res = await handleCallback({ rawBody, headers: sign(rawBody), secrets: SECRETS, postComment, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ repo: 'o/r', issue: 191, body: '/guardian approve' }]);
});

test('bad signature is rejected before any comment is posted', async () => {
  const rawBody = JSON.stringify({ action: { value: { issue: 191, verb: 'approve' } } });
  const headers = sign(rawBody);
  headers['x-lark-signature'] = 'deadbeef';
  const { calls, postComment } = recordingPoster();
  const res = await handleCallback({ rawBody, headers, secrets: SECRETS, postComment, now: NOW });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('duplicate event_id is deduped (comment posted once)', async () => {
  const rawBody = JSON.stringify({ header: { event_id: 'dup' }, action: { value: { issue: 5, verb: 'retry' } } });
  const headers = sign(rawBody);
  const { calls, postComment } = recordingPoster();
  const seen = new Set();
  await handleCallback({ rawBody, headers, secrets: SECRETS, postComment, seen, now: NOW });
  const res2 = await handleCallback({ rawBody, headers, secrets: SECRETS, postComment, seen, now: NOW });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(res2.body).deduped, true);
});

test('revise without text is rejected (400) and posts nothing', async () => {
  const rawBody = JSON.stringify({ action: { value: { issue: 191, verb: 'revise' }, input_value: '' } });
  const { calls, postComment } = recordingPoster();
  const res = await handleCallback({ rawBody, headers: sign(rawBody), secrets: SECRETS, postComment, now: NOW });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('malformed json returns 400', async () => {
  const { postComment } = recordingPoster();
  const res = await handleCallback({ rawBody: 'not-json', headers: {}, secrets: SECRETS, postComment, now: NOW });
  assert.equal(res.status, 400);
});

test('failed post un-reserves the event id so a retry can succeed (atomic reserve)', async () => {
  const rawBody = JSON.stringify({ header: { event_id: 'retry-me' }, action: { value: { issue: 7, verb: 'approve' } } });
  const headers = sign(rawBody);
  const seen = new Set();
  let attempts = 0;
  const flaky = async (repo, issue, body) => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient github failure');
    return { id: 1, url: 'u' };
  };
  // First attempt: post throws → handler rethrows, and event id must NOT remain reserved.
  await assert.rejects(() =>
    handleCallback({ rawBody, headers, secrets: SECRETS, postComment: flaky, seen, now: NOW }),
  );
  assert.equal(seen.has('retry-me'), false);
  // Retry: succeeds and posts exactly once more.
  const res = await handleCallback({ rawBody, headers, secrets: SECRETS, postComment: flaky, seen, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(attempts, 2);
  assert.equal(seen.has('retry-me'), true);
});

test('authorized Feishu actor posts the command', async () => {
  const rawBody = JSON.stringify({ header: { event_id: 'e-auth' }, operator: { open_id: 'ou_123' }, action: { value: { issue: 191, verb: 'approve' } } });
  const { calls, postComment } = recordingPoster();
  const authorize = () => ({ allowed: true, githubLogin: 'goudaren0528' });
  const res = await handleCallback({ rawBody, headers: sign(rawBody), secrets: SECRETS, postComment, now: NOW, authorize });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test('unauthorized Feishu actor is rejected with 403 and posts nothing', async () => {
  const rawBody = JSON.stringify({ header: { event_id: 'e-unauth' }, operator: { open_id: 'ou_evil' }, action: { value: { issue: 191, verb: 'approve' } } });
  const { calls, postComment } = recordingPoster();
  const authorize = () => ({ allowed: false, reason: 'unmapped-actor' });
  const res = await handleCallback({ rawBody, headers: sign(rawBody), secrets: SECRETS, postComment, now: NOW, authorize });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});
