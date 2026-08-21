import assert from 'node:assert/strict';
import test from 'node:test';

import { createKeypressParser, parseKeypress, TUI_TABS } from '../../tools/guardian/dashboard-tui-input.mjs';

test('dashboard-tui input maps queue/navigation shortcuts to actions', () => {
  assert.deepEqual(parseKeypress('q'), { type: 'quit' });
  assert.deepEqual(parseKeypress('j'), { type: 'down' });
  assert.deepEqual(parseKeypress('k'), { type: 'up' });
  assert.deepEqual(parseKeypress('\u001b[A'), { type: 'up' });
  assert.deepEqual(parseKeypress('\u001b[B'), { type: 'down' });
  assert.deepEqual(parseKeypress('\r'), { type: 'enter-detail' });
  assert.deepEqual(parseKeypress('\u001b'), { type: 'back-queue' });
});

test('dashboard-tui input maps tabs and refresh helpers', () => {
  assert.deepEqual(parseKeypress('1'), { type: 'switch-tab', tab: TUI_TABS.summary });
  assert.deepEqual(parseKeypress('2'), { type: 'switch-tab', tab: TUI_TABS.transcript });
  assert.deepEqual(parseKeypress('3'), { type: 'switch-tab', tab: TUI_TABS.logs });
  assert.deepEqual(parseKeypress('4'), { type: 'switch-tab', tab: TUI_TABS.artifacts });
  assert.deepEqual(parseKeypress('r'), { type: 'refresh' });
  assert.deepEqual(parseKeypress('a'), { type: 'toggle-auto-refresh' });
  assert.deepEqual(parseKeypress('F'), { type: 'toggle-transcript-full' });
  assert.deepEqual(parseKeypress('G'), { type: 'logs-follow-end' });
  assert.deepEqual(parseKeypress('p'), { type: 'logs-pause-follow' });
});

test('dashboard-tui input buffers split escape sequences until complete', () => {
  const parser = createKeypressParser();
  assert.deepEqual(parser.feed('\u001b'), []);
  assert.deepEqual(parser.feed('['), []);
  assert.deepEqual(parser.feed('A'), [{ type: 'up' }]);
  assert.equal(parser.hasPending(), false);
});

test('dashboard-tui input flushes lone escape as back-queue', () => {
  const parser = createKeypressParser();
  assert.deepEqual(parser.feed('\u001b'), []);
  assert.deepEqual(parser.flush(), [{ type: 'back-queue' }]);
  assert.equal(parser.hasPending(), false);
});

test('dashboard-tui input handles split page-down escape sequences safely', () => {
  const parser = createKeypressParser();
  assert.deepEqual(parser.feed('\u001b['), []);
  assert.deepEqual(parser.feed('6'), []);
  assert.deepEqual(parser.feed('~'), [{ type: 'page-down' }]);
});
