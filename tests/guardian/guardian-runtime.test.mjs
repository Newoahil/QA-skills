import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignalStopper, startGuardianRuntime } from '../../tools/guardian/guardian-runtime.mjs';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

test('runtime starts scheduler once and skips WS when explicitly disabled', async () => {
  let schedulerStarts = 0;
  let wsStarts = 0;
  const controller = new AbortController();
  const scheduler = async () => {
    schedulerStarts += 1;
    await new Promise((resolve) => controller.signal.addEventListener('abort', resolve, { once: true }));
  };
  const runtime = await startGuardianRuntime({
    repoDir: 'D:/repo',
    env: { FEISHU_WS_ENABLED: 'false' },
    config: {},
    secrets: { github_token: 't', github_repo: 'o/r' },
    controller,
    runScheduler: scheduler,
  });
  assert.equal(schedulerStarts, 1);
  assert.equal(runtime.wsRuntime, null);
  controller.abort();
  await runtime.shutdown();
});

test('runtime starts one injected WS runtime and one scheduler', async () => {
  let schedulerStarts = 0;
  let wsStarts = 0;
  let wsClosed = 0;
  const controller = new AbortController();
  const scheduler = async () => {
    schedulerStarts += 1;
    await new Promise((resolve) => controller.signal.addEventListener('abort', resolve, { once: true }));
  };
  const wsFactory = async () => ({
    start() { wsStarts += 1; },
    async close() { wsClosed += 1; },
  });
  const runtime = await startGuardianRuntime({
    repoDir: 'D:/repo',
    env: { FEISHU_WS_ENABLED: 'true' },
    config: {},
    secrets: { feishu_app_id: 'a', feishu_app_secret: 's', github_token: 't', github_repo: 'o/r' },
    controller,
    runScheduler: scheduler,
    createFeishuWsRuntime: wsFactory,
  });
  assert.equal(schedulerStarts, 1);
  assert.equal(wsStarts, 1);
  controller.abort();
  await runtime.shutdown();
  assert.equal(wsClosed, 1);
});

test('Ctrl+C aborts cooperatively and exits after a graceful shutdown', async () => {
  const controller = new AbortController();
  let shutdownCalls = 0;
  const exits = [];
  const stop = createSignalStopper({
    controller,
    getRuntime: () => ({ shutdown: async () => { shutdownCalls += 1; } }),
    exit: (code) => exits.push(code),
    logger: silentLogger,
    timeoutMs: 8000,
  });
  await stop('SIGINT');
  assert.equal(controller.signal.aborted, true);
  assert.equal(shutdownCalls, 1);
  assert.deepEqual(exits, [0]);
});

test('Ctrl+C exits within the bound even when shutdown hangs', async () => {
  const controller = new AbortController();
  const exits = [];
  const scheduledDelays = [];
  const stop = createSignalStopper({
    controller,
    // shutdown never resolves (mimics a mid-investigation tick that will not unwind promptly)
    getRuntime: () => ({ shutdown: () => new Promise(() => {}) }),
    exit: (code) => exits.push(code),
    logger: silentLogger,
    timeoutMs: 8000,
    // fire the bounded timer synchronously so the race resolves via timeout
    setTimeoutFn: (fn, ms) => { scheduledDelays.push(ms); fn(); return { unref() {} }; },
    clearTimeoutFn: () => {},
  });
  await stop('SIGINT');
  assert.deepEqual(scheduledDelays, [8000]);
  assert.deepEqual(exits, [0]);
});

test('a second Ctrl+C force-exits immediately', async () => {
  const controller = new AbortController();
  const exits = [];
  let releaseShutdown;
  const stop = createSignalStopper({
    controller,
    getRuntime: () => ({ shutdown: () => new Promise((resolve) => { releaseShutdown = resolve; }) }),
    exit: (code) => exits.push(code),
    logger: silentLogger,
    timeoutMs: 8000,
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
  });
  const first = stop('SIGINT'); // enters stopping state, awaits the hanging shutdown
  await stop('SIGINT'); // second signal while stopping -> force exit
  assert.deepEqual(exits, [1]);
  releaseShutdown?.();
  await first;
});
