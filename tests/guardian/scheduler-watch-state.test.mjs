import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeWatchState } from '../../tools/guardian/scheduler.mjs';

test('writeWatchState preserves recovery state and cleans same-directory temp on rename failure', () => {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'guardian-watch-'));
  const guardianDir = path.join(repoDir, '.qa', 'guardian');
  const canonical = path.join(guardianDir, 'watch-state.json');
  try {
    mkdirSync(guardianDir, { recursive: true });
    writeFileSync(canonical, '{"next_created_at":"old"}\n', 'utf8');
    const temp = path.join(guardianDir, '.watch-state.json.watch-failure.tmp');
    const fsOps = { mkdirSync: () => {}, writeFileSync, renameSync: () => { throw new Error('injected watch rename failure'); }, rmSync };
    assert.throws(() => writeWatchState(repoDir, { next_created_at: 'new' }, { fsOps, makeId: () => 'watch-failure' }), /injected watch rename failure/);
    assert.equal(readFileSync(canonical, 'utf8'), '{"next_created_at":"old"}\n');
    assert.equal(existsSync(temp), false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
