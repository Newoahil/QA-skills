// Tests for tools/guardian/lock.mjs — atomic N=1 lock (real temp dir, real fs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { acquireLock, renewLock, releaseLock, isLockLive } from '../../tools/guardian/lock.mjs';

const LEASE = 30 * 60 * 1000;

function tmpLock() {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardian-lock-'));
  return { dir, file: path.join(dir, '.scheduler.lock') };
}

test('acquireLock creates the lock atomically and returns a handle', () => {
  const { dir, file } = tmpLock();
  try {
    const h = acquireLock(file, { pid: 1, leaseMs: LEASE, now: 1000, dir });
    assert.ok(h && typeof h.token === 'string' && h.token.length > 0);
    assert.equal(existsSync(file), true);
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(payload.pid, 1);
    assert.equal(payload.acquired_at, 1000);
    assert.equal(payload.renewed_at, 1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a second acquire while a LIVE lock is held returns null (true N=1)', () => {
  const { dir, file } = tmpLock();
  try {
    const h1 = acquireLock(file, { pid: 1, leaseMs: LEASE, now: 1000, dir });
    assert.ok(h1);
    const h2 = acquireLock(file, { pid: 2, leaseMs: LEASE, now: 1000 + 60_000, dir });
    assert.equal(h2, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a STALE (lease-expired) lock is reclaimed by a new acquirer', () => {
  const { dir, file } = tmpLock();
  try {
    acquireLock(file, { pid: 1, leaseMs: LEASE, now: 1000, dir });
    const h2 = acquireLock(file, { pid: 2, leaseMs: LEASE, now: 1000 + LEASE + 1, dir });
    assert.ok(h2, 'expired lock should be reclaimable');
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(payload.pid, 2);
    assert.equal(payload.token, h2.token);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renewLock refreshes renewed_at only for the owning token', () => {
  const { dir, file } = tmpLock();
  try {
    const h = acquireLock(file, { pid: 1, leaseMs: LEASE, now: 1000, dir });
    assert.equal(renewLock(file, h, { now: 5000 }), true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).renewed_at, 5000);
    // A non-owner token cannot renew.
    assert.equal(renewLock(file, { token: 'someone-else' }, { now: 9000 }), false);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).renewed_at, 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renew keeps a long run live past the lease so N=1 still holds', () => {
  const { dir, file } = tmpLock();
  try {
    const h = acquireLock(file, { pid: 1, leaseMs: LEASE, now: 0, dir });
    renewLock(file, h, { now: LEASE - 1 }); // heartbeat before expiry
    const later = LEASE + 100; // past original acquire, but within renewed lease
    const other = acquireLock(file, { pid: 2, leaseMs: LEASE, now: later, dir });
    assert.equal(other, null, 'renewed lock must still block a second acquire');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('releaseLock removes the file only for the owning token', () => {
  const { dir, file } = tmpLock();
  try {
    const h = acquireLock(file, { pid: 1, leaseMs: LEASE, now: 1000, dir });
    assert.equal(releaseLock(file, { token: 'not-owner' }), false);
    assert.equal(existsSync(file), true);
    assert.equal(releaseLock(file, h), true);
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isLockLive: null/expired not live; within-lease live', () => {
  assert.equal(isLockLive(null, { leaseMs: LEASE, now: 0 }), false);
  assert.equal(isLockLive({ renewed_at: 0 }, { leaseMs: LEASE, now: LEASE + 1 }), false);
  assert.equal(isLockLive({ renewed_at: 0 }, { leaseMs: LEASE, now: 1000 }), true);
});
