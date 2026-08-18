// Tests for tools/guardian/wake-drain.mjs — Phase 4 scheduler-side coalescing + application-token
// guard (§3.3, §5). Proves the remaining Oracle regression cases: webhook + compensation converge
// to one application, out-of-order webhook preserves comment-chronology latest-wins, concurrent
// duplicate wakes coalesce to one reconcile, and an in_progress transition is retried by token
// (not a new logical run). Uses real temp-dir ledger + the pure state-router/selectCommand seams.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { planWakeTargets, guardTransition, unionWakeCandidates } from '../../tools/guardian/wake-drain.mjs';
import { transitionToken, recordApplied } from '../../tools/guardian/ledger.mjs';
import { routeIssue } from '../../tools/guardian/state-router.mjs';
import { selectCommand } from '../../tools/guardian/commands.mjs';
import { newState, STATES } from '../../tools/guardian/state.mjs';

function tempGuardianDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'guardian-wake-')), '.qa', 'guardian');
}
function cleanup(dir) {
  rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
}

test('planWakeTargets coalesces relay wakes + compensation into a unique sorted issue set', () => {
  const p = planWakeTargets({
    wakeRecords: [
      { delivery_id: 'd1', issue_number: 5 },
      { delivery_id: 'd2', issue_number: 5 },   // duplicate issue
      { delivery_id: 'd3', issue_number: null }, // pull_request/push → no issue wake
    ],
    compensationIssues: [7, 5, 3],               // overlaps issue 5
  });
  assert.deepEqual(p.issues, [3, 5, 7], 'issue 5 appears once; sorted; null dropped');
  assert.deepEqual(p.deliveryIds, ['d1', 'd2', 'd3'], 'all deliveries captured for ack');
});

// Oracle regression case 4: two near-simultaneous deliveries for the same issue → one reconcile.
test('REGRESSION 4: concurrent duplicate issue wakes coalesce to one reconcile target', () => {
  const p = planWakeTargets({
    wakeRecords: [{ delivery_id: 'a', issue_number: 42 }, { delivery_id: 'b', issue_number: 42 }],
    compensationIssues: [42],
  });
  assert.deepEqual(p.issues, [42], 'issue 42 reconciled once despite 3 sources');
});

// Oracle regression case 3: an out-of-order/late webhook must not change which command wins —
// comment chronology (selectCommand/isNewerComment) decides, not webhook arrival.
test('REGRESSION 3: out-of-order webhook preserves comment-chronology latest-wins', () => {
  const comments = [
    { id: 10, body: '/guardian revise do X', author: 'maintainer', createdAt: '2026-08-19T00:00:00Z' },
    { id: 20, body: '/guardian approve', author: 'maintainer', createdAt: '2026-08-19T01:00:00Z' },
  ];
  // Even though a "late webhook" might reference the older comment 10, reconciliation re-reads all
  // comments and selectCommand picks the newest eligible one (id 20), independent of arrival order.
  const cmd = selectCommand(comments, STATES.GATE_1_WAIT, null, ['maintainer']);
  assert.equal(cmd.verb, 'approve');
  assert.equal(cmd.commentId, 20);
});

// Oracle regression case 2: a webhook wake and a compensation poll that observe the SAME command
// must apply exactly once — the deterministic transition token is identical, so the second sees it
// already committed.
test('REGRESSION 2: webhook + compensation converge to one application via the transition token', () => {
  const dir = tempGuardianDir();
  try {
    const repo = 'o/r';
    const issue = 191;
    const decision = { action: 'RESUME', command: { commentId: 20, verb: 'approve' } };

    // First trigger (say, webhook): not yet applied → apply and commit.
    const g1 = guardTransition({ guardianDir: dir, repo, issue, decision });
    assert.equal(g1.alreadyApplied, false);
    recordApplied(dir, issue, g1.token, { action: 'RESUME', commandCommentId: 20, effectStatus: 'committed' });

    // Second trigger (compensation poll) sees the SAME command → same token → already applied.
    const g2 = guardTransition({ guardianDir: dir, repo, issue, decision });
    assert.equal(g2.token, g1.token, 'deterministic token across trigger paths');
    assert.equal(g2.alreadyApplied, true, 'second trigger must skip the effect');
  } finally { cleanup(dir); }
});

