import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newState, STATES, RISK } from '../../tools/guardian/state.mjs';
import {
  dashboardStats,
  extractSessionIds,
  filterByState,
  formatDashboardTable,
  formatIssueDetail,
  formatIssueSummary,
  guardianDirFor,
  loadAllIssueStates,
  relativeTime,
} from '../../tools/guardian/dashboard-model.mjs';

function tempRepo() {
  return mkdtempSync(path.join(tmpdir(), 'guardian-dashboard-'));
}

function writeStateFile(guardianDir, record) {
  writeFileSync(path.join(guardianDir, `${record.issue}.json`), `${JSON.stringify(record)}\n`, 'utf8');
}

test('dashboard formatting renders Chinese headers and session hints', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  const records = [
    { ...newState(42, '2026-08-20T11:57:00.000Z'), state: STATES.FIXING, risk: RISK.HIGH, branch: 'fix/issue-42' },
    { ...newState(38, '2026-08-20T10:00:00.000Z'), state: STATES.GATE_1_WAIT, risk: RISK.HIGH },
    { ...newState(35, '2026-08-19T12:00:00.000Z'), state: STATES.DONE, risk: RISK.LOW },
  ];
  const text = formatDashboardTable(records, { repoDir: 'D:/repo', now });
  assert.match(text, /QA Guardian 仪表盘/);
  assert.match(text, /议题\s+状态\s+风险/);
  assert.match(text, /#42/);
  assert.match(text, /活跃: 1 \| 等待: 1 \| 完成\/交回: 1 \| 共 3 个议题/);
  assert.match(text, /session-view\.mjs/);
});

test('formatIssueSummary and relativeTime render Chinese status text', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');
  const record = { ...newState(7, '2026-08-20T11:59:00.000Z'), state: STATES.VERIFYING, risk: RISK.LOW };
  assert.equal(relativeTime(record.updated_at, now), '1 分钟前');
  assert.match(formatIssueSummary(record, { now }), /#7 VERIFYING \[LOW\] 轮次=1 修复=0 更新=1 分钟前/);
});

test('extractSessionIds and issue detail include fixer qa specialists and round history', () => {
  const record = {
    ...newState(9),
    state: STATES.VERIFYING,
    risk: RISK.HIGH,
    opencode: {
      schema_version: 1,
      fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', last_status: 'ok', last_seen_at: '2026-08-20T10:00:00Z' },
      qa: { session_id: 'ses_qa', agent: 'qa', last_status: 'ok' },
      specialists: { code: { session_id: 'ses_code', agent: 'guardian-code', last_status: 'ok' } },
      inflight: { role: 'qa', session_id: 'ses_qa', status: 'running' },
    },
    round_history: [{ round: 1, branch: 'fix/issue-9', pr_url: 'https://pr/9', completed_at: '2026-08-19T00:00:00Z' }],
  };
  assert.deepEqual(extractSessionIds(record).map((item) => item.session_id), ['ses_fixer', 'ses_qa', 'ses_code']);
  const text = formatIssueDetail(record);
  assert.match(text, /修复者: ses_fixer/);
  assert.match(text, /QA: ses_qa/);
  assert.match(text, /专家\[code\]: ses_code/);
  assert.match(text, /轮次 1/);
});

test('filterByState supports exact active waiting and terminal groups', () => {
  const records = [
    { ...newState(1), state: STATES.FIXING },
    { ...newState(2), state: STATES.GATE_2_WAIT },
    { ...newState(3), state: STATES.HANDED_BACK },
  ];
  assert.deepEqual(filterByState(records, 'FIXING').map((record) => record.issue), [1]);
  assert.deepEqual(filterByState(records, 'active').map((record) => record.issue), [1]);
  assert.deepEqual(filterByState(records, 'waiting').map((record) => record.issue), [2]);
  assert.deepEqual(filterByState(records, 'terminal').map((record) => record.issue), [3]);
  assert.deepEqual(dashboardStats(records), { active: 1, waiting: 1, terminal: 1, total: 3 });
});

test('loadAllIssueStates returns normalized sorted records from disk', () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    writeStateFile(guardianDir, { ...newState(1, '2026-08-20T10:00:00.000Z'), state: STATES.DISCOVERED });
    writeStateFile(guardianDir, { ...newState(2, '2026-08-20T12:00:00.000Z'), state: STATES.FIXING });
    writeFileSync(path.join(guardianDir, 'config.json'), '{}\n', 'utf8');
    writeFileSync(path.join(guardianDir, 'notes.txt'), 'skip\n', 'utf8');
    const records = loadAllIssueStates(guardianDir);
    assert.deepEqual(records.map((record) => record.issue), [2, 1]);
    assert.equal(records[0].opencode.schema_version, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
