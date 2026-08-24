import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskObservation, normalizeExecutionSpec } from '../../tools/guardian/task-source.mjs';

test('createTaskObservation defaults spec to null and keeps facts exactly {title, body}', () => {
  const observation = createTaskObservation({
    identity: { source: 'github', taskId: '7', displayId: '#7' },
    facts: { title: 'T', body: 'B' },
    cursor: { lastConsumedId: null, lastConsumedSequence: null },
  });
  assert.deepEqual(observation.facts, { title: 'T', body: 'B' });
  assert.equal(observation.spec, null);
});

test('A2: createTaskObservation carries a normalized source-neutral execution spec', () => {
  const observation = createTaskObservation({
    identity: { source: 'pm', taskId: 'r-uuid', displayId: 'R-1' },
    facts: { title: 'Raise signup conversion', body: 'context' },
    cursor: { lastConsumedId: null, lastConsumedSequence: null },
    spec: {
      executionType: 'research',
      acceptanceCriteria: [{ criteriaId: 'c1', statement: 'report exists', expectedEvidence: 'url' }],
      expectedEvidence: 'a written report url',
      owner: 'alice',
      ownerType: 'agent',
      suggestedRole: 'researcher',
      repoContext: { url: 'https://git/x', branch: 'main', credentialRef: 'cred-1' },
      sourceMeta: { intentId: 'i-9' },
    },
  });
  assert.equal(observation.spec.executionType, 'research');
  assert.equal(observation.spec.acceptanceCriteria.length, 1);
  assert.equal(observation.spec.acceptanceCriteria[0].criteriaId, 'c1');
  assert.equal(observation.spec.repoContext.branch, 'main');
  assert.equal(observation.spec.sourceMeta.intentId, 'i-9');
  // facts stays minimal even when a rich spec is present.
  assert.deepEqual(observation.facts, { title: 'Raise signup conversion', body: 'context' });
});

test('normalizeExecutionSpec returns null for empty/invalid input and freezes output', () => {
  assert.equal(normalizeExecutionSpec(null), null);
  assert.equal(normalizeExecutionSpec('nope'), null);
  const spec = normalizeExecutionSpec({ executionType: 'coding' });
  assert.equal(Object.isFrozen(spec), true);
  assert.equal(spec.executionType, 'coding');
  assert.deepEqual(spec.acceptanceCriteria, []);
  assert.equal(spec.repoContext, null);
});
