import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createPullRequest, currentBranch } from '../../tools/guardian/pr-io.mjs';
import { ACTORS } from '../../tools/guardian/actor-routing.mjs';

test('createPullRequest uses shell-free gh argv and returns URL', () => {
  let captured;
  const url = createPullRequest({ actor: ACTORS.SUPERVISOR, repoDir: 'D:/repo', head: 'fix/issue-1', base: 'dev', title: '修复', body: '正文', run: (_cmd, args, opts) => {
    const bodyFile = args[args.indexOf('--body-file') + 1];
    captured = { args, opts, body: readFileSync(bodyFile, 'utf8'), existsDuringRun: existsSync(bodyFile) };
    return { status: 0, stdout: 'https://github/pr/1\n', stderr: '' };
  } });
  assert.equal(url, 'https://github/pr/1');
  assert.equal(captured.opts.shell, false);
  assert.equal(captured.args.includes('fix/issue-1'), true);
  assert.equal(captured.args.includes('--body-file'), true);
  assert.equal(captured.args.includes('--body'), false);
  assert.equal(captured.body, '正文');
  assert.equal(captured.existsDuringRun, true);
  assert.equal(existsSync(captured.args[captured.args.indexOf('--body-file') + 1]), false);
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
  assert.throws(() => createPullRequest({ actor: ACTORS.SUPERVISOR, repoDir: 'D:/repo', head: 'fix/x', base: 'dev', title: 'x', body: 'x', run: () => ({ status: 1, stderr: 'forbidden' }) }), /forbidden/);
});

test('createPullRequest rejects QA, fixer, and unknown actors before gh', () => {
  for (const actor of [ACTORS.BOT_FACT_WRITER, ACTORS.BOT_EXECUTOR, 'unknown']) {
    let calls = 0;
    assert.throws(() => createPullRequest({ actor, repoDir: 'D:/repo', head: 'fix/x', base: 'dev', title: 'x', body: 'x', run: () => { calls += 1; return { status: 0, stdout: 'url' }; } }), /may not perform|unknown actor/);
    assert.equal(calls, 0, actor);
  }
});

test('createPullRequest cleans body file after gh failure without exposing body in error', () => {
  let bodyFile;
  assert.throws(() => createPullRequest({ actor: ACTORS.SUPERVISOR, repoDir: 'D:/repo', head: 'fix/x', base: 'dev', title: 'x', body: '中文秘密', run: (_cmd, args) => {
    bodyFile = args[args.indexOf('--body-file') + 1];
    return { status: 1, stderr: 'forbidden' };
  } }), /forbidden/);
  assert.equal(existsSync(bodyFile), false);
});
