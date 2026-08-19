import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPERVISOR_OPERATIONS,
  createSupervisorExecutor,
  parseValidatedTestPlan,
} from '../../tools/guardian/supervisor-exec.mjs';

function fakeRun(calls, result = { status: 0, stdout: 'ok\n', stderr: '' }) {
  return (file, argv, options) => {
    calls.push({ file, argv, options });
    return result;
  };
}

test('supervisor exposes only fixed direct-argv operations', () => {
  assert.deepEqual(SUPERVISOR_OPERATIONS, Object.freeze([
    'current-branch', 'status-diff', 'staged-files', 'worktree-files', 'ensure-fix-branch', 'run-tests', 'stage-files', 'commit', 'push',
  ]));
  const calls = [];
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run: fakeRun(calls) });
  assert.equal(typeof executor.exec, 'function');
  assert.equal('run' in executor, false);
  assert.equal('command' in executor, false);
});

test('current branch and status diff use canonical cwd, shell false, and captured output', () => {
  const calls = [];
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo/../repo', run: fakeRun(calls) });
  const branch = executor.exec({ operation: 'current-branch' });
  const evidence = executor.exec({ operation: 'status-diff' });
  assert.equal(branch.status, 0);
  assert.equal(branch.stdout, 'ok\n');
  assert.equal(evidence.stderr, '');
  assert.equal(calls[0].file, 'git');
  assert.deepEqual(calls[0].argv, ['branch', '--show-current']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.cwd.endsWith('D:\\repo'), true);
  assert.deepEqual(calls[1].argv, ['status', '--short']);
  assert.deepEqual(calls[2].argv, ['diff', '--']);
});

test('validated test commands accept only scoped node test argv and reject wrappers/network/git writes', () => {
  assert.deepEqual(parseValidatedTestPlan([['node', '--test', 'tests/guardian/foo.test.mjs']]), [
    ['node', '--test', 'tests/guardian/foo.test.mjs'],
  ]);
  for (const command of [
    ['node', '-e', 'process.exit(0)'],
    ['cmd', '/c', 'node', '--test', 'tests/foo.test.mjs'],
    ['powershell', '-Command', 'node --test tests/foo.test.mjs'],
    ['node', '--test', 'tests/foo.test.mjs', '&&', 'git', 'push'],
    ['curl', 'https://evil.test'],
    ['git', 'status'],
    ['gh', 'pr', 'create', '--base', 'dev'],
    ['git', 'push', '--force'],
    ['npm', 'test'],
    ['node', '--test', 'D:/other/tests/foo.test.mjs'],
  ]) assert.throws(() => parseValidatedTestPlan([command]), /not allowed|scoped|command strings/i);
  assert.throws(() => parseValidatedTestPlan(['node --test tests/foo.test.mjs']), /command strings/i);
});

test('supervisor denies arbitrary operation names and constructs exact finalization argv', () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'branch') return { status: 0, stdout: 'dev\n', stderr: '' };
    if (argv[0] === 'switch' && argv.length === 2) return { status: 1, stdout: '', stderr: 'missing branch' };
    return { status: 0, stdout: 'ok\n', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  assert.throws(() => executor.exec({ operation: 'shell', command: 'git push' }), /unsupported operation|arbitrary/i);
  executor.exec({ operation: 'ensure-fix-branch', issue: 211 });
  executor.exec({ operation: 'run-tests', commands: [['node', '--test', 'tests/guardian/foo.test.mjs']] });
  executor.exec({ operation: 'stage-files', files: ['tools/guardian/foo.mjs', 'tests/guardian/foo.test.mjs'] });
  executor.exec({ operation: 'commit', issue: 211 });
  executor.exec({ operation: 'push', branch: 'fix/issue-211' });
  assert.deepEqual(calls.map((call) => call.argv), [
    ['branch', '--show-current'],
    ['switch', 'fix/issue-211'],
    ['switch', '--create', 'fix/issue-211'],
    ['--test', 'tests/guardian/foo.test.mjs'],
    ['add', '--', 'tools/guardian/foo.mjs', 'tests/guardian/foo.test.mjs'],
    ['commit', '-m', 'fix: resolve issue #211\n\nfixes #211'],
    ['push', '--set-upstream', 'origin', 'fix/issue-211'],
  ]);
  assert.equal(calls.some((call) => call.file === 'node' && call.argv[0] === '--test'), true);
  assert.deepEqual(calls.find((call) => call.file === 'node'), {
    file: 'node',
    argv: ['--test', 'tests/guardian/foo.test.mjs'],
    options: calls.find((call) => call.file === 'node').options,
  });
  assert.equal(calls.every((call) => call.file === 'git' || call.file === 'node'), true);
  assert.equal(calls.every((call) => call.options.shell === false && call.options.windowsHide === true), true);
});

