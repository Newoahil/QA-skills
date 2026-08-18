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
      capabilities: {}, config: { investigation_budget_ms: 1000, specialist_timeout_ms: 100 },
      runSpecialist: async ({ role, timeout_ms }) => {
        calls.push({ role, timeout_ms });
        return {
          specialist: role,
          hypotheses: [{ id: 'H1', statement: 'root' }],
          evidence: [{ id: `E-${role}`, kind: 'runtime_reproduction', source: role, observation: 'fail', supports: ['H1'], contradicts: [] }],
          unresolved_facts: [],
        };
      },
      buildPlan: async () => ({ root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['test'], acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code', 'E-guardian-runtime'], risk: 'LOW' }),
    });
    assert.equal(calls.length, 2);
    assert.equal(result.planResult.valid, true);
    assert.equal(investigationArtifactsReady(root, 42), true);
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
