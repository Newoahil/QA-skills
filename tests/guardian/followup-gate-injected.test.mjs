// Focused injected probes for the repaired DONE followup and gate notification flow.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCardAction, CallbackError } from '../../tools/guardian/feishu-callback.mjs';
import { buildFeishuCard } from '../../tools/guardian/notify-feishu.mjs';
import { deliverNotifications, notifyTargetState } from '../../tools/guardian/notify-io.mjs';
import { planTick } from '../../tools/guardian/scheduler-core.mjs';
import { newState, startFollowupRound } from '../../tools/guardian/state.mjs';

function fakeStore(initial) {
  const store = { ...initial };
  return {
    store,
    readState: (_dir, issue) => store[issue] ?? null,
    writeState: (_dir, record) => {
      store[record.issue] = { ...record };
      return store[record.issue];
    },
  };
}

function injectedIo() {
  const calls = { comment: [], webhook: [] };
  return {
    calls,
    ghComment: (issue, text) => calls.comment.push({ issue, text }),
    curlPost: (url, body) => calls.webhook.push({ url, body }),
  };
}

function findCardInput(card, name) {
  const stack = [card];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if (value && typeof value === 'object') {
      if (value.tag === 'input' && value.name === name) return value;
      stack.push(...Object.values(value));
    }
  }
  return null;
}

test('empty followup callback is rejected with missing-text', () => {
  assert.throws(
    () => parseCardAction({ action: { value: { issue: 191, verb: 'followup' }, input_value: '   ' } }),
    (error) => error instanceof CallbackError && error.code === 'missing-text',
  );
});

test('DONE card contains a followup input carrying the followup callback value', () => {
  const input = findCardInput(buildFeishuCard({ issue: 191, stage: 'DONE' }), 'guardian_followup');
  assert.ok(input);
  assert.deepEqual(input.button.value, { issue: 191, verb: 'followup' });
});

test('gate waiting SKIPs enter the notify list and map to their gate cards', () => {
  const decisions = [
    { issue: 1, action: 'SKIP', reason: 'gate1-waiting' },
    { issue: 2, action: 'SKIP', reason: 'gate2-waiting' },
  ];
  const plan = planTick({ decisions, lock: null, leaseMs: 1800000, now: Date.now() });
  assert.deepEqual(plan.notify.map((decision) => decision.issue), [1, 2]);
  assert.equal(notifyTargetState(plan.notify[0]), 'GATE_1_WAIT');
  assert.equal(notifyTargetState(plan.notify[1]), 'GATE_2_WAIT');
});

test('a second processing round can notify DONE after the first round', () => {
  const first = { ...newState(42), state: 'DONE', last_notified_state: null };
  const store = fakeStore({ 42: first });
  const io = injectedIo();
  const deps = { readState: store.readState, writeState: store.writeState };

  const firstResult = deliverNotifications({
    decisions: [{ issue: 42, action: 'DONE' }],
    guardianDir: '/injected',
    config: {},
    io,
    deps,
  });
  assert.equal(firstResult[0].delivered, true);
  assert.equal(store.store[42].last_notified_state, 'DONE');

  const second = startFollowupRound(
    store.store[42],
    { commentId: 99, data: 'new acceptance issue' },
    '2026-08-18T12:00:00.000Z',
  );
  store.writeState('/injected', second);
  assert.equal(store.store[42].state, 'INVESTIGATING');
  assert.equal(store.store[42].last_notified_state, null);

  store.store[42] = { ...store.store[42], state: 'DONE' };
  const secondResult = deliverNotifications({
    decisions: [{ issue: 42, action: 'DONE' }],
    guardianDir: '/injected',
    config: {},
    io,
    deps,
  });
  assert.equal(secondResult[0].delivered, true);
  assert.equal(io.calls.comment.length, 2);
  assert.equal(io.calls.webhook.length, 0);
});
