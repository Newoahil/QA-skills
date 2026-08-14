import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runOpenCodeScenario } from './harness.mjs';
import { scenarios } from './scenarios.mjs';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');
const artifactRoot = path.join(repositoryRoot, 'test-results', 'functional-validation');
const timeoutMs = Number(process.env.QA_SKILL_TIMEOUT_MS || 600000);

test('FV-INTEGRATION-001 runs PASS, FAIL, and BLOCKED scenarios against real OpenCode only when opted in', { skip: process.env.QA_SKILL_REAL_RUNS === '1' ? false : 'Set QA_SKILL_REAL_RUNS=1 to allow model-calling OpenCode runs.' }, async (t) => {
  assert.ok(process.env.QA_SKILL_MODEL, 'QA_SKILL_MODEL is required when QA_SKILL_REAL_RUNS=1');
  assert.ok(process.env.QA_SKILL_AGENT, 'QA_SKILL_AGENT is required when QA_SKILL_REAL_RUNS=1');

  for (const scenario of scenarios) {
    await t.test(scenario.id, () => {
      const result = runOpenCodeScenario({
        scenario,
        model: process.env.QA_SKILL_MODEL,
        agent: process.env.QA_SKILL_AGENT,
        artifactRoot,
        packRoot,
        timeoutMs,
      });
      assert.equal(result.infrastructureStatus.status, 'COMPLETED');
      assert.equal(result.agentTopology.ok, true);
      assert.equal(result.agentTopology.childCount, 1);
      assert.equal(result.qaVerdict, scenario.expectedVerdict);
      assert.ok(existsSync(path.join(result.artifacts.runDirectory, 'manifest.json')));
      assert.ok(existsSync(path.join(result.artifacts.runDirectory, 'oracle.json')));
    });
  }
});
