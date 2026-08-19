// Tests for tools/guardian/state.mjs — §11A.3 persistence + §11B.4 lease.
// Round-trip preserves all schema fields; normalizeState backfills missing fields;
// isLeaseExpired respects the active/waiting distinction and the boundary.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  STATES,
  RISK,
  newState,
  normalizeState,
  readState,
  startFollowupRound,
  writeState,
  isActiveState,
  isTerminalState,
  isLeaseExpired,
} from '../../tools/guardian/state.mjs';

function tempGuardianDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'guardian-state-')), '.qa', 'guardian');
}

test('newState has every schema field (§11A.3)', () => {
  const s = newState(42);
  for (const k of [
    'issue', 'state', 'risk', 'branch', 'pr_url', 'fix_rounds', 'updated_at',
    'stall_retries', 'last_consumed_comment_id', 'last_notified_state', 'handed_back_reason',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(s, k), `missing field ${k}`);
  }
  assert.equal(s.state, STATES.DISCOVERED);
  assert.equal(s.issue, 42);
});

test('newState carries an opencode session-metadata structure', () => {
  const s = newState(42);
  assert.ok(s.opencode, 'missing opencode structure');
  assert.equal(s.opencode.schema_version, 1);
  assert.equal(s.opencode.fixer, null);
  assert.equal(s.opencode.qa, null);
  assert.deepEqual(s.opencode.specialists, {});
  assert.equal(s.opencode.inflight, null);
});

test('startFollowupRound preserves fixer and qa session ids', () => {
  const record = {
    ...newState(7),
    state: STATES.DONE,
    opencode: {
      schema_version: 1,
      fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' },
      qa: { session_id: 'ses_qa', agent: 'qa' },
      specialists: {},
      inflight: null,
    },
  };
  const next = startFollowupRound(record, { commentId: 'c9', data: 'new round' });
  assert.equal(next.opencode.fixer.session_id, 'ses_fixer');
  assert.equal(next.opencode.qa.session_id, 'ses_qa');
  assert.equal(next.processing_round, 2);
  assert.equal(next.gate_1_approved_comment_id, null);
  assert.equal(next.gate_1_revision_data, null);
});

test('normalizeState backfills opencode for an older record', () => {
  const old = { issue: 5, state: STATES.DISCOVERED };
  const normalized = normalizeState(old, 5);
  assert.ok(normalized.opencode);
  assert.equal(normalized.opencode.schema_version, 1);
  assert.equal(normalized.opencode.fixer, null);
});

test('write then read round-trips all fields', () => {
  const dir = tempGuardianDir();
  try {
    const original = {
      ...newState(7),
      state: STATES.GATE_1_WAIT,
      risk: RISK.HIGH,
      branch: 'fix/issue-7',
      pr_url: 'https://gh/pr/1',
      fix_rounds: 1,
      stall_retries: 0,
      last_consumed_comment_id: 'c123',
      last_notified_state: 'GATE_1_WAIT',
      handed_back_reason: null,
    };
    writeState(dir, original, { touch: false });
    const back = readState(dir, 7);
    for (const k of Object.keys(original)) {
      assert.deepEqual(back[k], original[k], `field ${k} did not round-trip`);
    }
  } finally {
    rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
  }
});

test('readState returns null when no record exists (new issue)', () => {
  const dir = tempGuardianDir();
  try {
    assert.equal(readState(dir, 999), null);
  } finally {
    rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
  }
});

test('normalizeState backfills fields from an older/partial record', () => {
  const partial = { issue: 5, state: STATES.FIXING }; // pre-schema record
  const n = normalizeState(partial, 5);
  assert.equal(n.fix_rounds, 0);
  assert.equal(n.stall_retries, 0);
  assert.equal(n.last_notified_state, null);
  assert.equal(n.state, STATES.FIXING);
});

test('writeState touch=true stamps updated_at; touch=false preserves it', () => {
  const dir = tempGuardianDir();
  try {
    const frozen = '2020-01-01T00:00:00.000Z';
    writeState(dir, { ...newState(1), updated_at: frozen }, { touch: false });
    assert.equal(readState(dir, 1).updated_at, frozen);
    const now = '2026-08-18T12:00:00.000Z';
    writeState(dir, readState(dir, 1), { touch: true, now });
    assert.equal(readState(dir, 1).updated_at, now);
  } finally {
    rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
  }
});

test('isActiveState / isTerminalState classification', () => {
  assert.equal(isActiveState(STATES.INVESTIGATING), true);
  assert.equal(isActiveState(STATES.FIXING), true);
  assert.equal(isActiveState(STATES.GATE_1_WAIT), false);
  assert.equal(isTerminalState(STATES.DONE), true);
  assert.equal(isTerminalState(STATES.HANDED_BACK), true);
  assert.equal(isTerminalState(STATES.FIXING), false);
});

test('isLeaseExpired only applies to active states', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const old = new Date(now - 60 * 60 * 1000).toISOString(); // 1h ago
  // waiting state: never "expired" regardless of age
  assert.equal(isLeaseExpired({ state: STATES.GATE_1_WAIT, updated_at: old }, 30 * 60 * 1000, now), false);
  // active state: 1h > 30m lease → expired
  assert.equal(isLeaseExpired({ state: STATES.FIXING, updated_at: old }, 30 * 60 * 1000, now), true);
  // active + fresh → not expired
  const fresh = new Date(now - 60 * 1000).toISOString();
  assert.equal(isLeaseExpired({ state: STATES.FIXING, updated_at: fresh }, 30 * 60 * 1000, now), false);
});

test('isLeaseExpired treats an unparseable heartbeat as expired (fail toward recovery)', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  assert.equal(isLeaseExpired({ state: STATES.FIXING, updated_at: 'not-a-date' }, 1000, now), true);
});

test('startFollowupRound preserves history and resets round-local fields', () => {
  const record = { ...newState(42), state: STATES.DONE, processing_round: 1, branch: 'fix/issue-42', pr_url: 'https://pr/42', risk: RISK.HIGH, fix_rounds: 2 };
  const next = startFollowupRound(record, { commentId: 9, data: 'new acceptance issue' }, '2026-08-18T12:00:00.000Z');
  assert.equal(next.state, STATES.INVESTIGATING);
  assert.equal(next.processing_round, 2);
  assert.equal(next.schema_version, 3);
  assert.equal(next.branch, null);
  assert.equal(next.fix_rounds, 0);
  assert.equal(next.last_followup_comment_id, 9);
  assert.equal(next.last_notified_state, null);
  assert.equal(next.round_history[0].pr_url, 'https://pr/42');
});
