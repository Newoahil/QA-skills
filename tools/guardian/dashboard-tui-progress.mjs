import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { extractSessionIds } from './dashboard-model.mjs';

const PROGRESS_TAIL_BYTES = 16 * 1024;
const PROGRESS_TAIL_LINES = 80;

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function displaySessionStatus(status, record) {
  const text = valueOrDash(status);
  if (text === 'running' && !record?.opencode?.inflight?.session_id) return 'running，非实时';
  return text;
}

// Human-readable duration. null/undefined/non-number → '-'. Sub-minute shows seconds.
function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1000) return `${n}ms`;
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m${remSeconds}s`;
}

function progressDirForIssue(guardianDir, issue) {
  return path.join(guardianDir, 'progress', String(issue));
}

function collectRelevantLogRoles(record, existingLogs = []) {
  const roles = new Set();
  for (const session of extractSessionIds(record)) roles.add(session.role);
  if (record?.opencode?.inflight?.role) roles.add(record.opencode.inflight.role);
  for (const role of record?.specialists_requested ?? []) roles.add(role);
  for (const role of record?.specialists_completed ?? []) roles.add(role);
  for (const role of record?.specialist_failures ?? []) roles.add(role);
  for (const role of existingLogs) roles.add(role);
  return Array.from(roles).filter(Boolean);
}

function appendMissingProgressGuidance(lines) {
  lines.push('- 说明: shared OpenCode server / SDK 会话路径当前不会写本地镜像 .log 文件；本地 progress 日志只来自 child-process 进度镜像。');
  lines.push('- 下一步: 切到 Transcript 或实时 标签查看 session 消息、provider 错误和 SSE 事件。');
}

function readBoundedTail(filePath, { maxBytes = PROGRESS_TAIL_BYTES, maxLines = PROGRESS_TAIL_LINES } = {}) {
  const size = statSync(filePath).size;
  const start = Math.max(0, size - maxBytes);
  const length = Math.max(0, size - start);
  if (length === 0) return { lines: [], truncated: false };
  const buffer = Buffer.alloc(length);
  const handle = openSync(filePath, 'r');
  try {
    const bytesRead = readSync(handle, buffer, 0, length, start);
    let text = buffer.toString('utf8', 0, bytesRead);
    if (start > 0) {
      const newline = text.search(/\r?\n/);
      text = newline >= 0 ? text.slice(newline + (text[newline] === '\r' && text[newline + 1] === '\n' ? 2 : 1)) : '';
    }
    let lines = splitLines(text).filter((line, index, source) => !(index === source.length - 1 && line === ''));
    const truncatedByLines = lines.length > maxLines;
    if (truncatedByLines) lines = lines.slice(-maxLines);
    return { lines, truncated: start > 0 || truncatedByLines };
  } finally {
    closeSync(handle);
  }
}

function existingIssueLogRoles(progressDir) {
  if (!progressDir || !existsSync(progressDir)) return [];
  return readdirSync(progressDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => entry.name.replace(/\.log$/i, ''))
    .sort();
}

function buildProgressLogLinesForGuardianDir(guardianDir, record) {
  if (!record) return ['暂无日志。'];
  const progressDir = guardianDir ? progressDirForIssue(guardianDir, record.issue) : null;
  const existingLogs = existingIssueLogRoles(progressDir);
  const roles = collectRelevantLogRoles(record, existingLogs);
  const lines = [
    '进度上下文',
    `- 当前状态: ${record.state}`,
    `- 上次阶段: ${valueOrDash(record.last_phase)}`,
    `- 调查次数: ${valueOrDash(record.investigation_attempts)}`,
    `- 调查开始: ${valueOrDash(record.investigation_started_at)}`,
    `- 调查完成: ${valueOrDash(record.investigation_completed_at)}`,
    `- 调查耗时: ${formatDuration(record.investigation_duration_ms)}`,
    `- 计划耗时: ${formatDuration(record.plan_duration_ms)}`,
    `- 处理轮次: ${valueOrDash(record.processing_round)}`,
    `- 修复次数: ${valueOrDash(record.fix_rounds)}`,
    `- stall 重试: ${valueOrDash(record.stall_retries)}`,
  ];
  const durations = record.specialist_durations_ms;
  if (durations && typeof durations === 'object' && Object.keys(durations).length > 0) {
    lines.push('', '各角色耗时');
    for (const [role, ms] of Object.entries(durations)) lines.push(`- ${role}: ${formatDuration(ms)}`);
  }
  lines.push('', '会话活跃度');
  const sessions = extractSessionIds(record);
  if (sessions.length === 0) {
    lines.push('- 暂无会话记录');
  } else {
    for (const session of sessions) lines.push(`- ${session.role}: ${session.session_id} | 状态=${displaySessionStatus(session.last_status, record)} | 最近=${valueOrDash(session.last_seen_at)}`);
  }
  if (record?.opencode?.inflight) {
    const inflight = record.opencode.inflight;
    lines.push(`- 当前操作: ${valueOrDash(inflight.role)} | session=${valueOrDash(inflight.session_id)} | 状态=${valueOrDash(inflight.status)}`);
  }
  lines.push('', '实际进度日志');
  if (!progressDir) {
    lines.push('- 当前调用未提供 guardian 目录，无法读取 .qa/guardian/progress/<issue>/<agent>.log');
    return lines;
  }
  if (!existsSync(progressDir)) {
    lines.push(`- 未发现进度目录: ${progressDir}`);
    lines.push(`- 期望日志路径: ${path.join(progressDir, '<agent>.log')}`);
    if (roles.length > 0) lines.push(`- 当前相关角色: ${roles.join(', ')}`);
    appendMissingProgressGuidance(lines);
    return lines;
  }
  if (existingLogs.length === 0) {
    lines.push(`- 进度目录存在，但没有 .log 文件: ${progressDir}`);
    lines.push(`- 期望日志路径: ${path.join(progressDir, '<agent>.log')}`);
    if (roles.length > 0) lines.push(`- 当前相关角色: ${roles.join(', ')}`);
    appendMissingProgressGuidance(lines);
    return lines;
  }
  const orderedRoles = collectRelevantLogRoles(record, existingLogs)
    .filter((role, index, source) => source.indexOf(role) === index)
    .sort((left, right) => {
      const leftIndex = existingLogs.indexOf(left);
      const rightIndex = existingLogs.indexOf(right);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.localeCompare(right, 'zh-CN');
    });
  let foundReadableLog = false;
  for (const role of orderedRoles) {
    const logPath = path.join(progressDir, `${role}.log`);
    if (!existsSync(logPath)) continue;
    const { lines: tailLines, truncated } = readBoundedTail(logPath);
    foundReadableLog = true;
    lines.push(`- ${role}.log`);
    lines.push(`  路径: ${logPath}`);
    if (tailLines.length === 0) {
      lines.push('  [空日志]');
    } else {
      if (truncated) lines.push(`  … 已截断，仅显示末尾 ${tailLines.length} 行 / ${PROGRESS_TAIL_BYTES} 字节窗口`);
      for (const line of tailLines) lines.push(`  ${line}`);
    }
    lines.push('');
  }
  if (!foundReadableLog) {
    lines.push(`- 进度目录中未找到当前相关角色日志；请检查 ${path.join(progressDir, '<agent>.log')}`);
    if (existingLogs.length > 0) lines.push(`- 当前目录已有日志: ${existingLogs.join(', ')}`);
  }
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

export function buildProgressLogLines(guardianDirOrRecord, maybeRecord) {
  if (maybeRecord === undefined) return buildProgressLogLinesForGuardianDir(null, guardianDirOrRecord);
  return buildProgressLogLinesForGuardianDir(guardianDirOrRecord, maybeRecord);
}
