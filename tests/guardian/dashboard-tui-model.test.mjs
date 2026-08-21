import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newState, STATES, RISK } from '../../tools/guardian/state.mjs';
import {
  buildArtifactErrorLines,
  buildProgressLogLines,
  buildTranscriptLines,
  createInitialUiState,
  loadDashboardTuiSnapshot,
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
