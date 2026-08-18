// Tests for tools/guardian/webhook-ingest.mjs — Phase 4 cloud-side webhook ingest (§2, §6).
// Proves: signature verification, issue-number extraction, ingestion replay dedupe (§3.1), and
// that ingest NEVER produces more than one wake per delivery. No network, injected store.

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

import {
  ingestWebhook, verifyWebhookSignature, extractIssueNumber, createInMemoryWakeStore,
  SUPPORTED_EVENTS,
} from '../../tools/guardian/webhook-ingest.mjs';

const SECRET = 'webhook-secret';
function sign(body) {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;
}
function headers(eventType, deliveryId, body) {
  return { 'x-github-event': eventType, 'x-github-delivery': deliveryId, 'x-hub-signature-256': sign(body) };
}

test('verifyWebhookSignature: valid passes, tampered/absent fails', () => {
  const body = '{"a":1}';
  assert.equal(verifyWebhookSignature({ rawBody: body, signatureHeader: sign(body), secret: SECRET }), true);
  assert.equal(verifyWebhookSignature({ rawBody: body, signatureHeader: sign('other'), secret: SECRET }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signatureHeader: undefined, secret: SECRET }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signatureHeader: sign(body), secret: '' }), false);
});

test('extractIssueNumber by event type', () => {
  assert.equal(extractIssueNumber('issues', { issue: { number: 5 } }), 5);
  assert.equal(extractIssueNumber('issue_comment', { issue: { number: 9 } }), 9);
  assert.equal(extractIssueNumber('pull_request', { pull_request: { number: 3 } }), null);
  assert.equal(extractIssueNumber('push', {}), null);
  assert.equal(extractIssueNumber('issues', { issue: { number: 0 } }), null);
});

test('bad signature → 401, no store write', async () => {
  const store = createInMemoryWakeStore();
  const body = JSON.stringify({ issue: { number: 1 } });
  const res = await ingestWebhook({
    rawBody: body,
    headers: { 'x-github-event': 'issues', 'x-github-delivery': 'd1', 'x-hub-signature-256': 'sha256=bad' },
    secret: SECRET, store,
  });
  assert.equal(res.status, 401);
  assert.equal(store._all().length, 0);
});

test('missing delivery id → 400', async () => {
  const store = createInMemoryWakeStore();
  const body = JSON.stringify({ issue: { number: 1 } });
  const res = await ingestWebhook({
    rawBody: body, headers: { 'x-github-event': 'issues', 'x-hub-signature-256': sign(body) }, secret: SECRET, store,
  });
  assert.equal(res.status, 400);
});

test('unsupported event (ping) → 202 ignored, no wake recorded', async () => {
  const store = createInMemoryWakeStore();
  const body = JSON.stringify({ zen: 'hi' });
  const res = await ingestWebhook({
    rawBody: body, headers: { 'x-github-event': 'ping', 'x-github-delivery': 'd1', 'x-hub-signature-256': sign(body) },
    secret: SECRET, store,
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.ignored, 'ping');
  assert.equal(store._all().length, 0);
});

// Oracle regression case 1: same webhook delivery replayed twice → exactly one wake.
test('REGRESSION 1: delivery replay → one durable record, one wake target', async () => {
  const store = createInMemoryWakeStore();
  const body = JSON.stringify({ issue: { number: 191 } });
  const h = headers('issue_comment', 'delivery-1', body);
  const first = await ingestWebhook({ rawBody: body, headers: h, secret: SECRET, store });
  const replay = await ingestWebhook({ rawBody: body, headers: h, secret: SECRET, store });

  assert.equal(first.status, 202);
  assert.equal(first.body.issue, 191);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.deduped, true);
  assert.equal(store._all().length, 1, 'exactly one durable record');
  assert.equal((await store.pending()).length, 1, 'exactly one wake target');
});

test('supported events list is exactly the four GitHub events', () => {
  assert.deepEqual([...SUPPORTED_EVENTS], ['issues', 'issue_comment', 'pull_request', 'push']);
});
