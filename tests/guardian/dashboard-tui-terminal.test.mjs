import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerminalSession } from '../../tools/guardian/dashboard-tui-terminal.mjs';

test('dashboard-tui terminal enters alternate screen and restores raw mode', () => {
  const writes = [];
  const rawModes = [];
  const stdin = {
    setRawMode(value) { rawModes.push(value); },
    resume() {},
    pause() {},
  };
  const stdout = {
    columns: 120,
    rows: 30,
    write(text) { writes.push(text); },
  };
  const terminal = createTerminalSession({ stdin, stdout });
  terminal.enter();
  terminal.render('frame');
  terminal.restore();
  assert.deepEqual(rawModes, [true, false]);
  assert.match(writes[0], /\?1049h/);
  assert.match(writes[1], /\u001b\[Hframe/);
  assert.match(writes[2], /\?1049l/);
});
