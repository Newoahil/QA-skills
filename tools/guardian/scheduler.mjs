// QA Guardian — resident watch-mode scheduler (§15.1)
//
// Thin resident loop. Every interval it lists open `qa-guardian` issues, asks poll.mjs for each
// issue's decision, then uses scheduler-core.planTick (pure) to pick the SINGLE issue to run
// (N=1) and which stopped issues to notify. Decisions/routing live in poll/router/scheduler-core;
// this file only does I/O: gh list, spawn `opencode run`, the N=1 lock file, and logging.
//
// Runs on a machine that has: opencode, gh (authenticated), git, and the target repo checked out.
// Config: .qa/guardian/config.json { poll_interval_ms?, lease_ms?, base_branch?, notify_webhook?,
// notify_channel? }.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { pollIssue, defaultGhReader, DEFAULT_LEASE_MS } from './poll.mjs';
import { planTick } from './scheduler-core.mjs';

const DEFAULT_INTERVAL_MS = 60 * 1000;

function readConfig(repoDir) {
  const file = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}

function listOpenIssues(repoDir) {
  const res = spawnSync('gh', ['issue', 'list', '--label', 'qa-guardian', '--state', 'open', '--json', 'number,updatedAt'], {
    cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (res.status !== 0) throw new Error(`gh issue list failed: ${res.stderr || 'unknown'}`);
  const arr = JSON.parse(res.stdout || '[]');
  // Deterministic order: oldest updatedAt first (fairest single pick under N=1).
  return arr
    .map((x) => ({ issue: Number(x.number), updatedAt: x.updatedAt }))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

function lockPath(repoDir) {
  return path.join(repoDir, '.qa', 'guardian', '.scheduler.lock');
}

function readLock(repoDir) {
  const file = lockPath(repoDir);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { pid: Number(parsed.pid), acquired_at: Number(parsed.acquired_at) };
}

function writeLock(repoDir, pid) {
  const dir = path.join(repoDir, '.qa', 'guardian');
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockPath(repoDir), JSON.stringify({ pid, acquired_at: Date.now() }) + '\n');
}

function clearLock(repoDir) {
  const file = lockPath(repoDir);
  if (existsSync(file)) rmSync(file);
}

// Run one issue's guardian invocation to completion, holding the N=1 lock for its duration.
function runInvocation(repoDir, invoke) {
  return new Promise((resolve) => {
    // invoke is the full `opencode run --agent qa-guardian ...` string produced by poll.mjs.
    const child = spawn(invoke, { cwd: repoDir, shell: true, stdio: 'inherit', windowsHide: true });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

async function tick(repoDir, config) {
  const leaseMs = Number(config.lease_ms ?? DEFAULT_LEASE_MS);
  const now = Date.now();
  const issues = listOpenIssues(repoDir);

  const decisions = issues.map(({ issue }) =>
    pollIssue(path.join(repoDir, '.qa', 'guardian'), issue, defaultGhReader(repoDir), {
      leaseMs, repoDir,
    }),
  );

  const plan = planTick({ decisions, lock: readLock(repoDir), leaseMs, now });

  if (plan.lockBusy) {
    process.stdout.write(`[scheduler] lock busy; ${decisions.length} issue(s) polled, none started\n`);
    return;
  }
  if (!plan.toRun) {
    process.stdout.write(`[scheduler] nothing runnable this tick (${decisions.length} polled)\n`);
    return;
  }

  const { issue, invoke, action, toState } = plan.toRun;
  if (!invoke) {
    process.stdout.write(`[scheduler] issue #${issue} ${action}→${toState} has no invocation; skipping\n`);
    return;
  }

  writeLock(repoDir, process.pid);
  process.stdout.write(`[scheduler] running issue #${issue} (${action}→${toState})\n`);
  try {
    const code = await runInvocation(repoDir, invoke);
    process.stdout.write(`[scheduler] issue #${issue} run exited ${code}\n`);
  } finally {
    clearLock(repoDir);
  }
}

async function main() {
  const repoDir = process.argv.includes('--repo')
    ? process.argv[process.argv.indexOf('--repo') + 1]
    : process.cwd();
  const config = readConfig(repoDir);
  const interval = Number(config.poll_interval_ms ?? DEFAULT_INTERVAL_MS);

  process.stdout.write(`[scheduler] watching ${repoDir} every ${interval}ms (N=1)\n`);

  let stopped = false;
  const stop = () => { stopped = true; clearLock(repoDir); process.exit(0); };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, stop);

  while (!stopped) {
    try {
      await tick(repoDir, config);
    } catch (e) {
      // no-excuse-ok: catch — resident loop must survive a transient gh/network error and retry
      const msg = e instanceof Error ? e.message : 'unknown';
      process.stderr.write(`[scheduler] tick error: ${msg}\n`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (process.argv[1] && process.argv[1].endsWith('scheduler.mjs')) {
  main();
}
