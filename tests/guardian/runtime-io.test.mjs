import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLogger, readJsonFile, renderStartupBanner, resolveBannerMode, stripUtf8Bom } from '../../tools/guardian/runtime-io.mjs';

test('stripUtf8Bom and readJsonFile accept PowerShell BOM JSON', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardian-runtime-io-'));
  const file = path.join(dir, 'config.json');
  try {
    writeFileSync(file, '\uFEFF{"target_repo":"D:/tuantuanrent"}', 'utf8');
    assert.equal(stripUtf8Bom('\uFEFFx'), 'x');
    assert.deepEqual(readJsonFile(file), { target_repo: 'D:/tuantuanrent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonFile errors include path but not JSON secret content', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardian-runtime-io-'));
  const file = path.join(dir, 'bad.json');
  try {
    writeFileSync(file, '\uFEFF{"token":"secret-value"', 'utf8');
    assert.throws(() => readJsonFile(file), (error) => {
      assert.match(error.message, /bad\.json/);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('structured logger emits required fields to injected sink', () => {
  let output = '';
  const logger = createLogger({ component: 'test', sink: { write: (line) => { output += line; } }, now: () => '2026-01-01T00:00:00.000Z' });
  logger.warn('something.happened', { issue: 42, error: new Error('safe message') });
  const entry = JSON.parse(output);
  assert.deepEqual(entry, {
    ts: '2026-01-01T00:00:00.000Z',
    level: 'warn',
    component: 'test',
    event: 'something.happened',
    issue: 42,
    error_name: 'Error',
    error_message: 'safe message',
  });
});

test('banner supports ascii and unicode modes', () => {
  assert.equal(resolveBannerMode({ QA_GUARDIAN_BANNER_MODE: 'ascii' }), 'ascii');
  assert.equal(resolveBannerMode({ QA_GUARDIAN_BANNER_MODE: 'unicode' }), 'unicode');
  assert.equal(renderStartupBanner('ascii'), '<> QA Guardian / DEVer');
  assert.equal(renderStartupBanner('unicode'), '◇ QA Guardian / DEVer');
});
