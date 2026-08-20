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
