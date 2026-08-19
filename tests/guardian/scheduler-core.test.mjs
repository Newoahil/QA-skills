// Tests for tools/guardian/scheduler-core.mjs — N=1 tick planning (pure).

import assert from 'node:assert/strict';
import test from 'node:test';

import { commandlessStateTransition, planTick, isLockLive } from '../../tools/guardian/scheduler-core.mjs';
import { newState, STATES } from '../../tools/guardian/state.mjs';

const LEASE = 30 * 60 * 1000;
const NOW = Date.parse('2026-08-18T12:00:00Z');

function d(issue, action, extra = {}) {
  return { issue, action, invoke: `opencode run ... #${issue}`, ...extra };
}

test('isLockLive: null lock is not live; fresh lock is live; expired is not', () => {
  assert.equal(isLockLive(null, { leaseMs: LEASE, now: NOW }), false);
  assert.equal(isLockLive({ pid: 1, acquired_at: NOW - 1000 }, { leaseMs: LEASE, now: NOW }), true);
  assert.equal(isLockLive({ pid: 1, acquired_at: NOW - LEASE - 1 }, { leaseMs: LEASE, now: NOW }), false);
});

test('no lock: picks the first runnable decision (N=1 single pick)', () => {
  const decisions = [d(1, 'SKIP'), d(2, 'START'), d(3, 'RESUME')];
  const plan = planTick({ decisions, lock: null, leaseMs: LEASE, now: NOW });
  assert.equal(plan.lockBusy, false);
  assert.equal(plan.toRun.issue, 2);
});

test('live lock: starts nothing new (N=1), but still returns notify list', () => {
  const decisions = [d(1, 'START'), d(2, 'STALLED', { reason: 'lease' })];
  const plan = planTick({ decisions, lock: { pid: 9, acquired_at: NOW - 1000 }, leaseMs: LEASE, now: NOW });
  assert.equal(plan.lockBusy, true);
  assert.equal(plan.toRun, null);
  assert.equal(plan.notify.length, 1);
  assert.equal(plan.notify[0].issue, 2);
});

test('expired lock is treated as free → a run may start', () => {
  const decisions = [d(1, 'RESUME')];
  const plan = planTick({ decisions, lock: { pid: 9, acquired_at: NOW - LEASE - 1 }, leaseMs: LEASE, now: NOW });
  assert.equal(plan.lockBusy, false);
  assert.equal(plan.toRun.issue, 1);
});

test('no runnable decisions → toRun null', () => {
  const decisions = [d(1, 'SKIP'), d(2, 'DONE'), d(3, 'HANDED_BACK')];
  const plan = planTick({ decisions, lock: null, leaseMs: LEASE, now: NOW });
  assert.equal(plan.toRun, null);
  assert.equal(plan.notify.some((x) => x.action === 'HANDED_BACK'), true);
});

test('notify list covers STALLED/HANDED_BACK/DONE only (not START/SKIP)', () => {
  const decisions = [d(1, 'START'), d(2, 'SKIP'), d(3, 'STALLED'), d(4, 'HANDED_BACK'), d(5, 'DONE')];
  const plan = planTick({ decisions, lock: null, leaseMs: LEASE, now: NOW });
  assert.deepEqual(plan.notify.map((x) => x.issue).sort(), [3, 4, 5]);
});

test('gate waiting decisions are notify candidates even when action is SKIP', () => {
  const decisions = [
    { issue: 1, action: 'SKIP', reason: 'gate1-waiting' },
    { issue: 2, action: 'SKIP', reason: 'gate2-waiting' },
    { issue: 3, action: 'SKIP', reason: 'gate2-waiting' },
  ];
  const plan = planTick({ decisions, lock: null, leaseMs: 1800000, now: Date.now() });
  assert.deepEqual(plan.notify.map((x) => x.issue), [1, 2, 3]);
});

test('commandless DONE transition persists merged close-out fields', () => {
  const current = { ...newState(211), state: STATES.GATE_2_WAIT, last_phase: 'pr-opened' };
  const patch = commandlessStateTransition(current, { action: 'DONE', reason: 'merged-closed' });

  assert.deepEqual(patch, {
    state: STATES.DONE,
    handed_back_reason: null,
    last_phase: 'merged-closed',
    last_error_class: null,
  });
});

test('commandless STALLED transition persists retry counter and audit phase', () => {
  const current = { ...newState(42), state: STATES.INVESTIGATING, stall_retries: 0 };
  const patch = commandlessStateTransition(current, {
    action: 'STALLED',
    reason: 'lease-expired',
    nextStallRetries: 1,
  });

  assert.deepEqual(patch, {
    state: STATES.STALLED,
    stall_retries: 1,
    last_phase: 'stalled',
    last_error_class: 'lease-expired',
  });
});

test('commandless HANDED_BACK transition persists reason and audit fields', () => {
  const current = { ...newState(7), state: STATES.GATE_1_WAIT };
  const patch = commandlessStateTransition(current, {
    action: 'HANDED_BACK',
    reason: 'reject',
    handedBackReason: 'reject',
  });

  assert.deepEqual(patch, {
    state: STATES.HANDED_BACK,
    handed_back_reason: 'reject',
    last_phase: 'handed-back',
    last_error_class: 'reject',
  });
});

test('gate waiting SKIP has no commandless state transition', () => {
  const current = { ...newState(9), state: STATES.GATE_2_WAIT };
  assert.equal(commandlessStateTransition(current, { action: 'SKIP', reason: 'gate2-waiting' }), null);
});
