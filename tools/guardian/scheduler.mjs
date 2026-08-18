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

import { pollIssue, defaultGhReader, DEFAULT_LEASE_MS, invocationArgvFor } from './poll.mjs';
import { readState, startFollowupRound, writeState } from './state.mjs';
import { planTick } from './scheduler-core.mjs';
import { acquireLock, renewLock, releaseLock } from './lock.mjs';
import { deliverNotifications, defaultGhComment, defaultCurlPost } from './notify-io.mjs';
import { createLogger } from './runtime-io.mjs';
import { projectLabels } from './label-io.mjs';
import { prepareInvestigation } from './investigation-runtime.mjs';
import { processPlanBuilder, processSpecialistRunner } from './investigation-process.mjs';
import { discoverCapabilities } from './capabilities.mjs';
import { quarantineArtifacts, readArtifact, readArtifactPair } from './artifacts.mjs';
import { assessFixingEntry } from './plan-gate.mjs';
import { auditQaVerdict } from './qa-verdict.mjs';
import { canCreatePr } from './qa-gate.mjs';
import { createPullRequest } from './pr-io.mjs';

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
function runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs, timeoutMs = 20 * 60 * 1000, signal) {
  return new Promise((resolve) => {
    const child = spawn(invokeArgv.cmd, invokeArgv.args, {
      cwd: repoDir, shell: false, stdio: 'inherit', windowsHide: true,
    });
    // Heartbeat: keep the lease fresh while the run is alive so N=1 holds for long runs.
    const beat = setInterval(() => {
      renewLock(lockFile, handle, { leaseMs });
    }, HEARTBEAT_MS);
    if (typeof beat.unref === 'function') beat.unref();
    let timedOut = false;
    const done = (code) => {
      clearInterval(beat);
      clearTimeout(timer);
      resolve(code);
    };
    const stop = () => { if (!child.killed) child.kill(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.on('exit', (code) => done(timedOut ? 124 : (code ?? 0)));
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

  const { issue, action, toState } = plan.toRun;
  let invokeArgv = plan.toRun.invokeArgv;
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

  if (action === 'STALLED' && plan.toRun.idempotentStage !== true) {
    releaseLock(lockFile, handle);
    logger.warn('run.blocked_non_idempotent_stall', { issue, from_state: plan.toRun.fromState });
    return;
  }

  try {
  const currentBeforeRun = readState(guardianDirOf(repoDir), issue);
  if (currentBeforeRun && plan.toRun.command) {
    writeState(guardianDirOf(repoDir), {
      ...currentBeforeRun,
      last_consumed_comment_id: plan.toRun.command.commentId,
      fix_rounds: plan.toRun.clearFixRounds ? 0 : currentBeforeRun.fix_rounds,
      stall_retries: plan.toRun.nextStallRetries ?? currentBeforeRun.stall_retries,
    }, { touch: false });
  }
  if (currentBeforeRun && action === 'STALLED' && plan.toRun.nextStallRetries) {
    writeState(guardianDirOf(repoDir), {
      ...currentBeforeRun,
      stall_retries: plan.toRun.nextStallRetries,
      last_phase: 'stalled',
    }, { touch: false });
  }

  const investigationMode = config.investigation_mode ?? 'enforced';
  if (investigationMode !== 'legacy') {
    const guardianDir = guardianDirOf(repoDir);
    const pair = readArtifactPair(guardianDir, issue);
    const dossier = pair.dossier;
    const planArtifact = pair.plan;
    if (!pair.complete) {
      if (dossier || planArtifact) quarantineArtifacts(guardianDir, issue);
      try {
        const prepared = await prepareInvestigation({
          issue, repoDir, guardianDir, issueClass: config.default_issue_class ?? 'bug',
          complexity: config.investigation_complexity ?? 'complex',
          capabilities: discoverCapabilities({ env: process.env }),
          config, runSpecialist: processSpecialistRunner,
          buildPlan: (args) => processPlanBuilder({ ...args, repoDir }),
        });
        const state = readState(guardianDir, issue) ?? { issue };
        writeState(guardianDir, {
          ...state,
          dossier_path: prepared.artifact_paths.dossier_path,
          plan_path: prepared.artifact_paths.plan_path,
          dossier_status: prepared.validation.valid ? 'valid' : 'invalid',
          plan_status: prepared.planResult.valid ? 'valid' : 'invalid',
          evidence_count: prepared.dossier.evidence.length,
          hypothesis_ids: prepared.dossier.hypotheses.map((item) => item.id),
          unresolved_fact_count: prepared.dossier.unresolved_facts.length,
          acceptance_criteria_count: prepared.dossier.acceptance_criteria.length,
          last_phase: 'plan-validated',
        }, { touch: false });
        logger.info('investigation.artifacts_ready', { issue, mode: investigationMode });
      } catch (error) {
        const failureState = readState(guardianDir, issue) ?? { issue };
        writeState(guardianDir, {
          ...failureState,
          dossier_status: 'failed',
          plan_status: 'failed',
          investigation_attempts: (failureState.investigation_attempts ?? 0) + 1,
          last_error_class: 'investigation-failed',
          last_phase: 'investigation',
          plan_validation_errors: [error instanceof Error ? error.message : 'investigation failed'],
        }, { touch: false });
        releaseLock(lockFile, handle);
        logger.error('investigation.failed', { issue, error_message: error instanceof Error ? error.message : 'unknown' });
        return;
      }
    }
  }

  if (investigationMode !== 'legacy') {
    const guardianDir = guardianDirOf(repoDir);
    const pair = readArtifactPair(guardianDir, issue);
    const dossier = pair.dossier;
    const planArtifact = pair.plan;
    const gate = assessFixingEntry({ plan: planArtifact, dossier, investigationMode });
    if (!gate.allowed || gate.shadow === true) {
      releaseLock(lockFile, handle);
      logger.warn('run.blocked_plan_gate', { issue, mode: investigationMode, reason: gate.reason ?? 'shadow-mode' });
      return;
    }
    logger.info('run.plan_gate_passed', { issue, mode: investigationMode });
  }

  // Refresh the prompt after artifacts exist so the write-capable agent receives the exact
  // validated dossier/plan paths rather than an ungrounded generic invocation.
  if (investigationMode !== 'legacy') {
    invokeArgv = invocationArgvFor(repoDir, issue, plan.toRun, {
      dossierPath: path.join(guardianDirOf(repoDir), String(issue), 'dossier.json'),
      planPath: path.join(guardianDirOf(repoDir), String(issue), 'plan.json'),
      runtimeMode: investigationMode,
    });
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
    const code = await runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs, Number(config.child_timeout_ms ?? 20 * 60 * 1000));
    const qaVerdict = readArtifact(guardianDirOf(repoDir), issue, 'qa-verdict');
    const qaAudit = auditQaVerdict(qaVerdict, {
      issue,
      branch: readState(guardianDirOf(repoDir), issue)?.branch ?? undefined,
    });
    const afterRun = readState(guardianDirOf(repoDir), issue) ?? { issue };
    writeState(guardianDirOf(repoDir), {
      ...afterRun,
      qa_verdict_path: qaVerdict ? path.join(String(issue), 'qa-verdict.json') : null,
      qa_verdict_status: qaVerdict?.status ?? null,
      qa_verdict_hash: qaVerdict?.report_hash ?? null,
      last_child_exit_code: code,
      last_error_class: qaAudit.approved ? afterRun.last_error_class : qaAudit.reason,
      last_phase: qaAudit.approved ? 'qa-passed' : 'qa-unapproved',
    }, { touch: false });
    if (!qaAudit.approved) logger.warn('qa.verdict_unapproved', { issue, reason: qaAudit.reason, exit_code: code });
    else logger.info('qa.verdict_passed', { issue, exit_code: code });

    if (investigationMode === 'enforced' && qaAudit.approved) {
      const currentBranch = afterRun.branch;
      const qaGate = canCreatePr({
        verdict: qaVerdict,
        issue,
        branch: currentBranch,
        expectedPlanHash: afterRun.plan_hash ?? undefined,
      });
      if (!qaGate.allowed) {
        logger.warn('pr.blocked_qa_gate', { issue, errors: qaGate.errors.length });
      } else if (!currentBranch) {
        logger.warn('pr.blocked_missing_branch', { issue });
      } else {
        const prUrl = createPullRequest({
          repoDir,
          head: currentBranch,
          base: config.base_branch ?? 'dev',
          title: plan.toRun.issueTitle ?? `修复 issue #${issue}`,
          body: `## QA Guardian 自动验证\n\nIssue #${issue}\n\n独立 QA 结论：Overall Status: PASS\n\n请人工评审后合并。`,
        });
        writeState(guardianDirOf(repoDir), {
          ...afterRun,
          state: 'GATE_2_WAIT',
          pr_url: prUrl,
          last_phase: 'pr-opened',
        }, { touch: false });
        logger.info('pr.opened_gate2', { issue });
      }
    }
    logger.info('run.exit', { issue, exit_code: code });
  }
  catch (error) {
    logger.error('run.error', { issue, error_message: error instanceof Error ? error.message : 'unknown' });
    throw error;
  }
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
