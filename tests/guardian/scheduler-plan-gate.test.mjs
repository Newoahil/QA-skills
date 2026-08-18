import assert from 'node:assert/strict';
import test from 'node:test';

import { assessFixingEntry } from '../../tools/guardian/plan-gate.mjs';

test('legacy mode remains backward-compatible', () => {
  assert.equal(assessFixingEntry({ investigationMode: 'legacy', dossier: null, plan: null }).allowed, true);
});

test('shadow mode never grants autonomous fixing permission', () => {
  const result = assessFixingEntry({ investigationMode: 'shadow', dossier: null, plan: null });
  assert.equal(result.allowed, true);
  assert.equal(result.shadow, true);
});

test('enforced mode blocks missing dossier and plan', () => {
  const result = assessFixingEntry({ investigationMode: 'enforced', dossier: null, plan: null });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'plan-not-autonomous-ready');
});
