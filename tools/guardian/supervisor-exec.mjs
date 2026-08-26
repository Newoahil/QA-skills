// Supervisor-owned direct-argv seam for the small set of repository operations that agents must
// not execute. There is deliberately no arbitrary command/string entrypoint in this module.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { declaredPathList } from './plan-validator.mjs';

export const SUPERVISOR_OPERATIONS = Object.freeze([
  'current-branch', 'status-diff', 'staged-files', 'worktree-files', 'ensure-fix-branch', 'run-tests', 'pre-qa-evidence', 'stage-files', 'commit', 'push',
]);

// A scoped node test target is either (a) a file under a tests/test/__tests__ directory segment, or
// (b) a file whose basename follows a test naming convention (test-*, *.test.*, *.spec.*). The latter
// covers monorepos like frontend/apps/*/scripts/test-*.js where regression tests live beside build
// scripts. A bare src/ directory is intentionally NOT a test root (its files are product source);
// only a test-named file under src/ qualifies. repoRelativePath() already blocks traversal/absolute.
const TEST_PATH = /(?:(?:^|[\\/])(?:tests?|__tests__)[\\/].+|(?:^|[\\/])(?:test-[^\\/]+|[^\\/]+\.(?:test|spec)))\.(?:mjs|js|cjs|ts|tsx|jsx)$/;
const ALLOWED_PROJECT_TEST_SCRIPTS = Object.freeze([
  'frontend/apps/alipay-miniapp/scripts/test-category-builder-runtime.js',
]);

