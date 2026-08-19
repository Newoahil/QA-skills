import assert from 'node:assert/strict';
import test from 'node:test';
import { createPullRequest, currentBranch } from '../../tools/guardian/pr-io.mjs';

test('createPullRequest uses shell-free gh argv and returns URL', () => {
  let captured;
  const url = createPullRequest({ repoDir: 'D:/repo', head: 'fix/issue-1', base: 'dev', title: '修复', body: '正文', run: (_cmd, args, opts) => { captured = { args, opts }; return { status: 0, stdout: 'https://github/pr/1\n', stderr: '' }; } });
  assert.equal(url, 'https://github/pr/1');
  assert.equal(captured.opts.shell, false);
  assert.equal(captured.args.includes('fix/issue-1'), true);
});

test('currentBranch reads the checked-out branch without a shell', () => {
  const calls = [];
  const branch = currentBranch('D:/repo', (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0, stdout: 'fix/issue-211\n', stderr: '' };
  });
  assert.equal(branch, 'fix/issue-211');
  assert.equal(calls[0].cmd, 'git');
  assert.deepEqual(calls[0].args, ['branch', '--show-current']);
  assert.equal(calls[0].opts.shell, false);
});

test('createPullRequest throws on gh failure', () => {
  assert.throws(() => createPullRequest({ repoDir: 'D:/repo', head: 'fix/x', base: 'dev', title: 'x', body: 'x', run: () => ({ status: 1, stderr: 'forbidden' }) }), /forbidden/);
});
