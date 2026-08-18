import assert from 'node:assert/strict';
import test from 'node:test';

import { auditQaVerdict, buildQaVerdict, canOpenPr, hashQaReport } from '../../tools/guardian/qa-verdict.mjs';

test('buildQaVerdict materializes PASS report with hash and context', () => {
  const report = 'Overall Status: PASS\nall checks passed';
  const verdict = buildQaVerdict(report, { issue: 42, branch: 'fix/issue-42', verified_at: 'now' });
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.report_hash, hashQaReport(report));
  assert.equal(canOpenPr(verdict, { issue: 42, branch: 'fix/issue-42' }), true);
});

test('missing/FAIL report cannot open PR', () => {
  assert.equal(buildQaVerdict('no verdict', { issue: 1 }).status, 'NEEDS_HUMAN_REVIEW');
  assert.equal(canOpenPr(buildQaVerdict('Overall Status: FAIL', { issue: 1 }), { issue: 1 }), false);
});

test('auditQaVerdict fails closed for missing or non-PASS artifacts', () => {
  assert.equal(auditQaVerdict(null, { issue: 1 }).approved, false);
  const fail = buildQaVerdict('Overall Status: FAIL', { issue: 1 });
  assert.equal(auditQaVerdict(fail, { issue: 1 }).approved, false);
});
