import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadAgentRegistry,
  rolesForMode,
} from '../../tools/guardian/agent-registry.mjs';

test('loadAgentRegistry loads built-in specialists in deterministic order', () => {
  const registry = loadAgentRegistry();

  assert.deepEqual(registry.roles, [
    'guardian-code',
    'guardian-business',
    'guardian-runtime',
    'guardian-docs',
    'guardian-history',
    'guardian-plan-critic',
  ]);
  assert.deepEqual(rolesForMode(registry, { complexity: 'simple', capabilities: {} }), ['guardian-code', 'guardian-runtime']);
});

test('loadAgentRegistry rejects unknown manifest keys and duplicate roles', () => {
  assert.throws(() => loadAgentRegistry({ agents: [{ role: 'guardian-code', modes: ['simple'], capability: null, extra: true }] }), /unknown/i);
  assert.throws(() => loadAgentRegistry({ agents: [
    { role: 'guardian-code', modes: ['simple'], capability: null },
    { role: 'guardian-code', modes: ['complex'], capability: null },
  ] }), /duplicate/i);
});

test('rolesForMode skips unavailable capability-gated specialists', () => {
  const registry = loadAgentRegistry();

  assert.deepEqual(rolesForMode(registry, {
    complexity: 'complex',
    capabilities: { context7: { available: false }, git_history: { available: true }, plan_critic: { available: false } },
  }), ['guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-history']);
});

test('rolesForMode respects enabled switches without erroring on unavailable capabilities', () => {
  const registry = loadAgentRegistry();

  assert.deepEqual(rolesForMode(registry, {
    complexity: 'complex',
    capabilities: { context7: { available: true }, git_history: { available: true }, plan_critic: { available: true } },
    enabled: (role) => role !== 'guardian-history' && role !== 'guardian-plan-critic',
  }), ['guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-docs']);
});
