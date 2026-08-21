import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('guardian-start.bat launches the combined PowerShell wrapper and forwards an optional target', () => {
  const text = readFileSync('tools/guardian/guardian-start.bat', 'utf8');
  assert.match(text, /guardian-start\.ps1/);
  assert.match(text, /-TargetRepo "%~1"/);
  assert.match(text, /scheduler window may still be running/);
});

test('guardian-start.ps1 starts scheduler separately and keeps TUI in the current console', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(text, /schedulerPreflightArguments = \$schedulerArguments \+ '-DryRun'/);
  assert.match(text, /Scheduler preflight failed/);
  assert.match(text, /'-NoExit'/);
  assert.match(text, /\$schedulerWindowArguments/);
  assert.match(text, /-TargetRepo', \$TargetRepo, '-Yes'/);
  assert.match(text, /dashboard-tui\.mjs/);
  assert.match(text, /& \$nodeExe @tuiArguments/);
  assert.match(text, /read_only_tui = \$true/);
});

test('guardian-start.ps1 backfills legacy binding command authors from Guardian config', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /function Resolve-LauncherCommandAuthors/);
  assert.match(text, /Read-GuardianCommandAuthors \$ControlRepo/);
  assert.match(text, /Read-GuardianCommandAuthors \$TargetRepo/);
  assert.match(text, /\$schedulerArguments \+= @\('-CommandAuthors', \$commandAuthorArgument\)/);
  assert.match(text, /\$schedulerCommand \+= " -CommandAuthors '\$quotedCommandAuthors'"/);
  assert.match(text, /Trusted GitHub command authors/);
});

test('guardian-start.ps1 forwards a control progress dir so the TUI Logs tab shows live progress', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /\$progressDir = Join-Path \(Join-Path \$controlRepo '\.qa\\guardian'\) 'progress'/);
  assert.match(text, /'-TargetRepo', \$TargetRepo, '-Yes', '-ProgressDir', \$progressDir/);
  assert.match(text, /-ProgressDir '\$quotedProgressDir'/);
});

test('guardian-start.ps1 starts a shared opencode serve and points scheduler + TUI at it', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /function Start-SharedOpencodeServer/);
  assert.match(text, /'serve', '--port', "\$Port", '--hostname', '127\.0\.0\.1'/);
  assert.match(text, /global\/health/);
  assert.match(text, /\$schedulerArguments \+= @\('-OpenCodeServerUrl', \$plannedServerUrl\)/);
  assert.match(text, /\$tuiArguments \+= @\('--base-url', \$plannedServerUrl\)/);
  assert.match(text, /-OpenCodeServerUrl '\$quotedServerUrl'/);
  assert.match(text, /opencode attach \$serverUrl/);
  // Opt-out and graceful degrade to child processes when the server is unavailable.
  assert.match(text, /\$useSharedServer = -not \$NoSharedServer/);
  assert.match(text, /Where-Object \{ \$_ -ne '-OpenCodeServerUrl'/);
});

test('guardian-start.ps1 avoids launching npm PowerShell shims as plain files', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /npm\\opencode\.cmd/);
  assert.match(text, /npm\\opencode\.ps1/);
  assert.ok(text.indexOf('npm\\opencode.cmd') < text.indexOf('Get-Command opencode'));
  assert.ok(text.indexOf('npm\\opencode.cmd') < text.indexOf('npm\\opencode.ps1'));
});

test('scheduler-start.ps1 applies shared server + progress env to both polling and combined runtimes', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  // The env wiring must be ABOVE the SchedulerOnly branch so both runtimes inherit it.
  const envIndex = text.indexOf('$env:QA_GUARDIAN_OPENCODE_SERVER_URL = $OpenCodeServerUrl');
  const branchIndex = text.indexOf('if ($SchedulerOnly) {');
  assert.ok(envIndex > 0 && branchIndex > 0 && envIndex < branchIndex);
});

test('guardian-start.ps1 fails closed without an existing per-project binding', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /No Guardian binding found for this project/);
  assert.match(text, /Run scheduler-start\.bat once/);
  assert.match(text, /Select-LauncherBinding/);
  assert.doesNotMatch(text, /Save-LauncherBinding/);
});

test('guardian-start.ps1 dry run exposes scheduler and TUI launch plans without mutation', () => {
  const text = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  assert.match(text, /if \(\$DryRun\)/);
  assert.match(text, /ConvertTo-Json -Depth 6 -Compress/);
  assert.match(text, /-SchedulerOnly/);
  assert.match(text, /command_authors_source/);
  assert.doesNotMatch(text, /writeState|gh\s+(pr|issue)|git\s+(push|commit)/);
});
