import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { dashboardStats, extractSessionIds, filterByState, formatIssueDetail, guardianDirFor, hasGuardianDir, loadAllIssueStates } from './dashboard-model.mjs';
import { buildArtifactErrorLines } from './dashboard-tui-artifacts.mjs';
import { buildProgressLogLines } from './dashboard-tui-progress.mjs';
import { buildLiveTranscriptLines, buildSummaryTabLines, buildTranscriptLines, liveRoleOptions, resolveLiveSession, resolvePreferredSession } from './dashboard-tui-context.mjs';
import { resolveViewerRepo } from './worktree-binding.mjs';
import { fetchTranscript } from './session-transcript.mjs';
import { TUI_TABS } from './dashboard-tui-input.mjs';
import { stripUtf8Bom } from './runtime-io.mjs';

export const DEFAULT_REFRESH_SECONDS = 8;
export const DEFAULT_FOCUS = 'queue';
export const DEFAULT_STATE_FILTER = 'current';
const DEFAULT_LOCK_LEASE_MS = 30 * 60 * 1000;

// Cycle order for the `t` key. `current` (active + waiting) is the day-to-day watch view;
// `all` exposes terminal history (DONE / HANDED_BACK) for audit without deleting state files.
export const STATE_FILTER_CYCLE = Object.freeze(['current', 'active', 'waiting', 'all']);

export const STATE_FILTER_LABELS = Object.freeze({
  current: '关注中',
  active: '处理中',
  waiting: '等待人工',
  all: '全部历史',
});

export function stateFilterLabel(filter) {
  return STATE_FILTER_LABELS[filter] ?? String(filter ?? '全部');
}

export function nextStateFilter(filter) {
  const index = STATE_FILTER_CYCLE.indexOf(filter);
  if (index < 0) return STATE_FILTER_CYCLE[0];
  return STATE_FILTER_CYCLE[(index + 1) % STATE_FILTER_CYCLE.length];
}

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

export { buildArtifactErrorLines, buildProgressLogLines, buildSummaryTabLines, buildTranscriptLines, liveRoleOptions, resolveLiveSession, resolvePreferredSession };

