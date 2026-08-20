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
  assert.match(text, /Assert-CleanAndLatest \$Repo \$branch \$Label -AllowBehind/);
  assert.match(text, /本地版本不是远端最新，将继续使用本地版本运行/);
  assert.doesNotMatch(text, /Assert-CleanAndLatest \$GuardianRepo 'main' 'Guardian工具仓库'/);
});

test('scheduler-start.ps1 warns but continues when Guardian tools are not upstream latest', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /AllowBehind/);
  assert.match(text, /本地版本不是远端最新，将继续使用本地版本运行/);
  assert.match(text, /目标值守仓库/);
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
  assert.match(text, /last_target_repo/);
  assert.match(text, /projects/);
  assert.match(text, /Select-LauncherBinding/);
  assert.match(text, /Save-LauncherBinding/);
});

test('dashboard launcher resolves the authoritative control worktree without preflight', () => {
  const text = readFileSync('tools/guardian/dashboard-start.ps1', 'utf8');
  assert.match(text, /Resolve-ControlRepo/);
  assert.match(text, /scheduler\.config\.json/);
  assert.match(text, /--repo \$controlRepo/);
  assert.doesNotMatch(text, /gh auth status/);
  assert.match(text, /Select-LauncherBinding/);
});

test('scheduler launcher preserves an active control branch on reuse', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  const controlFunction = text.slice(text.indexOf('function Ensure-ControlWorktree'), text.indexOf('function Ensure-QaSnapshot'));
  assert.match(text, /function Ensure-ControlWorktree/);
  assert.match(text, /Guardian 状态之外/);
  assert.doesNotMatch(controlFunction, /rev-parse.*origin/);
  assert.match(text, /function Ensure-QaSnapshot/);
  assert.match(text, /Ensure-QaSnapshot \$TargetRepo \$qaRuntimeRepo \$base/);
});

test('scheduler launcher ignores Guardian-owned state when checking control worktree cleanliness', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  const controlFunction = text.slice(text.indexOf('function Ensure-ControlWorktree'), text.indexOf('function Ensure-QaSnapshot'));
  assert.match(controlFunction, /\.qa\/guardian\//);
  assert.match(controlFunction, /\.sybermem\//);
  assert.match(controlFunction, /\$line = \$_.Trim\(\)/);
  assert.match(controlFunction, /\$line\.Substring\(2\)/);
  assert.match(controlFunction, /unownedDirty/);
});

test('scheduler DryRun fails before first-run binding prompt or write', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /if \(-not \$Dashboard -and \$DryRun -and -not \$binding\)/);
  assert.match(text, /DryRun 不会进行首次模式选择/);
  assert.match(text, /if \(-not \$Dashboard -and -not \$DryRun -and -not \$binding\)/);
});

test('scheduler binding example documents the complete local-only shape', () => {
  const text = readFileSync('tools/guardian/scheduler.config.example.json', 'utf8');
  for (const field of ['version', 'last_target_repo', 'projects', 'canonical_target_path', 'mode', 'control_worktree_path', 'qa_snapshot_path', 'selected_runtime_input_paths', 'base_branch', 'guardian_repo_path']) {
    assert.match(text, new RegExp(`"${field}"`));
  }
  assert.match(text, /gitignored/);
  assert.match(text, /strict/);
  assert.match(text, /worktree/);
});

test('scheduler launcher repairs an existing config with empty command authors', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /if \(-not \$cfg\.command_authors -or @\(\$cfg\.command_authors\)\.Count -eq 0\)/);
  assert.match(text, /请输入可信 GitHub 登录名/);
  assert.match(text, /Add-Member -NotePropertyName command_authors -NotePropertyValue \$authors -Force/);
});

test('launcher docs and config describe explicit project switching and independent bindings', () => {
  const scheduler = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  const dashboard = readFileSync('tools/guardian/dashboard-start.ps1', 'utf8');
  const example = readFileSync('tools/guardian/scheduler.config.example.json', 'utf8');
  for (const text of [scheduler, example]) {
    assert.match(text, /projects/);
  }
  assert.match(scheduler, /每次启动都需要指定本次值守项目/);
  assert.match(dashboard, /Each start requires an explicit target project/);
  assert.match(scheduler, /never a fallback for another project/);
  assert.match(dashboard, /never a fallback for another project/);
});

test('scheduler and dashboard prompt for a target on every no-argument start', () => {
  const scheduler = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  const dashboard = readFileSync('tools/guardian/dashboard-start.ps1', 'utf8');
  assert.match(scheduler, /每次启动都需要指定本次值守项目/);
  assert.doesNotMatch(scheduler, /\$sc\.last_target_repo/);
  assert.match(dashboard, /Each start requires an explicit target project/);
  assert.doesNotMatch(dashboard, /\$saved\.last_target_repo/);
});

test('scheduler captures snapshot git diff and apply exit codes under Continue', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  const snapshotBlock = text.slice(text.indexOf('$patchFile ='), text.lastIndexOf('Copy-SelectedRuntimeInput'));
  assert.match(snapshotBlock, /\$ErrorActionPreference = "Continue"/);
  assert.match(snapshotBlock, /\$diffExitCode = \$LASTEXITCODE/);
  assert.match(snapshotBlock, /\$applyExitCode = \$LASTEXITCODE/);
});
