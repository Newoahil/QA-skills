import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newState, STATES, RISK } from '../../tools/guardian/state.mjs';
import {
  buildSummaryTabLines,
  buildArtifactErrorLines,
  buildProgressLogLines,
  buildTranscriptLines,
  createInitialUiState,
  DEFAULT_STATE_FILTER,
  loadDashboardTuiSnapshot,
  nextStateFilter,
  reduceUiState,
  resolvePreferredSession,
} from '../../tools/guardian/dashboard-tui-model.mjs';
import { guardianDirFor } from '../../tools/guardian/dashboard-model.mjs';
import { TUI_TABS } from '../../tools/guardian/dashboard-tui-input.mjs';

function tempRepo() {
  return mkdtempSync(path.join(tmpdir(), 'guardian-tui-'));
}

test('resolvePreferredSession prefers inflight then saved sessions', () => {
  const withInflight = {
    ...newState(12),
    opencode: {
      schema_version: 1,
      fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' },
      qa: null,
      specialists: {},
      inflight: { role: 'qa', session_id: 'ses_live', status: 'running' },
    },
  };
  assert.deepEqual(resolvePreferredSession(withInflight), {
    kind: 'ok',
    role: 'qa',
    sessionId: 'ses_live',
    source: 'inflight',
    status: 'running',
  });
  const noSessions = { ...newState(13), opencode: { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null } };
  assert.equal(resolvePreferredSession(noSessions).kind, 'missing-session');
});

test('buildTranscriptLines renders transcript or Chinese guidance', async () => {
  const record = {
    ...newState(42),
    state: STATES.VERIFYING,
    opencode: { schema_version: 1, fixer: { session_id: 'ses_42', agent: 'qa-guardian' }, qa: null, specialists: {}, inflight: null },
  };
  const lines = await buildTranscriptLines(record, {
    transcriptFetcher: async () => ({ kind: 'ok', messages: [{ role: 'assistant', createdAt: '2026-08-20T10:00:00Z', parts: [{ type: 'text', text: '已验证' }] }] }),
  });
  assert.match(lines.join('\n'), /session: ses_42/);
  assert.match(lines.join('\n'), /已验证/);

  const missing = await buildTranscriptLines({ ...record, opencode: { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null } });
  assert.match(missing.join('\n'), /没有 默认 角色的 OpenCode 会话/);
});

