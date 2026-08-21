import { TUI_TABS } from './dashboard-tui-input.mjs';
import { fitLine } from './dashboard-tui-text.mjs';

const ANSI = Object.freeze({
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  inverse: '\u001b[7m',
  bold: '\u001b[1m',
});

const PANEL_SEPARATOR = ' ';

const TAB_LABELS = Object.freeze({
  [TUI_TABS.summary]: '1 摘要',
  [TUI_TABS.transcript]: '2 Transcript',
  [TUI_TABS.logs]: '3 Logs',
  [TUI_TABS.artifacts]: '4 产物/错误',
});

function panelBorder(title, innerWidth, side, focused) {
  const color = focused ? ANSI.cyan : '';
  if (side === 'top') {
    const label = fitLine(` ${title} `, innerWidth).replace(/ /g, '─');
    return `${color}┌${label}┐${ANSI.reset}`;
  }
  return `${color}└${'─'.repeat(innerWidth)}┘${ANSI.reset}`;
}

function buildPanel(title, lines, width, height, { focused = false, scroll = 0 } = {}) {
  const safeWidth = Math.max(10, width);
  const safeHeight = Math.max(3, height);
  const innerWidth = safeWidth - 2;
  const visibleCount = safeHeight - 2;
  const maxScroll = Math.max(0, (lines?.length ?? 0) - visibleCount);
  const clampedScroll = Math.min(maxScroll, Math.max(0, scroll));
  const visibleLines = (lines ?? []).slice(clampedScroll, clampedScroll + visibleCount);
  const color = focused ? ANSI.cyan : '';
  const output = [panelBorder(title, innerWidth, 'top', focused)];
  for (let index = 0; index < visibleCount; index += 1) {
    const line = visibleLines[index] ?? '';
    output.push(`${color}│${ANSI.reset}${fitLine(line, innerWidth)}${color}│${ANSI.reset}`);
  }
  output.push(panelBorder(title, innerWidth, 'bottom', focused));
  return output;
}

function zipPanels(panels) {
  const totalRows = panels[0]?.length ?? 0;
  const lines = [];
  for (let row = 0; row < totalRows; row += 1) {
    lines.push(panels.map((panel) => panel[row]).join(PANEL_SEPARATOR));
  }
  return lines;
}

function renderQueueLines(snapshot) {
  const records = snapshot?.records ?? [];
  if (records.length === 0) return ['暂无 Guardian 议题。'];
  return records.map((record) => {
    const base = `#${record.issue} ${record.state} ${record.risk ?? '-'} ${record.branch ?? '-'}`;
    return Number(record.issue) === Number(snapshot.selectedIssue) ? `${ANSI.inverse}${base}${ANSI.reset}` : base;
  });
}

function helpLines(ui) {
  return [
    '快捷键',
    '  q 退出',
    '  ↑/↓ 或 j/k 队列移动 / 当前 pane 滚动',
    '  ←/→ 或 h/l 在队列/详情/上下文间切焦点',
    '  Enter 进入详情滚动，Esc 返回队列',
    '  1 摘要  2 transcript  3 logs  4 产物/错误',
    '  r 手动刷新',
    '  a 切换自动刷新',
    '  F transcript 完整模式',
    '  G 跳到日志末尾并 follow',
    '  p 暂停日志 follow',
    '  Tab 循环切焦点，PgUp/PgDn/Home/End 支持滚动',
    '',
    `当前自动刷新: ${ui.autoRefresh ? `${ui.refreshSeconds} 秒` : '关闭'}`,
    `Transcript 模式: ${ui.transcriptFull ? '完整' : '截断'}`,
  ];
}

function renderHeader(snapshot, ui, viewport) {
  const repo = snapshot.repoDir ?? '-';
  const tabs = Object.entries(TAB_LABELS)
    .map(([key, label]) => (ui.tab === key ? `${ANSI.inverse}${label}${ANSI.reset}` : label))
    .join('  ');
  return [
    fitLine(`${ANSI.bold}QA Guardian 单终端只读 TUI${ANSI.reset}  ${repo}`, viewport.columns),
    fitLine(`焦点=${ui.focus}  自动刷新=${ui.autoRefresh ? `${ui.refreshSeconds}s` : 'off'}  选中=#${snapshot.selectedIssue ?? '-'}  标签=${tabs}`, viewport.columns),
  ];
}

