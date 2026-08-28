// QA Guardian — resident watch-mode scheduler (§15.1)
//
// Thin resident loop. Every interval it lists all open issues, asks poll.mjs for each
// issue's decision, then uses scheduler-core.planTick (pure) to pick the SINGLE issue to run
// (N=1) and which stopped issues to notify. Decisions/routing live in poll/router/scheduler-core;
// this file only does I/O: gh list, spawn `opencode run`, the N=1 lock file, and logging.
//
// Runs on a machine that has: opencode, gh (authenticated), git, and the target repo checked out.
// Config: .qa/guardian/config.json { poll_interval_ms?, lease_ms?, base_branch?, notify_webhook?,
// notify_channel? }.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJsonFile } from './runtime-io.mjs';

import { invocationArgvFor } from './poll.mjs';
import {
  DEFAULT_INTERVAL_MS,
  MAX_FIX_ROUNDS_DEFAULT,
  validateSchedulerConfig,
  resolveRepoDir,
  assertTargetRepoConfigured,
} from './scheduler-config.mjs';
// Re-export config/repo helpers so scheduler.mjs stays the stable public surface (batch-1 refactor).
export {
  DEFAULT_INTERVAL_MS,
  MAX_FIX_ROUNDS_DEFAULT,
  validateSchedulerConfig,
  resolveRepoDir,
  assertTargetRepoConfigured,
};
import { guardianDirOf } from './guardian-paths.mjs';
import {
  listCandidates,
  listCandidatesFromTaskSource,
  pollTaskObservation,
  createSchedulerTaskSource,
} from './scheduler-discovery.mjs';
// Re-export discovery helpers so scheduler.mjs stays the stable public surface (batch-2 refactor).
export {
  listCandidates,
  listCandidatesFromTaskSource,
  pollTaskObservation,
  createSchedulerTaskSource,
};
import {
  sessionStatusAction,
  buildInvestigationFailureState,
  buildRunFailureState,
  applyGateCommandState,
  summarizeSupervisorEvidence,
  writeWatchState,
  persistCommandlessTransitions,
  publishWaitingGate1Proposals,
} from './scheduler-transitions.mjs';
// Re-export transition helpers so scheduler.mjs stays the stable public surface (batch-3/4 refactor).
export {
  sessionStatusAction,
  buildInvestigationFailureState,
  buildRunFailureState,
  applyGateCommandState,
  summarizeSupervisorEvidence,
  writeWatchState,
  persistCommandlessTransitions,
  publishWaitingGate1Proposals,
};
import { readState, startFollowupRound, STATES, writeState } from './state.mjs';

import { planTick, preRunPersistableDecisions } from './scheduler-core.mjs';
import { acquireLock, renewLock, releaseLock } from './lock.mjs';
import { closeoutTransition, deliverNotifications, defaultGhComment, defaultCurlPost } from './notify-io.mjs';
import { createLogger } from './runtime-io.mjs';
import { projectLabels } from './label-io.mjs';
import { prepareInvestigation } from './investigation-runtime.mjs';
import { hasTimeout, resolveSessionDeadlineMs } from './budgets.mjs';
import { processPlanBuilder, processSpecialistRunner } from './investigation-process.mjs';
import { resolveModelForRole } from './investigation-coordinator.mjs';
import { disableUnavailableGuardianAgents, discoverCapabilities, unavailableGuardianAgents } from './capabilities.mjs';
import { artifactIdentity, quarantineArtifacts, readArtifact, readArtifactPair, writeArtifact, writeMarkdownArtifact } from './artifacts.mjs';
import { assessFixingEntry } from './plan-gate.mjs';
import { auditQaVerdict } from './qa-verdict.mjs';
import { canCreatePr } from './qa-gate.mjs';
import { openGate2PullRequest } from './gate2-pr.mjs';
import { readRequiredQaAcceptance } from './content-artifacts.mjs';
import { buildVerdictComment, markerForApproval, hashVerdictComment } from './verdict-comment.mjs';
import { resolveOpencodeBin } from './opencode-bin.mjs';
import { createOpencodeClient } from './opencode-client.mjs';
import { loadRuntimePipelineManifest, loadRuntimeStageRunners, runPipeline, stageRunnerContext } from './stage-runner.mjs';
import { createGitHubEffectSink } from './github-effect-sink.mjs';

import { loadAgentRegistry } from './agent-registry.mjs';
import { createSupervisorExecutor } from './supervisor-exec.mjs';
import { ACTORS, assertActorMayPerform, EFFECTS } from './actor-routing.mjs';
import { recallEngineeringMemory, recordEngineeringMemory } from './memory-provider.mjs';

const FIXER_START_KIND = 'fixer-start';

