import assert from 'node:assert/strict';
import test from 'node:test';

import { isDecisionReady, rankHypotheses, validateDossier } from '../../tools/guardian/evidence.mjs';

const base = {
  issue: 42,
  issue_class: 'bug',
  hypotheses: [{ id: 'H1', statement: 'root cause' }, { id: 'H2', statement: 'alternative' }],
  evidence: [
    { id: 'E1', kind: 'runtime_reproduction', source: 'test:1', observation: 'reproduces', supports: ['H1'], contradicts: [] },
    { id: 'E2', kind: 'source_invariant', source: 'file:2', observation: 'guard rejects', supports: ['H1'], contradicts: ['H2'] },
  ],
  unresolved_facts: [],
  acceptance_criteria: [],
  selected_hypothesis: 'H1',
};

test('validateDossier accepts evidence-backed bug dossier', () => {
  assert.deepEqual(validateDossier(base), { valid: true, errors: [] });
  assert.equal(isDecisionReady(base).ready, true);
});

test('request dossier requires acceptance criteria', () => {
  assert.equal(validateDossier({ ...base, issue_class: 'request' }).errors.includes('request-missing-acceptance-criteria'), true);
  assert.equal(validateDossier({ ...base, issue_class: 'request', acceptance_criteria: [{ id: 'AC1', then: 'works' }] }).valid, true);
});

test('unresolved facts block decision readiness', () => {
  const result = isDecisionReady({ ...base, unresolved_facts: [{ id: 'F1', unknown: 'production state' }] });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ['unresolved-facts']);
});

test('hypotheses rank by supporting minus contradicting evidence strength', () => {
  const ranked = rankHypotheses(base.hypotheses, base.evidence);
  assert.equal(ranked[0].id, 'H1');
  assert.equal(ranked[0].score, 7);
  assert.equal(ranked[1].score, -3);
});

test('malformed evidence cannot become decision-ready', () => {
  const invalid = validateDossier({ ...base, evidence: [{ id: 'E1', kind: 'static_search' }] });
  assert.equal(invalid.valid, false);
});
