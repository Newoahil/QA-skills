// Tests for tools/guardian/verdict-comment.mjs — §3A Supervisor verdict-comment protocol.
// Covers: marker vocabulary, comment shape (marker line 1 + sentence + fenced JSON), metadata
// allow-list (no code/secrets), injection-safety (a verdict comment can never be re-parsed as a
// /guardian command), and idempotency hashing.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVerdictComment,
  markerForApproval,
  assertMarkerIsNotCommand,
  assertSafeMeta,
  hashVerdictComment,
  MARKERS,
  PROTOCOL,
} from '../../tools/guardian/verdict-comment.mjs';
import { selectCommand } from '../../tools/guardian/commands.mjs';

// Extract the fenced JSON metadata envelope from a comment body.
function extractMeta(body) {
  const m = body.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(m, 'comment must contain a fenced json block');
  return JSON.parse(m[1]);
}

test('markerForApproval maps approved→QA_VERIFIED, else QA_FAILED', () => {
  assert.equal(markerForApproval(true), MARKERS.QA_VERIFIED);
  assert.equal(markerForApproval(false), MARKERS.QA_FAILED);
});

test('QA_VERIFIED comment: marker on line 1, sentence, fenced json with pr_url', () => {
  const body = buildVerdictComment({
    marker: MARKERS.QA_VERIFIED,
    issue: 191,
    status: 'PASS',
    branch: 'fix/issue-191',
    prUrl: 'https://github.com/x/y/pull/5',
    prTitle: 'Fix issue 191',
    runId: 'run-abc',
    attempt: 1,
    reportHash: 'sha256:deadbeef',
    verifiedAt: '2026-08-19T00:00:00.000Z',
  });
  const lines = body.split('\n');
  assert.equal(lines[0], '[QA_VERIFIED]');
  const meta = extractMeta(body);
  assert.equal(meta.protocol, PROTOCOL);
  assert.equal(meta.marker, 'QA_VERIFIED');
  assert.equal(meta.agent, 'guardian-supervisor');
  assert.equal(meta.issue, 191);
  assert.equal(meta.status, 'PASS');
  assert.equal(meta.branch, 'fix/issue-191');
  assert.equal(meta.pr_url, 'https://github.com/x/y/pull/5');
  assert.equal(meta.report_hash, 'sha256:deadbeef');
  assert.equal('pr_title' in meta, false);
  assert.match(body, /## QA 验收结论/);
  assert.match(body, /PR 标题：Fix issue 191/);
  assert.match(body, /QA 报告指纹：sha256:deadbeef/);
});

test('QA_FAILED comment: marker QA_FAILED, reason keyword, null pr_url', () => {
  const body = buildVerdictComment({
    marker: MARKERS.QA_FAILED,
    issue: 42,
    status: 'FAIL',
    branch: 'fix/issue-42',
    reason: 'qa-status-FAIL',
  });
  assert.equal(body.split('\n')[0], '[QA_FAILED]');
  const meta = extractMeta(body);
  assert.equal(meta.marker, 'QA_FAILED');
  assert.equal(meta.status, 'FAIL');
  assert.equal(meta.pr_url, null);
  assert.match(body, /## QA 验收结论/);
  assert.match(body, /未开 PR，原因：qa-status-FAIL/);
});

test('BLOCKED / NEEDS_HUMAN_REVIEW status still produce a valid QA_FAILED comment', () => {
  for (const status of ['BLOCKED', 'NEEDS_HUMAN_REVIEW']) {
    const body = buildVerdictComment({ marker: MARKERS.QA_FAILED, issue: 7, status, reason: `qa-status-${status}` });
    const meta = extractMeta(body);
    assert.equal(meta.marker, 'QA_FAILED');
    assert.equal(meta.status, status);
  }
});

test('rejects an unsupported marker (e.g. reserved FIXER_PR_OPENED) in Phase 2', () => {
  assert.throws(() => buildVerdictComment({ marker: 'FIXER_PR_OPENED', issue: 1 }), /unsupported marker/);
});

test('rejects a non-integer issue', () => {
  assert.throws(() => buildVerdictComment({ marker: MARKERS.QA_VERIFIED, issue: 'abc' }), /issue must be an integer/);
});

test('assertSafeMeta rejects disallowed keys (no code/secret leak)', () => {
  assert.throws(() => assertSafeMeta({ protocol: PROTOCOL, marker: 'QA_VERIFIED', diff: 'secret code' }), /disallowed keys/);
});

test('metadata envelope contains no code/diff/token keys', () => {
  const body = buildVerdictComment({ marker: MARKERS.QA_VERIFIED, issue: 191, status: 'PASS' });
  const meta = extractMeta(body);
  for (const forbidden of ['diff', 'code', 'token', 'secret', 'report', 'body']) {
    assert.equal(forbidden in meta, false, `metadata must not carry '${forbidden}'`);
  }
});

test('assertMarkerIsNotCommand passes for a real verdict comment', () => {
  const body = buildVerdictComment({ marker: MARKERS.QA_VERIFIED, issue: 191, status: 'PASS' });
  assert.equal(assertMarkerIsNotCommand(body), true);
});

test('assertMarkerIsNotCommand throws if a /guardian line is present', () => {
  assert.throws(() => assertMarkerIsNotCommand('[QA_VERIFIED]\n/guardian approve\n'), /injection-safety/);
});

test('INJECTION REGRESSION: selectCommand never parses a verdict comment as a command', () => {
  // A supervisor/bot verdict comment, even from a trusted author, must NOT be treated as an
  // authorization command. The whole safety of the protocol (§3A.3) rests on this.
  for (const marker of [MARKERS.QA_VERIFIED, MARKERS.QA_FAILED]) {
    const body = buildVerdictComment({ marker, issue: 191, status: marker === MARKERS.QA_VERIFIED ? 'PASS' : 'FAIL' });
    const comments = [{ id: 1, body, createdAt: '2026-08-19T00:00:00Z', author: 'guardian-supervisor' }];
    // Even with the author trusted, no /guardian verb exists in the body → no command.
    for (const state of ['GATE_1_WAIT', 'GATE_2_WAIT', 'HANDED_BACK', 'DONE']) {
      const cmd = selectCommand(comments, state, null, ['guardian-supervisor']);
      assert.equal(cmd, null, `verdict comment must not parse as a command in ${state}`);
    }
  }
});

test('hashVerdictComment is deterministic and sha256-prefixed', () => {
  const body = buildVerdictComment({ marker: MARKERS.QA_VERIFIED, issue: 1, status: 'PASS', verifiedAt: '2026-08-19T00:00:00.000Z' });
  const h1 = hashVerdictComment(body);
  const h2 = hashVerdictComment(body);
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});
