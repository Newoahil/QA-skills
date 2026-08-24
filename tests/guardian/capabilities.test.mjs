import assert from 'node:assert/strict';
import test from 'node:test';

import { agentEnabled, availableInvestigationTools, assertReadOnlyInvestigationTools, disableUnavailableGuardianAgents, discoverCapabilities, disabledSkills, unavailableGuardianAgents } from '../../tools/guardian/capabilities.mjs';
import { loadAgentRegistry } from '../../tools/guardian/agent-registry.mjs';

test('capabilities fail closed when MCP flags are not enabled', () => {
  const caps = discoverCapabilities({ env: {}, probes: { codegraph: { available: true }, context7: { available: true } } });
  assert.equal(caps.codegraph.configured, false);
  assert.equal(caps.codegraph.available, false);
  assert.equal(caps.context7.available, false);
  assert.deepEqual(availableInvestigationTools(caps), ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-history', 'guardian-plan-critic']);
});

test('configured MCPs are available only when their injected probes succeed', () => {
  const caps = discoverCapabilities({
    env: { QA_GUARDIAN_CODEGRAPH_ENABLED: 'true', QA_GUARDIAN_CONTEXT7_ENABLED: 'true' },
    probes: { codegraph: { available: true, project_index: true }, context7: { available: true, official_docs: true } },
  });
  assert.equal(caps.codegraph.available, true);
  assert.equal(caps.context7.available, true);
  assert.deepEqual(availableInvestigationTools(caps), ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime', 'codegraph', 'context7', 'guardian-docs', 'guardian-history', 'guardian-plan-critic']);
});

test('MCP capabilities are explicitly read-only', () => {
  const caps = discoverCapabilities({ env: { QA_GUARDIAN_CODEGRAPH_ENABLED: 'true' }, probes: {} });
  assert.equal(caps.codegraph.read_only, true);
  assert.equal(caps.context7.read_only, true);
});

test('config and env control optional capabilities with safe defaults', () => {
  const caps = discoverCapabilities({
    env: { QA_GUARDIAN_PLAN_CRITIC_ENABLED: 'false', QA_GUARDIAN_SYBERMEM_ENABLED: 'true' },
    config: { capabilities: { codegraph: true, context7: true, git_history: false }, memory: { provider: 'sybermem' } },
    probes: { codegraph: { available: true }, context7: { available: false }, sybermem: { available: true } },
  });
  assert.equal(caps.codegraph.available, true);
  assert.equal(caps.context7.available, false);
  assert.equal(caps.git_history.available, false);
  assert.equal(caps.plan_critic.available, false);
  assert.equal(caps.sybermem.available, true);
});

test('disabled skills remove guardian agents from investigation tools', () => {
  const config = { skills: { disabled: ['guardian-history'] }, agents: { guardian_plan_critic: false } };
  const caps = discoverCapabilities({ config, probes: { sybermem: { available: true } } });
  assert.equal(disabledSkills(config).has('guardian-history'), true);
  assert.equal(agentEnabled(config, 'guardian-plan-critic'), false);
  assert.deepEqual(availableInvestigationTools(caps, config), ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime']);
});

test('available OpenCode agents disable missing optional Guardian specialists', () => {
  const config = { agents: { guardian_history: true, guardian_plan_critic: true } };
  const available = ['guardian-code', 'guardian-business', 'guardian-runtime'];
  assert.deepEqual(unavailableGuardianAgents(config, available), ['guardian-docs', 'guardian-history', 'guardian-plan-critic']);
  const filtered = disableUnavailableGuardianAgents(config, available);
  assert.equal(agentEnabled(filtered, 'guardian-history'), false);
  assert.equal(agentEnabled(filtered, 'guardian-plan-critic'), false);
  assert.equal(agentEnabled(filtered, 'guardian-code'), true);
});

test('available OpenCode agent filtering uses runtime project registry roles', () => {
  const registry = loadAgentRegistry(undefined, { projectManifest: { agents: [
    { role: 'guardian-custom', modes: ['complex'], requires_capability: null, enabled_default: true },
  ] } });
  const available = ['guardian-code', 'guardian-business', 'guardian-runtime'];

  assert.equal(unavailableGuardianAgents({}, available, registry).includes('guardian-custom'), true);
  assert.equal(agentEnabled(disableUnavailableGuardianAgents({}, available, registry), 'guardian-custom'), false);
});

test('empty successful OpenCode agent probe disables runtime registry roles fail-closed', () => {
  const registry = loadAgentRegistry(undefined, { projectManifest: { agents: [
    { role: 'guardian-custom', modes: ['complex'], requires_capability: null, enabled_default: true },
  ] } });

  assert.equal(unavailableGuardianAgents({}, [], registry).includes('guardian-custom'), true);
  assert.equal(agentEnabled(disableUnavailableGuardianAgents({}, [], registry), 'guardian-custom'), false);
});

// --- A3 (decision-e8c0d364): read-only specialist tool boundary is mechanically enforced ---

test('A3: availableInvestigationTools only ever yields read-only tools (all capabilities on)', () => {
  const allOn = {
    codegraph: { available: true }, context7: { available: true },
    git_history: { available: true }, plan_critic: { available: true }, sybermem: { available: true },
  };
  const tools = availableInvestigationTools(allOn);
  // must not throw, and every emitted tool is read-only (explore / guardian-* / doc/memory readers)
  for (const t of tools) {
    assert.equal(/^(edit|write|patch|bash|task|run|exec|pr_create|merge|close|commit|push|delete|rm)$/i.test(t), false, `unexpected write tool: ${t}`);
  }
  assert.equal(tools.includes('explore'), true);
});

test('A3: assertReadOnlyInvestigationTools fails closed on any write-capable tool', () => {
  assert.doesNotThrow(() => assertReadOnlyInvestigationTools(['explore', 'guardian-code', 'codegraph', 'context7']));
  for (const bad of ['edit', 'write', 'bash', 'task', 'pr_create', 'merge', 'code_write', 'fs.write', 'git-push', 'file-delete', 'apply_patch']) {
    assert.throws(() => assertReadOnlyInvestigationTools(['explore', bad]), /may not receive write-capable tools/, `should reject ${bad}`);
  }
});

test('A3: a registered guardian-* specialist never injects a write tool into the whitelist', () => {
  // Even a project-registered extra specialist is just a "guardian-*" role name; it cannot smuggle a
  // write-capable tool into availableInvestigationTools, because the tool set is code-defined and
  // guarded. Registering the role only gates its own presence, never the tool vocabulary.
  const registry = loadAgentRegistry(undefined, { projectManifest: { agents: [
    { role: 'guardian-perf', modes: ['complex'], requires_capability: null, enabled_default: true },
  ] } });
  assert.equal(registry.roles.includes('guardian-perf'), true);
  // tool set is independent of registered roles and remains read-only.
  assert.doesNotThrow(() => availableInvestigationTools({ git_history: { available: true }, plan_critic: { available: true } }));
});
