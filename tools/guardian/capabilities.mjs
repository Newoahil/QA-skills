// Investigation capability discovery (Phase 5).
// This does not claim MCP availability from prompt prose. It records explicit configured/available
// flags and safe local capabilities; integrations can inject actual MCP probes later.

export const CAPABILITY_NAMES = Object.freeze(['codegraph', 'context7', 'local_runtime', 'git_history']);

export function discoverCapabilities({ env = process.env, probes = {} } = {}) {
  const codegraphConfigured = String(env.QA_GUARDIAN_CODEGRAPH_ENABLED ?? '').toLowerCase() === 'true';
  const context7Configured = String(env.QA_GUARDIAN_CONTEXT7_ENABLED ?? '').toLowerCase() === 'true';
  const probe = (name, configured) => ({
    configured,
    available: configured && probes[name]?.available === true,
    read_only: true,
  });
  return {
    codegraph: { ...probe('codegraph', codegraphConfigured), project_index: probes.codegraph?.project_index === true },
    context7: { ...probe('context7', context7Configured), official_docs: probes.context7?.official_docs === true },
    local_runtime: { configured: true, available: probes.local_runtime?.available !== false, read_only: true },
    git_history: { configured: true, available: probes.git_history?.available !== false, read_only: true },
  };
}

export function availableInvestigationTools(capabilities) {
  const tools = ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime'];
  if (capabilities?.codegraph?.available) tools.push('codegraph');
  if (capabilities?.context7?.available) tools.push('context7', 'guardian-docs');
  return tools;
}
