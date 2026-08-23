import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { runDashboardTuiCli, tuiUsage } from '../../tools/guardian/dashboard-tui.mjs';

function makeWriter() {
  const chunks = [];
  return {
    chunks,
    write(text) { chunks.push(text); },
    toString() { return chunks.join(''); },
  };
}

async function flushMicrotasks(turns = 1) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

async function waitFor(predicate, turns = 20) {
  for (let index = 0; index < turns; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
}

test('dashboard-tui CLI prints help without requiring a TTY', async () => {
  const stdout = makeWriter();
  const stderr = makeWriter();
  const code = await runDashboardTuiCli(['--help'], {
    stdin: { isTTY: false },
    stdout: { ...stdout, isTTY: false },
    stderr,
  });
  assert.equal(code, 0);
  assert.match(stdout.toString(), /单终端只读 TUI/);
});

test('dashboard-tui CLI rejects non-TTY interactive runs with Chinese guidance', async () => {
  const stdout = makeWriter();
  const stderr = makeWriter();
  const code = await runDashboardTuiCli(['--repo', 'D:/repo'], {
    stdin: { isTTY: false },
    stdout: { ...stdout, isTTY: false },
    stderr,
  });
  assert.equal(code, 2);
  assert.match(stderr.toString(), /需要交互式 TTY/);
});

test('dashboard-tui CLI usage text includes readonly safety note', () => {
  assert.match(tuiUsage(), /只读查看/);
  assert.match(tuiUsage(), /resolveViewerRepo/);
});

test('dashboard-tui CLI restores terminal state when initial refresh fails after enter', async () => {
  const stdout = makeWriter();
  stdout.isTTY = true;
  stdout.on = () => {};
  stdout.removeListener = () => {};
  stdout.columns = 120;
  stdout.rows = 30;

  const stdin = {
    isTTY: true,
    on() {},
    removeListener() {},
    setRawMode() {},
    resume() {},
    pause() {},
  };

  const stderr = makeWriter();
  const calls = [];
  const terminal = {
    enter() { calls.push('enter'); },
    render() { calls.push('render'); },
    restore() { calls.push('restore'); },
    viewport() { return { columns: 120, rows: 30 }; },
  };

  await assert.rejects(
    runDashboardTuiCli(['--repo', 'D:/repo'], {
      stdin,
      stdout,
      stderr,
      snapshotLoader: async () => { throw new Error('boom'); },
      terminalFactory: () => terminal,
    }),
    /boom/,
  );

  assert.deepEqual(calls, ['enter', 'render', 'restore']);
  assert.equal(stderr.toString(), '');
});

test('dashboard-tui CLI serializes input-triggered refreshes so rapid key events do not overlap', async () => {
  const stdout = makeWriter();
  stdout.isTTY = true;
  stdout.columns = 120;
  stdout.rows = 30;
  stdout.on = () => {};
  stdout.removeListener = () => {};

  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};

  let terminalRestored = false;
  const intervals = [];
  const terminal = {
    enter() {},
    render() {},
    restore() { terminalRestored = true; },
    viewport() { return { columns: 120, rows: 30 }; },
  };

  const refreshResolvers = [];
  const refreshStarts = [];
  const refreshFinishes = [];
  let refreshCount = 0;
  const cliPromise = runDashboardTuiCli(['--repo', 'D:/repo'], {
    stdin,
    stdout,
    stderr: makeWriter(),
    snapshotLoader: () => {
      refreshCount += 1;
      const current = refreshCount;
      refreshStarts.push(current);
      return new Promise((resolve) => {
        refreshResolvers.push(() => {
          refreshFinishes.push(current);
          resolve({
            kind: 'ok',
            repoDir: 'D:/repo',
            now: Date.now(),
            records: [{ issue: 1, state: 'FIXING', risk: 'LOW', branch: 'fix/issue-1' }],
            selectedIssue: 1,
            selectedIndex: 0,
            detailLines: ['detail'],
            contextLines: ['context'],
          });
        });
      });
    },
    terminalFactory: () => terminal,
    setIntervalImpl(callback, delay) {
      const handle = { callback, delay };
      intervals.push(handle);
      return handle;
    },
    clearIntervalImpl(handle) {
      const index = intervals.indexOf(handle);
      if (index >= 0) intervals.splice(index, 1);
    },
  });

  await flushMicrotasks();
  assert.equal(refreshStarts.length, 1);
  stdin.emit('data', 'r');
  stdin.emit('data', 'q');
  assert.equal(refreshStarts.length, 1);

  const initialRefresh = refreshResolvers.shift();
  assert.ok(initialRefresh);
  initialRefresh();
  await waitFor(() => refreshResolvers.length > 0);

  assert.equal(refreshStarts[0], 1);
  assert(refreshStarts.length >= 1);
  assert.equal(refreshFinishes[0], 1);
  assert.equal(refreshFinishes.length, 1);

  const secondRefresh = refreshResolvers.shift();
  assert.ok(secondRefresh);
  secondRefresh();
  await flushMicrotasks(2);

  assert.equal(refreshStarts[0], 1);
  assert.equal(refreshStarts[1], 2);
  assert.equal(refreshStarts.length, 2);
  assert.equal(refreshFinishes[0], 1);
  assert.equal(refreshFinishes[1], 2);
  assert.equal(refreshFinishes.length, 2);

  const exitCode = await cliPromise;
  assert.equal(exitCode, 0);
  assert.equal(terminalRestored, true);
  assert.equal(intervals.length, 0);
  assert.deepEqual(refreshStarts, [1, 2]);
  assert.deepEqual(refreshFinishes, [1, 2]);
});

