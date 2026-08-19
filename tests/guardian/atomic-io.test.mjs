import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { atomicWriteText } from '../../tools/guardian/atomic-io.mjs';
import { withGithubBodyFile } from '../../tools/guardian/github-body-file.mjs';

test('atomicWriteText writes UTF-8 and leaves no temp file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardian-atomic-'));
  try {
    const file = path.join(dir, 'state.json');
    writeFileSync(file, 'old\n', 'utf8');
    atomicWriteText(file, '中文 ✅\n', { makeId: () => 'fixed' });
    assert.equal(readFileSync(file, 'utf8'), '中文 ✅\n');
    assert.deepEqual(readdirSync(dir), ['state.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicWriteText preserves old file when rename fails and removes temp', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardian-atomic-fail-'));
  try {
    const file = path.join(dir, 'state.json');
    writeFileSync(file, 'old\n', 'utf8');
    const fsOps = { mkdirSync: () => {}, writeFileSync, renameSync: () => { throw new Error('rename failed'); }, rmSync };
    assert.throws(() => atomicWriteText(file, 'new\n', { fsOps, makeId: () => 'failure' }), /rename failed/);
    assert.equal(readFileSync(file, 'utf8'), 'old\n');
    assert.equal(existsSync(path.join(dir, '.state.json.failure.tmp')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withGithubBodyFile preserves exact Unicode bytes and cleans on success', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-body-'));
  let observed;
  try {
    observed = withGithubBodyFile('中文内容 ✅', (file) => ({ file, text: readFileSync(file, 'utf8'), bytes: readFileSync(file) }), { tempRoot: `${root}${path.sep}` });
    assert.equal(observed.text, '中文内容 ✅');
    assert.deepEqual(observed.bytes, Buffer.from('中文内容 ✅', 'utf8'));
    assert.equal(existsSync(path.dirname(observed.file)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('withGithubBodyFile cleans recursively when callback fails and rethrows', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-body-fail-'));
  let bodyDir;
  try {
    assert.throws(() => withGithubBodyFile('失败', (file) => { bodyDir = path.dirname(file); throw new Error('callback failed'); }, { tempRoot: `${root}${path.sep}` }), /callback failed/);
    assert.equal(existsSync(bodyDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
