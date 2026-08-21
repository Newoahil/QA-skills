import path from 'node:path';

import { dashboardStats, filterByState, formatIssueDetail, guardianDirFor, hasGuardianDir, loadAllIssueStates } from './dashboard-model.mjs';
import { buildArtifactErrorLines } from './dashboard-tui-artifacts.mjs';
import { buildProgressLogLines } from './dashboard-tui-progress.mjs';
import { buildSummaryTabLines, buildTranscriptLines, resolvePreferredSession } from './dashboard-tui-context.mjs';
import { resolveViewerRepo } from './worktree-binding.mjs';
import { fetchTranscript } from './session-transcript.mjs';
import { TUI_TABS } from './dashboard-tui-input.mjs';

export const DEFAULT_REFRESH_SECONDS = 8;
export const DEFAULT_FOCUS = 'queue';

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

export { buildArtifactErrorLines, buildProgressLogLines, buildTranscriptLines, resolvePreferredSession };

export function parseRefreshSeconds(value, fallback = DEFAULT_REFRESH_SECONDS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createInitialUiState({ selectedIssue = null, refreshSeconds = DEFAULT_REFRESH_SECONDS } = {}) {
  return {
    selectedIssue,
    focus: DEFAULT_FOCUS,
    tab: TUI_TABS.summary,
    helpVisible: false,
    transcriptFull: false,
    autoRefresh: true,
    refreshSeconds,
    detailScroll: 0,
    contextScroll: 0,
    logFollow: true,
    statusMessage: '已进入只读 Guardian TUI。',
    lastRefreshAt: null,
  };
}

export function selectIssue(records, preferredIssue = null) {
  if (!Array.isArray(records) || records.length === 0) return { issue: null, index: -1, record: null };
  if (preferredIssue !== null) {
    const index = records.findIndex((record) => Number(record.issue) === Number(preferredIssue));
    if (index >= 0) return { issue: records[index].issue, index, record: records[index] };
  }
  return { issue: records[0].issue, index: 0, record: records[0] };
}

export async function loadDashboardTuiSnapshot({
  requestedRepo,
  bindingFile,
  selectedIssue,
  tab,
  stateFilter,
  transcriptFull,
  baseUrl,
  transcriptFetcher = fetchTranscript,
  now = Date.now(),
} = {}) {
  const repoDir = resolveViewerRepo(path.resolve(requestedRepo), bindingFile);
  if (!hasGuardianDir(repoDir)) {
    return {
      kind: 'error',
      repoDir,
      now,
      errorLines: ['未找到 Guardian 状态目录。', '', `仓库: ${repoDir}`, '下一步: 确认该项目已初始化 .qa/guardian，或检查 --repo / binding 指向的 authoritative control repo。'],
      records: [],
      selectedIssue: null,
      selectedIndex: -1,
      detailLines: [],
      contextLines: [],
      stats: { active: 0, waiting: 0, terminal: 0, total: 0 },
    };
  }

  const guardianDir = guardianDirFor(repoDir);
  const records = filterByState(loadAllIssueStates(guardianDir), stateFilter);
  const stats = dashboardStats(records);
  const selected = selectIssue(records, selectedIssue);
  const record = selected.record;
  const contextLines = await loadContextLines({ baseUrl, guardianDir, now, record, stats, tab, transcriptFetcher, transcriptFull });

  return {
    kind: 'ok',
    repoDir,
    guardianDir,
    now,
    records,
    stats,
    selectedIssue: selected.issue,
    selectedIndex: selected.index,
    detailLines: record ? splitLines(formatIssueDetail(record)) : ['暂无 Guardian 议题状态。'],
    contextLines,
    record,
  };
}

async function loadContextLines({ baseUrl, guardianDir, now, record, stats, tab, transcriptFetcher, transcriptFull }) {
  switch (tab) {
    case TUI_TABS.transcript:
      return buildTranscriptLines(record, { baseUrl, full: transcriptFull, transcriptFetcher });
    case TUI_TABS.logs:
      return buildProgressLogLines(guardianDir, record);
    case TUI_TABS.artifacts:
      return buildArtifactErrorLines(guardianDir, record);
    default:
      return buildSummaryTabLines(record, stats, now);
  }
}

function maxScroll(lines, visibleHeight) {
  return Math.max(0, (lines?.length ?? 0) - Math.max(0, visibleHeight));
}

export function reduceUiState(ui, action, snapshot, viewport = { rows: 24 }) {
  const next = { ...ui };
  const records = snapshot?.records ?? [];
  const selectedIndex = snapshot?.selectedIndex ?? -1;
  const paneRows = Math.max(4, (viewport.rows ?? 24) - 7);
  const detailMax = maxScroll(snapshot?.detailLines ?? [], paneRows - 2);
  const contextMax = maxScroll(snapshot?.contextLines ?? [], paneRows - 2);

  switch (action.type) {
    case 'toggle-help':
      next.helpVisible = !next.helpVisible;
      next.statusMessage = next.helpVisible ? '已打开帮助。' : '已关闭帮助。';
      return next;
    case 'toggle-auto-refresh':
      next.autoRefresh = !next.autoRefresh;
      next.statusMessage = next.autoRefresh ? `自动刷新已开启（${next.refreshSeconds} 秒）` : '自动刷新已暂停。';
      return next;
    case 'toggle-transcript-full':
      next.transcriptFull = !next.transcriptFull;
      next.contextScroll = 0;
      next.statusMessage = next.transcriptFull ? '完整 transcript 已开启。' : 'transcript 截断模式已恢复。';
      return next;
    case 'switch-tab':
      next.tab = action.tab;
      next.contextScroll = 0;
      if (action.tab !== TUI_TABS.logs) next.logFollow = false;
      next.statusMessage = `已切换到 ${action.tab} 标签。`;
      return next;
    case 'enter-detail':
      next.focus = 'detail';
      next.statusMessage = '已进入详情滚动模式；Esc 返回队列。';
      return next;
    case 'back-queue':
      next.focus = 'queue';
      next.helpVisible = false;
      next.statusMessage = '已返回议题队列。';
      return next;
    case 'cycle-focus':
      next.focus = next.focus === 'queue' ? 'detail' : next.focus === 'detail' ? 'context' : 'queue';
      next.statusMessage = `焦点已切换到 ${next.focus}。`;
      return next;
    case 'focus-left':
      next.focus = next.focus === 'context' ? 'detail' : 'queue';
      next.statusMessage = `焦点已切换到 ${next.focus}。`;
      return next;
    case 'focus-right':
      next.focus = next.focus === 'queue' ? 'detail' : 'context';
      next.statusMessage = `焦点已切换到 ${next.focus}。`;
      return next;
    case 'logs-follow-end':
      next.tab = TUI_TABS.logs;
      next.focus = 'context';
      next.logFollow = true;
      next.contextScroll = contextMax;
      next.statusMessage = '日志已跳到末尾并开启 follow。';
      return next;
    case 'logs-pause-follow':
      next.tab = TUI_TABS.logs;
      next.logFollow = false;
      next.statusMessage = '日志 follow 已暂停。';
      return next;
    case 'home':
      if (next.focus === 'detail') next.detailScroll = 0;
      if (next.focus === 'context') next.contextScroll = 0;
      return next;
    case 'end':
      if (next.focus === 'detail') next.detailScroll = detailMax;
      if (next.focus === 'context') next.contextScroll = contextMax;
      return next;
    case 'page-up':
      if (next.focus === 'detail') next.detailScroll = Math.max(0, next.detailScroll - 10);
      if (next.focus === 'context') next.contextScroll = Math.max(0, next.contextScroll - 10);
      return next;
    case 'page-down':
      if (next.focus === 'detail') next.detailScroll = Math.min(detailMax, next.detailScroll + 10);
      if (next.focus === 'context') next.contextScroll = Math.min(contextMax, next.contextScroll + 10);
      return next;
    case 'up':
      return moveSelectionOrScroll(next, { contextMax, detailMax, direction: -1, records, selectedIndex });
    case 'down':
      return moveSelectionOrScroll(next, { contextMax, detailMax, direction: 1, records, selectedIndex });
    case 'refresh':
      next.statusMessage = '正在刷新…';
      return next;
    default:
      return next;
  }
}

function moveSelectionOrScroll(next, { contextMax, detailMax, direction, records, selectedIndex }) {
  if (next.focus === 'queue') {
    if (records.length === 0) return next;
    const index = direction < 0 ? Math.max(0, selectedIndex - 1) : Math.min(records.length - 1, selectedIndex + 1);
    next.selectedIssue = records[index].issue;
    next.detailScroll = 0;
    next.contextScroll = 0;
    next.logFollow = next.tab === TUI_TABS.logs;
    return next;
  }
  if (next.focus === 'detail') {
    next.detailScroll = direction < 0 ? Math.max(0, next.detailScroll - 1) : Math.min(detailMax, next.detailScroll + 1);
    return next;
  }
  next.contextScroll = direction < 0 ? Math.max(0, next.contextScroll - 1) : Math.min(contextMax, next.contextScroll + 1);
  next.logFollow = false;
  return next;
}
