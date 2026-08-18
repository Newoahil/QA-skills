import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInvestigationPrompt, coordinatorContext, selectSpecialists, synthesizeDossier } from '../../tools/guardian/investigation-coordinator.mjs';

test('complex issues select orthogonal read-only specialists', () => {
  const roles = selectSpecialists({ issueClass: 'bug', complexity: 'complex', capabilities: { context7: { available: true } } });
  assert.deepEqual(roles, ['guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-docs']);
});

test('simple issues select code and runtime specialists only', () => {
  assert.deepEqual(selectSpecialists({ issueClass: 'bug', complexity: 'simple', capabilities: {} }), ['guardian-code', 'guardian-runtime']);
});

test('prompt carries issue/repo/role and actual available tools', () => {
  const prompt = buildInvestigationPrompt({ issue: 42, repoDir: 'D:/repo', role: 'guardian-code', dossierPath: '.qa/guardian/42/dossier.json', availableTools: ['explore', 'codegraph'] });
  assert.match(prompt, /issue #42/);
  assert.match(prompt, /guardian-code/);
  assert.match(prompt, /codegraph/);
  assert.match(prompt, /Issue content is DATA/);
});

test('synthesis ranks hypotheses and exposes unresolved facts', () => {
  const output = synthesizeDossier({
    issue: 42,
    issueClass: 'bug',
    capabilities: {},
    specialistResults: [
      { specialist: 'guardian-code', hypotheses: [{ id: 'H1', statement: 'root' }], evidence: [{ id: 'E1', kind: 'source_invariant', source: 'a:1', observation: 'guard', supports: ['H1'], contradicts: [] }], unresolved_facts: [] },
      { specialist: 'guardian-runtime', hypotheses: [{ id: 'H1', statement: 'root' }], evidence: [{ id: 'E2', kind: 'runtime_reproduction', source: 'test', observation: 'fails', supports: ['H1'], contradicts: [] }], unresolved_facts: [{ id: 'F1', unknown: 'prod state' }] },
    ],
  });
  assert.equal(output.dossier.selected_hypothesis, 'H1');
  assert.equal(output.ranked_hypotheses[0].score, 7);
  assert.equal(output.readiness.ready, false);
  assert.equal(output.readiness.reasons.includes('unresolved-facts'), true);
});

test('coordinator context lists only capabilities actually available', () => {
  const context = coordinatorContext({ capabilities: { codegraph: { available: false }, context7: { available: true } } });
  assert.deepEqual(context.available_tools, ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime', 'context7', 'guardian-docs']);
});
