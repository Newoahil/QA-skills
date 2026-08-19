import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';

const script = path.resolve('tools/guardian/scheduler-visible.ps1');
const monitorScript = path.resolve('tools/guardian/guardian-monitor.ps1');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

test('visible launcher uses PowerShell -File for scheduler and monitor windows', () => {
  // Given: a target path containing spaces, which exercises argument quoting.
  const targetRepo = 'D:\\repo with spaces';

  // When: the launcher renders its real Start-Process specifications without opening windows.
  const result = spawnSync(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-TargetRepo', targetRepo,
    '-Issue', '211',
    '-DryRun',
  ], { encoding: 'utf8', shell: false, windowsHide: true });

  // Then: both children use -File, preserve the target path, and never use nested -Command.
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const launches = JSON.parse(result.stdout);
  assert.equal(launches.length, 6);
  for (const launch of launches) {
    assert.equal(launch.file_path, 'powershell.exe');
    assert.equal(launch.arguments.includes('-File'), true);
    assert.equal(launch.arguments.includes('-Command'), false);
    assert.equal(launch.arguments.includes(targetRepo), true);
  }
  assert.equal(launches[0].arguments.some((value) => value.endsWith('opencode-server.ps1')), true);
  assert.equal(launches[0].arguments.includes('-Port'), true);
  assert.equal(launches[1].arguments.includes('-SchedulerOnly'), true);
  assert.equal(launches[1].arguments.includes('-OpenCodeServerUrl'), true);
  assert.equal(launches[1].arguments.includes('http://127.0.0.1:4097'), true);
  assert.equal(launches[2].arguments.includes('-Issue'), true);
  assert.equal(launches[2].arguments.includes('211'), true);
  for (const [index, role] of ['guardian-code', 'guardian-business', 'guardian-runtime'].entries()) {
    const launch = launches[index + 3];
    assert.equal(launch.arguments.some((value) => value.endsWith('agent-progress.ps1')), true);
    assert.equal(launch.arguments.includes('-Agent'), true);
    assert.equal(launch.arguments.includes(role), true);
  }
});

test('guardian monitor resolves git in an independent PowerShell window', () => {
  // Given: a fresh PowerShell process whose PATH does not contain Git.
  const env = { ...process.env, PATH: 'C:\\Windows\\System32;C:\\Windows' };

  // When: the monitor renders one frame and exits.
  const result = spawnSync(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', monitorScript,
    '-TargetRepo', path.resolve('.'),
    '-Issue', '211',
    '-Once',
  ], { encoding: 'utf8', shell: false, windowsHide: true, env });

  // Then: Git lookup succeeds without inheriting scheduler-start.ps1's PATH edits.
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});
