// QA Guardian combined local runtime: one scheduler loop + one Feishu WS client.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { createLogger, printStartupBanner, readJsonFile } from './runtime-io.mjs';

import { loadSecrets, requireSecrets } from './secrets.mjs';
import { postIssueComment } from './github-comment.mjs';
import { createFeishuWsRuntime } from './feishu-ws.mjs';
import { createFeishuAuthorizer } from './feishu-identity.mjs';
import { resolveRepoDir, runScheduler } from './scheduler.mjs';
import { ACTORS, EFFECTS } from './actor-routing.mjs';

function readConfig(repoDir) {
  const file = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(file)) throw new Error(`missing guardian config: ${file}`);
  return readJsonFile(file);
}

function wsEnabled(env, secrets) {
  if (String(env.FEISHU_WS_ENABLED ?? '').toLowerCase() === 'false') return false;
  return Boolean(secrets.feishu_app_id && secrets.feishu_app_secret);
}

/** Start the combined runtime; injectable pieces make startup behavior testable. */
export async function startGuardianRuntime(options = {}) {
  const repoDir = options.repoDir ?? resolveRepoDir(options.argv, options.env);
  const env = options.env ?? process.env;
  const logger = options.logger ?? createLogger({ component: 'runtime' });
  const config = options.config ?? readConfig(repoDir);
  const runtimeConfig = config.qa_runtime_dir || env.QA_GUARDIAN_QA_RUNTIME_DIR
    ? { ...config, qa_runtime_dir: config.qa_runtime_dir ?? env.QA_GUARDIAN_QA_RUNTIME_DIR }
    : config;
  const secrets = options.secrets ?? loadSecrets({ repoDir, env });
  const controller = options.controller ?? new AbortController();
  const seen = options.seen ?? new Set();
  const postComment = options.postComment ?? ((repo, issue, body) =>
    postIssueComment({ actor: ACTORS.HUMAN_AUTHORIZER, effect: EFFECTS.AUTHORIZE, repo, issue, body, token: requireSecrets(secrets, ['github_token']).github_token }));
  const authorize = options.authorize ?? createFeishuAuthorizer({
    feishuAuthorizers: config.feishu_authorizers ?? null,
    commandAuthors: config.command_authors ?? [],
  });

  printStartupBanner({ env });
  logger.info('startup.begin', { repo_dir: repoDir });

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
      authorize,
    });
    wsRuntime.start();
    logger.info('ws.started', { enabled: true });
  } else {
    logger.info('ws.disabled', { enabled: false });
  }

  const schedulerRunner = options.runScheduler ?? runScheduler;
  const schedulerPromise = schedulerRunner({ repoDir, config: runtimeConfig, signal: controller.signal });
  logger.info('scheduler.starting', { repo_dir: repoDir });
  const shutdown = async () => {
    controller.abort();
    await wsRuntime?.close?.();
    await schedulerPromise;
  };
  logger.info('startup.ready', { ws_enabled: Boolean(wsRuntime) });
  return { repoDir, controller, wsRuntime, schedulerPromise, shutdown };
}

/**
 * Build a signal handler that stops the combined runtime PROMPTLY on Ctrl+C.
 *
 * The naive handler (`await runtime.shutdown()` then exit) blocks the process until the current
 * scheduler tick unwinds — and a tick can be mid-investigation for minutes (specialist prompts have
 * a 30-minute deadline). During that window Ctrl+C appears to do nothing and the log keeps printing.
 * This stopper fixes that: the FIRST signal aborts cooperatively and races a bounded shutdown, then
 * exits regardless of whether the in-flight tick has fully unwound; a SECOND signal force-exits.
 */
export function createSignalStopper({
  controller,
  getRuntime,
  exit = (code) => process.exit(code),
  logger = createLogger({ component: 'runtime' }),
  timeoutMs = 8000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let stopping = false;
  return async function handleSignal(signal) {
    if (stopping) {
      logger.warn('shutdown.force', { signal: signal ?? null });
      exit(1);
      return;
    }
    stopping = true;
    logger.info('shutdown.begin', { signal: signal ?? null, timeout_ms: timeoutMs });
    controller.abort();
    const runtime = typeof getRuntime === 'function' ? getRuntime() : undefined;
    let timer = null;
    const bounded = new Promise((resolve) => { timer = setTimeoutFn(() => resolve('timeout'), timeoutMs); });
    if (timer && typeof timer.unref === 'function') timer.unref();
    const graceful = Promise.resolve()
      .then(() => runtime?.shutdown?.())
      .then(() => 'graceful', () => 'graceful');
    const outcome = await Promise.race([graceful, bounded]);
    clearTimeoutFn(timer);
    logger.info('shutdown.done', { outcome });
    exit(0);
  };
}

if (process.argv[1]?.endsWith('guardian-runtime.mjs')) {
  const controller = new AbortController();
  let runtime;
  const stop = createSignalStopper({ controller, getRuntime: () => runtime });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(sig); });
  startGuardianRuntime({ controller }).then((started) => { runtime = started; }).catch((error) => {
    const message = error instanceof Error ? error.message : 'startup failed';
    createLogger({ component: 'runtime' }).error('startup.failed', { error_message: message });
    process.exit(1);
  });
}
