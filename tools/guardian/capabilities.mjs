// Investigation capability discovery (Phase 5).
// This does not claim MCP availability from prompt prose. It records explicit configured/available
// flags and safe local capabilities; integrations can inject actual MCP probes later.

import { BUILTIN_AGENT_REGISTRY } from './agent-registry.mjs';

export const CAPABILITY_NAMES = Object.freeze(['codegraph', 'context7', 'local_runtime', 'git_history', 'plan_critic', 'sybermem']);
export const GUARDIAN_AGENT_ROLES = BUILTIN_AGENT_REGISTRY.roles;

function configValue(config, name) {
  return config?.capabilities?.[name] ?? config?.agents?.[name] ?? undefined;
}

function boolFromEnv(env, name) {
  const value = env[`QA_GUARDIAN_${name.toUpperCase()}_ENABLED`];
  if (value === undefined) return undefined;
  return String(value).toLowerCase() === 'true';
}

function configured({ env, config, name, defaultValue = false }) {
  const fromEnv = boolFromEnv(env, name);
  if (fromEnv !== undefined) return fromEnv;
  const fromConfig = configValue(config, name);
  if (fromConfig !== undefined) return Boolean(fromConfig);
  return defaultValue;
}

export function discoverCapabilities({ env = process.env, probes = {}, config = {} } = {}) {
  const codegraphConfigured = configured({ env, config, name: 'codegraph' });
  const context7Configured = configured({ env, config, name: 'context7' });
  const gitHistoryConfigured = configured({ env, config, name: 'git_history', defaultValue: true });
  const runtimeConfigured = configured({ env, config, name: 'local_runtime', defaultValue: true });
  const planCriticConfigured = configured({ env, config, name: 'plan_critic', defaultValue: true });
  const sybermemConfigured = configured({ env, config, name: 'sybermem' }) || Boolean(config?.memory?.provider === 'sybermem' && config?.memory?.enabled !== false);
  const probe = (name, configured) => ({
    configured,
    available: configured && probes[name]?.available === true,
    read_only: true,
  });
  return {
    codegraph: { ...probe('codegraph', codegraphConfigured), project_index: probes.codegraph?.project_index === true },
    context7: { ...probe('context7', context7Configured), official_docs: probes.context7?.official_docs === true },
    local_runtime: { configured: runtimeConfigured, available: runtimeConfigured && probes.local_runtime?.available !== false, read_only: true, mode: config?.capabilities?.runtime_probe ?? 'restricted' },
    git_history: { configured: gitHistoryConfigured, available: gitHistoryConfigured && probes.git_history?.available !== false, read_only: true },
    plan_critic: { configured: planCriticConfigured, available: planCriticConfigured && probes.plan_critic?.available !== false, read_only: true },
    sybermem: { ...probe('sybermem', sybermemConfigured), provider: sybermemConfigured ? 'sybermem' : null },
  };
}

export function disabledSkills(config = {}) {
  return new Set(Array.isArray(config?.skills?.disabled) ? config.skills.disabled : []);
}

export function agentEnabled(config = {}, agent) {
  if (disabledSkills(config).has(agent)) return false;
  const key = agent.replace(/^guardian-/, 'guardian_').replaceAll('-', '_');
  const value = config?.agents?.[key] ?? config?.agents?.[agent];
  return value !== false;
}

export function availableInvestigationTools(capabilities, config = {}) {
  const tools = ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime'];
  if (capabilities?.codegraph?.available) tools.push('codegraph');
  if (capabilities?.context7?.available) tools.push('context7', 'guardian-docs');
  if (capabilities?.git_history?.available) tools.push('guardian-history');
  if (capabilities?.plan_critic?.available) tools.push('guardian-plan-critic');
  if (capabilities?.sybermem?.available) tools.push('sybermem');
  return tools.filter((tool) => !tool.startsWith('guardian-') || agentEnabled(config, tool));
}

export function unavailableGuardianAgents(config = {}, availableAgents = [], registry = BUILTIN_AGENT_REGISTRY) {
  const available = new Set(Array.isArray(availableAgents) ? availableAgents : []);
  return registry.roles.filter((role) => agentEnabled(config, role) && !available.has(role));
}

export function disableUnavailableGuardianAgents(config = {}, availableAgents = [], registry = BUILTIN_AGENT_REGISTRY) {
  const unavailable = unavailableGuardianAgents(config, availableAgents, registry);
  if (unavailable.length === 0) return config;
  const agents = { ...(config.agents ?? {}) };
  for (const role of unavailable) {
    agents[role] = false;
    agents[role.replace(/^guardian-/, 'guardian_').replaceAll('-', '_')] = false;
  }
  return { ...config, agents };
}
