import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runE2ERunner } from '../qa-skill/scripts/e2e-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.dirname(__filename);
const runnerPath = path.join(repoRoot, '../qa-skill/scripts/e2e-runner.mjs');

function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), 'e2e-runner-test-'));
}

function writeScript(dir, name, source) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, source, 'utf8');
  return filePath;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.once('error', reject);
  });
}

function parseResultBlock(stdout) {
  const match = /E2E_RUN_RESULT\r?\n(.+)\r?\nEND_E2E_RUN_RESULT/s.exec(stdout);
  assert.ok(match, `missing result block in stdout:\n${stdout}`);
  return JSON.parse(match[1]);
}

function spawnRunner(configPath, cwd) {
  return spawn(process.execPath, [runnerPath, '--config', configPath], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function collectChildResult(child, timeoutMs = 5_000) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const startedAt = Date.now();
  const outcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`runner child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  return {
    ...outcome,
    stdout,
    stderr,
    elapsedMs: Date.now() - startedAt,
  };
}

async function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    return false;
  }
}

async function waitFor(deadlineMs, predicate) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

test('test-only OK returns status OK and CLI exit 0 quickly without leaked timers', async () => {
  const tempDir = makeTempDir();
  try {
    writeScript(tempDir, 'ok.mjs', 'console.log("ok"); process.exit(0);');
    const configPath = path.join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      cwd: tempDir,
      test: { command: process.execPath, args: ['ok.mjs'] },
      heartbeatMs: 5_000,
    }), 'utf8');

    const run = await collectChildResult(spawnRunner(configPath, tempDir), 3_000);

    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.signal, null);
    assert.equal(run.stderr, '');
    assert.ok(run.elapsedMs < 2_000, `expected quick exit, got ${run.elapsedMs}ms`);
    const result = parseResultBlock(run.stdout);
    assert.equal(result.status, 'OK');
    assert.equal(result.testExitCode, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('test-only nonzero preserves test exit code and CLI returns 1 quickly without leaked timers', async () => {
  const tempDir = makeTempDir();
  try {
    writeScript(tempDir, 'fail.mjs', 'process.exit(7);');
    const configPath = path.join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      cwd: tempDir,
      test: { command: process.execPath, args: ['fail.mjs'] },
    }), 'utf8');

    const run = await collectChildResult(spawnRunner(configPath, tempDir), 3_000);

    assert.equal(run.code, 1, run.stderr);
    assert.equal(run.signal, null);
    assert.equal(run.stderr, '');
    assert.ok(run.elapsedMs < 2_000, `expected quick exit, got ${run.elapsedMs}ms`);
    const result = parseResultBlock(run.stdout);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.testExitCode, 7);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('server readiness plus test OK cleans up owned server and frees port', async () => {
  const tempDir = makeTempDir();
  const port = await getFreePort();
  try {
    writeScript(tempDir, 'server.mjs', `
      import http from 'node:http';
      const server = http.createServer((req, res) => { res.statusCode = 200; res.end('ready'); });
      server.listen(${port}, '127.0.0.1');
      setInterval(() => {}, 1000);
    `);
    writeScript(tempDir, 'test.mjs', 'process.exit(0);');

    const result = await runE2ERunner({
      cwd: tempDir,
      start: { command: process.execPath, args: ['server.mjs'] },
      ready: { url: `http://127.0.0.1:${port}`, timeoutMs: 10_000, pollMs: 100 },
      test: { command: process.execPath, args: ['test.mjs'] },
      cleanupTimeoutMs: 5_000,
      heartbeatMs: 5_000,
    }, {
      log: () => {},
      error: () => {},
    });

    assert.equal(result.status, 'OK');
    assert.equal(await waitFor(3_000, async () => !(await isPidAlive(result.startedServerPid))), true);

    const probe = http.createServer((req, res) => res.end('reuse'));
    await new Promise((resolve, reject) => probe.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('preflight blocks on unknown occupied port without killing existing server', async () => {
  const port = await getFreePort();
  const external = http.createServer((req, res) => res.end('external'));
  await new Promise((resolve, reject) => external.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const tempDir = makeTempDir();
  try {
    writeScript(tempDir, 'server.mjs', 'setInterval(() => {}, 1000);');
    writeScript(tempDir, 'test.mjs', 'process.exit(0);');

    const result = await runE2ERunner({
      cwd: tempDir,
      start: { command: process.execPath, args: ['server.mjs'] },
      ready: { url: `http://127.0.0.1:${port}`, timeoutMs: 2_000, pollMs: 100, allowExisting: false },
      test: { command: process.execPath, args: ['test.mjs'] },
    }, {
      log: () => {},
      error: () => {},
    });

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason, /already in use/i);

    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}`, (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data));
      }).once('error', reject);
    });
    assert.equal(body, 'external');
  } finally {
    await new Promise((resolve, reject) => external.close((error) => error ? reject(error) : resolve()));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('readiness timeout blocks and cleans up started server child', async () => {
  const tempDir = makeTempDir();
  const port = await getFreePort();
  try {
    writeScript(tempDir, 'server-never-ready.mjs', 'setInterval(() => {}, 1000);');
    writeScript(tempDir, 'test.mjs', 'process.exit(0);');
    const result = await runE2ERunner({
      cwd: tempDir,
      start: { command: process.execPath, args: ['server-never-ready.mjs'] },
      ready: { port, timeoutMs: 400, pollMs: 50 },
      test: { command: process.execPath, args: ['test.mjs'] },
      cleanupTimeoutMs: 5_000,
    }, {
      log: () => {},
      error: () => {},
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.timedOut, true);
    assert.equal(await waitFor(3_000, async () => !(await isPidAlive(result.startedServerPid))), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('test timeout blocks and cleans up started test child', async () => {
  const tempDir = makeTempDir();
  try {
    writeScript(tempDir, 'hang.mjs', 'setInterval(() => {}, 1000);');
    const result = await runE2ERunner({
      cwd: tempDir,
      test: { command: process.execPath, args: ['hang.mjs'], timeoutMs: 300 },
      cleanupTimeoutMs: 5_000,
    }, {
      log: () => {},
      error: () => {},
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.timedOut, true);
    assert.match(result.reason, /timed out/i);
    assert.equal(await waitFor(3_000, async () => !(await isPidAlive(result.startedTestPid))), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('config env is passed to child processes', async () => {
  const tempDir = makeTempDir();
  try {
    const outputPath = path.join(tempDir, 'env.txt');
    writeScript(tempDir, 'env.mjs', `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(outputPath)}, String(process.env.SAMPLE_FLAG || ''), 'utf8');
      process.exit(process.env.SAMPLE_FLAG === 'expected' ? 0 : 9);
    `);
    const result = await runE2ERunner({
      cwd: tempDir,
      test: {
        command: process.execPath,
        args: ['env.mjs'],
        env: { SAMPLE_FLAG: 'expected' },
      },
    }, {
      log: () => {},
      error: () => {},
    });

    assert.equal(result.status, 'OK');
    assert.equal(readFileSync(outputPath, 'utf8'), 'expected');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('allowExisting true can use an already-running service without start', async () => {
  const port = await getFreePort();
  const external = http.createServer((req, res) => res.end('existing'));
  await new Promise((resolve, reject) => external.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const tempDir = makeTempDir();
  try {
    writeScript(tempDir, 'test.mjs', 'process.exit(0);');
    const result = await runE2ERunner({
      cwd: tempDir,
      ready: { url: `http://127.0.0.1:${port}`, allowExisting: true, timeoutMs: 2_000, pollMs: 50 },
      test: { command: process.execPath, args: ['test.mjs'] },
    }, {
      log: () => {},
      error: () => {},
    });

    assert.equal(result.status, 'OK');
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}`, (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data));
      }).once('error', reject);
    });
    assert.equal(body, 'existing');
  } finally {
    await new Promise((resolve, reject) => external.close((error) => error ? reject(error) : resolve()));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('abort signal interrupts running test quickly and cleans child', async () => {
  const tempDir = makeTempDir();
  try {
    writeScript(tempDir, 'hang.mjs', 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const runPromise = runE2ERunner({
      cwd: tempDir,
      test: { command: process.execPath, args: ['hang.mjs'], timeoutMs: 20_000 },
      cleanupTimeoutMs: 2_000,
      heartbeatMs: 5_000,
    }, {
      log: () => {},
      error: () => {},
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const startedAt = Date.now();
    controller.abort(new Error('Runner interrupted by SIGTERM'));
    const result = await runPromise;

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason, /interrupted/i);
    assert.ok(Date.now() - startedAt < 2_500, 'interrupt should return quickly');
    assert.equal(await waitFor(3_000, async () => !(await isPidAlive(result.startedTestPid))), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('start spawn error blocks quickly without running test command', async () => {
  const tempDir = makeTempDir();
  try {
    const markerPath = path.join(tempDir, 'test-ran.txt');
    writeScript(tempDir, 'test.mjs', `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(markerPath)}, 'ran', 'utf8');
      process.exit(0);
    `);

    const startedAt = Date.now();
    const result = await runE2ERunner({
      cwd: tempDir,
      start: { command: '__definitely_missing_e2e_runner_command__', args: [], shell: false },
      ready: { port: await getFreePort(), timeoutMs: 5_000, pollMs: 50 },
      test: { command: process.execPath, args: ['test.mjs'], shell: false },
      cleanupTimeoutMs: 1_000,
      heartbeatMs: 5_000,
    }, {
      log: () => {},
      error: () => {},
    });

    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.timedOut, false);
    assert.ok(elapsedMs < 2_000, `expected quick start failure, got ${elapsedMs}ms`);
    assert.match(result.reason, /failed to start server|spawn|enoent/i);
    assert.equal(result.startedTestPid, null);
    assert.equal(result.startedServerPid, null);
    assert.equal(result.cleanup.ok, true);
    assert.equal(result.cleanup.details.length, 0);
    assert.equal(result.testExitCode, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
