// Integration tests for the Supervisor verdict-comment writer (scheduler.writeVerdictComment).
// Verifies §3A.4 idempotency and §3 "Supervisor is the sole writer" wiring against REAL temp-dir
// state I/O with an injected spy ghComment (no gh, no network).

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeVerdictComment } from '../../tools/guardian/scheduler.mjs';
import { newState, writeState, readState } from '../../tools/guardian/state.mjs';
import { ACTORS } from '../../tools/guardian/actor-routing.mjs';

function tempGuardianDir() {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'guardian-verdict-')), '.qa', 'guardian');
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
}
function spy() {
  const calls = [];
  return { calls, ghComment: (issue, body) => calls.push({ issue, body }) };
}

test('QA_VERIFIED: posts exactly one comment carrying the PR link + persists idempotency hash', () => {
  const dir = tempGuardianDir();
  try {
    writeState(dir, { ...newState(191), branch: 'fix/issue-191' }, { touch: false });
    const io = spy();
    const res = writeVerdictComment(dir, 191, {
      approved: true, status: 'PASS', branch: 'fix/issue-191',
      prUrl: 'https://github.com/x/y/pull/9', reportHash: 'sha256:abc',
    }, { actor: ACTORS.SUPERVISOR, ghComment: io.ghComment });

    assert.equal(res.delivered, true);
    assert.equal(res.marker, 'QA_VERIFIED');
    assert.equal(io.calls.length, 1);
    assert.equal(io.calls[0].issue, 191);
    assert.equal(io.calls[0].body.split('\n')[0], '[QA_VERIFIED]');
    assert.match(io.calls[0].body, /pull\/9/);
    // Idempotency hash persisted on the state record.
    assert.match(readState(dir, 191).last_verdict_comment_hash, /^sha256:[0-9a-f]{64}$/);
  } finally { cleanup(dir); }
});

test('idempotent across ticks: identical verdict does not re-post', () => {
  const dir = tempGuardianDir();
  try {
    writeState(dir, { ...newState(42), branch: 'fix/issue-42' }, { touch: false });
    const io = spy();
    const params = {
      approved: true, status: 'PASS', branch: 'fix/issue-42',
      prUrl: 'https://gh/pr/1', reportHash: 'sha256:x', verifiedAt: '2026-08-19T00:00:00.000Z',
    };
    const first = writeVerdictComment(dir, 42, params, { actor: ACTORS.SUPERVISOR, ghComment: io.ghComment });
    const second = writeVerdictComment(dir, 42, params, { actor: ACTORS.SUPERVISOR, ghComment: io.ghComment });

    assert.equal(first.delivered, true);
    assert.equal(second.skipped, true);
    assert.equal(second.delivered, false);
    assert.equal(io.calls.length, 1, 'only one comment across two ticks');
  } finally { cleanup(dir); }
});

test('QA_FAILED: posts [QA_FAILED] with reason and no PR link', () => {
  const dir = tempGuardianDir();
  try {
    writeState(dir, { ...newState(7), branch: 'fix/issue-7' }, { touch: false });
    const io = spy();
    const res = writeVerdictComment(dir, 7, {
      approved: false, status: 'FAIL', branch: 'fix/issue-7', reason: 'qa-status-FAIL',
    }, { actor: ACTORS.SUPERVISOR, ghComment: io.ghComment });

    assert.equal(res.marker, 'QA_FAILED');
    assert.equal(io.calls.length, 1);
    assert.equal(io.calls[0].body.split('\n')[0], '[QA_FAILED]');
    assert.doesNotMatch(io.calls[0].body, /pull\//);
  } finally { cleanup(dir); }
});

test('a QA_VERIFIED then a distinct QA_FAILED both post (different hashes)', () => {
  const dir = tempGuardianDir();
  try {
    writeState(dir, { ...newState(5), branch: 'fix/issue-5' }, { touch: false });
    const io = spy();
    writeVerdictComment(dir, 5, { approved: true, status: 'PASS', branch: 'fix/issue-5', prUrl: 'https://gh/pr/2' }, { actor: ACTORS.SUPERVISOR, ghComment: io.ghComment });
    writeVerdictComment(dir, 5, { approved: false, status: 'FAIL', branch: 'fix/issue-5', reason: 'qa-status-FAIL' }, { actor: ACTORS.SUPERVISOR, ghComment: io.ghComment });
    assert.equal(io.calls.length, 2);
  } finally { cleanup(dir); }
});

test('delivery failure is swallowed (best-effort) and hash NOT persisted so a retry can succeed', () => {
  const dir = tempGuardianDir();
  try {
    writeState(dir, { ...newState(9), branch: 'fix/issue-9' }, { touch: false });
    let attempts = 0;
    const failingThenOk = (issue, body) => { attempts += 1; if (attempts === 1) throw new Error('gh down'); };
    const fail = writeVerdictComment(dir, 9, { approved: true, status: 'PASS', branch: 'fix/issue-9', prUrl: 'https://gh/pr/3' }, { actor: ACTORS.SUPERVISOR, ghComment: failingThenOk });
    assert.equal(fail.delivered, false);
    assert.match(fail.error, /gh down/);
    // hash must NOT be persisted after a failed delivery.
    assert.equal(readState(dir, 9).last_verdict_comment_hash, null);
    // retry succeeds.
    const ok = writeVerdictComment(dir, 9, { approved: true, status: 'PASS', branch: 'fix/issue-9', prUrl: 'https://gh/pr/3' }, { actor: ACTORS.SUPERVISOR, ghComment: failingThenOk });
    assert.equal(ok.delivered, true);
    assert.equal(attempts, 2);
  } finally { cleanup(dir); }
});

test('writeVerdictComment rejects QA, fixer, and unknown actors before comment I/O', () => {
  for (const actor of ['qa', ACTORS.BOT_EXECUTOR, 'unknown']) {
    const dir = tempGuardianDir();
    try {
      writeState(dir, { ...newState(10), branch: 'fix/issue-10' }, { touch: false });
      let calls = 0;
      const result = writeVerdictComment(dir, 10, { approved: true, status: 'PASS' }, { actor, ghComment: () => { calls += 1; } });
      assert.equal(result.delivered, false);
      assert.match(result.error, /may not perform|unknown actor/);
      assert.equal(calls, 0, actor);
    } finally { cleanup(dir); }
  }
});