function jsonFailureFields(error) {
  if (!(error instanceof Error) || error.name !== 'InvestigationJsonParseError') return {};
  const response = error.prompt_response && typeof error.prompt_response === 'object' ? error.prompt_response : {};
  return {
    json_phase: error.json_phase ?? null,
    json_source: error.json_source ?? null,
    role: error.role ?? null,
    parse_error_message: error.parse_error_message ?? null,
    output_bytes: typeof error.output_bytes === 'number' ? error.output_bytes : null,
    output_preview: error.output_preview ?? null,
    prompt_parts_count: typeof response.parts_count === 'number' ? response.parts_count : null,
    prompt_text_bytes: typeof response.text_bytes === 'number' ? response.text_bytes : null,
    prompt_has_structured: typeof response.has_structured === 'boolean' ? response.has_structured : null,
    prompt_has_structured_output: typeof response.has_structured_output === 'boolean' ? response.has_structured_output : null,
  };
}

function writeQaVerdictArtifact(guardianDir, issue, qaVerdict) {
  return writeArtifact(guardianDir, issue, 'qa-verdict', qaVerdict);
}

// Heartbeat cadence: renew the lock well within the lease so a live long run never looks stale.
const HEARTBEAT_MS = 30 * 1000;

export function createLeaseFence({
  lockFile,
  handle,
  leaseMs,
  renew = renewLock,
  heartbeatMs = HEARTBEAT_MS,
  signal = null,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const controller = new AbortController();
  let active = true;
  const isActiveRun = () => active && !controller.signal.aborted;
  const fence = () => {
    active = false;
    if (!controller.signal.aborted) controller.abort();
  };
  const renewNow = () => {
    try {
      if (!renew(lockFile, handle, { leaseMs })) fence();
    } catch {
      fence();
    }
    return isActiveRun();
  };
  const onAbort = () => fence();
  if (signal) {
    if (signal.aborted) fence();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const heartbeat = setIntervalFn(renewNow, heartbeatMs);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  return Object.freeze({
    signal: controller.signal,
    isActiveRun,
    renewNow,
    stop() {
      clearIntervalFn(heartbeat);
      if (signal) signal.removeEventListener('abort', onAbort);
      fence();
    },
  });
}

function readConfig(repoDir) {
  const file = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(file)) return {};
  return readJsonFile(file);
}

export function createSchedulerRuntime({ repoDir, config = {} }) {
  const taskSource = createSchedulerTaskSource({ repoDir, config });
  const agentRegistry = loadAgentRegistry(undefined, { repoDir });
  const pipelineRunners = loadRuntimeStageRunners({ registeredRunners: config.registered_stage_runners });
  const pipelineStages = loadRuntimePipelineManifest({ repoDir, runners: pipelineRunners });
  return Object.freeze({ taskSource, agentRegistry, pipelineRunners, pipelineStages });
}

function lockPath(repoDir) {
  return path.join(repoDir, '.qa', 'guardian', '.scheduler.lock');
}

// Run one issue's guardian invocation to completion, holding + heartbeating the N=1 lock for
// its whole duration. Spawns WITHOUT a shell (argv array), so issue-derived prompt text can
// never be interpreted by a shell. Returns the child's exit code.
function runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs, timeoutMs = 0, signal) {
  return new Promise((resolve) => {
    // Resolve the real opencode executable at the spawn point (Windows needs opencode.cmd). The
    // invokeArgv.cmd descriptor stays the logical name 'opencode'; only the actual spawn resolves it.
    const bin = invokeArgv.cmd === 'opencode' ? resolveOpencodeBin() : invokeArgv.cmd;
    const args = [...invokeArgv.args];
    const serverUrl = process.env.QA_GUARDIAN_OPENCODE_SERVER_URL;
    if (serverUrl && !args.includes('--attach')) args.splice(1, 0, '--attach', serverUrl);
    const child = spawn(bin, args, {
      cwd: repoDir, shell: false, stdio: 'inherit', windowsHide: true,
    });
    // NOTE: the N=1 lease heartbeat is owned by the OUTER critical section (started right after
    // acquireLock in tick, cleared in its finally), so it covers the whole critical section —
    // investigation AND fixer — not just this spawn. This prevents a long investigation from going
    // lease-stale mid-run (E2E bug #2). No heartbeat here; the outer one renews for us.
    let timedOut = false;
    const done = (code) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
      resolve(code);
    };
    const stop = () => { if (!child.killed) child.kill(); };
    // No forced timeout by default (timeoutMs<=0). A positive value opts back into a hard kill.
    const timer = hasTimeout(timeoutMs) ? setTimeout(() => { timedOut = true; stop(); }, Number(timeoutMs)) : null;
    if (signal) {
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    }
    child.on('exit', (code) => done(timedOut ? 124 : (code ?? 0)));
    child.on('error', () => done(1));
  });
}