// Oracle regression case 5: an in_progress transition (crash before completion) is retried by the
// SAME token — never assigned a second logical run.
test('REGRESSION 5: in_progress transition is retried by same token, not a new run', () => {
  const dir = tempGuardianDir();
  try {
    const repo = 'o/r';
    const issue = 7;
    const decision = { action: 'START', command: { commentId: 3, verb: 'approve' } };
    const token = transitionToken({ repo, issue, commentId: 3, verb: 'approve', action: 'START' });

    // Launch intent recorded as in_progress, then the process "crashes" before completing.
    recordApplied(dir, issue, token, { action: 'START', commandCommentId: 3, effectStatus: 'in_progress' });

    // On restart the guard shows NOT already-committed (in_progress ≠ committed) → retry same token.
    const g = guardTransition({ guardianDir: dir, repo, issue, decision });
    assert.equal(g.token, token, 'same logical token on retry');
    assert.equal(g.alreadyApplied, false, 'in_progress is retryable, not a completed application');
  } finally { cleanup(dir); }
});

test('guardTransition derives a commandless token for DONE/STALLED (no comment)', () => {
  const dir = tempGuardianDir();
  try {
    const g = guardTransition({
      guardianDir: dir, repo: 'o/r', issue: 9,
      decision: { action: 'DONE' }, currentState: 'GATE_2_WAIT', factsDigest: 'closed',
    });
    assert.match(g.token, /^sha256:/);
    assert.equal(g.alreadyApplied, false);
    assert.equal(g.action, 'DONE');
  } finally { cleanup(dir); }
});

test('routeIssue still returns a single pure decision (seam unchanged by Phase 4)', () => {
  const rec = { ...newState(1), state: STATES.GATE_1_WAIT };
  const decision = routeIssue(rec, { closed: false, comments: [] }, { leaseMs: 1000, trustedAuthors: ['m'] });
  assert.equal(decision.action, 'SKIP');
  assert.equal(decision.reason, 'gate1-waiting');
});

// unionWakeCandidates is the ONLY local seam the scheduler needs to consume webhook wakes.
test('unionWakeCandidates: no wake records → candidate list returned UNCHANGED (zero behavior change)', () => {
  const candidates = [
    { issue: 5, claim_source: 'labeled', updatedAt: 'x' },
    { issue: 7, claim_source: 'new-open' },
  ];
  const out = unionWakeCandidates({ candidates, wakeRecords: [] });
  assert.deepEqual(out, candidates, 'a scheduler with no relay wired behaves exactly as today');
});

test('unionWakeCandidates: a wake for an issue already in compensation keeps the compensation entry', () => {
  const candidates = [{ issue: 5, claim_source: 'labeled', updatedAt: 'x' }];
  const out = unionWakeCandidates({ candidates, wakeRecords: [{ delivery_id: 'd1', issue_number: 5 }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].claim_source, 'labeled', 'compensation entry wins; not overwritten by wake');
});

test('unionWakeCandidates: a wake-only issue is appended once as webhook-wake; nulls dropped', () => {
  const candidates = [{ issue: 5, claim_source: 'labeled' }];
  const out = unionWakeCandidates({
    candidates,
    wakeRecords: [
      { delivery_id: 'd1', issue_number: 9 },
      { delivery_id: 'd2', issue_number: 9 },   // duplicate wake-only issue → appended once
      { delivery_id: 'd3', issue_number: null }, // pull_request/push → no issue wake
    ],
  });
  assert.deepEqual(out.map((c) => c.issue), [5, 9]);
  assert.equal(out[1].claim_source, 'webhook-wake');
});
