import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyPresetToOpenCodeConfig,
  loadQaSkillConfig,
  mergeQaSkillConfig,
  resolveActivePreset,
  resolveSidebarAgentNames,
} from '../packages/qa-opencode-plugin/dist/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadQaSkillConfig parses JSONC, prefers jsonc over json, and merges null agent clears', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qa-plugin-config-'));
  try {
    const userDir = path.join(root, 'user');
    const projectDir = path.join(root, 'project');
    mkdirSync(userDir, { recursive: true });
    mkdirSync(path.join(projectDir, '.opencode'), { recursive: true });

    writeFileSync(path.join(userDir, 'qa-skill.json'), JSON.stringify({ preset: 'json-only' }, null, 2));
    writeFileSync(path.join(userDir, 'qa-skill.jsonc'), '\uFEFF{\n  // user comment\n  "preset": "team",\n  "sidebar": {"agents": ["qa", "guardian-code",],},\n  "presets": {"team": {"qa": {"model": "provider/model-a"}, "guardian-code": {"variant": "compact"}}}\n}\n');
    writeFileSync(path.join(projectDir, '.opencode', 'qa-skill.jsonc'), '{"compactSidebar": false, "presets": {"team": {"guardian-code": null, "qa-cr": {"model": "provider/model-cr"}}}}');

    const loaded = loadQaSkillConfig({ directory: projectDir, configDir: userDir });
    assert.equal(loaded.valid, true);
    assert.equal(loaded.sources.user.endsWith('qa-skill.jsonc'), true);
    assert.equal(loaded.config.preset, 'team');
    assert.equal(loaded.config.compactSidebar, false);
    assert.deepEqual(resolveSidebarAgentNames(loaded.config), ['qa', 'guardian-code']);
    assert.equal(loaded.config.presets.team['guardian-code'], null);
    assert.equal(loaded.config.presets.team['qa-cr'].model, 'provider/model-cr');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyPresetToOpenCodeConfig updates only existing qa/guardian agents and honors null deletes', () => {
  const config = {
    agent: {
      qa: { model: 'old-qa', variant: 'v1', other: true },
      'qa-cr': { model: 'old-cr', variant: 'cr-v1' },
      'guardian-code': { model: 'old-gc', variant: 'gc-v1' },
      unrelated: { model: 'stay' },
    },
  };

  const result = applyPresetToOpenCodeConfig(config, mergeQaSkillConfig({
    preset: 'team',
    presets: {
      team: {
        qa: { model: 'new-qa', variant: null },
        'qa-cr': { model: null },
        'guardian-code': null,
        unrelated: { model: 'ignore-me' },
      },
    },
  }));

  assert.deepEqual(result.appliedAgents, ['qa', 'qa-cr']);
  assert.equal(config.agent.qa.model, 'new-qa');
  assert.equal('variant' in config.agent.qa, false);
  assert.equal('model' in config.agent['qa-cr'], false);
  assert.equal(config.agent['guardian-code'].model, 'old-gc');
  assert.equal(config.agent.unrelated.model, 'stay');
});

test('resolveActivePreset falls back to default and sidebar filters by availability', () => {
  const resolved = resolveActivePreset({ preset: 'missing' });
  assert.equal(resolved.name, 'default');
  assert.match(resolved.warnings[0], /falling back/i);
  assert.deepEqual(resolveSidebarAgentNames({ sidebar: { agents: ['qa', 'guardian-runtime', 'qa'] } }, ['qa', 'qa-e2e']), ['qa']);
});

test('built-in default preset covers every manifest agent and contains no deepseek model', () => {
  const manifest = JSON.parse(readManifest());
  const preset = resolveActivePreset(mergeQaSkillConfig()).preset;

  for (const file of manifest.agents) {
    const agentName = file.replace(/\.md$/, '');
    assert.equal(typeof preset[agentName]?.model, 'string', `missing default preset model for ${agentName}`);
    assert.equal(String(preset[agentName].model).includes('deepseek-v4-flash:0731'), false);
  }
});

function readManifest() {
  return readFileSync(path.join(repoRoot, 'qa-skill', 'agents', 'install-manifest.json'), 'utf8');
}