export function parseRefreshSeconds(value, fallback = DEFAULT_REFRESH_SECONDS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createInitialUiState({
  selectedIssue = null,
  refreshSeconds = DEFAULT_REFRESH_SECONDS,
  stateFilter = DEFAULT_STATE_FILTER,
} = {}) {
  return {
    selectedIssue,
    focus: DEFAULT_FOCUS,
    tab: TUI_TABS.summary,
    helpVisible: false,
    transcriptFull: false,
    autoRefresh: true,
    refreshSeconds,
    stateFilter,
    detailScroll: 0,
    contextScroll: 0,
    logFollow: true,
    statusMessage: '已进入只读 Guardian TUI。',
    lastRefreshAt: null,
    liveRole: 'auto',
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
  liveLines = null,
  liveRole = 'auto',
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
  const contextLines = await loadContextLines({ baseUrl, guardianDir, now, record, stats, tab, transcriptFetcher, transcriptFull, liveLines, liveRole });

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

async function loadContextLines({ baseUrl, guardianDir, now, record, stats, tab, transcriptFetcher, transcriptFull, liveLines, liveRole }) {
  switch (tab) {
    case TUI_TABS.transcript:
      return buildTranscriptLines(record, { baseUrl, full: transcriptFull, transcriptFetcher });
    case TUI_TABS.logs:
      return buildProgressLogLines(guardianDir, record);
    case TUI_TABS.artifacts:
      return buildArtifactErrorLines(guardianDir, record);
    case TUI_TABS.live:
      return buildLiveEventLines(liveLines, baseUrl, { guardianDir, now, record, transcriptFetcher, transcriptFull, liveRole });
    default:
      return buildSummaryTabLines(record, stats, now);
  }
}

// Live tab: rendered from the selected OpenCode session transcript plus the CLI's in-memory SSE event
// buffer. Auto-refresh re-fetches getMessages(sessionId); SSE events provide immediate progress lines.
function processExists(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    return true;
  }
}

function schedulerLockLines(guardianDir, now = Date.now()) {
  if (!guardianDir) return ['- scheduler lock: 未知（无 guardianDir）'];
  const lockFile = path.join(guardianDir, '.scheduler.lock');
  if (!existsSync(lockFile)) return ['- scheduler lock: 未检测到'];
  try {
    const lock = JSON.parse(stripUtf8Bom(readFileSync(lockFile, 'utf8')));
    const renewedAt = Number(lock?.renewed_at ?? lock?.acquired_at);
    const pid = Number(lock?.pid);
    const ageMs = Number.isFinite(renewedAt) ? Math.max(0, now - renewedAt) : null;
    const leaseLive = ageMs !== null && ageMs < DEFAULT_LOCK_LEASE_MS;
    const ownerAlive = processExists(pid);
    if (leaseLive && ownerAlive) return [`- scheduler lock: live pid=${pid} renewed=${new Date(renewedAt).toLocaleString('zh-CN')}`];
    if (leaseLive && !ownerAlive) return [`- scheduler lock: 陈旧（pid=${pid} 不存在，但 lease 尚未过期）`];
    return [`- scheduler lock: 已过期 pid=${Number.isFinite(pid) ? pid : '-'} renewed=${Number.isFinite(renewedAt) ? new Date(renewedAt).toLocaleString('zh-CN') : '-'}`];
  } catch (error) {
    return [`- scheduler lock: 读取失败（${error instanceof Error ? error.message : 'unknown'}）`];
  }
}

function activeWorkLines(record) {
  const inflight = record?.opencode?.inflight;
  if (!inflight?.session_id) return ['- 当前操作: 无活跃 inflight'];
  return [`- 当前操作: ${inflight.role ?? '-'} session=${inflight.session_id} 状态=${inflight.status ?? '-'}`];
}

function recentSessionLines(record) {
  const sessions = extractSessionIds(record);
  if (sessions.length === 0) return [];
  return [
    '近期会话',
    ...sessions.map((session) => `- ${session.role}: ${session.session_id} | 状态=${session.last_status ?? '-'} | 最近=${session.last_seen_at ?? '-'}`),
    '',
  ];
}

function recentProgressLines(guardianDir, record) {
  const progress = buildProgressLogLines(guardianDir, record);
  const start = progress.findIndex((line) => line === '实际进度日志');
  if (start < 0) return [];
  const tail = progress.slice(start + 1).filter((line) => !/未发现进度目录|期望日志路径|进度目录存在，但没有|shared OpenCode server|下一步: 切到 Transcript/.test(line));
  if (tail.length === 0) return [];
  return ['最近进度日志', ...tail.slice(0, 12), ''];
}

async function buildLiveEventLines(liveLines, baseUrl, { guardianDir = null, now = Date.now(), record = null, transcriptFetcher = fetchTranscript, transcriptFull = false, liveRole = 'auto' } = {}) {
  if (!Array.isArray(liveLines)) {
    return [
      '实时事件流未启用。',
      '',
      '原因: 未连接共享 opencode 服务（--base-url 未指向运行中的 serve）。',
      '下一步: 用 guardian-start.bat 启动（默认共享 serve），或运行 dashboard-tui.mjs --base-url http://127.0.0.1:4096。',
    ];
  }
  const transcript = await buildLiveTranscriptLines(record, { baseUrl, full: transcriptFull, liveRole, transcriptFetcher });
  if (liveLines.length === 0) {
    const sessions = recentSessionLines(record);
    const progress = recentProgressLines(guardianDir, record);
    if (sessions.length > 0 || progress.length > 0) {
      return [
        `已连接共享 OpenCode 事件流: ${baseUrl}`,
        '',
        ...transcript,
        '',
        '当前没有新的 SSE 事件；下面显示已记录会话和本地进度上下文。',
        '',
        ...sessions,
        ...progress,
        '运行状态',
        ...activeWorkLines(record),
        ...schedulerLockLines(guardianDir, now),
      ];
    }
    return [
      `已连接共享 OpenCode 事件流: ${baseUrl}`,
      '',
      ...transcript,
      '',
      '当前没有活跃专员事件。',
      '说明: SSE 连接成功只代表可以接收后续事件；是否正在工作请同时看当前操作、scheduler lock 和状态更新时间。',
      '',
      '运行状态',
      ...activeWorkLines(record),
      ...schedulerLockLines(guardianDir, now),
    ];
  }
  return [`实时事件流: ${baseUrl}`, '', ...transcript, '', 'SSE 事件', ...liveLines];
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
    case 'cycle-state-filter':
      next.stateFilter = nextStateFilter(next.stateFilter);
      next.selectedIssue = null;
      next.detailScroll = 0;
      next.contextScroll = 0;
      next.statusMessage = `队列筛选已切换到「${stateFilterLabel(next.stateFilter)}」。`;
      return next;
    case 'switch-tab':
      next.tab = action.tab;
      next.contextScroll = 0;
      if (action.tab !== TUI_TABS.logs) next.logFollow = false;
      next.statusMessage = `已切换到 ${action.tab} 标签。`;
      return next;
    case 'cycle-live-role': {
      const options = liveRoleOptions(snapshot?.record);
      const current = options.includes(next.liveRole) ? next.liveRole : options[0];
      const currentIndex = options.indexOf(current);
      const direction = action.direction < 0 ? -1 : 1;
      next.liveRole = options[(currentIndex + direction + options.length) % options.length];
      next.tab = TUI_TABS.live;
      next.contextScroll = 0;
      next.statusMessage = `实时会话角色已切换到 ${next.liveRole}。`;
      return next;
    }
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
