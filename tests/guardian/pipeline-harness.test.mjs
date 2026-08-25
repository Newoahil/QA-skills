import assert from 'node:assert/strict';
import test from 'node:test';

import { runInjectedPipeline } from '../../tools/guardian/pipeline-harness.mjs';

const dossierEvidence = [
  { id: 'E1', kind: 'runtime_reproduction', source: 'test', observation: 'fails', supports: ['H1'], contradicts: [] },
  { id: 'E2', kind: 'source_invariant', source: 'file:1', observation: 'guard', supports: ['H1'], contradicts: [] },
];
const riskAssessment = {
  certain: true,
  lowDangerSurfaceOnly: true,
  touchedSurfaces: [],
  localImpact: true,
  diffLines: 10,
  reproducibleOracle: true,
  scopeExpansionRequested: false,
};
const plan = { root_cause: 'guard', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['regression'], test_commands: [['node', '--test', 'tests/guardian/pipeline-harness.test.mjs']], acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E1', 'E2'], risk: 'LOW', risk_assessment: riskAssessment };

test('clear bug pipeline reaches Gate2 only after independent QA PASS', async () => {
  const result = await runInjectedPipeline({
    issue: 42,
    issueClass: 'bug',
    specialistResults: [{ specialist: 'guardian-code', hypotheses: [{ id: 'H1', statement: 'guard' }], evidence: dossierEvidence, unresolved_facts: [] }],
    plan,
    qaVerdict: 'PASS',
  });
  assert.equal(result.stage, 'GATE_2_WAIT');
  assert.equal(result.pr.base, 'dev');
});

test('missing evidence/uncertainty stops at Gate1 before fixing', async () => {
  const result = await runInjectedPipeline({
    issue: 43,
    issueClass: 'bug',
    specialistResults: [{ specialist: 'guardian-business', hypotheses: [{ id: 'H1', statement: 'unknown' }], evidence: [], unresolved_facts: [{ id: 'F1', unknown: 'prod state' }] }],
    plan,
    qaVerdict: 'PASS',
  });
  assert.equal(result.stage, 'GATE_1_WAIT');
  assert.equal(result.pr, null);
});

test('QA FAIL never opens a PR', async () => {
  const result = await runInjectedPipeline({
    issue: 44,
    issueClass: 'bug',
    specialistResults: [{ specialist: 'guardian-runtime', hypotheses: [{ id: 'H1', statement: 'guard' }], evidence: dossierEvidence, unresolved_facts: [] }],
    plan,
    qaVerdict: 'FAIL',
  });
  assert.equal(result.stage, 'HANDED_BACK');
  assert.equal(result.pr, null);
});

test('model LOW without mechanical risk proof stops at Gate1', async () => {
  const result = await runInjectedPipeline({
    issue: 46,
    issueClass: 'bug',
    specialistResults: [{ specialist: 'guardian-code', hypotheses: [{ id: 'H1', statement: 'guard' }], evidence: dossierEvidence, unresolved_facts: [] }],
    plan: { ...plan, risk_assessment: undefined },
    qaVerdict: 'PASS',
  });
  assert.equal(result.stage, 'GATE_1_WAIT');
  assert.equal(result.pr, null);
});

test('request with criteria can be planned but remains non-autonomous LOW by policy', async () => {
  const result = await runInjectedPipeline({
    issue: 45,
    issueClass: 'request',
    specialistResults: [{ specialist: 'guardian-business', hypotheses: [{ id: 'H1', statement: 'requested change' }], evidence: dossierEvidence, unresolved_facts: [], acceptance_criteria: [{ id: 'AC1', then: 'works' }] }],
    plan: { ...plan, acceptance_criteria: ['works'] },
    qaVerdict: 'PASS',
  });
  assert.equal(result.stage, 'GATE_1_WAIT');
});
