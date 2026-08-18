import assert from 'node:assert/strict';
import test from 'node:test';

import { assessFixingEntry, fixingPromptContext } from '../../tools/guardian/plan-gate.mjs';

const dossier = {
  issue: 1,
  issue_class: 'bug',
  hypotheses: [{ id: 'H1', statement: 'root' }],
  evidence: [{ id: 'E1', kind: 'runtime_reproduction', source: 'test', observation: 'fail', supports: ['H1'], contradicts: [] }],
  unresolved_facts: [],
  acceptance_criteria: [],
  selected_hypothesis: 'H1',
};
const plan = {
  root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['test'],
  acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E1'], risk: 'LOW',
};

test('legacy mode preserves existing behavior', () => {
  assert.deepEqual(assessFixingEntry({ plan: null, dossier: null, investigationMode: 'legacy' }), { allowed: true, reason: 'legacy-mode' });
});

test('shadow mode reports validation but does not silently claim autonomous readiness', () => {
  const result = assessFixingEntry({ plan, dossier, investigationMode: 'shadow' });
  assert.equal(result.allowed, true);
  assert.equal(result.shadow, true);
  assert.equal(result.plan_valid, true);
});

test('enforced mode allows only valid evidence-backed autonomous plan', () => {
  assert.equal(assessFixingEntry({ plan, dossier, investigationMode: 'enforced' }).allowed, true);
  assert.equal(assessFixingEntry({ plan: { risk: 'LOW' }, dossier, investigationMode: 'enforced' }).allowed, false);
});

test('prompt context blocks editing when enforced plan is invalid', () => {
  const context = fixingPromptContext({ plan: {}, dossier, mode: 'enforced' });
  assert.equal(context.can_edit, false);
  assert.equal(context.requires_gate1, true);
});
