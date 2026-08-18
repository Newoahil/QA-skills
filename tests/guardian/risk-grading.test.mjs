// Tests for tools/guardian/risk.mjs — §5A risk grading.
// Covers acceptance 10-12: clear-high → HIGH, insufficient-info → HIGH (fail-safe),
// clear-low (all whitelist clauses) → LOW. Plus each individual whitelist clause forcing HIGH.

import assert from 'node:assert/strict';
import test from 'node:test';

import { gradeRisk, RISK, HIGH_RISK_SURFACES, DEFAULT_MAX_LOW_DIFF_LINES } from '../../tools/guardian/risk.mjs';

// A fully-clean LOW assessment (all whitelist clauses satisfied).
function cleanLow(overrides = {}) {
  return {
    certain: true,
    lowDangerSurfaceOnly: true,
    touchedSurfaces: [],
    localImpact: true,
    diffLines: 10,
    reproducibleOracle: true,
    scopeExpansionRequested: false,
    ...overrides,
  };
}

test('clear low (all clauses) → LOW (acceptance 12)', () => {
  const r = gradeRisk(cleanLow());
  assert.equal(r.risk, RISK.LOW);
});

test('fail-safe: not certain / insufficient info → HIGH (acceptance 11)', () => {
  assert.equal(gradeRisk(cleanLow({ certain: false })).risk, RISK.HIGH);
  assert.equal(gradeRisk({}).risk, RISK.HIGH); // empty assessment → HIGH
  assert.equal(gradeRisk(undefined).risk, RISK.HIGH); // missing → HIGH
});

test('clear high: touching a high-risk surface → HIGH (acceptance 10)', () => {
  const r = gradeRisk(cleanLow({ touchedSurfaces: ['authn-authz-permission'] }));
  assert.equal(r.risk, RISK.HIGH);
  assert.match(JSON.stringify(r.reasons), /authn-authz-permission/);
});

test('every high-risk surface individually forces HIGH', () => {
  for (const surface of HIGH_RISK_SURFACES) {
    const r = gradeRisk(cleanLow({ touchedSurfaces: [surface] }));
    assert.equal(r.risk, RISK.HIGH, `surface ${surface} must force HIGH`);
  }
});

test('each missing whitelist clause forces HIGH (all AND)', () => {
  assert.equal(gradeRisk(cleanLow({ lowDangerSurfaceOnly: false })).risk, RISK.HIGH);
  assert.equal(gradeRisk(cleanLow({ localImpact: false })).risk, RISK.HIGH);
  assert.equal(gradeRisk(cleanLow({ reproducibleOracle: false })).risk, RISK.HIGH);
});

test('diff over budget → HIGH; at budget → LOW', () => {
  assert.equal(gradeRisk(cleanLow({ diffLines: DEFAULT_MAX_LOW_DIFF_LINES + 1 })).risk, RISK.HIGH);
  assert.equal(gradeRisk(cleanLow({ diffLines: DEFAULT_MAX_LOW_DIFF_LINES })).risk, RISK.LOW);
});

test('configurable diff budget is honored', () => {
  assert.equal(gradeRisk(cleanLow({ diffLines: 5 }), { maxLowDiffLines: 3 }).risk, RISK.HIGH);
  assert.equal(gradeRisk(cleanLow({ diffLines: 3 }), { maxLowDiffLines: 3 }).risk, RISK.LOW);
});

test('issue-requested scope expansion → HIGH (injection guard §12)', () => {
  const r = gradeRisk(cleanLow({ scopeExpansionRequested: true }));
  assert.equal(r.risk, RISK.HIGH);
  assert.match(JSON.stringify(r.reasons), /scope-expansion/);
});

test('missing fields (undefined) are treated as NOT satisfied → HIGH', () => {
  // certain true but everything else undefined
  const r = gradeRisk({ certain: true });
  assert.equal(r.risk, RISK.HIGH);
});

test('LOW result reports matched clauses and excluded high-risk signals', () => {
  const r = gradeRisk(cleanLow());
  assert.equal(r.risk, RISK.LOW);
  assert.ok(r.matchedClauses.includes('no-high-risk-surface'));
  // all high-risk surfaces are recorded as explicitly excluded (audit trail §5A.3.2)
  for (const s of HIGH_RISK_SURFACES) assert.ok(r.excludedSignals.includes(s));
});
