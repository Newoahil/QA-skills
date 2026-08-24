// QA Guardian — specialist agent registry.

import { BUILTIN_AGENT_MANIFEST } from './agents.manifest.mjs';

const AGENT_KEYS = Object.freeze(['role', 'modes', 'capability']);

export function loadAgentRegistry(manifest = BUILTIN_AGENT_MANIFEST) {
  const roles = new Set();
  const agents = [];
  for (const agent of manifest?.agents ?? []) {
    assertKnownKeys(agent, AGENT_KEYS, 'agent');
    const role = cleanRole(agent.role);
    if (roles.has(role)) throw new Error(`duplicate agent role: ${role}`);
    roles.add(role);
    agents.push(Object.freeze({
      role,
      modes: Object.freeze(normalizeModes(agent.modes)),
      capability: cleanCapability(agent.capability),
    }));
  }
  return Object.freeze({ agents: Object.freeze(agents), roles: Object.freeze([...roles]) });
}

export const BUILTIN_AGENT_REGISTRY = loadAgentRegistry();

export function rolesForMode(registry = BUILTIN_AGENT_REGISTRY, { complexity = 'complex', capabilities = {}, enabled = () => true } = {}) {
  return Object.freeze(registry.agents
    .filter((agent) => agent.modes.includes(complexity))
    .filter((agent) => capabilityAvailable(capabilities, agent.capability))
    .map((agent) => agent.role)
    .filter((role) => enabled(role)));
}

function assertKnownKeys(value, keys, label) {
  for (const key of Object.keys(value ?? {})) {
    if (!keys.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  }
}

function cleanRole(role) {
  const value = String(role ?? '').trim();
  if (!value.startsWith('guardian-')) throw new Error(`invalid guardian role: ${String(role)}`);
  return value;
}

function normalizeModes(modes) {
  if (!Array.isArray(modes) || modes.length === 0) throw new Error('agent modes must be a non-empty array');
  return modes.map((mode) => {
    const value = String(mode).trim();
    if (!['simple', 'complex'].includes(value)) throw new Error(`unknown agent mode: ${value}`);
    return value;
  });
}

function cleanCapability(capability) {
  if (capability == null) return null;
  const value = String(capability).trim();
  if (value.length === 0) return null;
  return value;
}

function capabilityAvailable(capabilities, capability) {
  if (!capability) return true;
  return capabilities?.[capability]?.available === true;
}
