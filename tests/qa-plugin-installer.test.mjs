import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensurePluginConfig,
  ensureQaSkillConfigFile,
  mergeManagedPluginEntry,
  updatePluginConfigText,
} from '../tools/opencode/install-qa-plugin.mjs';

const MANAGED_SPEC = 'file:///tmp/repo/packages/qa-opencode-plugin/dist/server.js';
const MANAGED_TUI_SPEC = 'file:///tmp/repo/packages/qa-opencode-plugin/dist/tui.js';

test('installer merges plugin arrays idempotently and preserves comments when practical', () => {
  const source = `// top comment\n{\n  // keep me\n  "plugin": [\n    "npm:other",\n    "file:///old/repo/packages/qa-opencode-plugin/dist/server.js"\n  ]\n}\n`;
  const updated = updatePluginConfigText(source, MANAGED_SPEC, { filePath: 'opencode.jsonc' });
  const updatedTwice = updatePluginConfigText(updated, MANAGED_SPEC, { filePath: 'opencode.jsonc' });
  assert.match(updated, /top comment/);
  assert.match(updated, /keep me/);
  assert.deepEqual(updated, updatedTwice);
  assert.match(updated, /"npm:other"/);
  assert.match(updated, /"file:\/\/\/tmp\/repo\/packages\/qa-opencode-plugin\/dist\/server\.js"/);
  assert.equal(updated.includes('file:///old/repo/packages/qa-opencode-plugin/dist/server.js'), false);
});

test('mergeManagedPluginEntry appends managed entry last and removes stale managed entries', () => {
  const next = mergeManagedPluginEntry([
    'npm:a',
    MANAGED_SPEC,
    ['file:///old/repo/packages/qa-opencode-plugin/tui', {}],
    'file:///old/repo/packages/qa-opencode-plugin/dist/tui.js',
  ], MANAGED_TUI_SPEC, 'tui.jsonc');
  assert.deepEqual(next, ['npm:a', MANAGED_TUI_SPEC]);
});

test('installer writes qa-skill config only when absent and copies schema', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qa-plugin-installer-'));
  try {
    const qaConfigPath = path.join(root, 'qa-skill.jsonc');
    const schemaTargetPath = path.join(root, 'qa-skill.schema.json');
    const schemaSourcePath = path.join(root, 'source.schema.json');
    writeFileSync(schemaSourcePath, '{"title":"schema"}\n');

    const created = await ensureQaSkillConfigFile({ qaConfigPath, schemaTargetPath, schemaSourcePath, dryRun: false });
    assert.equal(created, true);
    assert.match(readFileSync(qaConfigPath, 'utf8'), /QA-Agents/);
    assert.equal(readFileSync(schemaTargetPath, 'utf8'), '{"title":"schema"}\n');

    writeFileSync(qaConfigPath, '{"preset":"keep"}\n');
    const createdAgain = await ensureQaSkillConfigFile({ qaConfigPath, schemaTargetPath, schemaSourcePath, dryRun: false });
    assert.equal(createdAgain, false);
    assert.equal(readFileSync(qaConfigPath, 'utf8'), '{"preset":"keep"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensurePluginConfig creates new config files atomically in temp dirs', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qa-plugin-config-file-'));
  try {
    mkdirSync(root, { recursive: true });
    const opencodePath = path.join(root, 'opencode.jsonc');
    const result = await ensurePluginConfig({ filePath: opencodePath, managedSpec: MANAGED_SPEC, dryRun: false, schema: 'https://opencode.ai/config.json', logger: { log() {} } });
    assert.equal(result.created, true);
    const text = readFileSync(opencodePath, 'utf8');
    assert.match(text, /https:\/\/opencode.ai\/config.json/);
    assert.match(text, /qa-opencode-plugin\/dist\/server\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installer rewrites legacy root and bogus /tui file urls to built artifacts', () => {
  const opencodeSource = `{"plugin":["file:///repo/packages/qa-opencode-plugin"]}\n`;
  const tuiSource = `{"plugin":["file:///repo/packages/qa-opencode-plugin/tui"]}\n`;
  const nextOpencode = updatePluginConfigText(opencodeSource, MANAGED_SPEC, { filePath: 'opencode.jsonc' });
  const nextTui = updatePluginConfigText(tuiSource, MANAGED_TUI_SPEC, { filePath: 'tui.jsonc' });
  assert.match(nextOpencode, /dist\/server\.js/);
  assert.doesNotMatch(nextOpencode, /qa-opencode-plugin"/);
  assert.match(nextTui, /dist\/tui\.js/);
  assert.doesNotMatch(nextTui, /qa-opencode-plugin\/tui/);
});