test('dashboard-tui CLI restores terminal and rejects when input-triggered refresh fails', async () => {
  const stdout = makeWriter();
  stdout.isTTY = true;
  stdout.columns = 120;
  stdout.rows = 30;
  stdout.on = () => {};
  stdout.removeListener = () => {};

  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};

  const terminalCalls = [];
  const intervals = [];
  const terminal = {
    enter() { terminalCalls.push('enter'); },
    render() { terminalCalls.push('render'); },
    restore() { terminalCalls.push('restore'); },
    viewport() { return { columns: 120, rows: 30 }; },
  };

  let refreshCount = 0;
  const cliPromise = runDashboardTuiCli(['--repo', 'D:/repo'], {
    stdin,
    stdout,
    stderr: makeWriter(),
    snapshotLoader: async () => {
      refreshCount += 1;
      if (refreshCount === 1) {
        return {
          kind: 'ok',
          repoDir: 'D:/repo',
          now: Date.now(),
          records: [{ issue: 1, state: 'FIXING', risk: 'LOW', branch: 'fix/issue-1' }],
          selectedIssue: 1,
          selectedIndex: 0,
          detailLines: ['detail'],
          contextLines: ['context'],
        };
      }
      throw new Error('refresh exploded');
    },
    terminalFactory: () => terminal,
    setIntervalImpl(callback, delay) {
      const handle = { callback, delay };
      intervals.push(handle);
      return handle;
    },
    clearIntervalImpl(handle) {
      const index = intervals.indexOf(handle);
      if (index >= 0) intervals.splice(index, 1);
    },
  });

  await Promise.resolve();
  stdin.emit('data', 'r');

  await assert.rejects(cliPromise, /refresh exploded/);
  assert.deepEqual(terminalCalls, ['enter', 'render', 'render', 'render', 'render', 'restore']);
  assert.equal(intervals.length, 0);
});

test('dashboard-tui CLI stops same-chunk actions after quit cleanup', async () => {
  const stdout = makeWriter();
  stdout.isTTY = true;
  stdout.columns = 120;
  stdout.rows = 30;
  stdout.on = () => {};
  stdout.removeListener = () => {};

  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};

  let restoreCount = 0;
  let refreshCount = 0;
  let renderCount = 0;
  const terminal = {
    enter() {},
    render() { renderCount += 1; },
    restore() { restoreCount += 1; },
    viewport() { return { columns: 120, rows: 30 }; },
  };

  const cliPromise = runDashboardTuiCli(['--repo', 'D:/repo'], {
    stdin,
    stdout,
    stderr: makeWriter(),
    snapshotLoader: async () => {
      refreshCount += 1;
      return {
        kind: 'ok',
        repoDir: 'D:/repo',
        now: Date.now(),
        records: [{ issue: 1, state: 'FIXING', risk: 'LOW', branch: 'fix/issue-1' }],
        selectedIssue: 1,
        selectedIndex: 0,
        detailLines: ['detail'],
        contextLines: ['context'],
      };
    },
    terminalFactory: () => terminal,
    setIntervalImpl() {
      throw new Error('auto-refresh should not be installed in this test');
    },
    clearIntervalImpl() {},
  });

  await flushMicrotasks();
  assert.equal(refreshCount, 1);
  assert.equal(renderCount, 2);

  stdin.emit('data', 'qr');

  const exitCode = await cliPromise;
  assert.equal(exitCode, 0);
  assert.equal(restoreCount, 1);
  assert.equal(refreshCount, 1);
  assert.equal(renderCount, 2);
});

