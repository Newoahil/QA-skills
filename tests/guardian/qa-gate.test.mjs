import assert from 'node:assert/strict';
import test from 'node:test';

import { canCreatePr } from '../../tools/guardian/qa-gate.mjs';

const base = { issue: 42, branch: 'fix/issue-42', verified_at: 'now', report_hash: 'sha256:x', status: 'PASS' };

test('qa gate allows PR only for matching PASS verdict', () => {
  const result = canCreatePr({ verdict: base, issue: 42, branch: 'fix/issue-42' });
  assert.equal(result.allowed, true);
});

test('qa gate rejects missing, failed, stale, or mismatched verdicts', () => {
  assert.equal(canCreatePr({ verdict: null, issue: 42, branch: base.branch }).allowed, false);
  assert.equal(canCreatePr({ verdict: { ...base, status: 'FAIL' }, issue: 42, branch: base.branch }).allowed, false);
  assert.equal(canCreatePr({ verdict: base, issue: 42, branch: 'fix/other' }).allowed, false);
  assert.equal(canCreatePr({ verdict: base, issue: 42, branch: base.branch, expectedPlanHash: 'p1' }).allowed, false);
});

test('qa gate accepts a PASS tied to the exact plan hash', () => {
  const result = canCreatePr({ verdict: { ...base, plan_hash: 'p1' }, issue: 42, branch: base.branch, expectedPlanHash: 'p1' });
  assert.equal(result.allowed, true);
});

test('qa gate accepts a PASS only when expected plan revision also matches', () => {
  assert.equal(canCreatePr({ verdict: { ...base, plan_hash: 'p1', plan_revision: 'r1' }, issue: 42, branch: base.branch, expectedPlanHash: 'p1', expectedPlanRevision: 'r1' }).allowed, true);
  assert.equal(canCreatePr({ verdict: { ...base, plan_hash: 'p1', plan_revision: 'r2' }, issue: 42, branch: base.branch, expectedPlanHash: 'p1', expectedPlanRevision: 'r1' }).allowed, false);
});
