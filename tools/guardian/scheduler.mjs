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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJsonFile } from './runtime-io.mjs';

import { pollIssue, defaultGhReader, DEFAULT_LEASE_MS } from './poll.mjs';
import { readState, startFollowupRound, writeState } from './state.mjs';
import { planTick } from './scheduler-core.mjs';
import { acquireLock, renewLock, releaseLock } from './lock.mjs';
import { deliverNotifications, defaultGhComment, defaultCurlPost } from './notify-io.mjs';
import { createLogger } from './runtime-io.mjs';
import { projectLabels } from './label-io.mjs';

const DEFAULT_INTERVAL_MS = 60 * 1000;
// Heartbeat cadence: renew the lock well within the lease so a live long run never looks stale.
const HEARTBEAT_MS = 30 * 1000;

function readConfig(repoDir) {
  const file = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(file)) return {};
  return readJsonFile(file);
}

function ghIssueList(repoDir, args) {
  const res = spawnSync('gh', ['issue', 'list', ...args], {
    cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (res.status !== 0) throw new Error(`gh issue list failed: ${res.stderr || 'unknown'}`);
  const arr = JSON.parse(res.stdout || '[]');
  // Deterministic order: oldest updatedAt first (fairest single pick under N=1).
  return arr
    .map((x) => ({ issue: Number(x.number), createdAt: x.createdAt, updatedAt: x.updatedAt, labels: x.labels ?? [] }))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

function watchStatePath(repoDir) { return path.join(repoDir, '.qa', 'guardian', 'watch-state.json'); }
function readWatchState(repoDir) {
  const file = watchStatePath(repoDir);
  if (!existsSync(file)) return null;
  return readJsonFile(file);
}
function writeWatchState(repoDir, state) {
  mkdirSync(path.dirname(watchStatePath(repoDir)), { recursive: true });
  writeFileSync(watchStatePath(repoDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function listCandidates(repoDir, config, now = new Date()) {
  const fields = ['number,createdAt,updatedAt,labels'];
  const labeled = ghIssueList(repoDir, ['--state', 'open', '--label', 'qa-guardian', '--limit', '1000', '--json', fields[0]])
    .map((x) => ({ ...x, claim_source: 'labeled' }));
  const followups = readdirSync(path.join(repoDir, '.qa', 'guardian'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
    .map((entry) => readJsonFile(path.join(repoDir, '.qa', 'guardian', entry.name)))
    .filter((record) => record.state === 'DONE' || record.state === 'GATE_2_WAIT')
    .map((record) => ({ issue: Number(record.issue), updatedAt: record.updated_at, claim_source: 'followup' }));
  if (config.watch_mode !== 'new-open') return [...new Map(labeled.concat(followups).map((x) => [x.issue, x])).values()];

  const current = now.toISOString();
  const state = readWatchState(repoDir) ?? {
    schema_version: 1,
    watch_mode: 'new-open',
    baseline_created_at: current,
    next_created_at: current,
    last_successful_scan_at: null,
  };
  const created = ghIssueList(repoDir, [
    '--state', 'open', '--search', `is:issue is:open created:>=${state.next_created_at}`,
    '--limit', '1000', '--json', fields[0],
  ]).filter((x) => typeof x.createdAt === 'string' && x.createdAt >= state.next_created_at)
    .map((x) => ({ ...x, claim_source: 'new-open' }));
  writeWatchState(repoDir, { ...state, watch_mode: 'new-open', next_created_at: current, last_successful_scan_at: current });
  const merged = new Map(labeled.concat(created, followups).map((x) => [x.issue, x]));
  return [...merged.values()].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
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

async function tick(repoDir, config, logger) {
  const leaseMs = Number(config.lease_ms ?? DEFAULT_LEASE_MS);
  const now = Date.now();
  const issues = listCandidates(repoDir, config, new Date(now));

  const trustedAuthors = config.command_authors ?? [];
  const decisions = issues.map(({ issue, claim_source }) => ({
    ...pollIssue(path.join(repoDir, '.qa', 'guardian'), issue, defaultGhReader(repoDir), {
      leaseMs, repoDir, trustedAuthors,
    }),
    claim_source,
  }));

  // Labels are best-effort visible projection; state JSON remains authoritative.
  for (const decision of decisions) {
    const record = readState(guardianDirOf(repoDir), decision.issue);
    if (!record) continue;
    const projection = projectLabels(repoDir, decision.issue, record);
    if (projection.errors.length > 0) logger.warn('labels.projection_failed', { issue: decision.issue, errors: projection.errors.length });
  }

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
    logger.info('notify.summary', { attempted: plan.notify.length, delivered });
  }

  if (!plan.toRun) {
    logger.info('tick.idle', { polled: decisions.length });
    return;
  }

  const { issue, invokeArgv, action, toState } = plan.toRun;
  if (!invokeArgv) {
    logger.warn('run.skipped_no_invocation', { issue, action, to_state: toState });
    return;
  }

  // Atomic acquire: if another scheduler holds a LIVE lock, we get null → skip (true N=1).
  const lockFile = lockPath(repoDir);
  const handle = acquireLock(lockFile, {
    pid: process.pid, leaseMs, now, dir: guardianDirOf(repoDir),
  });
  if (!handle) {
    logger.info('run.deferred_lock_live', { issue, action, to_state: toState });
    return;
  }

  if (plan.toRun.claim_source === 'new-open') {
    const claimId = randomUUID();
    const labelCreate = spawnSync('gh', ['label', 'create', 'qa-guardian-claimed', '--color', '5319e7', '--description', 'Issue claimed by QA Guardian', '--force'], {
      cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
    });
    const labelRes = spawnSync('gh', ['issue', 'edit', String(issue), '--add-label', 'qa-guardian', '--add-label', 'qa-guardian-claimed'], {
      cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
    });
    if (labelCreate.status !== 0 || labelRes.status !== 0) {
      releaseLock(lockFile, handle);
      logger.error('claim.failed', { issue, error_message: labelRes.stderr || labelCreate.stderr || 'gh label/issue edit failed' });
      return;
    }
    writeState(guardianDirOf(repoDir), {
      issue, state: 'DISCOVERED', claim_id: claimId, claimed_at: new Date(now).toISOString(), claim_source: 'new-open',
    }, { touch: false });
    logger.info('claim.accepted', { issue, claim_source: 'new-open' });
  }
  if (plan.toRun.newRound && plan.toRun.command) {
    const current = readState(guardianDirOf(repoDir), issue);
    if (current) writeState(guardianDirOf(repoDir), startFollowupRound(current, plan.toRun.command), { touch: false });
    logger.info('followup.round_started', { issue, round: (current?.processing_round ?? 1) + 1 });
  }

  logger.info('run.begin', { issue, action, to_state: toState });
  try {
    const code = await runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs);
    logger.info('run.exit', { issue, exit_code: code });
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

export function assertTargetRepoConfigured(repoDir) {
  const configPath = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`目标项目未配置 Guardian: ${configPath}；请使用 --repo <项目目录> 或设置 QA_GUARDIAN_REPO`);
  }
  return repoDir;
}

export async function runScheduler({ repoDir, config = readConfig(repoDir), signal } = {}) {
  if (!repoDir) throw new Error('scheduler requires repoDir');
  const interval = Number(config.poll_interval_ms ?? DEFAULT_INTERVAL_MS);
  const logger = createLogger({ component: 'scheduler' });

  logger.info('watch.begin', { repo_dir: repoDir, interval_ms: interval, concurrency: 1 });
  while (!signal?.aborted) {
    try {
      logger.info('tick.begin');
      await tick(repoDir, config, logger);
    } catch (e) {
      // no-excuse-ok: catch — resident loop must survive a transient gh/network error and retry
      const msg = e instanceof Error ? e.message : 'unknown';
      logger.error('tick.error', { error_message: msg });
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, interval);
      if (signal) signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, stop);
  await runScheduler({ repoDir: assertTargetRepoConfigured(resolveRepoDir()), signal: controller.signal });
}

if (process.argv[1] && process.argv[1].endsWith('scheduler.mjs')) {
  main();
}
