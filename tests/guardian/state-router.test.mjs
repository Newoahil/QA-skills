// Tests for tools/guardian/state-router.mjs — the §11A.2 dispatch table.
// Covers acceptance 13-15 (dedup/lease), 19-22 (gate-1 resume/reject, terminal retry, gate-2
// rework), 24-25 (deterministic close-out / STALLED), with gh facts as fixtures.

import assert from 'node:assert/strict';
import test from 'node:test';

import { routeIssue, MAX_STALL_RETRIES, MAX_FIX_ROUNDS } from '../../tools/guardian/state-router.mjs';
import { STATES, newState } from '../../tools/guardian/state.mjs';
import { buildGitHubTaskObservation } from '../../tools/guardian/github-task-source.mjs';

const LEASE = 30 * 60 * 1000;
const NOW = Date.parse('2026-08-18T12:00:00Z');
const TRUSTED = ['maintainer'];
// Router opts for command-consuming tests: include the trusted-author whitelist.
const OPTS = { leaseMs: LEASE, now: NOW, trustedAuthors: TRUSTED };

function rec(overrides = {}) {
  return { ...newState(42, new Date(NOW).toISOString()), ...overrides };
}
function gh(overrides = {}) {
  return { closed: false, comments: [], ...overrides };
}
function observation(record, overrides = {}, opts = {}) {
  return buildGitHubTaskObservation({
    issueNumber: 42,
    record,
    githubIssue: gh(overrides),
    trustedAuthors: opts.trustedAuthors ?? [],
  });
}
function route(record, overrides = {}, opts = { leaseMs: LEASE, now: NOW }) {
  return routeIssue(record, observation(record, overrides, opts), opts);
}
function comment(id, body, author = 'maintainer') {
  return { id, body, author, createdAt: `2026-08-18T11:${String(id).padStart(2, '0')}:00Z` };
}

test('no record → START into INVESTIGATING (new issue)', () => {
  const d = route(null, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'START');
  assert.equal(d.toState, STATES.INVESTIGATING);
});

test('DISCOVERED → START (treated as new)', () => {
  const r = rec({ state: STATES.DISCOVERED });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'START');
});

test('active state with fresh heartbeat → SKIP (dedup, acceptance 14)', () => {
  const fresh = rec({ state: STATES.FIXING, updated_at: new Date(NOW - 60 * 1000).toISOString() });
  const d = route(fresh, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'in-progress-fresh-lease');
});

test('active state with expired lease + idempotent stage → STALLED, auto-rerunnable (acceptance 25)', () => {
  const stale = rec({ state: STATES.INVESTIGATING, updated_at: new Date(NOW - LEASE - 1000).toISOString() });
  const d = route(stale, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'STALLED');
  assert.equal(d.idempotentStage, true);
  assert.equal(d.nextStallRetries, 1);
});

test('active state with expired lease, non-idempotent stage → STALLED flagged non-idempotent', () => {
  const stale = rec({ state: STATES.FIXING, updated_at: new Date(NOW - LEASE - 1000).toISOString() });
  const d = route(stale, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'STALLED');
  assert.equal(d.idempotentStage, false);
});

test('STALLED beyond retry cap → HANDED_BACK(reason=stalled) (acceptance 25)', () => {
  const stale = rec({
    state: STATES.INVESTIGATING,
    updated_at: new Date(NOW - LEASE - 1000).toISOString(),
    stall_retries: MAX_STALL_RETRIES,
  });
  const d = route(stale, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'HANDED_BACK');
  assert.equal(d.handedBackReason, 'stalled');
});

test('GATE_1_WAIT + no command → SKIP (waiting, not nagging, acceptance 19)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('GATE_1_WAIT + /guardian approve → RESUME to FIXING (acceptance 19)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian approve')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.FIXING);
  assert.equal(d.command.commentId, 1);
});

test('GATE_1_WAIT + /guardian reject → HANDED_BACK(reason=reject), permanent (acceptance 20)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian reject')] }, OPTS);
  assert.equal(d.action, 'HANDED_BACK');
  assert.equal(d.handedBackReason, 'reject');
});

test('GATE_1_WAIT + revise carries data tail (as DATA)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian revise use a guard clause instead')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.command.verb, 'revise');
  assert.equal(d.command.data, 'use a guard clause instead');
});

test('HANDED_BACK default → SKIP permanently even with label (acceptance 20)', () => {
  const r = rec({ state: STATES.HANDED_BACK, handed_back_reason: 'reject' });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'handed-back-terminal');
});

test('HANDED_BACK + /guardian retry → RESUME INVESTIGATING, clears fix_rounds (acceptance 21)', () => {
  const r = rec({ state: STATES.HANDED_BACK, fix_rounds: 2 });
  const d = route(r, { comments: [comment(1, '/guardian retry')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.INVESTIGATING);
  assert.equal(d.clearFixRounds, true);
});

test('GATE_2_WAIT + issue closed (human merged) → DONE (acceptance 9)', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = route(r, { closed: true }, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'DONE');
  assert.equal(d.reason, 'merged-closed');
});

test('GATE_2_WAIT + /guardian rework → RESUME FIXING (acceptance 22)', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian rework please also cover the null case')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.FIXING);
  assert.equal(d.command.verb, 'rework');
});

test('GATE_2_WAIT + no command + open → SKIP (still waiting on human review)', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate2-waiting');
});

test('DONE → SKIP', () => {
  const r = rec({ state: STATES.DONE });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'done');
});

test('wrong-state command is ignored (gate-2 rework offered while in gate-1)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian rework nope')] }, { leaseMs: LEASE, now: NOW });
  // rework is invalid in GATE_1_WAIT → no command consumed → keep waiting
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('MAX_FIX_ROUNDS is exported and sane', () => {
  assert.equal(MAX_FIX_ROUNDS >= 1 && MAX_FIX_ROUNDS <= 2, true);
});

test('GATE_1_WAIT + approve from an UNTRUSTED author → SKIP (authorization boundary)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian approve', 'attacker')] }, OPTS);
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('GATE_1_WAIT + approve but no trustedAuthors configured → SKIP (fail-closed)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian approve')] }, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('DONE + trusted /guardian followup → RESUME new INVESTIGATING round', () => {
  const r = rec({ state: STATES.DONE });
  const d = route(r, { comments: [comment(10, '/guardian followup new acceptance failure')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.INVESTIGATING);
  assert.equal(d.newRound, true);
  assert.equal(d.command.data, 'new acceptance failure');
});

test('closed GATE_2_WAIT + followup wins over DONE transition', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = route(r, { closed: true, comments: [comment(10, '/guardian followup post-merge issue')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'followup');
  assert.equal(d.newRound, true);
});
