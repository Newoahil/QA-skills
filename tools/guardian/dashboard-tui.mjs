#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { guidedError } from './dashboard-errors.mjs';
import { createKeypressParser, TUI_TABS } from './dashboard-tui-input.mjs';
import { loadDashboardTuiSnapshot, createInitialUiState, parseRefreshSeconds, reduceUiState, DEFAULT_STATE_FILTER } from './dashboard-tui-model.mjs';
import { renderDashboardTui } from './dashboard-tui-render.mjs';
import { createTerminalSession } from './dashboard-tui-terminal.mjs';
import { createEventBuffer, eventMatchesSessions, mapEventToLine } from './dashboard-tui-events.mjs';
import { extractSessionIds } from './dashboard-model.mjs';
import { createOpencodeClient } from './opencode-client.mjs';

const DEFAULT_BASE_URL = process.env.OPENCODE_BASE_URL ?? 'http://localhost:3000';
const ESCAPE_FLUSH_DELAY_MS = 25;
const EVENT_RECONNECT_MS = 3000;

export function tuiUsage() {
  return `QA Guardian 单终端只读 TUI

用法:
  node tools/guardian/dashboard-tui.mjs --repo <项目>
  node tools/guardian/dashboard-tui.mjs --repo <项目> --refresh 8

参数:
  --repo <path>        目标项目路径（必需；会先通过 resolveViewerRepo 定位 authoritative control repo）
  --refresh <秒>       自动刷新秒数，默认 8；运行中可按 a 开关自动刷新
  --state <filter>     队列初始筛选：current(默认)、active、waiting、all、terminal，或具体状态名
  --base-url <url>     OpenCode 服务地址；默认 ${DEFAULT_BASE_URL}
  --issue <n>          启动时默认选中 issue
  --help               显示帮助

键位:
  q 退出 | ↑/↓ 或 j/k 导航 | Enter 进入详情滚动 | Esc 返回队列
  1 摘要 | 2 transcript | 3 logs | 4 产物/错误 | 5 实时(需 --base-url 共享 serve)
  r 手动刷新 | a 自动刷新开关 | t 切换队列筛选 | ? 帮助 | F transcript 完整模式 | G/p logs follow

安全说明:
  - 只读查看 .qa/guardian、issue 产物与 OpenCode transcript
  - 不调用 writeState，不改 GitHub，不改 git，不改 scheduler 配置
  - 非 TTY 环境请改用 dashboard.mjs，或仅传 --help 查看说明
`;
}

function parseCli(argv) {
  return parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      refresh: { type: 'string' },
      state: { type: 'string' },
      'base-url': { type: 'string' },
      issue: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  }).values;
}

