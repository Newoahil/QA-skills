import assert from 'node:assert/strict';
import test from 'node:test';

import { availableInvestigationTools, discoverCapabilities } from '../../tools/guardian/capabilities.mjs';

test('capabilities fail closed when MCP flags are not enabled', () => {
  const caps = discoverCapabilities({ env: {}, probes: { codegraph: { available: true }, context7: { available: true } } });
  assert.equal(caps.codegraph.configured, false);
  assert.equal(caps.codegraph.available, false);
  assert.equal(caps.context7.available, false);
  assert.deepEqual(availableInvestigationTools(caps), ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime']);
});

test('configured MCPs are available only when their injected probes succeed', () => {
  const caps = discoverCapabilities({
    env: { QA_GUARDIAN_CODEGRAPH_ENABLED: 'true', QA_GUARDIAN_CONTEXT7_ENABLED: 'true' },
    probes: { codegraph: { available: true, project_index: true }, context7: { available: true, official_docs: true } },
  });
  assert.equal(caps.codegraph.available, true);
  assert.equal(caps.context7.available, true);
  assert.deepEqual(availableInvestigationTools(caps), ['explore', 'guardian-code', 'guardian-business', 'guardian-runtime', 'codegraph', 'context7', 'guardian-docs']);
});

test('MCP capabilities are explicitly read-only', () => {
  const caps = discoverCapabilities({ env: { QA_GUARDIAN_CODEGRAPH_ENABLED: 'true' }, probes: {} });
  assert.equal(caps.codegraph.read_only, true);
  assert.equal(caps.context7.read_only, true);
});
