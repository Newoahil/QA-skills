import assert from 'node:assert/strict';
import test from 'node:test';
import { createPullRequest } from '../../tools/guardian/pr-io.mjs';

test('createPullRequest uses shell-free gh argv and returns URL', () => {
  let captured;
  const url = createPullRequest({ repoDir: 'D:/repo', head: 'fix/issue-1', base: 'dev', title: '修复', body: '正文', run: (_cmd, args, opts) => { captured = { args, opts }; return { status: 0, stdout: 'https://github/pr/1\n', stderr: '' }; } });
  assert.equal(url, 'https://github/pr/1');
  assert.equal(captured.opts.shell, false);
  assert.equal(captured.args.includes('fix/issue-1'), true);
});

test('createPullRequest throws on gh failure', () => {
  assert.throws(() => createPullRequest({ repoDir: 'D:/repo', head: 'fix/x', base: 'dev', title: 'x', body: 'x', run: () => ({ status: 1, stderr: 'forbidden' }) }), /forbidden/);
});