function renderFooter(snapshot, ui, viewport) {
  const timeText = snapshot.now ? new Date(snapshot.now).toLocaleString('zh-CN') : '-';
  return [
    fitLine(`${ANSI.dim}${ui.statusMessage ?? ''}${ANSI.reset}`, viewport.columns),
    fitLine(`${ANSI.dim}r 刷新 · a 自动刷新 · ? 帮助 · 最后绘制 ${timeText}${ANSI.reset}`, viewport.columns),
  ];
}

function renderNarrow(snapshot, ui, viewport) {
  const maxRows = Math.max(1, Number(viewport.rows) || 0);
  const width = Math.max(1, Number(viewport.columns) || 0);
  const lines = [];
  const pushLine = (line = '') => {
    for (const segment of String(line ?? '').split(/\r?\n/u)) {
      if (lines.length >= maxRows) return;
      lines.push(fitLine(segment, width));
    }
  };

  for (const line of renderHeader(snapshot, ui, viewport)) pushLine(line);
  pushLine('');
  pushLine(`终端过窄：当前 ${viewport.columns}x${viewport.rows}，至少建议 100x20。`);
  pushLine('请扩大窗口后继续；当前仍保持只读，不会写 Guardian 状态。');
  if (snapshot.kind === 'error') {
    for (const line of snapshot.errorLines ?? []) pushLine(line);
  } else {
    pushLine('');
    pushLine(`队列议题数: ${snapshot.records?.length ?? 0}`);
    pushLine(`当前选中: #${snapshot.selectedIssue ?? '-'}`);
    for (const line of snapshot.detailLines ?? []) pushLine(line);
  }
  while (lines.length < maxRows) lines.push(' '.repeat(width));
  return lines.join('\n');
}

export function renderDashboardTui(snapshot, ui, viewport) {
  if ((viewport.columns ?? 0) < 100 || (viewport.rows ?? 0) < 20) {
    return renderNarrow(snapshot, ui, viewport);
  }

  if (ui.helpVisible) {
    const header = renderHeader(snapshot, ui, viewport);
    const helpPanel = buildPanel('帮助', helpLines(ui), viewport.columns, viewport.rows - 4, { focused: true, scroll: 0 });
    return [...header, ...helpPanel, ...renderFooter(snapshot, ui, viewport)].join('\n');
  }

  const header = renderHeader(snapshot, ui, viewport);
  const footer = renderFooter(snapshot, ui, viewport);
  const bodyHeight = viewport.rows - header.length - footer.length;

  if (snapshot.kind === 'error') {
    const errorPanel = buildPanel('错误', snapshot.errorLines ?? ['未知错误'], viewport.columns, bodyHeight, { focused: true, scroll: 0 });
    return [...header, ...errorPanel, ...footer].join('\n');
  }

  const queueWidth = Math.max(26, Math.floor(viewport.columns * 0.24));
  const rightWidth = Math.max(34, Math.floor(viewport.columns * 0.34));
  const separatorWidth = PANEL_SEPARATOR.length * 2;
  const centerWidth = Math.max(28, viewport.columns - queueWidth - rightWidth - separatorWidth);
  const queueScroll = Math.max(0, (snapshot.selectedIndex ?? 0) - Math.floor((bodyHeight - 2) / 2));
  const queuePanel = buildPanel('议题队列', renderQueueLines(snapshot), queueWidth, bodyHeight, {
    focused: ui.focus === 'queue',
    scroll: queueScroll,
  });
  const detailPanel = buildPanel('选中议题详情', snapshot.detailLines ?? ['暂无详情。'], centerWidth, bodyHeight, {
    focused: ui.focus === 'detail',
    scroll: ui.detailScroll,
  });
  const contextPanel = buildPanel(TAB_LABELS[ui.tab] ?? '上下文', snapshot.contextLines ?? ['暂无上下文。'], rightWidth, bodyHeight, {
    focused: ui.focus === 'context',
    scroll: ui.logFollow && ui.tab === TUI_TABS.logs ? 99999 : ui.contextScroll,
  });
  return [...header, ...zipPanels([queuePanel, detailPanel, contextPanel]), ...footer].join('\n');
}
