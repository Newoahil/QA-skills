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
  assert.doesNotMatch(text, /writeState|gh\s+(pr|issue)|git\s+(push|commit)/);
});
