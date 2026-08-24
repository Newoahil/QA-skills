// QA Guardian — specialist agent registry.

import fs from 'node:fs';
import path from 'node:path';

import { BUILTIN_AGENT_MANIFEST } from './agents.manifest.mjs';

const AGENT_KEYS = Object.freeze(['role', 'modes', 'requires_capability', 'enabled_default', 'capability']);
const MANIFEST_KEYS = Object.freeze(['agents']);

export function loadAgentRegistry(manifest = BUILTIN_AGENT_MANIFEST, options = {}) {
  const layers = manifestsFromInput(manifest, options);
  const agentsByRole = new Map();
  const seenRoles = new Set();
  for (const layer of layers) {
    validateManifest(layer);
    const seenInLayer = new Set();
    for (const agent of layer.agents) {
      assertKnownKeys(agent, AGENT_KEYS, 'agent');
      const role = cleanRole(agent.role);
      if (seenInLayer.has(role)) throw new Error(`duplicate agent role: ${role}`);
      if (seenRoles.has(role)) throw new Error(`duplicate agent role: ${role}`);
      seenInLayer.add(role);
      seenRoles.add(role);
      agentsByRole.set(role, Object.freeze({
        role,
        modes: Object.freeze(normalizeModes(agent.modes)),
        requires_capability: cleanCapability(agent.requires_capability ?? agent.capability),
        enabled_default: cleanEnabledDefault(agent.enabled_default),
      }));
    }
  }
  const agents = Object.freeze([...agentsByRole.values()]);
  return Object.freeze({ agents, roles: Object.freeze(agents.map((agent) => agent.role)) });
}

export const BUILTIN_AGENT_REGISTRY = loadAgentRegistry();

export function rolesForMode(registry = BUILTIN_AGENT_REGISTRY, { complexity = 'complex', capabilities = {}, enabled = () => true } = {}) {
  return Object.freeze(registry.agents
    .filter((agent) => agent.modes.includes(complexity))
    .filter((agent) => agent.enabled_default !== false)
    .filter((agent) => capabilityAvailable(capabilities, agent.requires_capability))
    .map((agent) => agent.role)
    .filter((role) => enabled(role)));
}

function manifestsFromInput(manifest, options) {
  const layers = Array.isArray(manifest) ? [...manifest] : [manifest];
  if (options.projectManifest) layers.push(options.projectManifest);
  const projectManifest = loadProjectManifest(options.repoDir, options.readFileSync ?? fs.readFileSync, options.existsSync ?? fs.existsSync);
  if (projectManifest) layers.push(projectManifest);
  return layers;
}

function loadProjectManifest(repoDir, readFileSync, existsSync) {
  if (!repoDir) return null;
  const manifestPath = path.join(repoDir, '.qa', 'guardian', 'agents.manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('agent manifest must be an object');
  assertKnownKeys(manifest, MANIFEST_KEYS, 'manifest');
  if (!Array.isArray(manifest.agents)) throw new Error('agent manifest agents must be an array');
}

function assertKnownKeys(value, keys, label) {
  for (const key of Object.keys(value ?? {})) {
    if (!keys.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  }
}

function cleanRole(role) {
  if (typeof role !== 'string') throw new Error(`invalid guardian role: ${String(role)}`);
  const value = role.trim();
  if (!value.startsWith('guardian-')) throw new Error(`invalid guardian role: ${String(role)}`);
  return value;
}

function normalizeModes(modes) {
  if (!Array.isArray(modes) || modes.length === 0) throw new Error('agent modes must be a non-empty array');
  return modes.map((mode) => {
    if (typeof mode !== 'string') throw new Error(`unknown agent mode: ${String(mode)}`);
    const value = mode.trim();
    if (!['simple', 'complex'].includes(value)) throw new Error(`unknown agent mode: ${value}`);
    return value;
  });
}

function cleanCapability(capability) {
  if (capability == null) return null;
  if (typeof capability !== 'string') throw new Error('agent requires_capability must be a string or null');
  const value = capability.trim();
  if (value.length === 0) return null;
  return value;
}

function cleanEnabledDefault(value) {
  if (value == null) return true;
  if (typeof value !== 'boolean') throw new Error('agent enabled_default must be a boolean');
  return value;
}

function capabilityAvailable(capabilities, capability) {
  if (!capability) return true;
  return capabilities?.[capability]?.available === true;
}