test('buildProgressLogLines and artifacts/errors surface readonly state and previews', () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(path.join(guardianDir, '9'), { recursive: true });
    mkdirSync(path.join(guardianDir, 'progress', '9'), { recursive: true });
    writeFileSync(path.join(guardianDir, '9', 'pr-summary.md'), '# PR\n内容\n', 'utf8');
    writeFileSync(path.join(guardianDir, '9', 'qa-acceptance.md'), '# QA\n通过\n', 'utf8');
    writeFileSync(path.join(guardianDir, '9', 'dossier.json'), '{"investigation_id":"inv-1"}\n', 'utf8');
    writeFileSync(path.join(guardianDir, '9', 'plan.json'), '{"investigation_id":"inv-1"}\n', 'utf8');
    writeFileSync(path.join(guardianDir, 'progress', '9', 'code.log'), '[code] step started\n[code] tool: grep parser\n[code] step finished: done\n', 'utf8');
    const record = {
      ...newState(9),
      state: STATES.FIXING,
      risk: RISK.HIGH,
      dossier_path: path.join('guardian', '9', 'dossier.json'),
      plan_path: path.join('guardian', '9', 'plan.json'),
      plan_validation_errors: ['plan-missing-proof'],
      specialist_failures: ['runtime'],
      specialists_completed: ['code'],
      opencode: { schema_version: 1, fixer: { session_id: 'ses_fix', agent: 'qa-guardian', last_status: 'ok' }, qa: null, specialists: {}, inflight: null },
    };
    const progress = buildProgressLogLines(guardianDir, record).join('\n');
    assert.match(progress, /实际进度日志/);
    assert.match(progress, /code\.log/);
    assert.match(progress, /tool: grep parser/);
    const text = buildArtifactErrorLines(guardianDir, record).join('\n');
    assert.match(text, /plan_validation_errors/);
    assert.match(text, /pr-summary\.md/);
    assert.match(text, /qa-acceptance\.md/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('buildProgressLogLines surfaces investigation and per-role durations', () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const record = {
      ...newState(205),
      state: STATES.DISCOVERED,
      investigation_duration_ms: 65000,
      plan_duration_ms: 2000,
      specialist_durations_ms: { 'guardian-code': 61000, 'guardian-runtime': 4000 },
    };
    const text = buildProgressLogLines(guardianDir, record).join('\n');
    assert.match(text, /调查耗时: 1m5s/);
    assert.match(text, /计划耗时: 2s/);
    assert.match(text, /各角色耗时/);
    assert.match(text, /guardian-code: 1m1s/);
    assert.match(text, /guardian-runtime: 4s/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('summary and logs mark persisted running sessions as non-live without inflight evidence', () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const record = {
      ...newState(205, '2026-08-20T10:00:00.000Z'),
      state: STATES.DISCOVERED,
      opencode: {
        schema_version: 1,
        fixer: null,
        qa: null,
        specialists: {
          'guardian-code': { session_id: 'ses_code', agent: 'guardian-code', last_status: 'running', last_seen_at: '2026-08-20T10:05:00.000Z' },
        },
        inflight: null,
      },
    };
    const summary = buildSummaryTabLines(record, { active: 0, waiting: 0, terminal: 0, total: 1 }, Date.parse('2026-08-20T11:00:00.000Z')).join('\n');
    assert.match(summary, /running，非实时/);
    const logs = buildProgressLogLines(guardianDir, record).join('\n');
    assert.match(logs, /状态=running，非实时/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('buildProgressLogLines shows clear guidance when no progress logs exist', () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const record = {
      ...newState(21),
      state: STATES.INVESTIGATING,
      specialists_requested: ['runtime'],
      opencode: { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: { role: 'runtime', session_id: 'ses_runtime', status: 'running' } },
    };
    const text = buildProgressLogLines(guardianDir, record).join('\n');
    assert.match(text, /未发现进度目录/);
    assert.match(text, /progress\\21\\<agent>\.log|progress\/21\/\<agent>\.log/);
    assert.match(text, /runtime/);
    assert.match(text, /shared OpenCode server/);
    assert.match(text, /Transcript|实时/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('loadDashboardTuiSnapshot resolves selected issue and loads current tab lines without live OpenCode', async () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const record = {
      ...newState(5, '2026-08-20T10:00:00.000Z'),
      state: STATES.VERIFYING,
      risk: RISK.LOW,
      opencode: { schema_version: 1, fixer: { session_id: 'ses_fix', agent: 'qa-guardian' }, qa: null, specialists: {}, inflight: null },
    };
    writeFileSync(path.join(guardianDir, '5.json'), `${JSON.stringify(record)}\n`, 'utf8');
    const snapshot = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      selectedIssue: 5,
      tab: TUI_TABS.transcript,
      transcriptFull: false,
      transcriptFetcher: async () => ({ kind: 'ok', messages: [{ role: 'assistant', createdAt: '2026-08-20T10:05:00Z', parts: [{ type: 'text', text: '通过' }] }] }),
    });
    assert.equal(snapshot.kind, 'ok');
    assert.equal(snapshot.selectedIssue, 5);
    assert.match(snapshot.contextLines.join('\n'), /通过/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('loadDashboardTuiSnapshot default current filter hides terminal issues', async () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const done = { ...newState(193, '2026-08-20T10:00:00.000Z'), state: STATES.DONE, risk: RISK.HIGH };
    const fixing = { ...newState(211, '2026-08-20T12:00:00.000Z'), state: STATES.FIXING, risk: RISK.LOW };
    writeFileSync(path.join(guardianDir, '193.json'), `${JSON.stringify(done)}\n`, 'utf8');
    writeFileSync(path.join(guardianDir, '211.json'), `${JSON.stringify(fixing)}\n`, 'utf8');

    const current = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      stateFilter: DEFAULT_STATE_FILTER,
      tab: TUI_TABS.summary,
    });
    assert.equal(current.kind, 'ok');
    assert.deepEqual(current.records.map((record) => record.issue), [211]);
    assert.equal(current.selectedIssue, 211);

    const all = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      stateFilter: 'all',
      tab: TUI_TABS.summary,
    });
    assert.deepEqual(all.records.map((record) => record.issue), [211, 193]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('live tab renders buffered event lines when enabled and guidance when disabled', async () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const record = { ...newState(205, '2026-08-20T10:00:00.000Z'), state: STATES.INVESTIGATING };
    writeFileSync(path.join(guardianDir, '205.json'), `${JSON.stringify(record)}\n`, 'utf8');

    const withLive = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      selectedIssue: 205,
      tab: TUI_TABS.live,
      baseUrl: 'http://127.0.0.1:4096',
      liveLines: ['[03:00:00] 工具 grep (running) badDebtReserves'],
    });
    assert.match(withLive.contextLines.join('\n'), /实时事件流: http:\/\/127\.0\.0\.1:4096/);
    assert.match(withLive.contextLines.join('\n'), /工具 grep \(running\)/);

    const connectedIdle = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      selectedIssue: 205,
      tab: TUI_TABS.live,
      baseUrl: 'http://127.0.0.1:4096',
      liveLines: [],
      now: Date.parse('2026-08-20T10:00:10.000Z'),
    });
    assert.match(connectedIdle.contextLines.join('\n'), /已连接共享 OpenCode 事件流/);
    assert.match(connectedIdle.contextLines.join('\n'), /当前没有活跃专员/);
    assert.match(connectedIdle.contextLines.join('\n'), /scheduler lock: 未检测到/);

    writeFileSync(path.join(guardianDir, '.scheduler.lock'), `${JSON.stringify({ pid: 999999, token: 'secret-token', acquired_at: Date.parse('2026-08-20T10:00:00.000Z'), renewed_at: Date.parse('2026-08-20T10:00:00.000Z') })}\n`, 'utf8');
    const stalePid = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      selectedIssue: 205,
      tab: TUI_TABS.live,
      baseUrl: 'http://127.0.0.1:4096',
      liveLines: [],
      now: Date.parse('2026-08-20T10:00:10.000Z'),
    });
    assert.match(stalePid.contextLines.join('\n'), /scheduler lock: 陈旧/);
    assert.doesNotMatch(stalePid.contextLines.join('\n'), /secret-token/);

    const disabled = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      selectedIssue: 205,
      tab: TUI_TABS.live,
      liveLines: null,
    });
    assert.match(disabled.contextLines.join('\n'), /实时事件流未启用/);
    assert.match(disabled.contextLines.join('\n'), /guardian-start\.bat/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('live tab surfaces persisted session context when connected event buffer is empty', async () => {
  const repo = tempRepo();
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(path.join(guardianDir, 'progress', '205'), { recursive: true });
    writeFileSync(path.join(guardianDir, 'progress', '205', 'guardian-code.log'), '[guardian-code] tool: grep category empty state\n[guardian-code] step finished: unresolved oracle\n', 'utf8');
    const record = {
      ...newState(205, '2026-08-20T10:00:00.000Z'),
      state: STATES.GATE_1_WAIT,
      risk: RISK.HIGH,
      opencode: {
        schema_version: 1,
        fixer: null,
        qa: null,
        specialists: {
          'guardian-code': { session_id: 'ses_code', agent: 'guardian-code', last_status: 'completed', last_seen_at: '2026-08-20T10:01:00.000Z' },
          'guardian-business': { session_id: 'ses_business', agent: 'guardian-business', last_status: 'completed', last_seen_at: '2026-08-20T10:02:00.000Z' },
        },
        inflight: null,
      },
    };
    writeFileSync(path.join(guardianDir, '205.json'), `${JSON.stringify(record)}\n`, 'utf8');

    const snapshot = await loadDashboardTuiSnapshot({
      requestedRepo: repo,
      bindingFile: path.join('tests', 'guardian', 'does-not-exist.json'),
      selectedIssue: 205,
      tab: TUI_TABS.live,
      baseUrl: 'http://127.0.0.1:4096',
      liveLines: [],
      now: Date.parse('2026-08-20T10:03:00.000Z'),
    });
    const text = snapshot.contextLines.join('\n');
    assert.match(text, /已连接共享 OpenCode 事件流/);
    assert.match(text, /近期会话/);
    assert.match(text, /guardian-code: ses_code/);
    assert.match(text, /guardian-business: ses_business/);
    assert.match(text, /最近进度日志/);
    assert.match(text, /tool: grep category empty state/);
    assert.doesNotMatch(text, /当前没有活跃专员事件。\n说明/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('createInitialUiState defaults to the current filter and t cycles it', () => {
  const ui = createInitialUiState();
  assert.equal(ui.stateFilter, 'current');
  assert.equal(nextStateFilter('current'), 'active');
  assert.equal(nextStateFilter('active'), 'waiting');
  assert.equal(nextStateFilter('waiting'), 'all');
  assert.equal(nextStateFilter('all'), 'current');
  assert.equal(nextStateFilter('unknown'), 'current');
});

test('reduceUiState cycle-state-filter advances filter and resets selection', () => {
  const ui = createInitialUiState({ selectedIssue: 193 });
  const snapshot = { records: [{ issue: 193 }], selectedIssue: 193, selectedIndex: 0, detailLines: [], contextLines: [] };
  const cycled = reduceUiState(ui, { type: 'cycle-state-filter' }, snapshot, { rows: 24 });
  assert.equal(cycled.stateFilter, 'active');
  assert.equal(cycled.selectedIssue, null);
  assert.match(cycled.statusMessage, /筛选/);
});

test('reduceUiState moves selection, switches tabs, and manages log follow', () => {
  const ui = createInitialUiState({ selectedIssue: 1, refreshSeconds: 8 });
  const snapshot = {
    records: [{ issue: 1 }, { issue: 2 }],
    selectedIssue: 1,
    selectedIndex: 0,
    detailLines: Array.from({ length: 40 }, (_, index) => `detail ${index}`),
    contextLines: Array.from({ length: 40 }, (_, index) => `ctx ${index}`),
  };
  const moved = reduceUiState(ui, { type: 'down' }, snapshot, { rows: 24 });
  assert.equal(moved.selectedIssue, 2);
  const tabbed = reduceUiState(moved, { type: 'switch-tab', tab: TUI_TABS.logs }, snapshot, { rows: 24 });
  assert.equal(tabbed.tab, TUI_TABS.logs);
  const followed = reduceUiState(tabbed, { type: 'logs-follow-end' }, snapshot, { rows: 24 });
  assert.equal(followed.logFollow, true);
  assert.equal(followed.focus, 'context');
});
