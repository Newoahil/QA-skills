import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNoQaE2eAfterStop, extractOverallStatus } from './helpers.mjs';
import { pairedScenarios } from './paired-scenarios.mjs';
import { assertScenarioOutcome, assertScenarioSpecifics, maybeCleanupScenarioResult, realRunEnabled, realRunSkipReason, runScenarioWithOpenCode } from './real-runner.mjs';

for (const scenario of pairedScenarios) {
  const skip = !realRunEnabled() ? realRunSkipReason() : false;

  test(`real paired scenario: ${scenario.id}`, { skip }, async () => {
    const result = runScenarioWithOpenCode(scenario);
    let ok = false;
    try {
      assertScenarioOutcome(result);
      assert.equal(extractOverallStatus(result.finalReport), scenario.expectedStatus, `wrong final status; temp root: ${result.fixtureData.tempRoot}`);
      assertNoQaE2eAfterStop(result.events);
      assertScenarioSpecifics(result);
      ok = true;
    } finally {
      maybeCleanupScenarioResult(result, ok);
    }
  });
}

test('paired eval real runner contract is declared', () => {
  assert.ok(pairedScenarios.length >= 5);
  assert.ok(pairedScenarios.some((scenario) => scenario.id === 'animation-duplicate-submit'));
});
