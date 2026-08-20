import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { investigationArtifactsReady, prepareInvestigation } from '../../tools/guardian/investigation-runtime.mjs';

test('prepareInvestigation runs bounded specialists and persists dossier/plan', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const calls = [];
  try {
    const result = await prepareInvestigation({
      issue: 42, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'simple',
      issueData: { title: 'Wrong badge color', body: 'Expected pink, observed red.' },
      capabilities: {}, config: { investigation_budget_ms: 1000, specialist_timeout_ms: 100 },
      memoryContext: { provider: 'sybermem', items: [{ id: 'R1', title: 'Rule', summary: 'Use pink.' }] },
      runSpecialist: async ({ role, timeout_ms, issueData, issueDataPath }) => {
        calls.push({ role, timeout_ms, issueData, issueDataPath });
        return {
          specialist: role,
          hypotheses: [{ id: 'H1', statement: 'root' }],
          evidence: [{ id: `E-${role}`, kind: 'runtime_reproduction', source: role, observation: 'fail', supports: ['H1'], contradicts: [] }],
          unresolved_facts: [],
        };
      },
      buildPlan: async ({ memoryContext }) => {
        assert.equal(memoryContext.provider, 'sybermem');
        return { root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['test'], acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code', 'E-guardian-runtime'], risk: 'LOW' };
      },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.issueData), [
      { title: 'Wrong badge color', body: 'Expected pink, observed red.' },
      { title: 'Wrong badge color', body: 'Expected pink, observed red.' },
    ]);
    assert.equal(calls.every((call) => call.issueDataPath.endsWith('issue-data.json')), true);
    assert.equal(result.planResult.valid, true);
    assert.equal(investigationArtifactsReady(root, 42), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation respects disabled optional specialists', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const roles = [];
  try {
    await prepareInvestigation({
      issue: 43, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'complex',
      issueData: { title: 'Regression', body: 'Broke after commit.' },
      capabilities: { context7: { available: true }, git_history: { available: true }, plan_critic: { available: true } },
      config: { agents: { guardian_plan_critic: false }, skills: { disabled: ['guardian-history'] } },
      runSpecialist: async ({ role }) => {
        roles.push(role);
        return { specialist: role, hypotheses: [{ id: 'H1', statement: 'root' }], evidence: [{ id: `E-${role}`, kind: 'source_invariant', source: role, observation: 'obs', supports: ['H1'], contradicts: [] }], unresolved_facts: [], acceptance_criteria: [] };
      },
      buildPlan: async () => ({ root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['test'], acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code', 'E-guardian-business', 'E-guardian-runtime', 'E-guardian-docs'], risk: 'HIGH' }),
    });
    assert.deepEqual(roles, ['guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-docs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation fails closed without specialist runner', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  try {
    await assert.rejects(() => prepareInvestigation({ issue: 1, repoDir: 'D:/r', guardianDir: root, issueClass: 'bug', capabilities: {}, buildPlan: async () => ({}) }), /specialist runner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
