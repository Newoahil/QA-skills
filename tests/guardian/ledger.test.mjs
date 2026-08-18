// Tests for tools/guardian/ledger.mjs — Phase 4 unified 3-layer idempotency ledger (§3).
// Proves: deterministic application tokens (same across replay/trigger path), distinct artifact vs
// application identity, ingestion replay dedupe, applied lifecycle (in_progress → committed), and
// that attacker-influenced delivery ids / tokens cannot escape the ledger directory.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  transitionToken, commandlessTransitionToken, commandArtifactToken, prArtifactToken,
  recordIngestion, hasIngested, recordApplied, readApplied, hasAppliedCommitted, ledgerRoot,
} from '../../tools/guardian/ledger.mjs';

function tempGuardianDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'guardian-ledger-')), '.qa', 'guardian');
}
function cleanup(dir) {
  rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
}

test('transitionToken is deterministic and sha256-prefixed (same across trigger paths)', () => {
  const args = { repo: 'o/r', issue: 191, commentId: 42, verb: 'approve', action: 'START' };
  const a = transitionToken(args);
  const b = transitionToken({ ...args });
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test('transitionToken differs when any component differs', () => {
  const base = { repo: 'o/r', issue: 1, commentId: 2, verb: 'approve', action: 'START' };
  const t = transitionToken(base);
  assert.notEqual(t, transitionToken({ ...base, action: 'RESUME' }));
  assert.notEqual(t, transitionToken({ ...base, commentId: 3 }));
  assert.notEqual(t, transitionToken({ ...base, issue: 2 }));
});

test('commandless token is stable and independent of any comment', () => {
  const t1 = commandlessTransitionToken({ issue: 5, currentState: 'GATE_2_WAIT', action: 'DONE', factsDigest: 'closed' });
  const t2 = commandlessTransitionToken({ issue: 5, currentState: 'GATE_2_WAIT', action: 'DONE', factsDigest: 'closed' });
  assert.equal(t1, t2);
  assert.match(t1, /^sha256:/);
});

test('artifact identity is distinct from application identity', () => {
  const artifact = commandArtifactToken(191, 42);
  const application = transitionToken({ repo: 'o/r', issue: 191, commentId: 42, verb: 'approve', action: 'START' });
  assert.notEqual(artifact, application);
  assert.equal(artifact, 'issue:191:comment:42');
  assert.equal(prArtifactToken(9), 'pr:9');
});

test('ingestion: first insert returns inserted, replay returns not-inserted (dedupe)', () => {
  const dir = tempGuardianDir();
  try {
    const first = recordIngestion(dir, { deliveryId: 'delivery-abc', issue: 191, eventType: 'issue_comment' });
    assert.equal(first.inserted, true);
    assert.equal(hasIngested(dir, 'delivery-abc'), true);
    const replay = recordIngestion(dir, { deliveryId: 'delivery-abc', issue: 191, eventType: 'issue_comment' });
    assert.equal(replay.inserted, false, 'replayed delivery must not insert again');
  } finally { cleanup(dir); }
});

test('applied lifecycle: in_progress is not committed; committed passes hasAppliedCommitted', () => {
  const dir = tempGuardianDir();
  try {
    const token = transitionToken({ repo: 'o/r', issue: 7, commentId: 1, verb: 'approve', action: 'START' });
    recordApplied(dir, 7, token, { action: 'START', fromState: 'GATE_1_WAIT', toState: 'FIXING', effectStatus: 'in_progress' });
    assert.equal(hasAppliedCommitted(dir, 7, token), false);
    // Commit it; applied_at must be preserved from the first write.
    const first = readApplied(dir, 7, token);
    recordApplied(dir, 7, token, { effectStatus: 'committed' });
    const committed = readApplied(dir, 7, token);
    assert.equal(committed.effect_status, 'committed');
    assert.equal(committed.applied_at, first.applied_at, 'applied_at is preserved across updates');
    assert.equal(hasAppliedCommitted(dir, 7, token), true);
  } finally { cleanup(dir); }
});

test('path safety: a malicious delivery id cannot escape the ledger dir', () => {
  const dir = tempGuardianDir();
  try {
    recordIngestion(dir, { deliveryId: '../../../etc/evil', issue: 1, eventType: 'push' });
    // The file must live INSIDE ledger/ingested, not outside the guardian dir.
    const ingestedDir = path.join(ledgerRoot(dir), 'ingested');
    assert.ok(existsSync(ingestedDir));
    const entries = readdirSync(ingestedDir);
    assert.equal(entries.length, 1);
    assert.doesNotMatch(entries[0], /[\\/]/, 'no path separators survive in the filename');
  } finally { cleanup(dir); }
});
