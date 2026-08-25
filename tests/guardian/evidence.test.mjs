import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVIDENCE_KIND_ALIASES,
  isDecisionReady,
  normalizeEvidenceItem,
  normalizeSpecialistResult,
  rankHypotheses,
  validateDossier,
} from '../../tools/guardian/evidence.mjs';

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

test('normalizeEvidenceItem maps explicit issue #263 aliases to canonical kinds', () => {
  assert.equal(EVIDENCE_KIND_ALIASES['issue-data'], 'issue_assertion');
  assert.equal(EVIDENCE_KIND_ALIASES.grep, 'static_search');
  assert.equal(EVIDENCE_KIND_ALIASES.source, 'source_invariant');
  assert.equal(EVIDENCE_KIND_ALIASES['test-inventory'], 'static_search');

  const normalized = normalizeEvidenceItem({
    id: 'E263',
    kind: 'tool-observation',
    source: 'playwright',
    observation: 'the page renders the wrong state',
    supports: ['H1'],
    contradicts: undefined,
  });

  assert.deepEqual(normalized, {
    id: 'E263',
    kind: 'runtime_reproduction',
    source: 'playwright',
    observation: 'the page renders the wrong state',
    supports: ['H1'],
    contradicts: [],
  });
});

test('normalizeEvidenceItem infers missing kind only from explicit source or tool metadata', () => {
  assert.equal(normalizeEvidenceItem({
    id: 'E-codegraph',
    source: 'codegraph',
    observation: 'call path proves the guard is reachable',
    supports: ['H1'],
    contradicts: [],
  }).kind, 'codegraph');

  assert.equal(normalizeEvidenceItem({
    id: 'E-docs',
    tool: 'context7',
    source: 'context7:docs',
    observation: 'official API docs require the field',
    supports: ['H1'],
    contradicts: [],
  }).kind, 'official_docs');

  assert.equal(normalizeEvidenceItem({
    id: 'E-source-only',
    provenance: 'frontend/apps/alipay-miniapp/src/pages/classifyAgain/index.js:886',
    observation: 'the node is rendered unconditionally',
    supports: ['H1'],
    contradicts: [],
  }).kind, 'source_invariant');

  assert.equal(normalizeEvidenceItem({
    id: 'E-grep-only',
    command: 'rg 点击继续浏览 frontend/apps/alipay-miniapp/src',
    observation: 'one match exists',
    supports: ['H1'],
    contradicts: [],
  }).kind, 'static_search');

  assert.throws(() => normalizeEvidenceItem({
    id: 'E-missing-kind',
    source: 'manual note',
    observation: 'someone said this probably happens',
    supports: ['H1'],
    contradicts: [],
  }), /invalid-kind/);
});

test('normalizeSpecialistResult namespaces duplicate evidence ids and rejects missing ids', () => {
  const normalized = normalizeSpecialistResult({
    specialist: 'guardian-code',
    hypotheses: [{ id: 'H1', statement: 'root cause' }],
    evidence: [
      { id: 'E1', kind: 'source', source: 'src/a.mjs:10', observation: 'guard blocks valid input', supports: ['H1'] },
      { id: 'E2', kind: 'grep', source: 'rg output', observation: 'the branch is only used here', supports: ['H1'], contradicts: undefined },
    ],
    unresolved_facts: [],
  });

  assert.deepEqual(normalized.evidence, [
    { id: 'E1', kind: 'source_invariant', source: 'src/a.mjs:10', observation: 'guard blocks valid input', supports: ['H1'], contradicts: [] },
    { id: 'E2', kind: 'static_search', source: 'rg output', observation: 'the branch is only used here', supports: ['H1'], contradicts: [] },
  ]);

  const seen = new Set(['E1']);
  const namespaced = normalizeSpecialistResult({
    specialist: 'guardian-code',
    evidence: [
      { id: 'E1', kind: 'source', source: 'src/a.mjs:10', observation: 'guard blocks valid input', supports: ['H1'], contradicts: [] },
    ],
  }, { seenEvidenceIds: seen });
  assert.equal(namespaced.evidence[0].id, 'guardian-code:E1');

  const canonical = normalizeSpecialistResult({
    specialist: 'guardian-runtime（只读复现专员）；复现状态：源码级复现成立',
    evidence: [
      { id: 'E1', kind: 'source_invariant', source: 'src/b.mjs:20', observation: 'second', supports: ['H1'], contradicts: [] },
    ],
  }, { seenEvidenceIds: new Set(['E1']), canonicalRole: 'guardian-runtime' });
  assert.equal(canonical.specialist, 'guardian-runtime');
  assert.equal(canonical.evidence[0].id, 'guardian-runtime:E1');

  assert.throws(() => normalizeSpecialistResult({
    specialist: 'guardian-code',
    evidence: [
      { kind: 'source', source: 'src/a.mjs:10', observation: 'guard blocks valid input', supports: ['H1'], contradicts: [] },
    ],
  }), /missing-id/);
});
