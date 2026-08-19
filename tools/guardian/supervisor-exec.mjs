// Supervisor-owned direct-argv seam for the small set of repository operations that agents must
// not execute. There is deliberately no arbitrary command/string entrypoint in this module.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const SUPERVISOR_OPERATIONS = Object.freeze([
  'current-branch', 'status-diff', 'staged-files', 'ensure-fix-branch', 'run-tests', 'stage-files', 'commit', 'push',
]);

const TEST_PATH = /^(?:tests|test|src)[\\/][^\\/].*\.(?:mjs|js|cjs|ts|tsx|jsx)$/;

function canonicalRepoDir(repoDir) {
  if (typeof repoDir !== 'string' || repoDir.trim() === '') throw new TypeError('repoDir is required');
  return path.resolve(repoDir);
}

function repoRelativePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value)) {
    throw new Error(`${label} must be a scoped relative path`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').includes('..') || normalized.startsWith('./') || normalized === '.codegraph' || normalized.startsWith('.codegraph/')) {
    throw new Error(`${label} must be a scoped relative path`);
  }
  return normalized;
}

function testArgv(argv) {
  if (!Array.isArray(argv) || argv.length < 2 || argv[0] !== 'node') {
    throw new Error('test command is not allowed');
  }
  const [, subcommand, ...args] = argv;
  if (subcommand !== '--test' || args.length === 0 || args.some((arg) => !TEST_PATH.test(repoRelativePath(arg, 'test path')))) {
    throw new Error('test command is not allowed');
  }
  return ['node', '--test', ...args.map((arg) => repoRelativePath(arg, 'test path'))];
}

export function parseValidatedTestPlan(commands) {
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('test plan is empty');
  return commands.map((command) => {
    if (!Array.isArray(command)) throw new Error('test plan must contain argv arrays; command strings are not allowed');
    return testArgv(command);
  });
}

function issueNumber(issue) {
  if (!Number.isInteger(Number(issue)) || Number(issue) <= 0) throw new Error('issue must be a positive integer');
  return Number(issue);
}

function branchName(issue) { return `fix/issue-${issueNumber(issue)}`; }

function checkedResult(file, argv, options, run) {
  const result = run(file, argv, options);
  return {
    status: Number.isInteger(result?.status) ? result.status : 1,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
}

export function createSupervisorExecutor({ repoDir, run = spawnSync } = {}) {
  const cwd = canonicalRepoDir(repoDir);
  const options = { cwd, encoding: 'utf8', shell: false, windowsHide: true };
  const git = (argv) => checkedResult('git', argv, options, run);
  const direct = (argv) => checkedResult(argv[0], argv.slice(1), options, run);

  function exec(request) {
    if (!request || typeof request !== 'object' || !SUPERVISOR_OPERATIONS.includes(request.operation)) {
      throw new Error('unsupported operation; arbitrary commands are not available');
    }
    switch (request.operation) {
      case 'current-branch': return git(['branch', '--show-current']);
      case 'status-diff': {
        const status = git(['status', '--short']);
        if (status.status !== 0) return status;
        const diff = git(['diff', '--']);
        return { ...diff, stdout: `${status.stdout}${diff.stdout}` };
      }
      case 'staged-files': return git(['diff', '--cached', '--name-only']);
      case 'ensure-fix-branch': {
        const branch = branchName(request.issue);
        const current = git(['branch', '--show-current']);
        if (current.status !== 0 || current.stdout.trim() === branch) return current;
        const switched = git(['switch', branch]);
        if (switched.status === 0) return switched;
        return git(['switch', '--create', branch]);
      }
      case 'run-tests': {
        const commands = parseValidatedTestPlan(request.commands);
        const results = commands.map((argv) => direct(argv));
        return results.find((result) => result.status !== 0) ?? results.at(-1);
      }
      case 'stage-files': {
        if (!Array.isArray(request.files) || request.files.length === 0) throw new Error('stage files are required');
        const files = request.files.map((file) => repoRelativePath(file, 'affected file'));
        return git(['add', '--', ...files]);
      }
      case 'commit': {
        const issue = issueNumber(request.issue);
        return git(['commit', '-m', `fix: resolve issue #${issue}\n\nfixes #${issue}`]);
      }
      case 'push': {
        const branch = branchName(request.issue ?? request.branch?.replace('fix/issue-', ''));
        if (request.branch && request.branch !== branch) throw new Error('push branch is not the issue fix branch');
        return git(['push', '--set-upstream', 'origin', branch]);
      }
      default: throw new Error('unsupported operation; arbitrary commands are not available');
    }
  }

  function prepareFixBranch(issue) {
    return exec({ operation: 'ensure-fix-branch', issue });
  }

  async function finalizeFix({ issue, plan }) {
    const affectedFiles = Array.isArray(plan?.affected_files) ? plan.affected_files.map((file) => repoRelativePath(file, 'affected file')) : [];
    if (affectedFiles.length === 0) throw new Error('affected files are required');
    const expected = new Set(affectedFiles);
    const stagedNames = () => {
      const result = exec({ operation: 'staged-files' });
      if (result.status !== 0) throw new Error(`staged file inspection failed: ${result.stderr || 'unknown'}`);
      return result.stdout.split(/\r?\n/).map((name) => name.trim().replaceAll('\\', '/')).filter(Boolean);
    };
    const rejectOutOfScope = (names, phase) => {
      const extras = names.filter((name) => !expected.has(name));
      if (extras.length > 0) throw new Error(`${phase} staged files outside plan scope: ${extras.join(', ')}`);
    };
    const testCommands = plan?.test_commands;
    const branch = branchName(issue);
    const current = exec({ operation: 'current-branch' });
    if (current.status !== 0 || current.stdout.trim() !== branch) {
      throw new Error(`finalization requires current branch ${branch}`);
    }
    const evidence = exec({ operation: 'status-diff' });
    if (evidence.status !== 0) throw new Error(`status/diff failed: ${evidence.stderr || 'unknown'}`);
    const tests = Array.isArray(testCommands) && testCommands.length > 0
      ? exec({ operation: 'run-tests', commands: testCommands })
      : { status: 0, skipped: true, reason: 'no test_commands supplied' };
    if (tests.status !== 0) throw new Error(`scoped tests failed: ${tests.stderr || tests.stdout || 'unknown'}`);
    rejectOutOfScope(stagedNames(), 'pre-existing');
    const stage = exec({ operation: 'stage-files', files: affectedFiles });
    if (stage.status !== 0) throw new Error(`stage failed: ${stage.stderr || 'unknown'}`);
    const stagedAfterAdd = stagedNames();
    rejectOutOfScope(stagedAfterAdd, 'post-add');
    if (stagedAfterAdd.length === 0) throw new Error('no scoped files staged for finalization');
    const commit = exec({ operation: 'commit', issue });
    if (commit.status !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      throw new Error(`commit failed: ${commit.stderr || 'unknown'}`);
    }
    const push = exec({ operation: 'push', branch });
    if (push.status !== 0) throw new Error(`push failed: ${push.stderr || 'unknown'}`);
    return { branch, evidence, tests, commit, push };
  }

  return Object.freeze({ exec, prepareFixBranch, finalizeFix });
}
