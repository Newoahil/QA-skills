#!/usr/bin/env node
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  dashboardJson,
  filterByState,
  formatDashboardTable,
  formatIssueDetail,
  guardianDirFor,
  hasGuardianDir,
  loadAllIssueStates,
  loadIssueState,
} from './dashboard-model.mjs';
import { guidedError } from './dashboard-errors.mjs';

function usage() {
  return `QA Guardian 仪表盘（只读）

用法:
  node tools/guardian/dashboard.mjs --repo <项目>
  node tools/guardian/dashboard.mjs --repo <项目> --watch 10
  node tools/guardian/dashboard.mjs --repo <项目> --issue <编号>

参数:
  --repo <path>        目标项目路径（必需）
  --watch [秒]         持续刷新；不填秒数时默认 5 秒
  --json              输出 JSON，便于脚本消费
  --state <filter>    筛选状态：active、waiting、terminal，或具体状态名（如 FIXING）
  --issue <n>         查看单个议题详情
  --help              显示本帮助

会话查看:
  node tools/guardian/session-view.mjs --repo <项目> --issue <编号> --agent fixer
  node tools/guardian/session-view.mjs --repo <项目> --issue <编号> --agent qa
`;
}

function parseCli(argv) {
  const normalizedArgv = [];
  for (let index = 0; index < argv.length; index += 1) {
    normalizedArgv.push(argv[index]);
    if (argv[index] === '--watch' && (argv[index + 1] === undefined || argv[index + 1].startsWith('--'))) {
      normalizedArgv.push('5');
    }
  }
  return parseArgs({
    args: normalizedArgv,
    options: {
      repo: { type: 'string' },
      watch: { type: 'string' },
      json: { type: 'boolean', default: false },
      state: { type: 'string' },
      issue: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  }).values;
}

function renderOnce(args, now = Date.now()) {
  const repoDir = path.resolve(args.repo);
  if (!hasGuardianDir(repoDir)) return { kind: 'error', text: guidedError('no-guardian-dir') };
  const guardianDir = guardianDirFor(repoDir);
  if (args.issue) {
    const issue = Number(args.issue);
    const record = loadIssueState(guardianDir, issue);
    if (!record) return { kind: 'error', text: guidedError('no-issue-state', { issue }) };
    return { kind: 'ok', text: args.json ? JSON.stringify(record, null, 2) : formatIssueDetail(record) };
  }
  const records = filterByState(loadAllIssueStates(guardianDir), args.state);
  return {
    kind: 'ok',
    text: args.json ? JSON.stringify(dashboardJson(records), null, 2) : formatDashboardTable(records, { repoDir, now }),
  };
}

function watchIntervalSeconds(value) {
  if (value === undefined) return 5;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.repo) {
    console.error(guidedError('missing-argument', { reason: '请提供 --repo <目标项目路径>。' }));
    process.exit(2);
  }
  if (args.watch !== undefined && args.json) {
    console.error(guidedError('missing-argument', { reason: '--watch 面向人工查看，不能和 --json 同时使用。' }));
    process.exit(2);
  }
  if (args.watch !== undefined) {
    const intervalMs = watchIntervalSeconds(args.watch) * 1000;
    while (true) {
      console.clear();
      const result = renderOnce(args);
      console[result.kind === 'ok' ? 'log' : 'error'](result.text);
      console.log(`\n自动刷新: ${intervalMs / 1000} 秒 | 停止: Ctrl+C`);
      await sleep(intervalMs);
    }
  }
  const result = renderOnce(args);
  console[result.kind === 'ok' ? 'log' : 'error'](result.text);
  if (result.kind !== 'ok') process.exit(2);
}

if (process.argv[1]?.endsWith('dashboard.mjs')) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : '未知错误';
    console.error(guidedError('missing-argument', { reason }));
    process.exit(1);
  });
}
