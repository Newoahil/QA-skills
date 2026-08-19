import assert from 'node:assert/strict';
import test from 'node:test';

import { persistCommandlessTransitions } from '../../tools/guardian/scheduler.mjs';
import { deliverNotifications } from '../../tools/guardian/notify-io.mjs';
import { ACTORS } from '../../tools/guardian/actor-routing.mjs';
import { newState, STATES } from '../../tools/guardian/state.mjs';

function fakeStore(initial) {
  const store = { ...initial };
  const writes = [];
  return {
    store,
    writes,
    readState: (_dir, issue) => (store[issue] ? { ...store[issue] } : null),
    writeState: (_dir, record) => {
      writes.push({ issue: record.issue, state: record.state, last_phase: record.last_phase });
      store[record.issue] = { ...record };
      return store[record.issue];
    },
  };
}

function spyIo(order) {
  return {
    ghComment: (issue) => order.push(`notify:${issue}`),
    curlPost: () => {},
  };
}

test('closed GATE_2_WAIT is persisted DONE before notification reads state', () => {
  const store = fakeStore({ 211: { ...newState(211), state: STATES.GATE_2_WAIT, last_phase: 'pr-opened' } });
  const order = [];
  const deps = { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' };
  const decision = { issue: 211, action: 'DONE', reason: 'merged-closed' };

  persistCommandlessTransitions({ decisions: [decision], guardianDir: '/injected', deps });
  deliverNotifications({
    decisions: [decision],
    guardianDir: '/injected',
    config: {},
    io: spyIo(order),
    actor: ACTORS.SUPERVISOR,
    deps,
  });

  assert.equal(store.store[211].state, STATES.DONE);
  assert.equal(store.store[211].last_notified_state, STATES.DONE);
  assert.deepEqual(store.writes.map((write) => write.state), [STATES.DONE, STATES.DONE]);
  assert.deepEqual(order, ['notify:211']);
});

test('STALLED and HANDED_BACK commandless decisions persist before their notifications', () => {
  const store = fakeStore({
    42: { ...newState(42), state: STATES.INVESTIGATING, stall_retries: 0 },
    7: { ...newState(7), state: STATES.GATE_1_WAIT },
  });
  const order = [];
  const deps = { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' };
  const decisions = [
    { issue: 42, action: 'STALLED', reason: 'lease-expired', nextStallRetries: 1 },
    { issue: 7, action: 'HANDED_BACK', reason: 'reject', handedBackReason: 'reject' },
  ];

  persistCommandlessTransitions({ decisions, guardianDir: '/injected', deps });
  deliverNotifications({ decisions, guardianDir: '/injected', config: {}, io: spyIo(order), actor: ACTORS.SUPERVISOR, deps });

  assert.equal(store.store[42].state, STATES.STALLED);
  assert.equal(store.store[42].stall_retries, 1);
  assert.equal(store.store[42].last_phase, 'stalled');
  assert.equal(store.store[7].state, STATES.HANDED_BACK);
  assert.equal(store.store[7].handed_back_reason, 'reject');
  assert.equal(store.store[7].last_phase, 'handed-back');
  assert.deepEqual(order, ['notify:42', 'notify:7']);
});

test('gate waiting SKIP does not rewrite authoritative state', () => {
  const original = { ...newState(9), state: STATES.GATE_2_WAIT, last_phase: 'pr-opened' };
  const store = fakeStore({ 9: original });

  persistCommandlessTransitions({
    decisions: [{ issue: 9, action: 'SKIP', reason: 'gate2-waiting' }],
    guardianDir: '/injected',
    deps: { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' },
  });

  assert.deepEqual(store.writes, []);
  assert.deepEqual(store.store[9], original);
});

test('repeated DONE persistence is idempotent after the first transition', () => {
  const store = fakeStore({ 211: { ...newState(211), state: STATES.GATE_2_WAIT } });
  const deps = { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' };
  const decision = { issue: 211, action: 'DONE', reason: 'merged-closed' };

  persistCommandlessTransitions({ decisions: [decision], guardianDir: '/injected', deps });
  persistCommandlessTransitions({ decisions: [decision], guardianDir: '/injected', deps });

  assert.equal(store.writes.length, 1);
  assert.equal(store.store[211].state, STATES.DONE);
});
