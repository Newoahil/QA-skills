import assert from 'node:assert/strict';
import test from 'node:test';

import { startGuardianRuntime } from '../../tools/guardian/guardian-runtime.mjs';

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
