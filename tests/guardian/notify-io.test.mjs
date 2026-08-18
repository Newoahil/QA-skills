// Tests for tools/guardian/notify-io.mjs — notification delivery orchestration (injected io/fs).

import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverNotifications, notifyTargetState } from '../../tools/guardian/notify-io.mjs';
import { newState } from '../../tools/guardian/state.mjs';

function fakeStore(initial = {}) {
  const store = { ...initial };
  return {
    store,
    readState: (_dir, issue) => (store[issue] ? { ...store[issue] } : null),
    writeState: (_dir, record) => {
      store[record.issue] = { ...record };
      return store[record.issue];
    },
  };
}

function spyIo() {
  const calls = { comment: [], webhook: [] };
  return {
    calls,
    ghComment: (issue, text) => calls.comment.push({ issue, text }),
    curlPost: (url, body) => calls.webhook.push({ url, body }),
  };
}

test('notifyTargetState maps STALLED/HANDED_BACK; others → null', () => {
  assert.equal(notifyTargetState({ action: 'STALLED' }), 'STALLED');
  assert.equal(notifyTargetState({ action: 'HANDED_BACK' }), 'HANDED_BACK');
  assert.equal(notifyTargetState({ action: 'START' }), null);
  assert.equal(notifyTargetState({ action: 'SKIP' }), null);
});

test('delivers a comment for a STALLED decision and persists last_notified_state', () => {
  const fs = fakeStore({ 42: newState(42) });
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 42, action: 'STALLED', reason: 'lease-expired' }],
    guardianDir: '/g',
    config: {},
    io,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.deepEqual(results, [{ issue: 42, delivered: true }]);
  assert.equal(io.calls.comment.length, 1);
  assert.equal(fs.store[42].last_notified_state, 'STALLED');
});

test('idempotent: a state already notified is not re-delivered', () => {
  const fs = fakeStore({ 42: { ...newState(42), last_notified_state: 'HANDED_BACK' } });
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 42, action: 'HANDED_BACK', handedBackReason: 'reject' }],
    guardianDir: '/g',
    config: {},
    io,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results[0].skipped, true);
  assert.equal(io.calls.comment.length, 0);
});

test('webhook fires when notify_webhook configured (feishu channel wraps a card)', () => {
  const fs = fakeStore({ 7: newState(7) });
  const io = spyIo();
  deliverNotifications({
    decisions: [{ issue: 7, action: 'STALLED' }],
    guardianDir: '/g',
    config: { notify_webhook: 'https://open.feishu.cn/hook', notify_channel: 'feishu' },
    io,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(io.calls.webhook.length, 1);
  assert.equal(io.calls.webhook[0].body.msg_type, 'interactive');
});

test('missing state record is skipped, not fatal', () => {
  const fs = fakeStore({});
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 99, action: 'STALLED' }],
    guardianDir: '/g',
    config: {},
    io,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].error, 'no-state-record');
});

test('one issue delivery failure does not abort the others (best-effort)', () => {
  const fs = fakeStore({ 1: newState(1), 2: newState(2) });
  const io = {
    calls: { comment: [] },
    ghComment: (issue, text) => {
      if (issue === 1) throw new Error('gh boom');
      io.calls.comment.push({ issue, text });
    },
    curlPost: () => {},
  };
  const results = deliverNotifications({
    decisions: [{ issue: 1, action: 'STALLED' }, { issue: 2, action: 'HANDED_BACK' }],
    guardianDir: '/g',
    config: {},
    io,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results.find((r) => r.issue === 1).error, 'gh boom');
  assert.equal(results.find((r) => r.issue === 2).delivered, true);
  // Failed issue must NOT have its marker persisted (so it retries next tick).
  assert.equal(fs.store[1].last_notified_state, null);
  assert.equal(fs.store[2].last_notified_state, 'HANDED_BACK');
});

test('non-notify decisions are ignored', () => {
  const fs = fakeStore({ 5: newState(5) });
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 5, action: 'START' }, { issue: 5, action: 'SKIP' }],
    guardianDir: '/g',
    config: {},
    io,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results.length, 0);
  assert.equal(io.calls.comment.length, 0);
});
