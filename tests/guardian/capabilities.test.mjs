import assert from 'node:assert/strict';
import test from 'node:test';

import { agentEnabled, availableInvestigationTools, discoverCapabilities, disabledSkills } from '../../tools/guardian/capabilities.mjs';

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
