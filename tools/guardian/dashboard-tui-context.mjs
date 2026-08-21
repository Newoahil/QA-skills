import { extractSessionIds, formatIssueSummary, relativeTime } from './dashboard-model.mjs';
import { guidedError } from './dashboard-errors.mjs';
import { fetchTranscript } from './session-transcript.mjs';

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function trimPreview(text, limit = 18) {
  const lines = splitLines(text).filter((line, index, source) => !(index === source.length - 1 && line === ''));
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `... 共 ${lines.length} 行，已截断`];
}

export function resolvePreferredSession(record) {
  if (!record) return { kind: 'missing-issue' };
  const inflight = record.opencode?.inflight;
  if (inflight?.session_id) {
    return {
      kind: 'ok',
      role: inflight.role ?? 'inflight',
      sessionId: inflight.session_id,
      source: 'inflight',
      status: inflight.status ?? '-',
    };
  }
  const sessions = extractSessionIds(record);
  if (sessions.length === 0) return { kind: 'missing-session', issue: record.issue, state: record.state };
  const preferred = sessions[0];
  return {
    kind: 'ok',
    role: preferred.role,
    sessionId: preferred.session_id,
    source: 'record',
    status: preferred.last_status ?? '-',
  };
}

export function buildSummaryTabLines(record, stats, now) {
  if (!record) return ['暂无议题。'];
  const sessions = extractSessionIds(record);
  return [
    `议题摘要: ${formatIssueSummary(record, { now })}`,
    `总览统计: 活跃 ${stats.active} / 等待 ${stats.waiting} / 结束 ${stats.terminal} / 共 ${stats.total}`,
    '',
    `Issue 分类: ${valueOrDash(record.issue_class)}`,
    `风险等级: ${valueOrDash(record.risk)}`,
    `调查状态: dossier=${valueOrDash(record.dossier_status)} | plan=${valueOrDash(record.plan_status)}`,
    `上次阶段: ${valueOrDash(record.last_phase)}`,
    `最后错误: ${valueOrDash(record.last_error_class)}`,
    `证据数: ${valueOrDash(record.evidence_count)}`,
    `未决事实: ${valueOrDash(record.unresolved_fact_count)}`,
    `验收条件: ${valueOrDash(record.acceptance_criteria_count)}`,
    `生产依赖: ${record.production_dependency ? '是' : '否'}`,
    `最近更新: ${relativeTime(record.updated_at, now)}`,
    '',
    `OpenCode 会话数: ${sessions.length}`,
    ...(sessions.length === 0 ? ['暂无已记录会话。'] : sessions.map((session) => `- ${session.role}: ${session.session_id} (${valueOrDash(session.last_status)})`)),
  ];
}

export async function buildTranscriptLines(record, { baseUrl, full = false, transcriptFetcher = fetchTranscript } = {}) {
  if (!record) return ['暂无会话。'];
  const resolved = resolvePreferredSession(record);
  if (resolved.kind !== 'ok') {
    return splitLines(guidedError('no-session', { issue: record.issue, role: '默认', state: record.state }));
  }
  const transcript = await transcriptFetcher(resolved.sessionId, { baseUrl });
  if (transcript.kind !== 'ok') return splitLines(transcript.error);
  const lines = [`会话来源: ${resolved.source} | 角色: ${resolved.role} | session: ${resolved.sessionId}`, ''];
  const messages = transcript.messages ?? [];
  for (const message of messages) {
    const created = valueOrDash(message?.createdAt ?? message?.created_at ?? message?.time?.created);
    const role = valueOrDash(message?.role ?? message?.author ?? message?.info?.role);
    lines.push(`[${role}] ${created}`);
    const parts = Array.isArray(message?.parts)
      ? message.parts
      : typeof message?.text === 'string'
        ? [{ type: 'text', text: message.text }]
        : [];
    if (parts.length === 0) {
      lines.push('  [空消息]');
      lines.push('');
      continue;
    }
    for (const part of parts) {
      if (part?.type === 'tool_result' && !full) continue;
      let rendered = '';
      if (part?.type === 'tool_use' || part?.type === 'tool_call') {
        rendered = `[工具调用] ${part.name ?? part.tool ?? part.toolName ?? 'unknown'}`;
      } else if (part?.type === 'tool_result') {
        rendered = `[工具结果]\n${valueOrDash(part.text ?? part.content ?? part.message ?? JSON.stringify(part))}`;
      } else {
        rendered = valueOrDash(part?.text ?? part?.content ?? part?.message ?? JSON.stringify(part));
      }
      for (const line of trimPreview(rendered, full ? 1000 : 14)) lines.push(`  ${line}`);
    }
    lines.push('');
  }
  return lines.length > 0 ? lines : ['暂无消息。'];
}
