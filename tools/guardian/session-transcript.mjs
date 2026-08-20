import { createOpencodeClient } from './opencode-client.mjs';
import { loadIssueState } from './dashboard-model.mjs';
import { guidedError } from './dashboard-errors.mjs';

const DEFAULT_TEXT_LIMIT = 500;

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function textFromPart(part) {
  if (typeof part?.text === 'string') return part.text;
  if (typeof part?.content === 'string') return part.content;
  if (typeof part?.message === 'string') return part.message;
  return '';
}

function truncateText(text, { full = false, limit = DEFAULT_TEXT_LIMIT } = {}) {
  if (full || text.length <= limit) return text;
  return `${text.slice(0, limit)}...(截断)`;
}

function renderToolUse(part) {
  const name = part?.name ?? part?.tool ?? part?.toolName ?? 'unknown';
  return `[工具调用: ${name}]`;
}

function renderToolResult(part, options) {
  if (!options.full) return null;
  const text = textFromPart(part) || JSON.stringify(part);
  return `[工具结果]\n${truncateText(text, options)}`;
}

export function resolveSessionId(guardianDir, issueNumber, role) {
  const record = loadIssueState(guardianDir, issueNumber);
  if (!record) return { kind: 'missing-issue' };
  const normalizedRole = String(role ?? '').toLowerCase();
  if (normalizedRole === 'fixer' || normalizedRole === 'qa-guardian') {
    return record.opencode?.fixer?.session_id
      ? { kind: 'ok', sessionId: record.opencode.fixer.session_id, record, role: 'fixer' }
      : { kind: 'missing-session', record, role: 'fixer' };
  }
  if (normalizedRole === 'qa') {
    return record.opencode?.qa?.session_id
      ? { kind: 'ok', sessionId: record.opencode.qa.session_id, record, role: 'qa' }
      : { kind: 'missing-session', record, role: 'qa' };
  }
  const session = record.opencode?.specialists?.[normalizedRole];
  return session?.session_id
    ? { kind: 'ok', sessionId: session.session_id, record, role: normalizedRole }
    : { kind: 'missing-session', record, role: normalizedRole };
}

export async function fetchTranscript(sessionId, { baseUrl, clientFactory = createOpencodeClient } = {}) {
  const client = clientFactory({ baseUrl });
  const result = await client.getMessages(sessionId);
  if (result.kind === 'ok') return { kind: 'ok', messages: Array.isArray(result.messages) ? result.messages : [] };
  if (result.kind === 'unusable-session') {
    return { kind: 'error', error: guidedError('session-not-found', { sessionId }) };
  }
  if (result.kind === 'retryable') {
    return { kind: 'error', error: guidedError('opencode-unreachable', { baseUrl: baseUrl ?? '默认地址' }) };
  }
  return { kind: 'error', error: guidedError('session-fetch-error', { kind: result.kind ?? 'unknown' }) };
}

export function renderMessagePart(part, options = {}) {
  switch (part?.type) {
    case 'text':
      return truncateText(textFromPart(part), options);
    case 'tool_use':
    case 'tool_call':
      return renderToolUse(part);
    case 'tool_result':
      return renderToolResult(part, options);
    default:
      if (part?.type) return `[${part.type}]`;
      return truncateText(textFromPart(part) || JSON.stringify(part), options);
  }
}

function messageRole(message) {
  return message?.role ?? message?.info?.role ?? message?.author ?? 'unknown';
}

function messageTime(message) {
  return message?.createdAt ?? message?.created_at ?? message?.time?.created ?? message?.info?.time?.created ?? null;
}

function messageParts(message) {
  if (Array.isArray(message?.parts)) return message.parts;
  if (typeof message?.text === 'string') return [{ type: 'text', text: message.text }];
  return [];
}

export function formatMessageSummary(messages) {
  const times = messages.map(messageTime).filter(Boolean).sort();
  const roles = [...new Set(messages.map(messageRole))].join(', ') || '-';
  const range = times.length > 0 ? `${times[0]} 至 ${times[times.length - 1]}` : '未知';
  return `消息数: ${messages.length} | 角色: ${roles} | 时间: ${range}`;
}

export function formatTranscript(messages, { sessionId = '', issue = null, role = '', full = false } = {}) {
  const header = sessionId ? `=== 会话记录 ${sessionId} ===` : '=== 会话记录 ===';
  const meta = [`议题: ${issue ? `#${issue}` : '-'}`, `角色: ${valueOrDash(role)}`, formatMessageSummary(messages)];
  const lines = [header, meta.join(' | '), ''];
  if (messages.length === 0) {
    lines.push('暂无消息。');
    return lines.join('\n');
  }
  messages.forEach((message, index) => {
    lines.push(`[${index + 1}] ${messageRole(message)} ${valueOrDash(messageTime(message))}`);
    const rendered = messageParts(message)
      .map((part) => renderMessagePart(part, { full }))
      .filter(Boolean);
    lines.push(...(rendered.length > 0 ? rendered : ['[空消息]']).map((line) => `  ${line.replace(/\n/g, '\n  ')}`));
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
