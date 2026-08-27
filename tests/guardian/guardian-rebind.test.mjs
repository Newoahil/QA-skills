import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('guardian-rebind.ps1 delegates to scheduler init-only setup', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /scheduler-start\.ps1/);
  assert.match(text, /'-Init'/);
  assert.match(text, /'-InitOnly'/);
  assert.match(text, /'-ForceRebind'/);
  assert.match(text, /'-TargetRepo', \$TargetRepo/);
  assert.match(text, /'-BaseBranch', \$BaseBranch/);
  assert.match(text, /'-WatchMode', \$WatchMode/);
});

test('guardian-rebind.ps1 declares BindingMode and forwards it only when explicitly provided', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /\[ValidateSet\("strict", "worktree"\)\]\s*\[string\]\$BindingMode = ""/);
  assert.match(text, /if \(\$BindingMode\) \{ \$arguments \+= @\('-BindingMode', \$BindingMode\) \}/);
  assert.doesNotMatch(text, /'-BindingMode', \$BindingMode,\s*'-ForceRebind'/);
});

test('guardian-rebind.ps1 keeps BaseBranch empty by default and only forwards a confirmed nonempty value', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /\[string\]\$BaseBranch = ""/);
  assert.match(text, /if \(-not \$BaseBranch\) \{/);
  assert.match(text, /\$BaseBranch = Read-Host -Prompt/);
  assert.match(text, /if \(-not \$BaseBranch\) \{ throw "Cancelled: PR base branch is required\." \}/);
  assert.match(text, /\$BaseBranch = \$BaseBranch\.Trim\(\)/);
  assert.match(text, /if \(\$BaseBranch\) \{ \$arguments \+= @\('-BaseBranch', \$BaseBranch\) \}/);
  assert.doesNotMatch(text, /'-BaseBranch', \$BaseBranch,\s*'-WatchMode'/);
});

test('guardian-rebind.ps1 rejects -Yes when BaseBranch was omitted instead of inventing dev', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /if \(\$Yes\) \{ throw "PR base branch is required under -Yes\. Please rerun with -BaseBranch <branch>\." \}/);
  assert.doesNotMatch(text, /\[string\]\$BaseBranch = "dev"/);
});

test('guardian-rebind.ps1 is interactive and rebind-only', () => {
  const text = readFileSync('tools/guardian/guardian-rebind.ps1', 'utf8');
  assert.match(text, /Target repo path \(blank to cancel\)/);
  assert.match(text, /updates the selected project's binding\/config only/);
  assert.match(text, /existing selected-project mode is replaced/);
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
  assert.doesNotMatch(start, /BindingMode/);
  assert.match(rebind, /'-InitOnly'/);
});
