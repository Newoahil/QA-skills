import assert from 'node:assert/strict';
import test from 'node:test';

import { canEnterFixing, validatePlan } from '../../tools/guardian/plan-validator.mjs';

const dossier = {
  issue: 42,
  issue_class: 'bug',
  hypotheses: [{ id: 'H1', statement: 'root cause' }],
  evidence: [{ id: 'E1', kind: 'runtime_reproduction', source: 'test', observation: 'reproduced', supports: ['H1'], contradicts: [] }],
  unresolved_facts: [],
  acceptance_criteria: [],
  selected_hypothesis: 'H1',
};

function plan(overrides = {}) {
  return {
    root_cause: 'configuration guard rejects the valid path',
    affected_files: ['src/config.mjs'],
    non_goals: ['do not change deployment'],
    test_plan: ['add regression test'],
    acceptance_criteria: ['request returns success'],
    rollback_plan: 'revert one commit',
    evidence_ids: ['E1'],
    risk: 'LOW',
    ...overrides,
  };
}

test('valid evidence-backed LOW bug plan is autonomous-ready', () => {
  const result = validatePlan(plan(), dossier);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, true);
  assert.equal(canEnterFixing(plan(), dossier), true);
});

test('missing plan fields block fixing', () => {
  const result = validatePlan({ risk: 'LOW' }, dossier);
  assert.equal(result.valid, false);
  assert.equal(result.autonomousReady, false);
  assert.equal(canEnterFixing({ risk: 'LOW' }, dossier), false);
});

test('request LOW plan is blocked from autonomous execution', () => {
  const request = { ...dossier, issue_class: 'request', acceptance_criteria: [{ id: 'AC1' }] };
  const result = validatePlan(plan(), request);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('plan:request-cannot-autonomously-low'), true);
});

test('unresolved facts make plan non-autonomous', () => {
  const uncertain = { ...dossier, unresolved_facts: [{ id: 'F1', unknown: 'production state' }] };
  const result = validatePlan(plan(), uncertain);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.gateRequired, true);
});

test('unknown evidence id blocks plan', () => {
  const result = validatePlan(plan({ evidence_ids: ['E404'] }), dossier);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('plan:unknown-evidence:E404'), true);
});

test('HIGH plan is structurally valid but still requires Gate 1', () => {
  const result = validatePlan(plan({ risk: 'HIGH' }), dossier);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.gateRequired, true);
});
