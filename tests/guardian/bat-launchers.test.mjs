import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('scheduler-start.bat launches the scheduler PowerShell wrapper', () => {
  const text = readFileSync('tools/guardian/scheduler-start.bat', 'utf8');
  assert.match(text, /scheduler-start\.ps1/);
  assert.match(text, /-TargetRepo "%~1"/);
  assert.match(text, /-Init -CommandAuthors "%~2"/);
});

test('dashboard-start.bat launches the read-only dashboard wrapper', () => {
  const text = readFileSync('tools/guardian/dashboard-start.bat', 'utf8');
  assert.match(text, /dashboard-start\.ps1/);
  assert.match(text, /-TargetRepo "%~1"/);
  assert.doesNotMatch(text, /-Init -CommandAuthors/);
});

test('dashboard-start.ps1 runs the read-only dashboard without scheduler preflight', () => {
  const text = readFileSync('tools/guardian/dashboard-start.ps1', 'utf8');
  assert.match(text, /dashboard\.mjs/);
  assert.match(text, /--watch 5/);
  assert.match(text, /QA_GUARDIAN_REPO/);
  assert.doesNotMatch(text, /gh auth status/);
  assert.doesNotMatch(text, /Assert-CleanAndLatest/);
});

test('scheduler-start.ps1 avoids the PowerShell $Args automatic-variable trap for git argv', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /function Invoke-Git\(\[string\]\$Repo, \[string\[\]\]\$GitArgs/);
  assert.match(text, /& git -C \$Repo @GitArgs/);
  assert.doesNotMatch(text, /\[string\[\]\]\$Args/);
});

test('scheduler-start.ps1 captures benign git stderr without promoting it to a terminating error', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /\$previousErrorActionPreference = \$ErrorActionPreference/);
  assert.match(text, /\$ErrorActionPreference = "Continue"/);
  assert.match(text, /finally \{ \$ErrorActionPreference = \$previousErrorActionPreference \}/);
  assert.match(text, /& git -C \$Repo @GitArgs 2>&1/);
});

test('scheduler-start.ps1 checks the Guardian tools repository against its current upstream branch', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /function Current-GitBranch/);
  assert.match(text, /function Assert-CleanAndUpstreamLatest/);
  assert.match(text, /\$guardianFacts = Assert-CleanAndUpstreamLatest \$GuardianRepo 'Guardian工具仓库'/);
  assert.doesNotMatch(text, /Assert-CleanAndLatest \$GuardianRepo 'main' 'Guardian工具仓库'/);
});

test('scheduler-start.ps1 accepts GitHub URL input by normalizing it to owner repo form', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /function Normalize-GitHubRepo/);
  assert.match(text, /https\?:\/\/github\\\.com/);
  assert.match(text, /git@github\\\.com/);
  assert.match(text, /Normalize-GitHubRepo \$GitHubRepo/);
  assert.match(text, /Normalize-GitHubRepo \$inputGithub/);
});

test('scheduler launcher persists one-time binding and sends control repo plus QA runtime dir', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /scheduler\.config\.json/);
  assert.match(text, /首次启动尚未选择模式/);
  assert.match(text, /control_worktree_path/);
  assert.match(text, /qa_snapshot_path/);
  assert.match(text, /QA_GUARDIAN_QA_RUNTIME_DIR/);
  assert.match(text, /--repo \$controlRepo/);
});

test('dashboard launcher resolves the authoritative control worktree without preflight', () => {
  const text = readFileSync('tools/guardian/dashboard-start.ps1', 'utf8');
  assert.match(text, /Resolve-ControlRepo/);
  assert.match(text, /scheduler\.config\.json/);
  assert.match(text, /--repo \$controlRepo/);
  assert.doesNotMatch(text, /gh auth status/);
});

test('scheduler launcher preserves an active control branch on reuse', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  const controlFunction = text.slice(text.indexOf('function Ensure-ControlWorktree'), text.indexOf('function Ensure-QaSnapshot'));
  assert.match(text, /function Ensure-ControlWorktree/);
  assert.match(text, /control worktree 不干净/);
  assert.doesNotMatch(controlFunction, /rev-parse.*origin/);
  assert.match(text, /function Ensure-QaSnapshot/);
  assert.match(text, /Ensure-QaSnapshot \$TargetRepo \$qaRuntimeRepo \$base/);
});

test('scheduler DryRun fails before first-run binding prompt or write', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /if \(-not \$Dashboard -and \$DryRun -and -not \$binding\)/);
  assert.match(text, /DryRun 不会进行首次模式选择/);
  assert.match(text, /if \(-not \$Dashboard -and -not \$DryRun -and -not \$binding\)/);
});

test('scheduler binding example documents the complete local-only shape', () => {
  const text = readFileSync('tools/guardian/scheduler.config.example.json', 'utf8');
  for (const field of ['version', 'canonical_target_path', 'mode', 'control_worktree_path', 'qa_snapshot_path', 'selected_runtime_input_paths', 'base_branch', 'guardian_repo_path']) {
    assert.match(text, new RegExp(`"${field}"`));
  }
  assert.match(text, /gitignored/);
  assert.match(text, /strict/);
  assert.match(text, /worktree/);
});
