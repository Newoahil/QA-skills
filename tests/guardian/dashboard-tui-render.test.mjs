import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDashboardTui } from '../../tools/guardian/dashboard-tui-render.mjs';
import { createInitialUiState } from '../../tools/guardian/dashboard-tui-model.mjs';
import { TUI_TABS } from '../../tools/guardian/dashboard-tui-input.mjs';

function stripAnsi(text) {
  return String(text ?? '').replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|.)/gu, '');
}

function isWideChar(char) {
  if (!char) return false;
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff)
  );
}

function charWidth(char) {
  if (!char) return 0;
  const code = char.codePointAt(0) ?? 0;
  if (
    code <= 0x1f
    || code === 0x7f
    || code === 0x200c
    || code === 0x200d
    || /\p{Mark}/u.test(char)
    || (code >= 0xfe00 && code <= 0xfe0f)
    || (code >= 0xe0100 && code <= 0xe01ef)
  ) {
    return 0;
  }
  return isWideChar(char) ? 2 : 1;
}

const segmenter = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
  : null;

function graphemes(text) {
  const source = stripAnsi(text);
  if (!source) return [];
  if (!segmenter) return Array.from(source);
  return Array.from(segmenter.segment(source), (entry) => entry.segment);
}

function visibleWidth(text) {
  return graphemes(text).reduce((sum, grapheme) => {
    let width = 0;
    for (const char of Array.from(grapheme)) {
      width = Math.max(width, charWidth(char));
    }
    return sum + width;
  }, 0);
}

function assertFrameFits(frame, columns) {
  const lines = frame.split('\n');
  assert(lines.every((line) => visibleWidth(line) <= columns), `expected all rows to fit ${columns} columns`);
}

test('dashboard-tui renderer shows three-pane layout with Chinese headers', () => {
  const ui = createInitialUiState({ selectedIssue: 42, refreshSeconds: 8 });
  ui.tab = TUI_TABS.summary;
  const snapshot = {
    kind: 'ok',
    repoDir: 'D:/repo.control',
    now: Date.parse('2026-08-20T12:00:00Z'),
    records: [{ issue: 42, state: 'FIXING', risk: 'HIGH', branch: 'fix/issue-42' }],
    selectedIssue: 42,
    selectedIndex: 0,
    detailLines: ['detail line'],
    contextLines: ['summary line'],
  };
  const frame = renderDashboardTui(snapshot, ui, { columns: 140, rows: 30 });
  assert.match(frame, /QA Guardian 单终端只读 TUI/);
  assert.match(frame, /议题队列/);
  assert.match(frame, /选中议题详情/);
  assert.match(frame, /1 摘要/);
  assertFrameFits(frame, 140);
});

test('dashboard-tui renderer falls back gracefully on narrow terminals and error snapshots', () => {
  const ui = createInitialUiState({ refreshSeconds: 8 });
  const frame = renderDashboardTui({ kind: 'error', repoDir: 'D:/repo', errorLines: ['错误一'], now: Date.now() }, ui, { columns: 80, rows: 18 });
  assert.match(frame, /终端过窄/);
  assert.match(frame, /错误一/);
  assertFrameFits(frame, 80);
});

test('dashboard-tui renderer shows help overlay', () => {
  const ui = createInitialUiState({ refreshSeconds: 8 });
  ui.helpVisible = true;
  const frame = renderDashboardTui({ kind: 'ok', repoDir: 'D:/repo', now: Date.now(), records: [], selectedIssue: null, selectedIndex: -1, detailLines: [], contextLines: [] }, ui, { columns: 120, rows: 24 });
  assert.match(frame, /快捷键/);
  assert.match(frame, /F transcript 完整模式/);
  assertFrameFits(frame, 120);
});

test('dashboard-tui renderer bounds narrow fallback to viewport rows for long error lines', () => {
  const ui = createInitialUiState({ refreshSeconds: 8 });
  const frame = renderDashboardTui({
    kind: 'error',
    repoDir: 'D:/repo',
    errorLines: ['错误：这是一个很长的中文错误提示，需要在窄终端里安全截断。'.repeat(6), '更多错误：第二段说明同样需要裁剪。'.repeat(6), '第三行：补充信息也不能越界。'.repeat(6)],
    now: Date.now(),
  }, ui, { columns: 18, rows: 6 });

  const lines = frame.split('\n');
  assert.equal(lines.length, 6);
  assert(lines.every((line) => line.length > 0));
  assert(lines.every((line) => !line.includes('undefined')));
  assert(lines.some((line) => line.includes('…')));
  assertFrameFits(frame, 18);
});

test('dashboard-tui renderer clamps narrow fallback detail output and padding on tiny viewports', () => {
  const ui = createInitialUiState({ selectedIssue: 7, refreshSeconds: 8 });
  const frame = renderDashboardTui({
    kind: 'ok',
    repoDir: 'D:/repo',
    now: Date.now(),
    records: [{ issue: 7, state: 'FIXING', risk: 'LOW', branch: 'fix/issue-7' }],
    selectedIssue: 7,
    selectedIndex: 0,
    detailLines: ['详情'.repeat(30), '第二行'.repeat(20), '第三行'.repeat(20)],
    contextLines: ['summary'],
  }, ui, { columns: 12, rows: 5 });

  const lines = frame.split('\n');
  assert.equal(lines.length, 5);
  assert(lines.every((line) => line.length > 0));
  assert(lines.some((line) => line.includes('…')));
  assertFrameFits(frame, 12);
});

