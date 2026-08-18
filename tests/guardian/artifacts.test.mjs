import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { artifactDir, artifactPaths, readArtifact, writeArtifact } from '../../tools/guardian/artifacts.mjs';
import { newState, normalizeState } from '../../tools/guardian/state.mjs';

test('artifact store writes and reads dossier/plan atomically', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-artifact-'));
  try {
    const dossier = { issue: 42, issue_class: 'bug', evidence: [] };
    const plan = { risk: 'HIGH', root_cause: 'unknown' };
    writeArtifact(root, 42, 'dossier', dossier);
    writeArtifact(root, 42, 'plan', plan);
    assert.deepEqual(readArtifact(root, 42, 'dossier'), dossier);
    assert.deepEqual(readArtifact(root, 42, 'plan'), plan);
    assert.equal(artifactDir(root, 42), path.join(root, '42'));
    assert.match(artifactPaths(root, 42).dossier_path, /42[\\/]dossier\.json$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('artifact reads tolerate BOM JSON', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-artifact-'));
  try {
    mkdirSync(path.join(root, '7'), { recursive: true });
    writeFileSync(path.join(root, '7', 'dossier.json'), '\uFEFF{"issue":7}', 'utf8');
    assert.deepEqual(readArtifact(root, 7, 'dossier'), { issue: 7 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('old state normalizes with schema v3 artifact fields', () => {
  const old = { ...newState(42), schema_version: 2 };
  const normalized = normalizeState(old, 42);
  assert.equal(normalized.schema_version, 2);
  assert.equal(normalized.dossier_status, 'missing');
  assert.deepEqual(normalized.specialists_requested, []);
  assert.equal(normalized.investigation_attempts, 0);
});
