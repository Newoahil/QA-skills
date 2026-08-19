import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGate1Comment } from '../../tools/guardian/gate1-comment.mjs';

test('gate1 comment carries marker, plan summary, unresolved facts, and commands', () => {
  const body = buildGate1Comment({
    issue: 211,
    plan: { risk: 'LOW', root_cause: 'color', affected_files: ['a.jsx'] },
    dossier: { unresolved_facts: ['exact pink token?'] },
  });
  assert.equal(body.split('\n')[0], '[GATE_1_WAIT]');
  assert.equal(body.includes('/guardian approve'), true);
  assert.equal(body.includes('/guardian revise'), true);
  assert.equal(body.includes('/guardian reject'), true);
  assert.equal(body.includes('exact pink token?'), true);
});
