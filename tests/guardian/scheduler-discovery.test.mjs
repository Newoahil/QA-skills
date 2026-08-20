import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listCandidates } from '../../tools/guardian/scheduler.mjs';
import { newState, readState, STATES, writeState } from '../../tools/guardian/state.mjs';
import { pollIssue } from '../../tools/guardian/poll.mjs';

function repoWithGuardian() {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'guardian-discovery-'));
  mkdirSync(path.join(repoDir, '.qa', 'guardian'), { recursive: true });
  return repoDir;
}

test('all-open discovery includes historical unlabeled issues and orders deterministically', () => {
  const repoDir = repoWithGuardian();
  const calls = [];
  try {
    const candidates = listCandidates(repoDir, { watch_mode: 'new-open' }, new Date('2026-08-20T12:00:00Z'), {
      ghIssueList: (_repo, args) => {
        calls.push(args);
        return [
          { issue: 206, updatedAt: '2026-08-20T10:00:00Z', labels: [] },
          { issue: 205, updatedAt: '2026-08-20T10:00:00Z', labels: [] },
          { issue: 207, updatedAt: '2026-08-20T11:00:00Z', labels: [{ name: 'qa-guardian' }] },
        ];
      },
    });

    assert.deepEqual(candidates.map(({ issue }) => issue), [205, 206, 207]);
    assert.equal(candidates.find(({ issue }) => issue === 205).claim_source, 'discovered');
    assert.deepEqual(calls, [['--state', 'open', '--limit', '1000', '--json', 'number,createdAt,updatedAt,labels']]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('DONE and GATE_2_WAIT records remain followup candidates', () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(301), state: STATES.DONE }, { touch: false });
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(302), state: STATES.GATE_2_WAIT }, { touch: false });
    const candidates = listCandidates(repoDir, {}, undefined, {
      ghIssueList: () => [],
    });

    assert.deepEqual(candidates.map(({ issue, claim_source }) => ({ issue, claim_source })), [
      { issue: 301, claim_source: 'followup' },
      { issue: 302, claim_source: 'followup' },
    ]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('open issue #205 without state is a START candidate', () => {
  const repoDir = repoWithGuardian();
  try {
    const decision = pollIssue(
      path.join(repoDir, '.qa', 'guardian'),
      205,
      () => ({ state: 'OPEN', title: 'Historical issue', body: '', comments: [] }),
      { repoDir, now: Date.parse('2026-08-20T12:00:00Z') },
    );
    assert.equal(decision.issue, 205);
    assert.equal(decision.action, 'START');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('terminal HANDED_BACK state is skipped rather than claimed again', () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(400), state: STATES.HANDED_BACK }, { touch: false });
    const decision = pollIssue(
      path.join(repoDir, '.qa', 'guardian'),
      400,
      () => ({ state: 'OPEN', title: 'Handed back', body: '', comments: [] }),
      { repoDir, now: Date.parse('2026-08-20T12:00:00Z') },
    );
    assert.equal(decision.action, 'SKIP');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('initial discovery claim persists the discovered claim source', () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), {
      ...newState(205),
      claim_id: 'claim-205',
      claimed_at: '2026-08-20T12:00:00.000Z',
      claim_source: 'discovered',
    }, { touch: false });
    const claimed = readState(path.join(repoDir, '.qa', 'guardian'), 205);
    assert.equal(claimed.state, STATES.DISCOVERED);
    assert.equal(claimed.claim_source, 'discovered');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('discovered claim projects doing before the agent run', () => {
  const source = readFileSync(new URL('../../tools/guardian/scheduler.mjs', import.meta.url), 'utf8');
  assert.match(source, /claimProjection = projectLabels\(repoDir, issue/);
  assert.match(source, /state: 'INVESTIGATING'/);
});