// Paths the Guardian runtime legitimately mutates outside the plan scope. These are never staged
// into the product commit but must not block worktree isolation.
const GUARDIAN_ALLOWLIST = Object.freeze([
  /^\.qa\/guardian\//,
  /^\.sybermem\//,
  /^\.scheduler\.lock$/,
  /^watch-state\.json$/,
]);

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
  if (argv.length === 2 && ALLOWED_PROJECT_TEST_SCRIPTS.includes(repoRelativePath(subcommand, 'test script'))) {
    return ['node', repoRelativePath(subcommand, 'test script')];
  }
  if (subcommand === '--test' && args.length > 0 && args.every((arg) => TEST_PATH.test(repoRelativePath(arg, 'test path')))) {
    return ['node', '--test', ...args.map((arg) => repoRelativePath(arg, 'test path'))];
  }
  throw new Error('test command is not allowed');
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
      case 'worktree-files': return git(['status', '--porcelain=v1', '-z', '-uall']);
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
      case 'pre-qa-evidence': {
        const commands = parseValidatedTestPlan(request.commands);
        const status = git(['status', '--short']);
        const diff = status.status === 0 ? git(['diff', '--']) : { status: 1, stdout: '', stderr: 'status failed' };
        const tests = commands.map((argv) => ({ argv, result: direct(argv) }));
        const evidence = {
          status_diff: {
            command: ['git', 'status', '--short', '&&', 'git', 'diff', '--'],
            exit_code: status.status === 0 ? diff.status : status.status,
            stdout: `${status.stdout}${diff.stdout}`,
            stderr: status.status === 0 ? diff.stderr : status.stderr,
          },
          tests: tests.map(({ argv, result }) => ({
            command: argv,
            exit_code: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
          })),
        };
        const failed = evidence.status_diff.exit_code !== 0
          ? evidence.status_diff
          : evidence.tests.find((entry) => entry.exit_code !== 0);
        return { status: failed?.exit_code ?? 0, evidence };
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

  function prepareFixBranch(issue, { baseBranch = 'dev', plan = null } = {}) {
    return prepareFixBranchFromBase(issue, { baseBranch, plan });
  }

  function prepareFixBranchFromBase(issue, { baseBranch = 'dev', plan = null } = {}) {
    const branch = branchName(issue);
    const base = repoRelativePath(baseBranch, 'base branch');
    const fetched = git(['fetch', 'origin', base]);
    if (fetched.status !== 0) return { ...fetched, code: 'base-fetch-failed', recoverable: true };

    const status = git(['status', '--porcelain=v1', '-uall']);
    if (status.status !== 0) return { ...status, code: 'worktree-status-failed', recoverable: true };
    const statusEntries = status.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({
        xy: line.slice(0, 2),
        path: line.slice(3).trim().replace(/ -> .*$/u, '').replace(/^"|"$/gu, '').replaceAll('\\', '/'),
      }))
      .filter((entry) => entry.path !== '');
    const isGuardianOwned = (path) => GUARDIAN_ALLOWLIST.some((re) => re.test(path));
    const dirtyPaths = statusEntries.filter((entry) => !isGuardianOwned(entry.path)).map((entry) => entry.path);
    // Guardian-owned TRACKED dirty files (e.g. SyberMem hooks continuously rewrite
    // .sybermem/.auto-trail.jsonl / .recall-debug.jsonl). Untracked (`??`) entries have no HEAD
    // version to restore and never block a checkout the way tracked local changes do, so skip them.
    const guardianOwnedTrackedDirty = statusEntries
      .filter((entry) => isGuardianOwned(entry.path) && entry.xy !== '??')
      .map((entry) => entry.path);
    if (dirtyPaths.length > 0) {
      const current = git(['branch', '--show-current']);
      if (current.status !== 0) return { ...current, code: 'current-branch-failed', recoverable: true };
      const planned = new Set(declaredPathList(plan?.affected_files).map((file) => repoRelativePath(file, 'affected file')));
      const outOfPlan = dirtyPaths.filter((path) => !planned.has(path));
      if (current.stdout.trim() === branch && outOfPlan.length === 0) {
        return { status: 0, stdout: status.stdout, stderr: '', code: 'planned-dirty-fix-branch-current', base_branch: base, branch };
      }
      return {
        status: 1,
        stdout: status.stdout,
        stderr: `cannot prepare ${branch}: dirty worktree outside Guardian-owned state (${dirtyPaths.join(', ')}); recover by cleaning or preserving changes before retry`,
        code: 'stale-dirty-fix-branch',
        recoverable: true,
      };
    }

    // Neutralize Guardian-owned tracked dirty files BEFORE any branch-changing op. These are our own
    // runtime state (SyberMem hooks rewrite them continuously); left dirty they make `git switch` /
    // `git reset --hard` abort with "local changes would be overwritten". Restore only these exact
    // allowlisted tracked paths to HEAD — never product files. Idempotent: a no-op once clean.
    if (guardianOwnedTrackedDirty.length > 0) {
      const restored = git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...guardianOwnedTrackedDirty]);
      if (restored.status !== 0) {
        return { ...restored, code: 'guardian-state-neutralize-failed', recoverable: true };
      }
    }

    const current = git(['branch', '--show-current']);
    if (current.status !== 0) return { ...current, code: 'current-branch-failed', recoverable: true };
    const existing = git(['rev-parse', '--verify', branch]);
    if (existing.status !== 0) {
      const created = git(['switch', '--create', branch, `origin/${base}`]);
      return created.status === 0
        ? { ...created, code: 'new-fix-branch-created', base_branch: base, branch }
        : { ...created, code: 'fix-branch-create-failed', recoverable: true };
    }

    const originBase = git(['rev-parse', '--verify', `origin/${base}`]);
    if (originBase.status !== 0) return { ...originBase, code: 'base-ref-missing', recoverable: true };
    const mergeBase = git(['merge-base', branch, `origin/${base}`]);
    if (mergeBase.status !== 0) return { ...mergeBase, code: 'base-ancestry-check-failed', recoverable: true };
    if (mergeBase.stdout.trim() === originBase.stdout.trim()) {
      const switched = current.stdout.trim() === branch ? current : git(['switch', branch]);
      return switched.status === 0
        ? { ...switched, code: 'fix-branch-current', base_branch: base, branch }
        : { ...switched, code: 'fix-branch-switch-failed', recoverable: true };
    }

    const switched = current.stdout.trim() === branch ? current : git(['switch', branch]);
    if (switched.status !== 0) return { ...switched, code: 'fix-branch-switch-failed', recoverable: true };
    const reset = git(['reset', '--hard', `origin/${base}`]);
    return reset.status === 0
      ? { ...reset, code: 'stale-clean-branch-refreshed', base_branch: base, branch }
      : { ...reset, code: 'stale-clean-branch-refresh-failed', recoverable: true };
  }

  // Parse `git status --porcelain=v1 -z` into changed paths (both staged and unstaged/untracked).
  function worktreeChangedPaths() {
    const result = exec({ operation: 'worktree-files' });
    if (result.status !== 0) throw new Error(`worktree inspection failed: ${result.stderr || 'unknown'}`);
    const entries = result.stdout.split('\0').filter(Boolean);
    const paths = [];
    for (let i = 0; i < entries.length; i += 1) {
      const line = entries[i];
      // porcelain v1 -z: "XY path" (path may contain spaces; no quoting in -z mode).
      const path = line.slice(3).trim().replaceAll('\\', '/');
      if (path) paths.push(path);
    }
    return paths;
  }

  function assertWorktreeIsolated(plan) {
    const affected = new Set(declaredPathList(plan?.affected_files).map((file) => repoRelativePath(file, 'affected file')));
    const changed = worktreeChangedPaths();
    const outOfScope = changed.filter((path) => !affected.has(path) && !GUARDIAN_ALLOWLIST.some((re) => re.test(path)));
    if (outOfScope.length > 0) {
      throw new Error(`worktree has changes outside plan scope: ${outOfScope.join(', ')}`);
    }
  }

  async function finalizeFix({ issue, plan, mode = 'enforced', isActiveRun = () => true }) {
    const assertActiveRun = () => {
      if (!isActiveRun()) throw new Error('finalization fenced: active run is false');
    };
    const affectedFiles = declaredPathList(plan?.affected_files).map((file) => repoRelativePath(file, 'affected file'));
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
    assertActiveRun();
    // Enforced mode must run executable scoped tests before commit/push.
    if (mode === 'enforced' && (!Array.isArray(testCommands) || testCommands.length === 0)) {
      throw new Error('enforced finalization requires executable test_commands');
    }
    assertWorktreeIsolated(plan);
    const evidence = exec({ operation: 'status-diff' });
    if (evidence.status !== 0) throw new Error(`status/diff failed: ${evidence.stderr || 'unknown'}`);
    const tests = Array.isArray(testCommands) && testCommands.length > 0
      ? (assertActiveRun(), exec({ operation: 'run-tests', commands: testCommands }))
      : { status: 0, skipped: true, reason: 'no test_commands supplied' };
    if (tests.status !== 0) throw new Error(`scoped tests failed: ${tests.stderr || tests.stdout || 'unknown'}`);
    assertWorktreeIsolated(plan);
    rejectOutOfScope(stagedNames(), 'pre-existing');
    assertActiveRun();
    const stage = exec({ operation: 'stage-files', files: affectedFiles });
    if (stage.status !== 0) throw new Error(`stage failed: ${stage.stderr || 'unknown'}`);
    const stagedAfterAdd = stagedNames();
    rejectOutOfScope(stagedAfterAdd, 'post-add');
    if (stagedAfterAdd.length === 0) throw new Error('no scoped files staged for finalization');
    assertActiveRun();
    const commit = exec({ operation: 'commit', issue });
    if (commit.status !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      throw new Error(`commit failed: ${commit.stderr || 'unknown'}`);
    }
    assertActiveRun();
    const push = exec({ operation: 'push', branch });
    if (push.status !== 0) throw new Error(`push failed: ${push.stderr || 'unknown'}`);
    return { branch, evidence, tests, commit, push };
  }

  function preQaEvidence({ plan }) {
    return exec({ operation: 'pre-qa-evidence', commands: plan?.test_commands });
  }

  return Object.freeze({ exec, prepareFixBranch, prepareFixBranchFromBase, preQaEvidence, finalizeFix });
}
