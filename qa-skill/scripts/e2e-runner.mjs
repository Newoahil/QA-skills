import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({
  totalTimeoutMs: 600_000,
  readyTimeoutMs: 180_000,
  testTimeoutMs: 420_000,
  cleanupTimeoutMs: 30_000,
  heartbeatMs: 20_000,
  connectTimeoutMs: 1_000,
});

const RESULT_START = 'E2E_RUN_RESULT';
const RESULT_END = 'END_E2E_RUN_RESULT';
const PHASES = Object.freeze([
  'preflight',
  'starting_server',
  'waiting_ready',
  'running_test',
  'cleanup',
  'complete',
]);

class AbortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AbortError';
  }
}

function createTimeout(ms) {
  let timer = null;
  let settled = false;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => {
      settled = true;
      resolve();
    }, ms);
  });
  return {
    promise,
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      settled = true;
    },
    get settled() {
      return settled;
    },
  };
}

function abortErrorFromSignal(signal) {
  const reason = signal?.reason;
  const message = reason instanceof Error ? reason.message : String(reason ?? 'Runner interrupted');
  return new AbortError(message);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortErrorFromSignal(signal);
}

async function delay(ms, signal) {
  throwIfAborted(signal);
  const timeout = createTimeout(ms);
  const onAbort = () => {
    timeout.cancel();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await timeout.promise;
    throwIfAborted(signal);
  } finally {
    timeout.cancel();
    signal?.removeEventListener('abort', onAbort);
  }
}

function toPositiveInt(value, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeEnv(env) {
  const normalized = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value == null) continue;
    normalized[String(key)] = String(value);
  }
  return normalized;
}

function parseReadyPort(ready) {
  if (!ready) return null;
  if (ready.port != null) {
    if (!Number.isInteger(ready.port) || ready.port <= 0 || ready.port > 65535) {
      throw new Error('ready.port must be an integer between 1 and 65535');
    }
    return ready.port;
  }
  if (!ready.url) return null;
  const parsed = new URL(ready.url);
  if (parsed.port) return Number(parsed.port);
  if (parsed.protocol === 'http:') return 80;
  if (parsed.protocol === 'https:') return 443;
  throw new Error('ready.url must include a port or use http/https default ports');
}

function validateCommandConfig(name, commandConfig) {
  if (!commandConfig || typeof commandConfig !== 'object') {
    throw new Error(`${name} must be an object`);
  }
  if (!commandConfig.command || typeof commandConfig.command !== 'string') {
    throw new Error(`${name}.command must be a non-empty string`);
  }
  if (commandConfig.args != null && !Array.isArray(commandConfig.args)) {
    throw new Error(`${name}.args must be an array when present`);
  }
}

function defaultShellForCommand(command) {
  if (process.platform !== 'win32') return false;
  const normalized = String(command).trim().toLowerCase();
  return /(^|[\\/])(npm|pnpm|yarn|npx|bun)(\.cmd|\.exe)?$/.test(normalized);
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('config must be an object');
  }
  if (!rawConfig.cwd || typeof rawConfig.cwd !== 'string') {
    throw new Error('config.cwd must be a non-empty string');
  }

  const config = {
    cwd: rawConfig.cwd,
    start: rawConfig.start,
    ready: rawConfig.ready,
    test: rawConfig.test,
    totalTimeoutMs: toPositiveInt(rawConfig.totalTimeoutMs, DEFAULTS.totalTimeoutMs, 'totalTimeoutMs'),
    cleanupTimeoutMs: toPositiveInt(rawConfig.cleanupTimeoutMs, DEFAULTS.cleanupTimeoutMs, 'cleanupTimeoutMs'),
    heartbeatMs: toPositiveInt(rawConfig.heartbeatMs, DEFAULTS.heartbeatMs, 'heartbeatMs'),
  };

  if (!config.test) throw new Error('config.test is required');
  validateCommandConfig('test', config.test);
  config.test = {
    command: config.test.command,
    args: Array.isArray(config.test.args) ? config.test.args.map(String) : [],
    env: normalizeEnv(config.test.env),
    shell: config.test.shell ?? defaultShellForCommand(config.test.command),
    timeoutMs: toPositiveInt(config.test.timeoutMs, DEFAULTS.testTimeoutMs, 'test.timeoutMs'),
  };

  if (config.start != null) {
    validateCommandConfig('start', config.start);
    config.start = {
      command: config.start.command,
      args: Array.isArray(config.start.args) ? config.start.args.map(String) : [],
      env: normalizeEnv(config.start.env),
      shell: config.start.shell ?? defaultShellForCommand(config.start.command),
    };
  }

  if (config.ready != null) {
    if (typeof config.ready !== 'object') throw new Error('ready must be an object');
    config.ready = {
      url: config.ready.url ?? null,
      port: config.ready.port ?? null,
      allowExisting: config.ready.allowExisting === true,
      timeoutMs: toPositiveInt(config.ready.timeoutMs, DEFAULTS.readyTimeoutMs, 'ready.timeoutMs'),
      pollMs: toPositiveInt(config.ready.pollMs, 1_000, 'ready.pollMs'),
    };
  }

  const readyPort = parseReadyPort(config.ready);

  if (config.start && !config.ready) {
    throw new Error('start requires ready with url or port');
  }
  if (config.start && !config.ready?.url && config.ready?.port == null) {
    throw new Error('start requires ready.url or ready.port');
  }
  if (!config.start && config.ready && config.ready.allowExisting !== true) {
    throw new Error('ready.allowExisting must be true when connecting to an existing service without start');
  }

  return { ...config, readyPort };
}

