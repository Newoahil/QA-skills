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

test('scheduler-start.ps1 accepts GitHub URL input by normalizing it to owner repo form', () => {
  const text = readFileSync('tools/guardian/scheduler-start.ps1', 'utf8');
  assert.match(text, /function Normalize-GitHubRepo/);
  assert.match(text, /https\?:\/\/github\\\.com/);
  assert.match(text, /git@github\\\.com/);
  assert.match(text, /Normalize-GitHubRepo \$GitHubRepo/);
  assert.match(text, /Normalize-GitHubRepo \$inputGithub/);
});
