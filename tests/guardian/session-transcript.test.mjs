import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newState } from '../../tools/guardian/state.mjs';
import { guardianDirFor } from '../../tools/guardian/dashboard-model.mjs';
import {
  fetchTranscript,
  formatMessageSummary,
  formatTranscript,
  renderMessagePart,
  resolveSessionId,
} from '../../tools/guardian/session-transcript.mjs';

test('formatTranscript renders text, tool calls, and Chinese summary', () => {
  const messages = [
    { role: 'user', createdAt: '2026-08-20T10:00:00Z', parts: [{ type: 'text', text: '请处理 issue' }] },
    { role: 'assistant', createdAt: '2026-08-20T10:01:00Z', parts: [{ type: 'tool_use', name: 'read' }, { type: 'text', text: '已读取' }] },
  ];
  const text = formatTranscript(messages, { sessionId: 'ses_1', issue: 42, role: 'fixer' });
  assert.match(text, /会话记录 ses_1/);
  assert.match(text, /议题: #42/);
  assert.match(text, /消息数: 2/);
  assert.match(text, /\[工具调用: read\]/);
});

test('renderMessagePart truncates long text unless full mode is enabled', () => {
  const text = 'x'.repeat(600);
  assert.match(renderMessagePart({ type: 'text', text }), /\.\.\.\(截断\)$/);
  assert.equal(renderMessagePart({ type: 'text', text }, { full: true }).length, 600);
});

test('tool_result is hidden by default and shown in full mode', () => {
  const part = { type: 'tool_result', text: 'result body' };
  assert.equal(renderMessagePart(part), null);
  assert.match(renderMessagePart(part, { full: true }), /工具结果/);
});

test('formatMessageSummary counts roles and timestamp range', () => {
  const summary = formatMessageSummary([
    { role: 'user', createdAt: '2026-08-20T10:00:00Z' },
    { role: 'assistant', createdAt: '2026-08-20T10:02:00Z' },
  ]);
  assert.match(summary, /消息数: 2/);
  assert.match(summary, /user, assistant/);
  assert.match(summary, /2026-08-20T10:00:00Z 至 2026-08-20T10:02:00Z/);
});

test('resolveSessionId finds fixer qa and specialist sessions from Guardian state', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'guardian-session-'));
  const guardianDir = guardianDirFor(repo);
  try {
    mkdirSync(guardianDir, { recursive: true });
    const record = {
      ...newState(77),
      opencode: {
        schema_version: 1,
        fixer: { session_id: 'ses_fixer', agent: 'qa-guardian' },
        qa: { session_id: 'ses_qa', agent: 'qa' },
        specialists: { code: { session_id: 'ses_code', agent: 'guardian-code' } },
        inflight: null,
      },
    };
    writeFileSync(path.join(guardianDir, '77.json'), `${JSON.stringify(record)}\n`, 'utf8');
    assert.deepEqual(resolveSessionId(guardianDir, 77, 'fixer').sessionId, 'ses_fixer');
    assert.deepEqual(resolveSessionId(guardianDir, 77, 'qa').sessionId, 'ses_qa');
    assert.deepEqual(resolveSessionId(guardianDir, 77, 'code').sessionId, 'ses_code');
    assert.equal(resolveSessionId(guardianDir, 77, 'runtime').kind, 'missing-session');
    assert.equal(resolveSessionId(guardianDir, 88, 'qa').kind, 'missing-issue');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('fetchTranscript maps OpenCode client outcomes to transcript or Chinese guidance', async () => {
  const ok = await fetchTranscript('ses_ok', { clientFactory: () => ({ getMessages: async () => ({ kind: 'ok', messages: [{ role: 'assistant' }] }) }) });
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.messages.length, 1);

  const missing = await fetchTranscript('ses_missing', { clientFactory: () => ({ getMessages: async () => ({ kind: 'unusable-session' }) }) });
  assert.equal(missing.kind, 'error');
  assert.match(missing.error, /问题: 会话 ses_missing 不存在/);

  const retryable = await fetchTranscript('ses_retry', { baseUrl: 'http://127.0.0.1:3000', clientFactory: () => ({ getMessages: async () => ({ kind: 'retryable' }) }) });
  assert.equal(retryable.kind, 'error');
  assert.match(retryable.error, /无法连接 OpenCode 服务/);
});
