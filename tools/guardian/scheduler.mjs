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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { pollIssue, defaultGhReader, DEFAULT_LEASE_MS } from './poll.mjs';
import { planTick } from './scheduler-core.mjs';
import { acquireLock, renewLock, releaseLock } from './lock.mjs';
import { deliverNotifications, defaultGhComment, defaultCurlPost } from './notify-io.mjs';

const DEFAULT_INTERVAL_MS = 60 * 1000;
// Heartbeat cadence: renew the lock well within the lease so a live long run never looks stale.
const HEARTBEAT_MS = 30 * 1000;

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

function guardianDirOf(repoDir) {
  return path.join(repoDir, '.qa', 'guardian');
}

// Run one issue's guardian invocation to completion, holding + heartbeating the N=1 lock for
// its whole duration. Spawns WITHOUT a shell (argv array), so issue-derived prompt text can
// never be interpreted by a shell. Returns the child's exit code.
function runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs) {
  return new Promise((resolve) => {
    const child = spawn(invokeArgv.cmd, invokeArgv.args, {
      cwd: repoDir, shell: false, stdio: 'inherit', windowsHide: true,
    });
    // Heartbeat: keep the lease fresh while the run is alive so N=1 holds for long runs.
    const beat = setInterval(() => {
      renewLock(lockFile, handle, { leaseMs });
    }, HEARTBEAT_MS);
    if (typeof beat.unref === 'function') beat.unref();
    const done = (code) => {
      clearInterval(beat);
      resolve(code);
    };
    child.on('exit', (code) => done(code ?? 0));
    child.on('error', () => done(1));
  });
}

async function tick(repoDir, config) {
  const leaseMs = Number(config.lease_ms ?? DEFAULT_LEASE_MS);
  const now = Date.now();
  const issues = listOpenIssues(repoDir);

  const trustedAuthors = config.command_authors ?? [];
  const decisions = issues.map(({ issue }) =>
    pollIssue(path.join(repoDir, '.qa', 'guardian'), issue, defaultGhReader(repoDir), {
      leaseMs, repoDir, trustedAuthors,
    }),
  );

  // planTick selects the single runnable candidate (pure). Actual N=1 exclusion is enforced by
  // the ATOMIC lock acquire below — planTick's lock arg is null here so it only picks a candidate.
  const plan = planTick({ decisions, lock: null, leaseMs, now });

  // Deliver notifications (FR-21 / §11B.5) for gate-stop/STALLED/HANDED_BACK decisions BEFORE
  // handling the run. Idempotent per last_notified_state; independent of the N=1 run lock, so a
  // stopped issue is announced even while another issue is running. Best-effort per issue.
  if (plan.notify.length > 0) {
    const guardianDir = guardianDirOf(repoDir);
    const results = deliverNotifications({
      decisions: plan.notify,
      guardianDir,
      config,
      io: { ghComment: defaultGhComment(repoDir), curlPost: defaultCurlPost() },
    });
    const delivered = results.filter((r) => r.delivered).length;
    process.stdout.write(`[scheduler] notifications: ${delivered}/${plan.notify.length} delivered\n`);
  }

  if (!plan.toRun) {
    process.stdout.write(`[scheduler] nothing runnable this tick (${decisions.length} polled)\n`);
    return;
  }

  const { issue, invokeArgv, action, toState } = plan.toRun;
  if (!invokeArgv) {
    process.stdout.write(`[scheduler] issue #${issue} ${action}→${toState} has no invocation; skipping\n`);
    return;
  }

  // Atomic acquire: if another scheduler holds a LIVE lock, we get null → skip (true N=1).
  const lockFile = lockPath(repoDir);
  const handle = acquireLock(lockFile, {
    pid: process.pid, leaseMs, now, dir: guardianDirOf(repoDir),
  });
  if (!handle) {
    process.stdout.write(`[scheduler] lock held by a live run; issue #${issue} deferred\n`);
    return;
  }

  process.stdout.write(`[scheduler] running issue #${issue} (${action}→${toState})\n`);
  try {
    const code = await runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs);
    process.stdout.write(`[scheduler] issue #${issue} run exited ${code}\n`);
  } finally {
    releaseLock(lockFile, handle);
  }
}

// Resolve which repo the scheduler watches. Precedence (highest first):
//   1. CLI: --repo <dir>
//   2. env: QA_GUARDIAN_REPO
//   3. current working directory
// Exported + pure (argv/env injected) so it is unit-testable.
export function resolveRepoDir(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (typeof env.QA_GUARDIAN_REPO === 'string' && env.QA_GUARDIAN_REPO.length > 0) {
    return env.QA_GUARDIAN_REPO;
  }
  return process.cwd();
}

async function main() {
  const repoDir = resolveRepoDir();
  const config = readConfig(repoDir);
  const interval = Number(config.poll_interval_ms ?? DEFAULT_INTERVAL_MS);

  process.stdout.write(`[scheduler] watching ${repoDir} every ${interval}ms (N=1)\n`);

  // On signal, stop the loop and exit. An in-flight run's lock is released by tick()'s finally;
  // if the process is killed mid-run, the lock is lease-bounded and reclaimed after it expires.
  let stopped = false;
  const stop = () => { stopped = true; process.exit(0); };
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