async function tick(repoDir, config, logger, signal = null, runtime = createSchedulerRuntime({ repoDir, config })) {
  const qaRuntimeDir = config.qa_runtime_dir ?? repoDir;
  const leaseMs = config.lease_ms;
  const now = Date.now();
  const guardianDir = guardianDirOf(repoDir);
  const trustedAuthors = config.command_authors ?? [];
  const { taskSource, agentRegistry, pipelineRunners, pipelineStages } = runtime;
  const issues = await listCandidatesFromTaskSource(repoDir, taskSource, { logger, source: config.task_source?.type ?? config.task_source ?? 'github' });

  // Shared OpenCode server client (Oracle design): one serve, SDK sessions per role. Created once
  // per tick from the configured server URL; null when no shared server is configured (fallback to
  // child-process path).
  const serverUrl = process.env.QA_GUARDIAN_OPENCODE_SERVER_URL;
  const opencodeClient = serverUrl ? createOpencodeClient({ baseUrl: serverUrl, logger }) : null;
  // Provider resilience: when a specialist/plan prompt hits a provider cooldown (429), retry the
  // same session on the next configured fallback model instead of failing the whole investigation.
  const fallbackModels = Array.isArray(config.fallback_models)
    ? config.fallback_models.filter((m) => typeof m === 'string' && m)
    : [];
  const supervisor = opencodeClient ? createSupervisorExecutor({ repoDir }) : null;
  let qaAudit = null;
  let finalizationStarted = false;
  try {
  const decisions = await Promise.all(issues.map(async ({ taskRef, claim_source }) => ({
    ...(await pollTaskObservation({ repoDir, guardianDir, taskSource, taskRef, leaseMs, now, trustedAuthors })),
    claim_source,
  })));

  for (const decision of decisions) {
    logger.info('route.decision', { issue: decision.issue, action: decision.action, to_state: decision.toState ?? null, reason: decision.reason ?? null });
  }

  // Labels are best-effort visible projection; state JSON remains authoritative.
  for (const decision of decisions) {
    const record = readState(guardianDirOf(repoDir), decision.issue);
    if (!record) continue;
     const projection = projectLabels(repoDir, decision.issue, record, undefined, ACTORS.SUPERVISOR);
    if (projection.errors.length > 0) logger.warn('labels.projection_failed', { issue: decision.issue, errors: projection.errors.length });
  }

  // planTick selects the single runnable candidate (pure). Actual N=1 exclusion is enforced by
  // the ATOMIC lock acquire below — planTick's lock arg is null here so it only picks a candidate.
  const plan = planTick({ decisions, lock: null, leaseMs, now });

  if (plan.toRun?.taskRef && plan.toRun.taskRef.source !== 'github') {
    logger.warn('run.unsupported_source', {
      issue: plan.toRun.issue,
      source: plan.toRun.taskRef.source,
      reason: `unsupported-source:${plan.toRun.taskRef.source}`,
    });
    return;
  }

  persistCommandlessTransitions({
    decisions: preRunPersistableDecisions(decisions, plan.toRun),
    guardianDir: guardianDirOf(repoDir),
    now: new Date(now).toISOString(),
  });

  const proposalResults = publishWaitingGate1Proposals({
    decisions,
    guardianDir: guardianDirOf(repoDir),
    actor: ACTORS.SUPERVISOR,
    io: { ghComment: defaultGhComment(repoDir, ACTORS.SUPERVISOR) },
  });
  for (const result of proposalResults) {
    if (result.error) logger.warn('gate1.proposal_recovery_failed', { issue: result.issue, error_message: result.error });
    else if (result.published) logger.info('gate1.proposal_recovered', { issue: result.issue });
  }

  // Deliver notifications (FR-21 / §11B.5) for gate-stop/STALLED/HANDED_BACK decisions BEFORE
  // handling the run. Idempotent per last_notified_state; independent of the N=1 run lock, so a
  // stopped issue is announced even while another issue is running. Best-effort per issue.
  const notifyDecisions = plan.notify.filter((decision) => !decision.taskRef || decision.taskRef.source === 'github');
  if (notifyDecisions.length > 0) {
    const guardianDir = guardianDirOf(repoDir);
    const results = deliverNotifications({
       decisions: notifyDecisions,
      guardianDir,
      config,
       actor: ACTORS.SUPERVISOR,
       io: { ghComment: defaultGhComment(repoDir, ACTORS.SUPERVISOR), curlPost: defaultCurlPost(ACTORS.SUPERVISOR) },
    });
    const delivered = results.filter((r) => r.delivered).length;
     logger.info('notify.summary', { attempted: notifyDecisions.length, delivered });
  }

  if (!plan.toRun) {
    logger.info('tick.idle', { polled: decisions.length, qa_runtime_dir: qaRuntimeDir });
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

  // N=1 critical-section heartbeat: renew the lease for the WHOLE critical section (investigation
  // + fixer + QA + PR), so a long investigation cannot go lease-stale and be judged STALLED by
  // another poll (E2E bug #2). Cleared in the finally below. Owner-guarded by handle.token.
  const runFence = createLeaseFence({ lockFile, handle, leaseMs, signal });
  const { isActiveRun } = runFence;

  try {
  if (!isActiveRun()) return;
  const currentBeforeRun = readState(guardianDirOf(repoDir), issue);
  if (plan.toRun.claim_source === 'discovered' && !currentBeforeRun) {
    const claimId = randomUUID();
    writeState(guardianDirOf(repoDir), {
      issue, state: STATES.INVESTIGATING, claim_id: claimId, claimed_at: new Date(now).toISOString(), claim_source: 'discovered',
    }, { touch: false });
    const claimProjection = projectLabels(repoDir, issue, { issue_class: null, risk: null, state: 'INVESTIGATING' }, undefined, ACTORS.SUPERVISOR);
    if (claimProjection.errors.length > 0) logger.warn('claim.doing_projection_failed', { issue, errors: claimProjection.errors.length });
    logger.info('claim.accepted', { issue, claim_source: 'discovered' });
  }
  if (currentBeforeRun && plan.toRun.command) {
    const currentPair = readArtifactPair(guardianDirOf(repoDir), issue);
    const currentIdentity = artifactIdentity(currentPair);
    const commandState = applyGateCommandState({
      currentBeforeRun,
      command: {
        ...plan.toRun.command,
        clearFixRounds: plan.toRun.clearFixRounds,
        nextStallRetries: plan.toRun.nextStallRetries,
        manualFixResume: plan.toRun.manualFixResume,
      },
      currentIdentity,
      repoDir,
      qaRuntimeDir,
      now: new Date(now).toISOString(),
    });
    writeState(guardianDirOf(repoDir), commandState, { touch: false });
    if (plan.toRun.command.verb === 'revise') quarantineArtifacts(guardianDirOf(repoDir), issue);
  }
  const investigationMode = config.investigation_mode ?? 'enforced';
  if (investigationMode !== 'legacy') {
    const guardianDir = guardianDirOf(repoDir);
    const pair = readArtifactPair(guardianDir, issue);
    const dossier = pair.dossier;
    const planArtifact = pair.plan;
    if (!pair.complete) {
      if (dossier || planArtifact) quarantineArtifacts(guardianDir, issue);
      const investigationState = readState(guardianDir, issue) ?? { issue };
      try {
        const issueData = { title: plan.toRun.issueTitle ?? '', body: plan.toRun.issueBody ?? '' };
        const memoryContext = recallEngineeringMemory({ config, repoDir, issue, issueData });
        if (memoryContext.status === 'unavailable') logger.warn('memory.recall_unavailable', { issue, provider: memoryContext.provider, reason: memoryContext.reason });
        let investigationConfig = config;
        if (opencodeClient?.getAgents) {
          const agents = await opencodeClient.getAgents(qaRuntimeDir);
          if (agents.kind === 'ok') {
            const unavailable = unavailableGuardianAgents(config, agents.agents, agentRegistry);
            if (unavailable.length > 0) {
              logger.warn('investigation.agents_unavailable', { issue, agents: unavailable.join(',') });
              investigationConfig = disableUnavailableGuardianAgents(config, agents.agents, agentRegistry);
            }
          } else {
            logger.warn('investigation.agent_probe_failed', { issue, error_message: agents.error instanceof Error ? agents.error.message : 'unknown' });
          }
        }
        const prepared = await prepareInvestigation({
          issue,
          issueData,
           repoDir, qaRuntimeDir, guardianDir, issueClass: config.default_issue_class ?? 'bug',
          complexity: config.investigation_complexity ?? 'complex',
          capabilities: discoverCapabilities({ env: process.env, config: investigationConfig }),
          config: investigationConfig,
          agentRegistry,
          memoryContext,
          state: investigationState,
          round: investigationState.processing_round ?? 1,
           signal: runFence.signal,
          logger,
          runSpecialist: (args) => processSpecialistRunner({
            ...args,
            opencodeClient,
            fallbackModels,
            model: resolveModelForRole(config, args.role),
            deadlineMs: resolveSessionDeadlineMs(config, 'specialist_deadline_ms'),
            progressSink: (fields) => logger.info('specialist.progress', fields),
          }),
           buildPlan: (args) => processPlanBuilder({ ...args, repoDir, qaRuntimeDir, guardianDir, state: investigationState, opencodeClient, fallbackModels, model: resolveModelForRole(config, 'plan'), deadlineMs: resolveSessionDeadlineMs(config, 'specialist_deadline_ms') }),
         });
         if (!isActiveRun()) return;
         const state = readState(guardianDir, issue) ?? { issue };
        writeState(guardianDir, {
          ...state,
          dossier_path: prepared.artifact_paths.dossier_path,
          plan_path: prepared.artifact_paths.plan_path,
          dossier_status: prepared.validation.valid ? 'valid' : 'invalid',
          plan_status: prepared.planResult.valid ? 'valid' : 'invalid',
          ...artifactIdentity({ dossier: prepared.dossier, plan: prepared.plan }),
          opencode: prepared.opencode ?? investigationState.opencode,
          specialists_requested: prepared.specialists ?? state.specialists_requested,
          investigation_started_at: prepared.timing?.investigation_started_at ?? state.investigation_started_at,
          investigation_completed_at: prepared.timing?.investigation_completed_at ?? state.investigation_completed_at,
          investigation_duration_ms: prepared.timing?.investigation_duration_ms ?? state.investigation_duration_ms,
          plan_duration_ms: prepared.timing?.plan_duration_ms ?? state.plan_duration_ms,
          specialist_durations_ms: prepared.timing?.specialist_durations_ms ?? state.specialist_durations_ms,
          evidence_count: prepared.dossier.evidence.length,
          hypothesis_ids: prepared.dossier.hypotheses.map((item) => item.id),
          unresolved_fact_count: prepared.dossier.unresolved_facts.length,
          acceptance_criteria_count: prepared.dossier.acceptance_criteria.length,
          last_phase: 'plan-validated',
        }, { touch: false });
        logger.info('investigation.artifacts_ready', {
          issue,
          mode: investigationMode,
          investigation_duration_ms: prepared.timing?.investigation_duration_ms ?? null,
        });
      } catch (error) {
        if (!isActiveRun()) return;
        const failureState = readState(guardianDir, issue) ?? { issue };
        // Persist session metadata + measured durations even on failure so a retry can inspect the
        // same specialist sessions. The state must stop being active immediately; otherwise a failed
        // investigation looks like a fresh in-progress lease until timeout.
        writeState(guardianDir, buildInvestigationFailureState({ failureState, investigationState, error }), { touch: false });
        // Lock cleanup is owned SOLELY by the inner finally (runFence.stop() then releaseLock, once).
        // Releasing here while the heartbeat fence is still active would double-release and leave a
        // live heartbeat briefly running against a released lock (Oracle review: line-454 lifecycle bug).
        logger.error('investigation.failed', { issue, error_message: error instanceof Error ? error.message : 'unknown', ...jsonFailureFields(error) });
        return;
      }
    }
  }

  if (investigationMode !== 'legacy') {
    if (!isActiveRun()) return;
    const guardianDir = guardianDirOf(repoDir);
    const pair = readArtifactPair(guardianDir, issue);
    const dossier = pair.dossier;
    const planArtifact = pair.plan;
    const gateState = readState(guardianDir, issue);
    const identity = artifactIdentity(pair);
    if (gateState && (gateState.plan_hash !== identity.plan_hash || gateState.plan_revision !== identity.plan_revision || gateState.dossier_revision !== identity.dossier_revision)) {
      writeState(guardianDir, { ...gateState, ...identity }, { touch: false });
    }
    const gate = assessFixingEntry({
      plan: planArtifact,
      dossier,
      investigationMode,
      humanApproved: Boolean(gateState?.gate_1_approved_comment_id),
      currentPlanHash: identity.plan_hash,
      currentPlanRevision: identity.plan_revision,
      approvedPlanHash: gateState?.gate_1_approved_plan_hash,
      approvedPlanRevision: gateState?.gate_1_approved_plan_revision,
    });
    if (!gate.allowed || gate.shadow === true) {
      const current = readState(guardianDir, issue) ?? { issue };
      const gate1StatePatch = {
        state: 'GATE_1_WAIT',
        risk: 'HIGH',
        gate_1_approved_comment_id: null,
        gate_1_approved_plan_hash: null,
        gate_1_approved_plan_revision: null,
        // Keep last applied command audit; do NOT roll back last_consumed_comment_id (would hot-loop
        // the same approve). The plan must be revised/regenerated, then explicitly re-approved.
        last_error_class: 'plan-gate-rejected',
        last_phase: 'gate1-wait-rejected',
        plan_validation_errors: gate.plan_result?.errors ?? [],
      };
      try {
       closeoutTransition({
         guardianDir,
         decision: {
           action: 'GATE_1_WAIT',
           issue,
           taskRef: plan.toRun.taskRef,
           proposal: { plan: planArtifact, dossier, planHash: identity.plan_hash, planRevision: identity.plan_revision },
         },
         statePatch: gate1StatePatch,
         config,
         actor: ACTORS.SUPERVISOR,
         io: {
            ghComment: (commentIssue, text) => defaultGhComment(repoDir, ACTORS.SUPERVISOR)(commentIssue, text),
            curlPost: defaultCurlPost(ACTORS.SUPERVISOR),
          },
          deliver: null,
          isActiveRun,
        });
      } catch (error) {
        logger.warn('gate1.comment_failed', { issue, error_message: error instanceof Error ? error.message : 'unknown' });
      }
      // Lock cleanup is owned SOLELY by the inner finally (runFence.stop() then releaseLock, once);
      // same lifecycle fix as the investigation-failure branch — no explicit release inside the fence.
      logger.warn('run.blocked_plan_gate', { issue, mode: investigationMode, reason: gate.reason ?? 'shadow-mode' });
      return;
    }
    logger.info('run.plan_gate_passed', { issue, mode: investigationMode });
  }

  // Refresh the prompt after artifacts exist so the write-capable agent receives the exact
  // validated dossier/plan paths rather than an ungrounded generic invocation.
  if (investigationMode !== 'legacy') {
    if (!isActiveRun()) return;
    invokeArgv = invocationArgvFor(repoDir, issue, plan.toRun, {
      dossierPath: path.join(guardianDirOf(repoDir), String(issue), 'dossier.json'),
      planPath: path.join(guardianDirOf(repoDir), String(issue), 'plan.json'),
      runtimeMode: investigationMode,
    });
  }

  if (plan.toRun.newRound && plan.toRun.command) {
    if (!isActiveRun()) return;
    const current = readState(guardianDirOf(repoDir), issue);
    if (current) writeState(guardianDirOf(repoDir), startFollowupRound(current, plan.toRun.command), { touch: false });
    logger.info('followup.round_started', { issue, round: (current?.processing_round ?? 1) + 1 });
  }

    logger.info('run.begin', { issue, action, to_state: toState });
  try {
    const guardianDir = guardianDirOf(repoDir);
    const githubEffectSink = createGitHubEffectSink({ repoDir });
    let code = 0;
    let qaVerdict = null;
    let finalization = null;

    if (opencodeClient) {
      const pipeline = await runPipeline({
        stages: pipelineStages,
        runners: pipelineRunners,
        context: stageRunnerContext({
           client: opencodeClient,
           issue,
           taskRef: plan.toRun.taskRef,
           executionSpec: plan.toRun.executionSpec,
           repoDir,
          guardianDir,
          command: plan.toRun.command,
          issueTitle: plan.toRun.issueTitle,
          config,
          investigationMode,
          supervisor,
           effectSink: {
             emit: (descriptor) => (isActiveRun()
               ? githubEffectSink.emit(descriptor)
               : { ok: false, fenced: true }),
           },
          notifyStage: {
            enabled: Boolean(config.notify_webhook),
            webhookUrl: config.notify_webhook ?? null,
          },
           fallbackModels,
           signal: runFence.signal,
           isActiveRun,
           logger,
           readState,
           readArtifactPair,
           writeState: (...args) => (isActiveRun() ? writeState(...args) : null),
           writeArtifact: (...args) => (isActiveRun() ? (args[2] === 'qa-verdict'
             ? writeQaVerdictArtifact(args[0], args[1], args[3])
             : writeArtifact(...args)) : null),
           writeMarkdownArtifact: (...args) => (isActiveRun() ? writeMarkdownArtifact(...args) : null),
          resolveSessionDeadlineMs,
          resolveModelForRole,
        }),
      });
      if (!isActiveRun()) return;
      if (pipeline.stopped) return;
      qaVerdict = pipeline.qaVerdict;
    } else {
      // Legacy path: fixer spawns and internally dispatches qa (writes qa-verdict.json itself).
      code = await runInvocation(repoDir, invokeArgv, lockFile, handle, leaseMs, Number(config.child_timeout_ms ?? 0), runFence.signal);
      if (!isActiveRun()) return;
      qaVerdict = readArtifact(guardianDir, issue, 'qa-verdict');
    }

    if (!isActiveRun()) return;
    qaAudit = auditQaVerdict(qaVerdict, {
      issue,
      branch: readState(guardianDir, issue)?.branch ?? undefined,
    });
    const afterRun = readState(guardianDir, issue) ?? { issue };
    writeState(guardianDir, materializeQaVerdictState({ afterRun, issue, qaVerdict, qaAudit, code }), { touch: false });
    if (!qaAudit.approved) logger.warn('qa.verdict_unapproved', { issue, reason: qaAudit.reason, exit_code: code });
    else logger.info('qa.verdict_passed', { issue, exit_code: code });

    if (opencodeClient && investigationMode === 'enforced' && qaAudit.approved) {
      if (!isActiveRun()) return;
      finalizationStarted = true;
      finalization = await supervisor.finalizeFix({ issue, plan: readArtifactPair(guardianDir, issue).plan, mode: investigationMode, isActiveRun });
      if (!isActiveRun()) return;
      const finalizedState = readState(guardianDir, issue) ?? afterRun;
      writeState(guardianDir, { ...finalizedState, branch: finalization.branch }, { touch: false });
    }

    // Supervisor writes the authoritative [QA_FAILED] comment ONLY when an actual verdict artifact
    // exists and it did not approve (FAIL/BLOCKED/NHR). A missing verdict means the run stopped
    // mid-pipeline (e.g. at a gate) and is NOT a QA failure — do not post then. Enforced mode only.
    if (investigationMode === 'enforced' && qaVerdict && !qaAudit.approved) {
      if (!isActiveRun()) return;
      let qaAcceptance = null;
      try {
        qaAcceptance = readRequiredQaAcceptance(guardianDir, issue);
      } catch (error) {
        logger.warn('qa.acceptance_read_failed', { issue, error_message: error instanceof Error ? error.message : 'unknown' });
      }
      writeVerdictComment(guardianDir, issue, {
        approved: false,
        status: qaVerdict?.status ?? null,
        branch: afterRun.branch ?? null,
        reason: qaAudit.reason,
        qaAcceptanceMarkdown: qaAcceptance,
        supervisorEvidenceSummary: summarizeSupervisorEvidence(qaVerdict?.supervisor_evidence),
        reportHash: qaVerdict?.report_hash ?? null,
        attempt: afterRun.fix_rounds ?? 1,
      }, { actor: ACTORS.SUPERVISOR, isActiveRun, ghComment: defaultGhComment(repoDir, ACTORS.SUPERVISOR), logger });
    }

    if (investigationMode === 'enforced' && qaAudit.approved) {
      if (!isActiveRun()) return;
      const currentBranch = finalization?.branch ?? (readState(guardianDir, issue)?.branch ?? afterRun.branch);
      const qaGate = canCreatePr({
        verdict: qaVerdict,
        issue,
        branch: currentBranch,
         expectedPlanHash: afterRun.plan_hash ?? undefined,
         expectedPlanRevision: afterRun.plan_revision ?? undefined,
      });
      if (!qaGate.allowed) {
        logger.warn('pr.blocked_qa_gate', { issue, errors: qaGate.errors.length });
      } else if (!currentBranch) {
        logger.warn('pr.blocked_missing_branch', { issue });
      } else {
        const baseBranch = config.base_branch ?? 'dev';
        const qaAcceptance = readRequiredQaAcceptance(guardianDir, issue);
        const pr = openGate2PullRequest({
          repoDir,
          guardianDir,
          issue,
          issueTitle: plan.toRun.issueTitle ?? null,
          baseBranch,
          currentBranch,
          verdict: qaVerdict,
          actor: ACTORS.SUPERVISOR,
        });
        if (!isActiveRun()) return;
        const gate2State = readState(guardianDir, issue) ?? afterRun;
        writeState(guardianDir, {
          ...gate2State,
          state: 'GATE_2_WAIT',
          pr_url: pr.url,
          last_phase: 'pr-opened',
        }, { touch: false });
        logger.info('pr.opened_gate2', { issue });
        const memoryRecord = recordEngineeringMemory({
          config,
          repoDir,
          issue,
          summary: `Issue #${issue}\nPR: ${pr.url}\nBranch: ${currentBranch}\nQA: ${qaVerdict?.status ?? 'PASS'}\n${qaAcceptance}`,
        });
        if (memoryRecord.status === 'unavailable') logger.warn('memory.record_unavailable', { issue, provider: memoryRecord.provider, reason: memoryRecord.reason });
        // Supervisor writes the authoritative [QA_VERIFIED] verification comment (§3A).
        writeVerdictComment(guardianDir, issue, {
          approved: true,
          status: qaVerdict?.status ?? 'PASS',
          branch: currentBranch,
          prUrl: pr.url,
          prTitle: pr.title,
          qaAcceptanceMarkdown: qaAcceptance,
          supervisorEvidenceSummary: summarizeSupervisorEvidence(qaVerdict?.supervisor_evidence),
          reportHash: qaVerdict?.report_hash ?? null,
          attempt: afterRun.fix_rounds ?? 1,
        }, { actor: ACTORS.SUPERVISOR, isActiveRun, ghComment: defaultGhComment(repoDir, ACTORS.SUPERVISOR), logger });
      }
    }
    logger.info('run.exit', { issue, exit_code: code });
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    if (isActiveRun()) {
      const guardianDir = guardianDirOf(repoDir);
      const current = readState(guardianDir, issue) ?? { issue };
      const phase = finalizationStarted && !finalization && qaAudit?.approved ? 'finalization' : 'run-error';
      writeState(guardianDir, buildRunFailureState({ currentState: current, error, phase }), { touch: false });
    }
    logger.error('run.error', { issue, error_message: errorMessage });
    throw error;
  }
  } finally {
    runFence.stop();
    releaseLock(lockFile, handle);
  }
  } finally {
    await opencodeClient?.close?.();
  }
}

// Supervisor is the SOLE writer of the [QA_VERIFIED]/[QA_FAILED] verdict comment (§3, §3A).
// Idempotent per last_verdict_comment_hash: the same comment is never posted twice. Best-effort —
// a gh delivery failure is logged and swallowed so the resident loop survives (like notify-io).
// Side effects (ghComment/readState/writeState) are injected so this is unit-testable without gh.
export function materializeQaVerdictState({ afterRun, issue, qaVerdict, qaAudit, code }) {
  return {
    ...afterRun,
    qa_verdict_path: qaVerdict ? path.join(String(issue), 'qa-verdict.json') : null,
    qa_verdict_status: qaVerdict?.status ?? null,
    qa_verdict_hash: qaVerdict?.report_hash ?? null,
    qa_verdict_report: qaVerdict?.evidence_summary ?? null,
    supervisor_test_evidence: qaVerdict?.supervisor_evidence ?? null,
    last_child_exit_code: code,
    last_error_class: qaAudit.approved || qaVerdict?.status === 'FAIL' ? afterRun.last_error_class : qaAudit.reason,
    last_phase: qaAudit.approved || qaVerdict?.status === 'FAIL' ? afterRun.last_phase : 'qa-unapproved',
  };
}

export function writeVerdictComment(guardianDir, issue, params, deps) {
  const isActiveRun = deps?.isActiveRun ?? (() => true);
  const fenceError = 'verdict comment fenced: active run is false';
  if (!isActiveRun()) return { delivered: false, fenced: true, error: fenceError, marker: markerForApproval(params.approved) };
  const rs = deps?.readState ?? readState;
  const ws = deps?.writeState ?? writeState;
  const ghComment = deps.ghComment;
  const actor = deps.actor;
  const logger = deps.logger;
  const marker = markerForApproval(params.approved);
  const body = buildVerdictComment({
    marker,
    issue,
    status: params.status ?? null,
    branch: params.branch ?? null,
    prUrl: params.prUrl ?? null,
    prTitle: params.prTitle ?? null,
    qaAcceptanceMarkdown: params.qaAcceptanceMarkdown ?? null,
    supervisorEvidenceSummary: params.supervisorEvidenceSummary ?? null,
    runId: params.runId ?? null,
    attempt: Number.isInteger(params.attempt) ? params.attempt : 1,
    reportHash: params.reportHash ?? null,
    reason: params.reason ?? null,
    ...(params.verifiedAt ? { verifiedAt: params.verifiedAt } : {}),
  });
  const hash = hashVerdictComment(body);
  const record = rs(guardianDir, issue);
  if (record && record.last_verdict_comment_hash === hash) {
    return { delivered: false, skipped: true, marker };
  }
  try {
    assertActorMayPerform(actor, EFFECTS.FACT_COMMENT);
    if (!isActiveRun()) return { delivered: false, fenced: true, error: fenceError, marker };
    ghComment(issue, body);
    const fresh = rs(guardianDir, issue) ?? record ?? { issue };
    ws(guardianDir, { ...fresh, last_verdict_comment_hash: hash }, { touch: false });
    logger?.info('verdict.comment_posted', { issue, marker });
    return { delivered: true, marker };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger?.warn('verdict.comment_failed', { issue, marker, error_message: msg });
    return { delivered: false, error: msg, marker };
  }
}

// Resolve which repo the scheduler watches. Precedence (highest first):
//   1. CLI: --repo <dir>
//   2. env: QA_GUARDIAN_REPO
//   3. current working directory
// Exported + pure (argv/env injected) so it is unit-testable.
export async function runScheduler({ repoDir, config = readConfig(repoDir), signal } = {}) {
  if (!repoDir) throw new Error('scheduler requires repoDir');
  if (!config.qa_runtime_dir && process.env.QA_GUARDIAN_QA_RUNTIME_DIR) {
    config = { ...config, qa_runtime_dir: process.env.QA_GUARDIAN_QA_RUNTIME_DIR };
  }
  const validatedConfig = validateSchedulerConfig(config);
  const interval = validatedConfig.poll_interval_ms;
  const logger = createLogger({ component: 'scheduler' });
  const runtime = createSchedulerRuntime({ repoDir, config: validatedConfig });

  logger.info('watch.begin', { repo_dir: repoDir, interval_ms: interval, concurrency: 1 });
  while (!signal?.aborted) {
    try {
      logger.info('tick.begin');
      await tick(repoDir, validatedConfig, logger, signal, runtime);
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
