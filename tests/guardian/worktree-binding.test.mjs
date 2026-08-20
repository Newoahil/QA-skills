import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeWorktreeBinding,
  resolveAuthoritativeControlRepo,
  validateBinding,
  validateRepositoryRelativePath,
  validateRuntimeInputPaths,
} from '../../tools/guardian/worktree-binding.mjs';

test('rejects traversal, absolute, and protected runtime input paths', () => {
  for (const value of ['../secret.env', '/secret.env', 'C:/secret.env', '.git/config', '.qa/guardian/1.json', 'node_modules/pkg/index.js']) {
    assert.equal(validateRepositoryRelativePath(value).ok, false, value);
  }
  assert.deepEqual(validateRepositoryRelativePath('config/runtime.env'), { ok: true, relativePath: 'config/runtime.env' });
});

test('validates persisted binding metadata and canonical target identity', () => {
  const binding = makeWorktreeBinding({
    canonicalTargetPath: 'D:/tuantuanrent', guardianRepoPath: 'D:/QA-skills', baseBranch: 'dev',
    controlWorktreePath: 'D:/tuantuanrent.qa-guardian-control', qaSnapshotPath: 'D:/tuantuanrent.qa-guardian-qa',
    selectedRuntimeInputPaths: ['.env.test'], gitIdentity: 'repo-id',
  });
  assert.equal(validateBinding(binding, { canonicalTargetPath: 'D:/tuantuanrent', guardianRepoPath: 'D:/QA-skills' }).ok, true);
  assert.equal(validateBinding(binding, { canonicalTargetPath: 'D:/other' }).ok, false);
  assert.equal(resolveAuthoritativeControlRepo('D:/tuantuanrent', binding), 'D:/tuantuanrent.qa-guardian-control');
});

test('rejects malformed selected runtime input lists', () => {
  assert.equal(validateRuntimeInputPaths(['.env.test', '../bad']).ok, false);
  assert.equal(validateRuntimeInputPaths(['.env.test', '.env.test']).ok, false);
});