function createLineForwarder(write) {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex).replace(/\r$/, '');
        write(line);
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf('\n');
      }
    },
    flush() {
      if (pending.length > 0) {
        write(pending.replace(/\r$/, ''));
        pending = '';
      }
    },
  };
}

function defaultLogger(line) {
  process.stdout.write(`${line}\n`);
}

function defaultErrorLogger(line) {
  process.stderr.write(`${line}\n`);
}

function isRunnableFile() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('e2e-runner.mjs');
  } catch {
    return process.argv[1].endsWith('e2e-runner.mjs');
  }
}

async function isPortOpen(port, host = '127.0.0.1', timeoutMs = DEFAULTS.connectTimeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function waitForPortReady({ port, timeoutMs, pollMs, deadlineAt, signal, onCheckAbort }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs && Date.now() < deadlineAt) {
    throwIfAborted(signal);
    onCheckAbort?.();
    if (await isPortOpen(port)) return { ok: true };
    await delay(Math.min(pollMs, Math.max(1, deadlineAt - Date.now())), signal);
  }
  throwIfAborted(signal);
  onCheckAbort?.();
  return { ok: false, reason: 'Timed out waiting for ready port' };
}

async function waitForUrlReady({ url, timeoutMs, pollMs, deadlineAt, signal, onCheckAbort }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs && Date.now() < deadlineAt) {
    throwIfAborted(signal);
    onCheckAbort?.();
    const controller = new AbortController();
    const timeout = createTimeout(Math.min(DEFAULTS.connectTimeoutMs, Math.max(100, pollMs)));
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timeout.promise.then(() => controller.abort()).catch(() => {});
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status < 500) {
        await response.body?.cancel?.();
        return { ok: true, status: response.status };
      }
      await response.body?.cancel?.();
    } catch {
      // Keep polling.
    } finally {
      timeout.cancel();
      signal?.removeEventListener('abort', onAbort);
    }
    await delay(Math.min(pollMs, Math.max(1, deadlineAt - Date.now())), signal);
  }
  throwIfAborted(signal);
  onCheckAbort?.();
  return { ok: false, reason: 'Timed out waiting for ready URL' };
}

function spawnManagedProcess(commandConfig, cwd, prefix, output) {
  const child = spawn(commandConfig.command, commandConfig.args, {
    cwd,
    env: { ...process.env, ...commandConfig.env },
    shell: commandConfig.shell,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutForwarder = createLineForwarder((line) => output.log(`[${prefix}] ${line}`));
  const stderrForwarder = createLineForwarder((line) => output.error(`[${prefix}] ${line}`));

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => stdoutForwarder.push(chunk));
  child.stderr?.on('data', (chunk) => stderrForwarder.push(chunk));
  child.stdout?.on('end', () => stdoutForwarder.flush());
  child.stderr?.on('end', () => stderrForwarder.flush());

  return child;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    let exit = null;
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      exit = { code, signal };
    });
    child.once('close', (code, signal) => {
      resolve(exit ?? { code, signal });
    });
  });
}

async function waitForObservedExit(child, timeoutMs = 1_000) {
  if (!child) return Promise.resolve();
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  const timeout = createTimeout(timeoutMs);
  try {
    await Promise.race([
      new Promise((resolve) => child.once('close', () => resolve())),
      timeout.promise,
    ]);
  } finally {
    timeout.cancel();
  }
}

