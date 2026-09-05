import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = path.join(repoRoot, 'qa-skill', 'agents');
const manifestPath = path.join(agentsDir, 'install-manifest.json');
const exampleConfigPath = path.join(repoRoot, 'packages', 'qa-opencode-plugin', 'qa-skill.example.jsonc');
const installerPath = path.join(repoRoot, 'tools', 'opencode', 'install-qa-plugin.mjs');

function frontmatterModel(markdown) {
  const match = markdown.match(/^model:\s*(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function parsePresetModelsFromJsonc(text) {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\/\/.*$/gm, '');
  const parsed = JSON.parse(normalized);
  return parsed.presets.default;
}

test('install manifest lists exactly the runnable current agent markdown files', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const actual = readdirSync(agentsDir)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => file !== 'fixer-agent.md')
    .sort((left, right) => left.localeCompare(right));

  assert.equal(actual.includes('qa-facet.md'), false);
  assert.equal(manifest.agents.includes('fixer-agent.md'), false);
  assert.deepEqual([...manifest.agents].sort((left, right) => left.localeCompare(right)), actual);
});

test('default preset covers every manifest agent and generated defaults contain no deepseek model', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const exampleText = readFileSync(exampleConfigPath, 'utf8');
  const installerText = readFileSync(installerPath, 'utf8');
  const preset = parsePresetModelsFromJsonc(exampleText);

  for (const file of manifest.agents) {
    const agentName = file.replace(/\.md$/, '');
    const model = frontmatterModel(readFileSync(path.join(agentsDir, file), 'utf8'));
    assert.ok(model, `missing frontmatter model for ${file}`);
    assert.equal(preset[agentName]?.model, model, `default preset model mismatch for ${agentName}`);
  }

  assert.equal(exampleText.includes('deepseek-v4-flash:0731'), false);
  assert.equal(installerText.includes('deepseek-v4-flash:0731'), false);
});
