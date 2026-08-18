// QA Guardian — N=1 scheduler lock (atomic acquire + heartbeat renew + owner-only release)
//
// The scheduler must guarantee at most ONE active guardian run across all scheduler processes.
// A plain "read then write" lock races: two schedulers both see no/expired lock and both spawn.
// This module makes acquisition ATOMIC via exclusive create (open flag 'wx'): only one caller
// can create the lock file; everyone else gets EEXIST. Liveness is a lease (renewed by a live
// owner's heartbeat), so a crashed owner's lock is reclaimable after the lease expires. Release
// only removes a lock this process owns (owner-guarded), so we never delete another run's lock.
//
// Lock payload: { pid, token, acquired_at, renewed_at }. `token` is a per-acquire random id so
// two processes with the same pid (containers, pid reuse) cannot spoof ownership.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

export class LockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LockError';
    this.code = code; // 'held' | 'not-owner' | 'corrupt'
  }
}

function readLockRaw(fs, lockFile) {
  if (!fs.existsSync(lockFile)) return null;
  const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  return {
    pid: Number(parsed.pid),
    token: String(parsed.token ?? ''),
    acquired_at: Number(parsed.acquired_at),
    renewed_at: Number(parsed.renewed_at ?? parsed.acquired_at),
  };
}

// A lock is "live" while its most recent heartbeat is within the lease window.
export function isLockLive(lock, { leaseMs, now }) {
  if (!lock || typeof lock.renewed_at !== 'number' || Number.isNaN(lock.renewed_at)) return false;
  return now - lock.renewed_at < leaseMs;
}

// Default fs surface (injectable for tests).
const realFs = { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync, rmSync };

/**
 * Try to acquire the lock atomically. Returns an owner handle { token } on success, or null
 * when a LIVE lock is already held by someone else. A stale (lease-expired) lock is reclaimed.
 * @param {string} lockFile
 * @param {object} opts { pid, leaseMs, now?, fs?, dir? }
 */
export function acquireLock(lockFile, opts) {
  const fs = opts.fs ?? realFs;
  const now = opts.now ?? Date.now();
  const token = randomUUID();
  if (opts.dir) fs.mkdirSync(opts.dir, { recursive: true });

  const payload = () =>
    `${JSON.stringify({ pid: opts.pid, token, acquired_at: now, renewed_at: now })}\n`;

  // 1. Fast path: atomic exclusive create. Winner writes the lock; losers get EEXIST.
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, payload());
    fs.closeSync(fd);
    return { token };
  } catch (e) {
    if (!(e && e.code === 'EEXIST')) throw e;
  }

  // 2. A lock file exists. Reclaim ONLY if it is stale (lease expired); never steal a live lock.
  const existing = readLockRaw(fs, lockFile);
  if (isLockLive(existing, { leaseMs: opts.leaseMs, now })) {
    return null; // someone else holds a live lock → N=1 respected
  }
  // Stale: overwrite in place with our fresh ownership.
  fs.writeFileSync(lockFile, payload());
  return { token };
}

/**
 * Renew (heartbeat) the lock — only if we still own it (token match). Returns true on renew.
 */
export function renewLock(lockFile, handle, opts) {
  const fs = opts.fs ?? realFs;
  const now = opts.now ?? Date.now();
  const existing = readLockRaw(fs, lockFile);
  if (!existing || existing.token !== handle.token) return false; // lost ownership
  fs.writeFileSync(
    lockFile,
    `${JSON.stringify({ ...existing, renewed_at: now })}\n`,
  );
  return true;
}

/**
 * Release the lock — owner-guarded. Removes the file only if we still own it (token match).
 */
export function releaseLock(lockFile, handle, opts = {}) {
  const fs = opts.fs ?? realFs;
  if (!fs.existsSync(lockFile)) return false;
  const existing = readLockRaw(fs, lockFile);
  if (!existing || existing.token !== handle.token) return false; // not ours → do not delete
  fs.rmSync(lockFile);
  return true;
}