async function waitForExitWithTimeout(child, timeoutMs, signal) {
  throwIfAborted(signal);
  const timeout = createTimeout(timeoutMs);
  const exitPromise = waitForExit(child).then((value) => ({ type: 'exit', value }));
  const timeoutPromise = timeout.promise.then(() => ({ type: 'timeout' }));
  let onAbort = null;
  const abortPromise = signal
    ? new Promise((resolve) => {
      onAbort = () => resolve({ type: 'abort', error: abortErrorFromSignal(signal) });
      signal.addEventListener('abort', onAbort, { once: true });
    })
    : null;

  try {
    const winner = await Promise.race([exitPromise, timeoutPromise, abortPromise].filter(Boolean));
    if (winner.type === 'abort') throw winner.error;
    if (winner.type === 'timeout') return { timeout: true };
    return winner.value;
  } finally {
    timeout.cancel();
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function killProcessTree(pid, timeoutMs) {
  if (!pid || pid <= 0) return { attempted: false, killed: true };
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const alreadyGone = /not found|no running instance|process .* could not be terminated/i.test(`${stdout}\n${stderr}`);
    return {
      attempted: true,
      killed: result.status === 0 || alreadyGone,
      method: 'taskkill',
      exitCode: result.status,
      timedOut: result.error?.code === 'ETIMEDOUT',
      stdout,
      stderr,
    };
  }

  let terminated = false;
  try {
    process.kill(-pid, 'SIGTERM');
    terminated = true;
  } catch (error) {
    if (error.code === 'ESRCH') return { attempted: true, killed: true, method: 'pgid' };
  }
  const waitUntil = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < waitUntil) {
    try {
      process.kill(-pid, 0);
      await delay(100);
    } catch (error) {
      if (error.code === 'ESRCH') return { attempted: true, killed: true, method: terminated ? 'pgid-term' : 'pgid' };
      break;
    }
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code === 'ESRCH') return { attempted: true, killed: true, method: 'pgid-kill' };
  }
  await delay(100);
  try {
    process.kill(-pid, 0);
    return { attempted: true, killed: false, method: 'pgid-kill' };
  } catch (error) {
    if (error.code === 'ESRCH') return { attempted: true, killed: true, method: 'pgid-kill' };
    return { attempted: true, killed: false, method: 'pgid-kill', error: error.message };
  }
}

