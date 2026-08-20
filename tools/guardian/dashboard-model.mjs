import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ACTIVE_STATES, isTerminalState, normalizeState, readState, STATES } from './state.mjs';
import { readJsonFile } from './runtime-io.mjs';

const WAITING_STATES = Object.freeze([STATES.GATE_1_WAIT, STATES.GATE_2_WAIT, STATES.STALLED]);
const ROLE_LABELS = Object.freeze({
  fixer: '修复者',
  qa: 'QA',
  inflight: '当前操作',
});

export function guardianDirFor(repoDir) {
  return path.join(repoDir, '.qa', 'guardian');
}

export function hasGuardianDir(repoDir) {
  return existsSync(guardianDirFor(repoDir));
}

export function loadIssueState(guardianDir, issueNumber) {
  return readState(guardianDir, issueNumber);
}

export function loadAllIssueStates(guardianDir) {
  if (!existsSync(guardianDir)) return [];
  return readdirSync(guardianDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
    .map((entry) => {
      const issue = Number(entry.name.replace(/\.json$/, ''));
      return normalizeState(readJsonFile(path.join(guardianDir, entry.name)), issue);
    })
    .sort((left, right) => Date.parse(right.updated_at ?? '') - Date.parse(left.updated_at ?? ''));
}

export function filterByState(records, filter) {
  if (!filter) return records;
  const normalized = String(filter).toLowerCase();
  if (normalized === 'active') return records.filter((record) => ACTIVE_STATES.includes(record.state));
  if (normalized === 'terminal') return records.filter((record) => isTerminalState(record.state));
  if (normalized === 'waiting') return records.filter((record) => WAITING_STATES.includes(record.state));
  return records.filter((record) => String(record.state).toLowerCase() === normalized);
}

export function relativeTime(isoString, now = Date.now()) {
  const then = Date.parse(isoString ?? '');
  if (Number.isNaN(then)) return '未知';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`;
}

function sessionLine(ref) {
  const label = ROLE_LABELS[ref.role] ?? `专家[${ref.role}]`;
  return `${label}: ${ref.session_id} (agent=${valueOrDash(ref.agent)}, 状态=${valueOrDash(ref.last_status)}, 最后活跃=${valueOrDash(ref.last_seen_at)})`;
}

export function extractSessionIds(record) {
  const sessions = [];
  if (record.opencode?.fixer?.session_id) {
    sessions.push({ role: 'fixer', ...record.opencode.fixer });
  }
  if (record.opencode?.qa?.session_id) {
    sessions.push({ role: 'qa', ...record.opencode.qa });
  }
  for (const [role, session] of Object.entries(record.opencode?.specialists ?? {})) {
    if (session?.session_id) sessions.push({ role, ...session });
  }
  return sessions;
}

export function formatIssueSummary(record, { now = Date.now() } = {}) {
  return `#${record.issue} ${record.state} [${valueOrDash(record.risk)}] 轮次=${record.processing_round ?? 1} 修复=${record.fix_rounds ?? 0} 更新=${relativeTime(record.updated_at, now)}`;
}

export function dashboardStats(records) {
  return {
    active: records.filter((record) => ACTIVE_STATES.includes(record.state)).length,
    waiting: records.filter((record) => WAITING_STATES.includes(record.state)).length,
    terminal: records.filter((record) => isTerminalState(record.state)).length,
    total: records.length,
  };
}

export function formatDashboardTable(records, { repoDir = '', now = Date.now() } = {}) {
  const header = repoDir ? `QA Guardian 仪表盘 - ${repoDir}` : 'QA Guardian 仪表盘';
  const lines = [header, `更新时间: ${new Date(now).toLocaleString('zh-CN')}`, ''];
  if (records.length === 0) {
    lines.push('暂无 Guardian 议题状态。');
    lines.push('下一步: 启动 scheduler，或确认目标仓库存在 .qa/guardian/<issue>.json。');
    return lines.join('\n');
  }

  lines.push(`${pad('议题', 8)} ${pad('状态', 16)} ${pad('风险', 6)} ${pad('轮次', 6)} ${pad('修复', 6)} ${pad('分支', 20)} 更新`);
  for (const record of records) {
    lines.push([
      pad(`#${record.issue}`, 8),
      pad(record.state, 16),
      pad(valueOrDash(record.risk), 6),
      pad(record.processing_round ?? 1, 6),
      pad(record.fix_rounds ?? 0, 6),
      pad(valueOrDash(record.branch), 20),
      relativeTime(record.updated_at, now),
    ].join(' '));
  }
  const stats = dashboardStats(records);
  lines.push('');
  lines.push(`活跃: ${stats.active} | 等待: ${stats.waiting} | 完成/交回: ${stats.terminal} | 共 ${stats.total} 个议题`);
  lines.push('查看会话: node tools/guardian/session-view.mjs --repo <项目> --issue <编号> --agent fixer');
  return lines.join('\n');
}

export function formatIssueDetail(record) {
  const sessions = extractSessionIds(record);
  const lines = [
    `=== 议题 #${record.issue} 详情 ===`,
    `状态: ${record.state}`,
    `风险等级: ${valueOrDash(record.risk)}`,
    `处理轮次: ${record.processing_round ?? 1} (修复次数: ${record.fix_rounds ?? 0})`,
    `分支: ${valueOrDash(record.branch)}`,
    `PR: ${valueOrDash(record.pr_url)}`,
    `调查状态: 档案=${valueOrDash(record.dossier_status)} 计划=${valueOrDash(record.plan_status)}`,
    `上次阶段: ${valueOrDash(record.last_phase)}`,
    `上次错误: ${valueOrDash(record.last_error_class)}`,
    '',
    '--- OpenCode 会话 ---',
  ];
  if (sessions.length === 0) {
    lines.push('暂无已记录的 OpenCode 会话。');
  } else {
    lines.push(...sessions.map(sessionLine));
  }
  if (record.opencode?.inflight) {
    const inflight = record.opencode.inflight;
    lines.push(`当前操作: ${valueOrDash(inflight.role)} ${valueOrDash(inflight.session_id)} (${valueOrDash(inflight.status)})`);
  } else {
    lines.push('当前操作: 无');
  }
  lines.push('', '--- 轮次历史 ---');
  const history = record.round_history ?? [];
  if (history.length === 0) {
    lines.push('暂无历史轮次。');
  } else {
    for (const item of history) {
      lines.push(`轮次 ${item.round}: 分支=${valueOrDash(item.branch)} PR=${valueOrDash(item.pr_url)} 完成于=${valueOrDash(item.completed_at)}`);
    }
  }
  lines.push('', `查看修复者会话: node tools/guardian/session-view.mjs --repo <项目> --issue ${record.issue} --agent fixer`);
  return lines.join('\n');
}

export function dashboardJson(records) {
  return {
    generated_at: new Date().toISOString(),
    stats: dashboardStats(records),
    issues: records,
  };
}
