// Tests for tools/guardian/scheduler-core.mjs — N=1 tick planning (pure).

import assert from 'node:assert/strict';
import test from 'node:test';

import { planTick, isLockLive } from '../../tools/guardian/scheduler-core.mjs';

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

test('notify list covers STALLED and HANDED_BACK only (not START/SKIP/DONE)', () => {
  const decisions = [d(1, 'START'), d(2, 'SKIP'), d(3, 'STALLED'), d(4, 'HANDED_BACK'), d(5, 'DONE')];
  const plan = planTick({ decisions, lock: null, leaseMs: LEASE, now: NOW });
  assert.deepEqual(plan.notify.map((x) => x.issue).sort(), [3, 4]);
});