export async function runDashboardTuiCli(argv, deps = {}) {
  const {
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    transcriptFetcher,
    snapshotLoader = loadDashboardTuiSnapshot,
    setIntervalImpl = global.setInterval,
    clearIntervalImpl = global.clearInterval,
    terminalFactory = createTerminalSession,
    eventClientFactory = createOpencodeClient,
    eventReconnectMs = EVENT_RECONNECT_MS,
  } = deps;
  const args = parseCli(argv);
  if (args.help) {
    stdout.write(`${tuiUsage()}\n`);
    return 0;
  }
  if (!args.repo) {
    stderr.write(`${guidedError('missing-argument', { reason: '请提供 --repo <目标项目路径>。' })}\n`);
    return 2;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    stderr.write(`${guidedError('missing-argument', { reason: 'dashboard-tui 需要交互式 TTY；若只需静态输出，请改用 dashboard.mjs。' })}\n`);
    return 2;
  }

  const refreshSeconds = parseRefreshSeconds(args.refresh);
  const bindingFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scheduler.config.json');
  const requestedRepo = path.resolve(args.repo);
  // Live event view is enabled only with an explicit --base-url (a running shared serve). Without it,
  // the live tab shows guidance and the TUI keeps working with the on-disk snapshot only.
  const liveBaseUrl = args['base-url'] ?? null;
  const liveEnabled = Boolean(liveBaseUrl);
  const eventBuffer = liveEnabled ? createEventBuffer() : null;
  let ui = createInitialUiState({
    selectedIssue: args.issue ? Number(args.issue) : null,
    refreshSeconds,
    stateFilter: args.state ?? DEFAULT_STATE_FILTER,
  });
  let snapshot = {
    kind: 'ok',
    repoDir: requestedRepo,
    now: Date.now(),
    records: [],
    selectedIssue: ui.selectedIssue,
    selectedIndex: -1,
    detailLines: ['加载中…'],
    contextLines: ['加载中…'],
  };
  let intervalId = null;
  let escapeFlushTimer = null;
  let liveRefreshTimer = null;
  let cleaned = false;
  let resolveExit;
  let rejectExit;
  const exitPromise = new Promise((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  const terminal = terminalFactory({ stdin, stdout });
  const keypressParser = createKeypressParser();
  let inputQueue = Promise.resolve();
  let refreshQueue = Promise.resolve();

  function repaint() {
    terminal.render(renderDashboardTui(snapshot, ui, terminal.viewport()));
  }

  async function refreshNow(reason = 'manual') {
    const scheduled = refreshQueue.then(async () => {
      if (cleaned) return;
      snapshot = await snapshotLoader({
        requestedRepo,
        bindingFile,
        selectedIssue: ui.selectedIssue,
        tab: ui.tab,
        stateFilter: ui.stateFilter,
        transcriptFull: ui.transcriptFull,
        baseUrl: liveBaseUrl ?? DEFAULT_BASE_URL,
        transcriptFetcher,
        liveLines: eventBuffer ? eventBuffer.lines() : null,
      });
      ui.selectedIssue = snapshot.selectedIssue;
      ui.lastRefreshAt = Date.now();
      if (reason !== 'selection') {
        ui.statusMessage = reason === 'auto' ? `已自动刷新（${ui.refreshSeconds} 秒）。` : '已手动刷新。';
      }
      repaint();
    });
    refreshQueue = scheduled.catch(() => undefined);
    return scheduled;
  }

  async function applyAction(action) {
    if (action.type === 'noop') return;
    if (action.type === 'quit') {
      cleanup(0);
      return;
    }
    const beforeIssue = ui.selectedIssue;
    const beforeTab = ui.tab;
    const beforeFilter = ui.stateFilter;
    ui = reduceUiState(ui, action, snapshot, terminal.viewport());
    repaint();
    const needsRefresh = action.type === 'refresh'
      || beforeIssue !== ui.selectedIssue
      || beforeTab !== ui.tab
      || beforeFilter !== ui.stateFilter
      || action.type === 'toggle-transcript-full'
      || action.type === 'logs-follow-end'
      || action.type === 'logs-pause-follow';
    if (needsRefresh) await refreshNow(action.type === 'refresh' ? 'manual' : 'selection');
  }

  function installAutoRefresh() {
    if (intervalId) clearIntervalImpl(intervalId);
    if (cleaned) return;
    if (!ui.autoRefresh) return;
    intervalId = setIntervalImpl(() => {
      refreshNow('auto').catch((error) => {
        ui.statusMessage = `自动刷新失败: ${error instanceof Error ? error.message : '未知错误'}`;
        repaint();
      });
    }, ui.refreshSeconds * 1000);
  }

  // Real-time event view: subscribe once to the shared serve's official SSE stream and append mapped
  // lines to the bounded buffer, filtered to the selected issue's session ids. No polling. Auto
  // reconnects on stream end/error until cleanup. A repaint fires only while the live tab is visible.
  let eventCancel = null;
  let eventStopped = false;
  function scheduleLiveRefresh() {
    if (cleaned || liveRefreshTimer) return;
    liveRefreshTimer = setTimeout(() => {
      liveRefreshTimer = null;
      refreshNow('live').catch(() => undefined);
    }, 0);
  }
  function currentSessionIds() {
    const record = snapshot?.record;
    if (!record) return [];
    const ids = extractSessionIds(record).map((session) => session.session_id).filter(Boolean);
    if (record.opencode?.inflight?.session_id) ids.push(record.opencode.inflight.session_id);
    return ids;
  }
  async function runEventSubscription() {
    if (!liveEnabled) return;
    const client = eventClientFactory({ baseUrl: liveBaseUrl });
    while (!cleaned && !eventStopped) {
      let subscription;
      try {
        subscription = await client.subscribeEvents();
      } catch {
        subscription = { kind: 'error' };
      }
      if (cleaned || eventStopped) return;
      if (subscription.kind !== 'ok' || !subscription.stream) {
        eventBuffer.push(`[连接] 无法连接实时事件流，${Math.round(eventReconnectMs / 1000)}s 后重试…`);
        if (ui.tab === TUI_TABS.live) repaint();
        await new Promise((resolve) => setTimeout(resolve, eventReconnectMs));
        continue;
      }
      eventCancel = subscription.cancel ?? null;
      try {
        for await (const event of subscription.stream) {
          if (cleaned || eventStopped) break;
          if (!eventMatchesSessions(event, currentSessionIds())) continue;
          const line = mapEventToLine(event);
          if (!line) continue;
          eventBuffer.push(line);
          // Rebuild the snapshot (cheap, reads the buffer) so the live tab reflects the new line
          // immediately without any polling timer.
          if (ui.tab === TUI_TABS.live) scheduleLiveRefresh();
        }
      } catch {
        // stream error → fall through to reconnect
      }
      eventCancel = null;
      if (cleaned || eventStopped) return;
      await new Promise((resolve) => setTimeout(resolve, eventReconnectMs));
    }
  }

  function cleanup(code, error) {
    if (cleaned) return;
    cleaned = true;
    eventStopped = true;
    if (typeof eventCancel === 'function') { try { eventCancel(); } catch { /* best-effort */ } }
    if (intervalId) clearIntervalImpl(intervalId);
    if (escapeFlushTimer) clearTimeout(escapeFlushTimer);
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    stdin.removeListener('data', onData);
    stdout.removeListener('resize', onResize);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    terminal.restore();
    if (error === undefined) {
      resolveExit(code);
      return;
    }
    rejectExit(error);
  }

  function failInputHandling(error, prefix) {
    ui.statusMessage = `${prefix}: ${error instanceof Error ? error.message : '未知错误'}`;
    repaint();
    cleanup(undefined, error);
  }

  async function applyActions(actions) {
    for (const action of actions) {
      if (cleaned) break;
      const prevAuto = ui.autoRefresh;
      await applyAction(action);
      if (cleaned) break;
      if (prevAuto !== ui.autoRefresh) installAutoRefresh();
    }
  }

  function enqueueInputHandling(task, prefix) {
    inputQueue = inputQueue.then(task);
    inputQueue = inputQueue.catch((error) => {
      failInputHandling(error, prefix);
      return undefined;
    });
    return inputQueue;
  }

  function scheduleEscapeFlush() {
    if (!keypressParser.hasPending()) return;
    if (escapeFlushTimer) clearTimeout(escapeFlushTimer);
    escapeFlushTimer = setTimeout(() => {
      escapeFlushTimer = null;
      enqueueInputHandling(() => applyActions(keypressParser.flush()), '按键处理失败');
    }, ESCAPE_FLUSH_DELAY_MS);
  }

  function onData(chunk) {
    enqueueInputHandling(async () => {
      if (cleaned) return;
      if (escapeFlushTimer) {
        clearTimeout(escapeFlushTimer);
        escapeFlushTimer = null;
      }
      await applyActions(keypressParser.feed(chunk));
      if (cleaned) return;
      scheduleEscapeFlush();
    }, '按键处理失败');
  }

  function onResize() {
    repaint();
  }

  function onSigint() {
    cleanup(130);
  }

  function onSigterm() {
    cleanup(143);
  }

  try {
    terminal.enter();
    stdin.on('data', onData);
    stdout.on('resize', onResize);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    repaint();
    await refreshNow('manual');
    installAutoRefresh();
    if (liveEnabled) { runEventSubscription().catch(() => undefined); }
    return exitPromise;
  } catch (error) {
    cleanup(undefined);
    throw error;
  }
}

async function main() {
  const code = await runDashboardTuiCli(process.argv.slice(2));
  if (code !== 0) process.exit(code);
}

if (process.argv[1]?.endsWith('dashboard-tui.mjs')) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : '未知错误';
    process.stderr.write(`${guidedError('session-fetch-error', { kind: message })}\n`);
    process.exit(1);
  });
}
