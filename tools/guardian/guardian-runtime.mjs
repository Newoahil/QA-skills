// QA Guardian combined local runtime: one scheduler loop + one Feishu WS client.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadSecrets, requireSecrets } from './secrets.mjs';
import { postIssueComment } from './github-comment.mjs';
import { createFeishuWsRuntime } from './feishu-ws.mjs';
import { resolveRepoDir, runScheduler } from './scheduler.mjs';

function readConfig(repoDir) {
  const file = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(file)) throw new Error(`missing guardian config: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function wsEnabled(env, secrets) {
  if (String(env.FEISHU_WS_ENABLED ?? '').toLowerCase() === 'false') return false;
  return Boolean(secrets.feishu_app_id && secrets.feishu_app_secret);
}

/** Start the combined runtime; injectable pieces make startup behavior testable. */
export async function startGuardianRuntime(options = {}) {
  const repoDir = options.repoDir ?? resolveRepoDir(options.argv, options.env);
  const env = options.env ?? process.env;
  const config = options.config ?? readConfig(repoDir);
  const secrets = options.secrets ?? loadSecrets({ repoDir, env });
  const controller = options.controller ?? new AbortController();
  const seen = options.seen ?? new Set();
  const postComment = options.postComment ?? ((repo, issue, body) =>
    postIssueComment({ repo, issue, body, token: requireSecrets(secrets, ['github_token']).github_token }));

  let wsRuntime = null;
  if (wsEnabled(env, secrets)) {
    const wsSecrets = requireSecrets(secrets, ['feishu_app_id', 'feishu_app_secret', 'github_repo']);
    const wsFactory = options.createFeishuWsRuntime ?? createFeishuWsRuntime;
    wsRuntime = await wsFactory({
      appId: wsSecrets.feishu_app_id,
      appSecret: wsSecrets.feishu_app_secret,
      repo: wsSecrets.github_repo,
      seen,
      postComment,
    });
    wsRuntime.start();
    process.stdout.write('[runtime] Feishu WebSocket started\n');
  } else {
    process.stdout.write('[runtime] Feishu WebSocket disabled (set FEISHU_APP_ID + FEISHU_APP_SECRET to enable)\n');
  }

  const schedulerRunner = options.runScheduler ?? runScheduler;
  const schedulerPromise = schedulerRunner({ repoDir, config, signal: controller.signal });
  const shutdown = async () => {
    controller.abort();
    await wsRuntime?.close?.();
    await schedulerPromise;
  };
  return { repoDir, controller, wsRuntime, schedulerPromise, shutdown };
}

if (process.argv[1]?.endsWith('guardian-runtime.mjs')) {
  const controller = new AbortController();
  let runtime;
  const stop = async () => {
    controller.abort();
    await runtime?.shutdown?.();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, stop);
  startGuardianRuntime({ controller }).then((started) => { runtime = started; }).catch((error) => {
    const message = error instanceof Error ? error.message : 'startup failed';
    process.stderr.write(`[runtime] ${message}\n`);
    process.exit(1);
  });
}
