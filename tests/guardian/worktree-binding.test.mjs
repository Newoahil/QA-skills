import assert from 'node:assert/strict';
import { unlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  makeStrictBinding,
  makeWorktreeBinding,
  readLauncherConfig,
  resolveAuthoritativeControlRepo,
  resolveLauncherBinding,
  resolveViewerRepo,
  validateCommandAuthors,
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

test('supports optional non-empty command authors in binding builders and validation', () => {
  const strictBinding = makeStrictBinding({
    canonicalTargetPath: 'D:/strict-authors-project', guardianRepoPath: 'D:/QA-skills', baseBranch: 'dev',
    commandAuthors: ['strict-owner'],
  });
  assert.deepEqual(strictBinding.command_authors, ['strict-owner']);
  const binding = makeWorktreeBinding({
    canonicalTargetPath: 'D:/authors-project', guardianRepoPath: 'D:/QA-skills', baseBranch: 'dev',
    controlWorktreePath: 'D:/authors-project.control', qaSnapshotPath: 'D:/authors-project.qa',
    selectedRuntimeInputPaths: [], commandAuthors: [' alice ', 'bob'],
  });
  assert.deepEqual(binding.command_authors, ['alice', 'bob']);
  assert.deepEqual(validateBinding(binding, { canonicalTargetPath: 'D:/authors-project' }).binding.command_authors, ['alice', 'bob']);
  assert.equal(validateCommandAuthors(undefined).ok, true);
  assert.equal(validateCommandAuthors([]).ok, false);
  assert.equal(validateCommandAuthors([' ']).ok, false);
  assert.equal(validateCommandAuthors('alice').ok, false);
});

test('rejects malformed selected runtime input lists', () => {
  assert.equal(validateRuntimeInputPaths(['.env.test', '../bad']).ok, false);
  assert.equal(validateRuntimeInputPaths(['.env.test', '.env.test']).ok, false);
});

test('resolves independent project bindings without cross-project reuse', () => {
  const first = makeWorktreeBinding({
    canonicalTargetPath: 'D:/project-one', guardianRepoPath: 'D:/QA-skills', baseBranch: 'dev',
    controlWorktreePath: 'D:/project-one.control', qaSnapshotPath: 'D:/project-one.qa',
    selectedRuntimeInputPaths: [],
  });
  const second = makeWorktreeBinding({
    canonicalTargetPath: 'D:/project-two', guardianRepoPath: 'D:/QA-skills', baseBranch: 'dev',
    controlWorktreePath: 'D:/project-two.control', qaSnapshotPath: 'D:/project-two.qa',
    selectedRuntimeInputPaths: [],
  });
  const config = { version: 2, last_target_repo: 'd:/project-two', projects: {
    'D:/project-one': first,
    'D:/project-two': second,
  } };
  assert.equal(resolveLauncherBinding(config, 'D:/project-one').control_worktree_path, 'D:/project-one.control');
  assert.equal(resolveLauncherBinding(config, 'D:/project-two').control_worktree_path, 'D:/project-two.control');
  assert.equal(resolveLauncherBinding(config, 'D:/project-three'), null);
  assert.equal(resolveAuthoritativeControlRepo('D:/project-two', resolveLauncherBinding(config, 'D:/project-two')), 'D:/project-two.control');
});

test('keeps legacy v1 binding readable for its exact target only', () => {
  const legacy = makeWorktreeBinding({
    canonicalTargetPath: 'D:/legacy-project', guardianRepoPath: 'D:/QA-skills', baseBranch: 'dev',
    controlWorktreePath: 'D:/legacy-project.control', qaSnapshotPath: 'D:/legacy-project.qa',
    selectedRuntimeInputPaths: [],
  });
  assert.equal(resolveLauncherBinding(legacy, 'D:/legacy-project').control_worktree_path, 'D:/legacy-project.control');
  assert.equal(resolveLauncherBinding(legacy, 'D:/other-project'), null);
  assert.equal(readLauncherConfig('tests/guardian/does-not-exist.json'), null);
});

test('resolveViewerRepo uses the matching project entry and not last_target_repo', () => {
  const config = {
    version: 2,
    last_target_repo: 'd:/project-two',
    projects: {
      'D:/project-one': { version: 1, mode: 'worktree', canonical_target_path: 'D:/project-one', control_worktree_path: 'D:/project-one.control' },
      'D:/project-two': { version: 1, mode: 'worktree', canonical_target_path: 'D:/project-two', control_worktree_path: 'D:/project-two.control' },
    },
  };
  const bindingFile = 'tests/guardian/.tmp-launcher-config.json';
  writeFileSync(bindingFile, JSON.stringify(config));
  try {
    assert.equal(resolveViewerRepo('D:/project-one', bindingFile), 'D:/project-one.control');
  } finally {
    unlinkSync(bindingFile);
  }
});
