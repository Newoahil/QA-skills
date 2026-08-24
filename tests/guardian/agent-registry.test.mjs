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
  assert.throws(() => loadAgentRegistry({ agents: [{ role: 'guardian-code', modes: ['simple'], requires_capability: null, enabled_default: true, extra: true }] }), /unknown/i);
  assert.throws(() => loadAgentRegistry({ agents: [], extra: true }), /unknown manifest key/);
  assert.throws(() => loadAgentRegistry({}), /agents must be an array/);
  assert.throws(() => loadAgentRegistry({ agents: [
    { role: 'guardian-code', modes: ['simple'], requires_capability: null, enabled_default: true },
    { role: 'guardian-code', modes: ['complex'], requires_capability: null, enabled_default: true },
  ] }), /duplicate/i);
});

test('loadAgentRegistry rejects malformed agent field types fail-closed', () => {
  assert.throws(() => loadAgentRegistry({ agents: [{ role: 42, modes: ['simple'], requires_capability: null, enabled_default: true }] }), /invalid guardian role/);
  assert.throws(() => loadAgentRegistry({ agents: [{ role: 'guardian-code', modes: [false], requires_capability: null, enabled_default: true }] }), /unknown agent mode/);
  assert.throws(() => loadAgentRegistry({ agents: [{ role: 'guardian-code', modes: ['simple'], requires_capability: 42, enabled_default: true }] }), /requires_capability/);
  assert.throws(() => loadAgentRegistry({ agents: [{ role: 'guardian-code', modes: ['simple'], requires_capability: null, enabled_default: 'false' }] }), /enabled_default/);
});

test('loadAgentRegistry rejects project manifests that duplicate built-in roles', () => {
  assert.throws(() => loadAgentRegistry(undefined, {
    projectManifest: {
      agents: [
        { role: 'guardian-code', modes: ['complex'], requires_capability: null, enabled_default: true },
      ],
    },
  }), /duplicate agent role: guardian-code/);
});

test('loadAgentRegistry appends project specialists without replacing built-ins', () => {
  const registry = loadAgentRegistry(undefined, {
    projectManifest: {
      agents: [
        { role: 'guardian-custom', modes: ['simple', 'complex'], requires_capability: 'custom_tool', enabled_default: true },
      ],
    },
  });

  assert.deepEqual(registry.roles, [
    'guardian-code',
    'guardian-business',
    'guardian-runtime',
    'guardian-docs',
    'guardian-history',
    'guardian-plan-critic',
    'guardian-custom',
  ]);
  assert.deepEqual(rolesForMode(registry, {
    complexity: 'simple',
    capabilities: { custom_tool: { available: true } },
  }), ['guardian-code', 'guardian-runtime', 'guardian-custom']);
});

test('loadAgentRegistry reads optional project manifest from .qa/guardian', () => {
  const registry = loadAgentRegistry(undefined, {
    repoDir: 'D:/repo',
    existsSync: (file) => file.endsWith('.qa\\guardian\\agents.manifest.json') || file.endsWith('.qa/guardian/agents.manifest.json'),
    readFileSync: () => JSON.stringify({ agents: [{ role: 'guardian-local', modes: ['complex'], requires_capability: null, enabled_default: true }] }),
  });

  assert.equal(registry.roles.includes('guardian-local'), true);
});

test('rolesForMode respects enabled_default false', () => {
  const registry = loadAgentRegistry({ agents: [
    { role: 'guardian-code', modes: ['simple'], requires_capability: null, enabled_default: false },
    { role: 'guardian-runtime', modes: ['simple'], requires_capability: null, enabled_default: true },
  ] });

  assert.deepEqual(rolesForMode(registry, { complexity: 'simple', capabilities: {} }), ['guardian-runtime']);
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
