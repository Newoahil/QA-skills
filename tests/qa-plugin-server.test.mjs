import assert from 'node:assert/strict';
import test from 'node:test';

import { createQaSkillServerPlugin } from '../packages/qa-opencode-plugin/dist/server.js';

test('server config hook overrides configured QA models in place', async () => {
  const warnings = [];
  const plugin = createQaSkillServerPlugin({
    logger: { warn: (message) => warnings.push(message) },
    loadConfig: () => ({
      valid: true,
      warnings: [],
      sources: {},
      config: {
        preset: 'team',
        presets: {
          team: {
            qa: { model: 'cpa/custom-qa' },
            'qa-cr': { variant: 'review' },
            unrelated: { model: 'ignore' },
          },
        },
      },
    }),
  });

  const hooks = await plugin({ directory: 'C:/repo' });
  const openCodeConfig = { agent: { qa: { model: 'old' }, 'qa-cr': { model: 'old-cr' }, unrelated: { model: 'same' } } };
  await hooks.config(openCodeConfig);

  assert.equal(openCodeConfig.agent.qa.model, 'cpa/custom-qa');
  assert.equal(openCodeConfig.agent['qa-cr'].variant, 'review');
  assert.equal(openCodeConfig.agent.unrelated.model, 'same');
  assert.deepEqual(warnings, []);
});

test('server fails open on invalid config payload', async () => {
  const warnings = [];
  const plugin = createQaSkillServerPlugin({
    logger: { warn: (message) => warnings.push(message) },
    loadConfig: () => ({
      valid: false,
      warnings: ['bad qa-skill config'],
      sources: {},
      config: {},
    }),
  });

  const hooks = await plugin({ directory: 'C:/repo' });
  const openCodeConfig = { agent: { qa: { model: 'keep-me' } } };
  await hooks.config(openCodeConfig);

  assert.equal(openCodeConfig.agent.qa.model, 'keep-me');
  assert.equal(warnings.some((message) => message.includes('bad qa-skill config')), true);
});
