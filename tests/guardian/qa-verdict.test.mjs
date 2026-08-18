import assert from 'node:assert/strict';
import test from 'node:test';

import { canOpenPr, parseOverallStatus, validateQaVerdict } from '../../tools/guardian/qa-verdict.mjs';

test('parseOverallStatus extracts the exact machine-readable QA line', () => {
  assert.equal(parseOverallStatus('details\nOverall Status: PASS\n'), 'PASS');
  assert.equal(parseOverallStatus('Overall Status: FAIL'), 'FAIL');
  assert.equal(parseOverallStatus('status PASS'), null);
});

test('PASS verdict requires issue/branch/time/report hash contract', () => {
  const verdict = { status: 'PASS', issue: 42, branch: 'fix/issue-42', verified_at: '2026-01-01T00:00:00Z', report_hash: 'sha256:x' };
  assert.equal(validateQaVerdict(verdict, { issue: 42, branch: 'fix/issue-42' }).valid, true);
  assert.equal(canOpenPr(verdict, { issue: 42, branch: 'fix/issue-42' }), true);
});

test('FAIL/BLOCKED/mismatch cannot open a PR', () => {
  const base = { issue: 42, branch: 'fix/issue-42', verified_at: 'now', report_hash: 'x' };
  assert.equal(canOpenPr({ ...base, status: 'FAIL' }, base), false);
  assert.equal(canOpenPr({ ...base, status: 'PASS', issue: 7 }, base), false);
  assert.equal(canOpenPr({ ...base, status: 'PASS', report_hash: undefined }, base), false);
});
