import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventBuffer, eventMatchesSessions, eventSessionId, mapEventToLine } from '../../tools/guardian/dashboard-tui-events.mjs';

const NOW = Date.parse('2026-08-21T03:00:00Z');

test('mapEventToLine renders tool part progress from message.part.updated', () => {
  const line = mapEventToLine({
    type: 'message.part.updated',
    properties: { part: { type: 'tool', tool: 'grep', sessionID: 'ses_a', state: { status: 'running', title: 'find field', input: { pattern: 'badDebtReserves' } } } },
  }, NOW);
  assert.match(line, /工具 grep \(running\)/);
  assert.match(line, /find field/);
  assert.match(line, /badDebtReserves/);
});

test('mapEventToLine renders text parts and session lifecycle events', () => {
  assert.match(mapEventToLine({ type: 'message.part.updated', properties: { part: { type: 'text', text: '根因定位到状态分支' } } }, NOW), /文本 根因定位到状态分支/);
  assert.match(mapEventToLine({ type: 'session.idle', properties: { sessionID: 'ses_a' } }, NOW), /会话空闲/);
  assert.match(mapEventToLine({ type: 'session.error', properties: { error: { message: 'boom' } } }, NOW), /会话错误 boom/);
});

test('mapEventToLine supports the v2 payload envelope and returns null for noise', () => {
  assert.match(mapEventToLine({ type: 'message.part.delta', payload: { field: 'text', delta: 'hello' } }, NOW), /文本 hello/);
  assert.equal(mapEventToLine({ type: 'installation.updated', properties: {} }, NOW), null);
  assert.equal(mapEventToLine({ type: 'message.part.updated', properties: { part: { type: 'text', text: '   ' } } }, NOW), null);
});

test('eventSessionId reads session id from part/info/direct shapes', () => {
  assert.equal(eventSessionId({ properties: { sessionID: 'ses_direct' } }), 'ses_direct');
  assert.equal(eventSessionId({ properties: { part: { sessionID: 'ses_part' } } }), 'ses_part');
  assert.equal(eventSessionId({ properties: { info: { sessionID: 'ses_info' } } }), 'ses_info');
  assert.equal(eventSessionId({ properties: { info: { id: 'ses_id' } } }), 'ses_id');
  assert.equal(eventSessionId({ properties: {} }), null);
});

test('eventMatchesSessions filters by session ids but always keeps server-level events', () => {
  const toolEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'ses_a' } } };
  assert.equal(eventMatchesSessions(toolEvent, ['ses_a']), true);
  assert.equal(eventMatchesSessions(toolEvent, ['ses_b']), false);
  assert.equal(eventMatchesSessions(toolEvent, []), true); // no filter → accept all
  // A server-level event with no session id is always relevant.
  assert.equal(eventMatchesSessions({ type: 'server.connected', properties: {} }, ['ses_a']), true);
});

test('createEventBuffer keeps a bounded FIFO of lines', () => {
  const buffer = createEventBuffer(3);
  buffer.push('a');
  buffer.push('b');
  buffer.push(null); // ignored
  buffer.push('c');
  buffer.push('d');
  assert.deepEqual(buffer.lines(), ['b', 'c', 'd']);
  assert.equal(buffer.size, 3);
  buffer.clear();
  assert.deepEqual(buffer.lines(), []);
});