test('dashboard-tui renderer keeps every three-pane row within viewport columns', () => {
  const ui = createInitialUiState({ selectedIssue: 42, refreshSeconds: 8 });
  ui.focus = 'detail';
  ui.tab = TUI_TABS.logs;
  const snapshot = {
    kind: 'ok',
    repoDir: 'D:/repo.control',
    now: Date.parse('2026-08-20T12:00:00Z'),
    records: [
      { issue: 41, state: 'READY', risk: 'LOW', branch: 'fix/issue-41' },
      { issue: 42, state: 'FIXING', risk: 'HIGH', branch: 'fix/issue-42' },
      { issue: 43, state: 'QA', risk: 'LOW', branch: 'fix/issue-43' },
    ],
    selectedIssue: 42,
    selectedIndex: 1,
    detailLines: ['详情：'.repeat(20), '更多详情：'.repeat(18)],
    contextLines: ['日志：'.repeat(20), '第二行日志：'.repeat(14)],
  };

  const frame = renderDashboardTui(snapshot, ui, { columns: 100, rows: 24 });

  assertFrameFits(frame, 100);
});

test('dashboard-tui renderer truncates long ANSI-styled lines without broken escapes or leaked styles', () => {
  const ui = createInitialUiState({ selectedIssue: 99, refreshSeconds: 8 });
  const styledDetail = '\u001b[1m加粗标题\u001b[0m \u001b[36m彩色内容彩色内容彩色内容彩色内容\u001b[0m 尾部文本';
  const styledContext = '\u001b[7m反显日志\u001b[0m \u001b[2m补充说明补充说明补充说明\u001b[0m';
  const frame = renderDashboardTui({
    kind: 'ok',
    repoDir: 'D:/repo',
    now: Date.now(),
    records: [{ issue: 99, state: 'FIXING', risk: 'HIGH', branch: 'fix/issue-99' }],
    selectedIssue: 99,
    selectedIndex: 0,
    detailLines: [styledDetail],
    contextLines: [styledContext],
  }, ui, { columns: 100, rows: 20 });

  assert.match(frame, /\u001b\[1m/);
  assert.match(frame, /\u001b\[36m/);
  assert.match(frame, /\u001b\[7m/);
  assert.doesNotMatch(frame, /\u001b\[[0-9;?]*…/u);
  assertFrameFits(frame, 100);
});

test('dashboard-tui renderer keeps combining marks, variation selectors, and ZWJ sequences width-safe', () => {
  const ui = createInitialUiState({ selectedIssue: 11, refreshSeconds: 8 });
  const frame = renderDashboardTui({
    kind: 'error',
    repoDir: 'D:/repo',
    errorLines: [
      'Cafe\u0301 Cafe\u0301 Cafe\u0301 Cafe\u0301',
      '♥\ufe0f♥\ufe0f♥\ufe0f♥\ufe0f 说明说明说明说明',
      '开发者\u{1f469}\u200d\u{1f4bb}开发者\u{1f469}\u200d\u{1f4bb}开发者\u{1f469}\u200d\u{1f4bb}',
    ],
    now: Date.now(),
  }, ui, { columns: 16, rows: 7 });

  const lines = frame.split('\n');
  assert.equal(lines.length, 7);
  assertFrameFits(frame, 16);
  assert(lines.some((line) => line.includes('…')));
});

test('dashboard-tui renderer counts regional indicator flags as width-safe wide graphemes', () => {
  const ui = createInitialUiState({ selectedIssue: 12, refreshSeconds: 8 });
  const frame = renderDashboardTui({
    kind: 'error',
    repoDir: 'D:/repo',
    errorLines: [
      '国旗 🇨🇳🇺🇸🇯🇵🇩🇪 国旗 🇨🇳🇺🇸🇯🇵🇩🇪 国旗 🇨🇳🇺🇸🇯🇵🇩🇪',
      '第二行 🇭🇰🇲🇴🇹🇼 说明说明说明说明',
    ],
    now: Date.now(),
  }, ui, { columns: 18, rows: 7 });

  const lines = frame.split('\n');
  assert.equal(lines.length, 7);
  assertFrameFits(frame, 18);
  assert(lines.some((line) => line.includes('…')));
});

test('dashboard-tui renderer sanitizes tabs and control characters before width fitting', () => {
  const ui = createInitialUiState({ selectedIssue: 13, refreshSeconds: 8 });
  const frame = renderDashboardTui({
    kind: 'error',
    repoDir: 'D:/repo',
    errorLines: [
      '第一列\t第二列\t第三列',
      '前缀\u0000\u0007中段\t尾部',
      '换行前保持语义\n换行后\t继续',
    ],
    now: Date.now(),
  }, ui, { columns: 16, rows: 8 });

  const lines = frame.split('\n');
  assert.equal(lines.length, 8);
  assertFrameFits(frame, 16);
  assert(lines.every((line) => !line.includes('\u0000')));
  assert(lines.every((line) => !line.includes('\u0007')));
  assert(lines.every((line) => !line.includes('\t')));
});