export async function runE2ERunner(rawConfig, options = {}) {
  const output = {
    log: options.log ?? defaultLogger,
    error: options.error ?? defaultErrorLogger,
  };
  const emitResultBlock = options.emitResultBlock ?? false;

  const result = {
    status: 'BLOCKED',
    phase: 'preflight',
    reason: '',
    testExitCode: null,
    timedOut: false,
    durationsMs: {},
    cleanup: { ok: true, details: [] },
    serverPid: null,
    testPid: null,
    startedServerPid: null,
    startedTestPid: null,
    totalElapsedMs: 0,
  };

  let config;
  let heartbeat = null;
  let currentPhase = 'preflight';
  let phaseStartedAt = Date.now();
  const runStartedAt = Date.now();
  let serverChild = null;
  let testChild = null;
  let signalReason = null;
  let serverSpawnError = null;
  const captureSignals = options.captureSignals === true;
  const internalAbortController = new AbortController();
  const externalSignal = options.signal ?? null;
  const combinedSignal = internalAbortController.signal;
  let sigintHandler = null;
  let sigtermHandler = null;

  const finalizePhase = (nextPhase) => {
    const now = Date.now();
    result.durationsMs[currentPhase] = (result.durationsMs[currentPhase] ?? 0) + (now - phaseStartedAt);
    currentPhase = nextPhase;
    result.phase = nextPhase;
    phaseStartedAt = now;
    output.log(`[e2e-runner] phase=${nextPhase} elapsedMs=${now - runStartedAt}`);
  };

  const refreshHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      output.log(`[e2e-runner] heartbeat phase=${currentPhase} elapsedMs=${Date.now() - runStartedAt}`);
    }, config?.heartbeatMs ?? DEFAULTS.heartbeatMs);
    heartbeat.unref?.();
  };

  const deadlineRemaining = () => Math.max(0, runStartedAt + config.totalTimeoutMs - Date.now());
  const executionBudgetRemaining = () => Math.max(0, deadlineRemaining() - config.cleanupTimeoutMs);
  const cleanupDeadlineRemaining = (cleanupStartedAt) => Math.max(0, cleanupStartedAt + config.cleanupTimeoutMs - Date.now());

  const cleanupManaged = async (name, child, cleanupStartedAt) => {
    if (!child?.pid) return;
    if (child.exitCode != null || child.signalCode != null) {
      result.cleanup.details.push({ target: name, pid: child.pid, attempted: false, killed: true, alreadyExited: true });
      return;
    }
    const remainingMs = cleanupDeadlineRemaining(cleanupStartedAt);
    if (remainingMs <= 0) {
      result.cleanup.details.push({ target: name, pid: child.pid, attempted: false, killed: false, skipped: true, reason: 'Cleanup budget exhausted' });
      result.cleanup.ok = false;
      return;
    }
    const info = await killProcessTree(child.pid, remainingMs);
    await waitForObservedExit(child, Math.min(1_000, cleanupDeadlineRemaining(cleanupStartedAt)));
    result.cleanup.details.push({ target: name, pid: child.pid, ...info });
    if (!info.killed) result.cleanup.ok = false;
  };

  const onSignal = (signal) => {
    signalReason = signal;
    if (!internalAbortController.signal.aborted) {
      internalAbortController.abort(new Error(`Runner interrupted by ${signal}`));
    }
  };

  const onExternalAbort = () => {
    const externalReason = externalSignal?.reason instanceof Error
      ? externalSignal.reason.message
      : String(externalSignal?.reason ?? 'Runner interrupted by external abort');
    signalReason = signalReason ?? externalReason;
    if (!internalAbortController.signal.aborted) {
      internalAbortController.abort(new Error(externalReason));
    }
  };

  if (captureSignals) {
    sigintHandler = () => onSignal('SIGINT');
    sigtermHandler = () => onSignal('SIGTERM');
    process.once('SIGINT', sigintHandler);
    process.once('SIGTERM', sigtermHandler);
  }
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    config = normalizeConfig(rawConfig);
    result.phase = currentPhase;
    refreshHeartbeat();
    output.log(`[e2e-runner] phase=${currentPhase} elapsedMs=0`);

    if (config.totalTimeoutMs <= config.cleanupTimeoutMs) {
      throw new Error('totalTimeoutMs must be greater than cleanupTimeoutMs');
    }

    if (config.readyPort != null && config.ready?.allowExisting !== true) {
      const occupied = await isPortOpen(config.readyPort);
      if (occupied) {
        result.reason = `Port ${config.readyPort} is already in use`;
        return result;
      }
    }

    if (!config.start && config.ready?.allowExisting === true && config.readyPort == null && !config.ready.url) {
      throw new Error('ready.url or ready.port is required when allowExisting is true');
    }

    throwIfAborted(combinedSignal);

    if (config.start) {
      finalizePhase('starting_server');
      serverChild = spawnManagedProcess(config.start, config.cwd, 'server', output);
      result.startedServerPid = serverChild.pid ?? null;
      serverChild.once('error', (error) => {
        serverSpawnError = error;
        result.reason = `Failed to start server: ${error.message}`;
        if (!internalAbortController.signal.aborted) {
          internalAbortController.abort(new Error(result.reason));
        }
      });

      finalizePhase('waiting_ready');
      const readyBudgetMs = Math.min(config.ready.timeoutMs, executionBudgetRemaining());
      if (readyBudgetMs <= 0) {
        result.timedOut = true;
        result.reason = 'No execution budget remaining before readiness wait';
        return result;
      }

      let serverExited = null;
      const serverExitPromise = waitForExit(serverChild).then((value) => {
        serverExited = value;
        return value;
      });
      serverExitPromise.catch(() => {});
      const deadlineAt = Date.now() + readyBudgetMs;
      const waitFn = config.ready.url
        ? waitForUrlReady
        : waitForPortReady;
      const readyResult = await waitFn({
        url: config.ready.url,
        port: config.readyPort,
        timeoutMs: readyBudgetMs,
        pollMs: config.ready.pollMs,
        deadlineAt,
        signal: combinedSignal,
        onCheckAbort: () => {
          if (serverExited) {
            throw new Error(`Server exited before ready (code=${serverExited.code}, signal=${serverExited.signal})`);
          }
          throwIfAborted(combinedSignal);
        },
      });
      if (!readyResult.ok) {
        result.reason = readyResult.reason;
        result.timedOut = /Timed out/i.test(readyResult.reason);
        return result;
      }
    } else if (config.ready) {
      finalizePhase('waiting_ready');
      const readyBudgetMs = Math.min(config.ready.timeoutMs, executionBudgetRemaining());
      if (readyBudgetMs <= 0) {
        result.timedOut = true;
        result.reason = 'No execution budget remaining before readiness wait';
        return result;
      }
      const deadlineAt = Date.now() + readyBudgetMs;
      const waitFn = config.ready.url
        ? waitForUrlReady
        : waitForPortReady;
      const readyResult = await waitFn({
        url: config.ready.url,
        port: config.readyPort,
        timeoutMs: readyBudgetMs,
        pollMs: config.ready.pollMs,
        deadlineAt,
        signal: combinedSignal,
        onCheckAbort: () => {
          throwIfAborted(combinedSignal);
        },
      });
      if (!readyResult.ok) {
        result.reason = readyResult.reason;
        result.timedOut = /Timed out/i.test(readyResult.reason);
        return result;
      }
    }

    finalizePhase('running_test');
    const testBudgetMs = Math.min(config.test.timeoutMs, executionBudgetRemaining());
    if (testBudgetMs <= 0) {
      result.timedOut = true;
      result.reason = 'No execution budget remaining before test run';
      return result;
    }

    testChild = spawnManagedProcess(config.test, config.cwd, 'test', output);
    result.startedTestPid = testChild.pid ?? null;
    const testOutcome = await waitForExitWithTimeout(testChild, testBudgetMs, combinedSignal);

    if (testOutcome?.timeout) {
      result.timedOut = true;
      result.reason = 'Test command timed out';
      return result;
    }

    result.testExitCode = typeof testOutcome.code === 'number' ? testOutcome.code : null;
    if (testOutcome.signal) {
      result.reason = `Test command exited with signal ${testOutcome.signal}`;
      return result;
    }
    if (testOutcome.code === 0) {
      result.status = 'OK';
      result.reason = 'Test command succeeded';
    } else {
      result.status = 'FAIL';
      result.reason = `Test command failed with exit code ${testOutcome.code}`;
    }
    return result;
  } catch (error) {
    result.reason = error instanceof Error ? error.message : String(error);
    if (serverSpawnError && !/failed to start server/i.test(result.reason)) {
      result.reason = `Failed to start server: ${serverSpawnError.message}`;
    }
    if (error instanceof AbortError) {
      result.reason = result.reason || `Runner interrupted${signalReason ? ` by ${signalReason}` : ''}`;
    }
    if (/timed out|timeout/i.test(result.reason)) result.timedOut = true;
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    finalizePhase('cleanup');
    const cleanupStartedAt = Date.now();
    await cleanupManaged('test', testChild, cleanupStartedAt);
    await cleanupManaged('server', serverChild, cleanupStartedAt);
    result.serverPid = null;
    result.testPid = null;
    if (!result.cleanup.ok && result.status === 'OK') {
      result.status = 'BLOCKED';
      result.reason = `${result.reason || 'Cleanup failure'}; cleanup failed`;
    }
    finalizePhase('complete');
    result.totalElapsedMs = Date.now() - runStartedAt;
    if (emitResultBlock) {
      output.log(RESULT_START);
      output.log(JSON.stringify(result));
      output.log(RESULT_END);
    }
    if (captureSignals) {
      if (sigintHandler) process.removeListener('SIGINT', sigintHandler);
      if (sigtermHandler) process.removeListener('SIGTERM', sigtermHandler);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function loadConfigFile(configPath) {
  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  let configPath = null;
  while (args.length > 0) {
    const current = args.shift();
    if (current === '--config') {
      configPath = args.shift() ?? null;
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }
  if (!configPath) throw new Error('--config <path> is required');
  return { configPath };
}

export async function cli(argv = process.argv.slice(2), options = {}) {
  const log = options.log ?? defaultLogger;
  const error = options.error ?? defaultErrorLogger;
  try {
    const { configPath } = parseCliArgs(argv);
    const config = await loadConfigFile(configPath);
    const result = await runE2ERunner(config, { log, error, emitResultBlock: true, captureSignals: true });
    if (result.status === 'OK') return 0;
    if (result.status === 'FAIL') return 1;
    return 2;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const result = {
      status: 'BLOCKED',
      phase: 'preflight',
      reason: message,
      testExitCode: null,
      timedOut: false,
      durationsMs: {},
      cleanup: { ok: true, details: [] },
      serverPid: null,
      testPid: null,
      startedServerPid: null,
      startedTestPid: null,
      totalElapsedMs: 0,
    };
    log(RESULT_START);
    log(JSON.stringify(result));
    log(RESULT_END);
    return 2;
  }
}

if (isRunnableFile()) {
  cli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export const __internal = {
  AbortError,
  normalizeConfig,
  parseReadyPort,
  isPortOpen,
  defaultShellForCommand,
  createTimeout,
  waitForExitWithTimeout,
};