test('finalization skips prose-only test plans in legacy mode without executing npm', async () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'branch') return { status: 0, stdout: 'fix/issue-211\n', stderr: '' };
    if (argv[0] === 'status' && argv[1] === '--porcelain=v1') return { status: 0, stdout: ' M tools/guardian/foo.mjs\0', stderr: '' };
    if (argv[0] === 'diff' && argv[1] === '--cached') return { status: 0, stdout: calls.some((call) => call.argv[0] === 'add') ? 'tools/guardian/foo.mjs\n' : '', stderr: '' };
    if (argv[0] === 'diff') return { status: 0, stdout: 'diff --git a/tools/guardian/foo.mjs b/tools/guardian/foo.mjs\n', stderr: '' };
    if (argv[0] === 'add') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  const result = await executor.finalizeFix({
    issue: 211,
    mode: 'legacy',
    plan: { affected_files: ['tools/guardian/foo.mjs'], test_plan: ['run focused checks'] },
  });
  assert.equal(result.tests.skipped, true);
  assert.equal(calls.some((call) => call.file === 'npm'), false);
  assert.equal(calls.some((call) => call.file === 'node'), false);
});

test('enforced finalization requires executable test_commands', async () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'branch') return { status: 0, stdout: 'fix/issue-211\n', stderr: '' };
    if (argv[0] === 'status' && argv[1] === '--porcelain=v1') return { status: 0, stdout: ' M tools/guardian/foo.mjs\0', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  await assert.rejects(
    () => executor.finalizeFix({ issue: 211, mode: 'enforced', plan: { affected_files: ['tools/guardian/foo.mjs'], test_plan: ['run focused checks'] } }),
    /test_commands/i,
  );
  assert.equal(calls.some((call) => call.argv[0] === 'commit'), false);
});

test('rejects unrelated pre-staged files before finalization', async () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'branch') return { status: 0, stdout: 'fix/issue-211\n', stderr: '' };
    if (argv[0] === 'status' && argv[1] === '--porcelain=v1') return { status: 0, stdout: 'A  .codegraph/graph.json\0 M tools/guardian/foo.mjs\0', stderr: '' };
    if (argv[0] === 'diff' && argv[1] === '--cached') return { status: 0, stdout: 'A  .codegraph/graph.json\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  await assert.rejects(() => executor.finalizeFix({ issue: 211, mode: 'enforced', plan: { affected_files: ['tools/guardian/foo.mjs'], test_commands: [['node', '--test', 'tests/guardian/foo.test.mjs']] } }), /staged|scope|codegraph|worktree/i);
  assert.equal(calls.some((call) => call.argv[0] === 'commit'), false);
});

test('rejects unrelated unstaged worktree changes before finalization', async () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'branch') return { status: 0, stdout: 'fix/issue-211\n', stderr: '' };
    if (argv[0] === 'status' && argv[1] === '--porcelain=v1') return { status: 0, stdout: ' M tools/guardian/foo.mjs\0 M unrelated/other.mjs\0', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  await assert.rejects(
    () => executor.finalizeFix({ issue: 211, mode: 'enforced', plan: { affected_files: ['tools/guardian/foo.mjs'], test_commands: [['node', '--test', 'tests/guardian/foo.test.mjs']] } }),
    /worktree|scope/i,
  );
  assert.equal(calls.some((call) => call.argv[0] === 'commit'), false);
});

test('clean scoped finalization stages only the affected files and excludes codegraph', async () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'branch') return { status: 0, stdout: 'fix/issue-211\n', stderr: '' };
    if (argv[0] === 'status' && argv[1] === '--porcelain=v1') return { status: 0, stdout: ' M tools/guardian/foo.mjs\0', stderr: '' };
    if (argv[0] === 'diff' && argv[1] === '--cached') return { status: 0, stdout: 'tools/guardian/foo.mjs\n', stderr: '' };
    if (argv[0] === 'diff') return { status: 0, stdout: 'diff\n', stderr: '' };
    if (argv[0] === 'add') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  const result = await executor.finalizeFix({ issue: 211, mode: 'enforced', plan: { affected_files: ['tools/guardian/foo.mjs'], test_commands: [['node', '--test', 'tests/guardian/foo.test.mjs']] } });
  assert.equal(result.branch, 'fix/issue-211');
  assert.deepEqual(calls.find((call) => call.argv[0] === 'add').argv, ['add', '--', 'tools/guardian/foo.mjs']);
  assert.equal(calls.some((call) => call.argv.includes('.codegraph')), false);
});

test('ensure-fix-branch creates only when switching an existing branch fails', () => {
  const calls = [];
  const run = (file, argv, options) => {
    calls.push({ file, argv, options });
    if (argv[0] === 'switch' && argv.length === 2) return { status: 1, stdout: '', stderr: 'missing branch' };
    return { status: 0, stdout: argv[0] === 'branch' ? 'dev\n' : '', stderr: '' };
  };
  const executor = createSupervisorExecutor({ repoDir: 'D:/repo', run });
  const result = executor.exec({ operation: 'ensure-fix-branch', issue: 211 });
  assert.equal(result.status, 0);
  assert.deepEqual(calls.map((call) => call.argv), [
    ['branch', '--show-current'],
    ['switch', 'fix/issue-211'],
    ['switch', '--create', 'fix/issue-211'],
  ]);
});