test('dashboard-tui CLI streams live specialist events from the shared server into the buffer', async () => {
  const stdout = makeWriter();
  stdout.isTTY = true;
  stdout.columns = 120;
  stdout.rows = 30;
  stdout.on = () => {};
  stdout.removeListener = () => {};

  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};

  const terminal = {
    enter() {},
    render() {},
    restore() {},
    viewport() { return { columns: 120, rows: 30 }; },
  };

  // Snapshot exposes the selected issue's specialist session id so the subscriber's filter matches.
  const record = {
    issue: 205,
    state: 'INVESTIGATING',
    opencode: { schema_version: 1, fixer: null, qa: null, specialists: { 'guardian-code': { session_id: 'ses_code', role: 'guardian-code' } }, inflight: null },
  };
  const liveSeen = [];
  const snapshotLoader = async ({ liveLines }) => {
    if (Array.isArray(liveLines)) liveSeen.push(liveLines.slice());
    return {
      kind: 'ok', repoDir: 'D:/repo', now: Date.now(),
      records: [record], selectedIssue: 205, selectedIndex: 0,
      detailLines: ['detail'], contextLines: liveLines ?? ['context'], record,
    };
  };

  // A small delay before the first event lets the '5' keypress switch to the live tab first, so the
  // event deterministically triggers a live snapshot rebuild. The stream then idles until cleanup.
  let stopStream = () => {};
  async function* toolEvents() {
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield { type: 'message.part.updated', properties: { part: { type: 'tool', tool: 'grep', sessionID: 'ses_code', state: { status: 'running', input: { pattern: 'x' } } } } };
    await new Promise((resolve) => { stopStream = resolve; });
  }
  const eventClientFactory = () => ({
    subscribeEvents: async () => ({ kind: 'ok', stream: toolEvents(), cancel: () => { stopStream(); } }),
  });

  const cliPromise = runDashboardTuiCli(['--repo', 'D:/repo', '--base-url', 'http://127.0.0.1:4096'], {
    stdin,
    stdout,
    stderr: makeWriter(),
    snapshotLoader,
    terminalFactory: () => terminal,
    eventClientFactory,
    eventReconnectMs: 10_000,
    setIntervalImpl() { return { id: 1 }; },
    clearIntervalImpl() {},
  });

  // Switch to the live tab (5) so an incoming event triggers a snapshot rebuild that surfaces it.
  stdin.emit('data', '5');
  // The event stream yields after a real 20ms delay; poll real time until the mapped line lands.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !liveSeen.some((lines) => lines.some((l) => /工具 grep/.test(l)))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  stdin.emit('data', 'q');
  const exitCode = await cliPromise;
  assert.equal(exitCode, 0);
  assert.ok(liveSeen.some((lines) => lines.some((l) => /工具 grep \(running\)/.test(l))), 'live buffer should contain the mapped tool event');
});

test('dashboard-tui CLI coalesces live event burst refreshes', async () => {
  const stdout = makeWriter();
  stdout.isTTY = true;
  stdout.columns = 120;
  stdout.rows = 30;
  stdout.on = () => {};
  stdout.removeListener = () => {};

  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};

  const terminal = {
    enter() {},
    render() {},
    restore() {},
    viewport() { return { columns: 120, rows: 30 }; },
  };
  const record = {
    issue: 205,
    state: 'INVESTIGATING',
    opencode: { schema_version: 1, fixer: null, qa: null, specialists: { 'guardian-code': { session_id: 'ses_code', role: 'guardian-code' } }, inflight: null },
  };
  let refreshCount = 0;
  const liveSeen = [];
  const snapshotLoader = async ({ liveLines }) => {
    refreshCount += 1;
    if (Array.isArray(liveLines)) liveSeen.push(liveLines.slice());
    return {
      kind: 'ok', repoDir: 'D:/repo', now: Date.now(),
      records: [record], selectedIssue: 205, selectedIndex: 0,
      detailLines: ['detail'], contextLines: liveLines ?? ['context'], record,
    };
  };

  let releaseBurst;
  const burstReady = new Promise((resolve) => { releaseBurst = resolve; });
  let stopStream = () => {};
  async function* burstEvents() {
    await burstReady;
    for (let index = 0; index < 20; index += 1) {
      yield { type: 'message.part.updated', properties: { part: { type: 'tool', tool: 'grep', sessionID: 'ses_code', state: { status: 'running', input: { pattern: `x-${index}` } } } } };
    }
    await new Promise((resolve) => { stopStream = resolve; });
  }
  const eventClientFactory = () => ({
    subscribeEvents: async () => ({ kind: 'ok', stream: burstEvents(), cancel: () => { stopStream(); } }),
  });

  const cliPromise = runDashboardTuiCli(['--repo', 'D:/repo', '--base-url', 'http://127.0.0.1:4096'], {
    stdin,
    stdout,
    stderr: makeWriter(),
    snapshotLoader,
    terminalFactory: () => terminal,
    eventClientFactory,
    eventReconnectMs: 10_000,
    setIntervalImpl() { return { id: 1 }; },
    clearIntervalImpl() {},
  });

  await waitFor(() => refreshCount === 1);
  stdin.emit('data', '5');
  await waitFor(() => refreshCount === 2);
  releaseBurst();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(refreshCount, 3, 'initial + tab selection + one coalesced live refresh');
  assert.ok(liveSeen.some((lines) => lines.length >= 20), 'coalesced live refresh should include the full burst buffer');
  stdin.emit('data', 'q');
  const exitCode = await cliPromise;
  assert.equal(exitCode, 0);
});
