import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('guardian-rebind.ps1 delegates to scheduler init-only setup', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /scheduler-start\.ps1/);
  assert.match(text, /'-Init'/);
  assert.match(text, /'-InitOnly'/);
  assert.match(text, /'-TargetRepo', \$TargetRepo/);
  assert.match(text, /'-BaseBranch', \$BaseBranch/);
  assert.match(text, /'-WatchMode', \$WatchMode/);
});

test('guardian-rebind.ps1 is interactive and rebind-only', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /Target repo path \(blank to cancel\)/);
  assert.match(text, /updates the selected project's binding\/config only/);
  assert.match(text, /Start with: tools\\guardian\\guardian-start\.bat/);
  assert.doesNotMatch(text, /dashboard-tui\.mjs/);
  assert.doesNotMatch(text, /guardian-runtime\.mjs/);
  assert.doesNotMatch(text, /scheduler\.mjs/);
  assert.doesNotMatch(text, /Start-Process/);
});

test('guardian-start.ps1 remains binding-read-only while rebind owns onboarding', () => {
  const start = readFileSync('tools/guardian/guardian-start.ps1', 'utf8');
  const rebind = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(start, /No Guardian binding found for this project/);
  assert.doesNotMatch(start, /'-InitOnly'/);
  assert.doesNotMatch(start, /Save-LauncherBinding/);
  assert.match(rebind, /'-InitOnly'/);
});
