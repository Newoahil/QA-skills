// Tests for tools/guardian/notify.mjs — §11B.5 dual-channel notification.
// Covers acceptance 26: comment always sent, webhook when configured, degrade to
// comment-only when absent, idempotent (same state not re-pushed), body carries no
// code/secrets (only issue#+stage+link).

import assert from 'node:assert/strict';
import test from 'node:test';

import { notify, buildNotification, assertSafeBody, NOTIFY_STATES } from '../../tools/guardian/notify.mjs';
import { newState } from '../../tools/guardian/state.mjs';

function spyIo() {
  const calls = { comment: [], webhook: [] };
  return {
    calls,
    comment: (payload) => calls.comment.push(payload),
    webhook: (url, payload) => calls.webhook.push({ url, payload }),
  };
}

test('with webhook configured → both channels fire (acceptance 26)', () => {
  const io = spyIo();
  const record = newState(42);
  const res = notify(
    record,
    { targetState: 'GATE_1_WAIT', link: 'https://gh/issue/42' },
    { notify_webhook: 'https://hooks.example/x' },
    io,
  );
  assert.equal(res.commented, true);
  assert.equal(res.webhookPushed, true);
  assert.equal(io.calls.comment.length, 1);
  assert.equal(io.calls.webhook.length, 1);
  assert.equal(io.calls.webhook[0].url, 'https://hooks.example/x');
});

test('without webhook config → degrade to comment-only, link not blocked (acceptance 26)', () => {
  const io = spyIo();
  const res = notify(newState(42), { targetState: 'GATE_2_WAIT' }, {}, io);
  assert.equal(res.commented, true);
  assert.equal(res.webhookPushed, false);
  assert.equal(io.calls.comment.length, 1);
  assert.equal(io.calls.webhook.length, 0);
});

test('idempotent: same state already notified → no re-push (acceptance 26)', () => {
  const io = spyIo();
  const record = { ...newState(42), last_notified_state: 'GATE_1_WAIT' };
  const res = notify(record, { targetState: 'GATE_1_WAIT' }, { notify_webhook: 'https://h' }, io);
  assert.equal(res.skipped, true);
  assert.equal(io.calls.comment.length, 0);
  assert.equal(io.calls.webhook.length, 0);
});

test('a DIFFERENT state does fire even if a prior state was notified', () => {
  const io = spyIo();
  const record = { ...newState(42), last_notified_state: 'GATE_1_WAIT' };
  const res = notify(record, { targetState: 'HANDED_BACK', reason: 'reject' }, {}, io);
  assert.equal(res.skipped, false);
  assert.equal(io.calls.comment.length, 1);
});

test('body contains only issue#/stage/link/reason/text — no code or secrets', () => {
  const payload = buildNotification({
    issue: 42,
    state: 'STALLED',
    link: 'https://gh/issue/42',
    reason: 'stalled',
  });
  assert.doesNotThrow(() => assertSafeBody(payload));
  assert.equal(payload.issue, 42);
  assert.equal(payload.stage, 'STALLED');
  // text is a short human string, contains issue number and stage, nothing else sensitive
  assert.match(payload.text, /#42/);
  assert.match(payload.text, /STALLED/);
});

test('assertSafeBody rejects a body with extra (potentially leaky) keys', () => {
  assert.throws(() => assertSafeBody({ issue: 1, stage: 'X', secret: 'token' }), /disallowed keys/);
});

test('NOTIFY_STATES only covers gate/stall/handback (not progress-only states)', () => {
  assert.deepEqual([...NOTIFY_STATES].sort(), ['GATE_1_WAIT', 'GATE_2_WAIT', 'HANDED_BACK', 'STALLED'].sort());
});
