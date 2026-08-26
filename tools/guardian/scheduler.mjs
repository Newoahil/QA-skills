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

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJsonFile } from './runtime-io.mjs';

import { defaultGhReader, DEFAULT_LEASE_MS, invocationArgvFor } from './poll.mjs';
import { readState, startFollowupRound, STATES, writeState } from './state.mjs';
import { storageKey as taskRefStorageKey, isNumericStorageKey, makeTaskRef } from './task-ref.mjs';
import { routeIssue } from './state-router.mjs';
import { commandlessStateTransition, planTick, preRunPersistableDecisions } from './scheduler-core.mjs';
import { acquireLock, renewLock, releaseLock } from './lock.mjs';
import { closeoutTransition, deliverNotifications, defaultGhComment, defaultCurlPost, publishGate1Proposal } from './notify-io.mjs';
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
import { createGitHubTaskSource } from './github-task-source.mjs';
import { createHttpTaskSource } from './http-task-source.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { createSupervisorExecutor } from './supervisor-exec.mjs';
import { ACTORS, assertActorMayPerform, EFFECTS } from './actor-routing.mjs';
import { atomicWriteJson } from './atomic-io.mjs';
import { recallEngineeringMemory, recordEngineeringMemory } from './memory-provider.mjs';

const FIXER_START_KIND = 'fixer-start';

export function sessionStatusAction(status) {
  if (status === 'ok') return { continue: true, retry: false, failClosed: false };
  if (status === 'retry') return { continue: false, retry: true, failClosed: false };
  return { continue: false, retry: false, failClosed: true };
}

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

export function buildInvestigationFailureState({ failureState, investigationState, error }) {
  const failureRoles = Array.isArray(error?.specialist_failures) ? error.specialist_failures : null;
  const failedSpecialists = failureRoles ?? Object.entries(investigationState.opencode?.specialists ?? {})
    .filter(([, session]) => session?.last_status === 'failed')
    .map(([role]) => role);
  const failureDurations = error?.specialist_durations_ms && typeof error.specialist_durations_ms === 'object' ? error.specialist_durations_ms : null;
  const failedDurations = failureDurations ?? Object.fromEntries(
    Object.entries(investigationState.opencode?.specialists ?? {})
      .filter(([, session]) => typeof session?.duration_ms === 'number')
      .map(([role, session]) => [role, session.duration_ms]),
  );
  return {
    ...failureState,
    state: STATES.HANDED_BACK,
    handed_back_reason: 'investigation-failed',
    opencode: investigationState.opencode ?? failureState.opencode,
    specialist_failures: failedSpecialists.length > 0 ? failedSpecialists : failureState.specialist_failures,
    specialist_durations_ms: Object.keys(failedDurations).length > 0 ? failedDurations : failureState.specialist_durations_ms,
    dossier_status: 'failed',
    plan_status: 'failed',
    investigation_attempts: (failureState.investigation_attempts ?? 0) + 1,
    last_error_class: 'investigation-failed',
    last_phase: 'investigation',
    plan_validation_errors: [error instanceof Error ? error.message : 'investigation failed'],
  };
}

export function applyGateCommandState({ currentBeforeRun, command, currentIdentity, repoDir, qaRuntimeDir, now = new Date().toISOString() }) {
  const gateApproved = command.verb === 'approve';
  const gateRevision = command.verb === 'revise';
  const manualFixResume = command.verb === 'continue' && command.manualFixResume === true;
  return {
    ...currentBeforeRun,
    control_repo_dir: repoDir,
    qa_runtime_dir: qaRuntimeDir,
    state: gateApproved || manualFixResume ? STATES.FIXING : (gateRevision ? STATES.INVESTIGATING : currentBeforeRun.state),
    last_consumed_comment_id: command.commentId,
    last_command_verb: command.verb,
    last_command_comment_id: command.commentId,
    gate_1_approved_comment_id: gateApproved ? command.commentId : null,
    gate_1_approved_plan_hash: gateApproved ? currentIdentity.plan_hash : null,
    gate_1_approved_plan_revision: gateApproved ? currentIdentity.plan_revision : null,
    gate_1_revision_data: gateRevision ? command.data : currentBeforeRun.gate_1_revision_data,
    manual_fix_resume: manualFixResume ? true : currentBeforeRun.manual_fix_resume,
    manual_fix_resume_comment_id: manualFixResume ? command.commentId : currentBeforeRun.manual_fix_resume_comment_id,
    manual_fix_resume_data: manualFixResume ? command.data : currentBeforeRun.manual_fix_resume_data,
    gate_1_comment_hash: gateRevision ? null : currentBeforeRun.gate_1_comment_hash,
    last_gate_1_proposal_hash: gateRevision ? null : currentBeforeRun.last_gate_1_proposal_hash,
    last_notified_state: gateRevision ? null : currentBeforeRun.last_notified_state,
    dossier_status: gateRevision ? 'superseded' : currentBeforeRun.dossier_status,
    plan_status: gateRevision ? 'superseded' : currentBeforeRun.plan_status,
    dossier_hash: gateRevision ? null : currentBeforeRun.dossier_hash,
    dossier_revision: gateRevision ? null : currentBeforeRun.dossier_revision,
    plan_hash: gateRevision ? null : currentBeforeRun.plan_hash,
    plan_revision: gateRevision ? null : currentBeforeRun.plan_revision,
    fix_rounds: command.clearFixRounds ? 0 : currentBeforeRun.fix_rounds,
    stall_retries: command.nextStallRetries ?? currentBeforeRun.stall_retries,
    last_phase: gateRevision ? 'gate1-revision' : currentBeforeRun.last_phase,
    opencode: {
      ...(currentBeforeRun.opencode ?? { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null }),
      inflight: gateApproved || manualFixResume ? {
        operation_id: randomUUID(),
        role: 'fixer',
        kind: FIXER_START_KIND,
        round: currentBeforeRun.processing_round ?? 1,
        started_at: now,
        status: 'starting',
      } : null,
    },
  };
}

function writeQaVerdictArtifact(guardianDir, issue, qaVerdict) {
  return writeArtifact(guardianDir, issue, 'qa-verdict', qaVerdict);
}

// Sanitized supervisor evidence summary for the [QA_VERIFIED] human-readable section. Renders only
// allow-listed facts (status/diff exit code, test names + exit codes) — never raw command output,
// secrets, or paths. Returns null when nothing safe is present so the comment can say 未提供.
export function summarizeSupervisorEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const lines = [];
  const statusDiff = evidence.status_diff;
  if (statusDiff && typeof statusDiff === 'object') {
    lines.push(`- status/diff 退出码: ${Number.isInteger(statusDiff.exit_code) ? statusDiff.exit_code : 'n/a'}`);
  }
  const tests = Array.isArray(evidence.tests) ? evidence.tests : [];
  for (const test of tests) {
    if (!test || typeof test !== 'object') continue;
    const argv = Array.isArray(test.command) ? test.command.join(' ') : String(test.command ?? '');
    lines.push(`- 测试: ${argv || 'n/a'} → 退出码 ${Number.isInteger(test.exit_code) ? test.exit_code : 'n/a'}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

export const DEFAULT_INTERVAL_MS = 10 * 1000;
// Fix↔QA repair loop default bound. QA FAIL resumes the same fixer session with the previous
// report until QA passes, up to this cap; beyond it the issue is handed back with a human-review
// recommendation. Configurable per project via config.max_fix_rounds.
export const MAX_FIX_ROUNDS_DEFAULT = 5;
// Heartbeat cadence: renew the lock well within the lease so a live long run never looks stale.
const HEARTBEAT_MS = 30 * 1000;

function normalizePositiveMs(value, fallback) {
  const candidate = value ?? fallback;
  const normalized = Number(candidate);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

export function validateSchedulerConfig(config = {}) {
  const pollIntervalMs = normalizePositiveMs(config.poll_interval_ms, DEFAULT_INTERVAL_MS);
  if (pollIntervalMs === null) {
    throw new Error('scheduler poll_interval_ms must be a finite positive number');
  }

  const leaseMs = normalizePositiveMs(config.lease_ms, DEFAULT_LEASE_MS);
  if (leaseMs === null) {
    throw new Error('scheduler lease_ms must be a finite positive number');
  }

  if (leaseMs < pollIntervalMs * 2) {
    throw new Error('scheduler lease_ms must be at least 2x poll_interval_ms');
  }

  const maxFixRounds = config.max_fix_rounds ?? MAX_FIX_ROUNDS_DEFAULT;
  if (!Number.isInteger(maxFixRounds) || maxFixRounds < 1) {
    throw new Error('scheduler max_fix_rounds must be a positive integer');
  }

  return Object.freeze({
    ...config,
    poll_interval_ms: pollIntervalMs,
    lease_ms: leaseMs,
    max_fix_rounds: maxFixRounds,
  });
}

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
export function writeWatchState(repoDir, state, { fsOps, makeId } = {}) {
  mkdirSync(path.dirname(watchStatePath(repoDir)), { recursive: true });
  atomicWriteJson(watchStatePath(repoDir), state, { ...(fsOps ? { fsOps } : {}), ...(makeId ? { makeId } : {}) });
}

// Persist router transitions that do not have a guardian command to execute before notifications
// read the record. This keeps the notification stage and authoritative state on the same tick.
export function persistCommandlessTransitions({ decisions, guardianDir, deps = {} }) {
  const rs = deps.readState ?? readState;
  const ws = deps.writeState ?? writeState;
  const now = deps.now ?? new Date().toISOString();

  for (const decision of decisions) {
    const current = rs(guardianDir, decision.issue);
    if (!current) continue;
    const patch = commandlessStateTransition(current, decision);
    if (!patch) continue;
    const changed = Object.keys(patch).some((key) => current[key] !== patch[key]);
    if (!changed) continue;
    ws(guardianDir, { ...current, ...patch }, { touch: true, now });
  }
}

export function publishWaitingGate1Proposals({ decisions, guardianDir, io, actor = ACTORS.SUPERVISOR, deps = {} }) {
  const rs = deps.readState ?? readState;
  const results = [];
  for (const decision of decisions) {
    if (decision.action !== 'SKIP' || decision.reason !== 'gate1-waiting') continue;
    if (decision.taskRef?.source && decision.taskRef.source !== 'github') continue;
    const record = rs(guardianDir, decision.issue);
    if (!record) continue;
    if (record.state !== STATES.GATE_1_WAIT) continue;
    if (record.plan_status !== 'valid' || record.dossier_status !== 'valid') continue;
    const pair = readArtifactPair(guardianDir, decision.issue);
    if (!pair.complete) continue;
    const identity = artifactIdentity(pair);
    try {
      results.push({ issue: decision.issue, ...publishGate1Proposal({
        guardianDir,
        issue: decision.issue,
        record,
        plan: pair.plan,
        dossier: pair.dossier,
        planHash: record.plan_hash ?? identity.plan_hash,
        planRevision: record.plan_revision ?? identity.plan_revision,
        ghComment: io.ghComment,
        actor,
        deps,
      }) });
    } catch (error) {
      results.push({ issue: decision.issue, published: false, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return results;
}

export function listCandidates(repoDir, _config = {}, _now = new Date(), deps = {}) {
  const fields = ['number,createdAt,updatedAt,labels'];
  const issueList = deps.ghIssueList ?? ghIssueList;
  const stateReader = deps.readState ?? readState;
  const openIssues = issueList(repoDir, ['--state', 'open', '--limit', '1000', '--json', fields[0]]);
  const followups = readdirSync(path.join(repoDir, '.qa', 'guardian'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
    .map((entry) => readJsonFile(path.join(repoDir, '.qa', 'guardian', entry.name)))
    .filter((record) => record.state === 'DONE' || record.state === 'GATE_2_WAIT')
    .map((record) => ({ issue: Number(record.issue), updatedAt: record.updated_at, claim_source: 'followup' }));
  const candidates = openIssues.map((issue) => {
    const record = stateReader(path.join(repoDir, '.qa', 'guardian'), issue.issue);
    return { ...issue, claim_source: record ? 'existing' : 'discovered' };
  });
  const merged = new Map(candidates.concat(followups).map((x) => [x.issue, x]));
  const ordered = [...merged.values()].sort((a, b) => {
    const updated = String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''));
    return updated || Number(a.issue) - Number(b.issue);
  });
  if (deps.logger) {
    deps.logger.info('discovery.candidates', {
      count: ordered.length,
      open: openIssues.length,
      followups: followups.length,
      issues: ordered.map((x) => x.issue).join(','),
    });
  }
  return ordered;
}

export async function listCandidatesFromTaskSource(repoDir, taskSource, deps = {}) {
  const refs = await taskSource.listTasks();
  const stateReader = deps.readState ?? readState;
  const guardianDir = guardianDirOf(repoDir);
  const source = deps.source ?? refs[0]?.source ?? 'github';
  const candidates = refs.map((ref) => {
    const issue = schedulerStateKey(ref);
    const record = stateReader(guardianDir, issue);
    return { issue, taskRef: ref, updatedAt: ref.updatedAt ?? ref.updated_at, claim_source: record ? 'existing' : 'discovered' };
  });
  // A1 (decision-e8c0d364): the followup scan accepts BOTH legacy numeric `<n>.json` (github) and
  // source-qualified `<source>__<taskId>.json` files, rebuilding a faithful TaskRef from either.
  const followups = readdirSync(guardianDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.json$/.test(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, record: safeReadRecord(path.join(guardianDir, entry.name)) }))
    .filter(({ record }) => record && (record.state === 'DONE' || record.state === 'GATE_2_WAIT'))
    .map(({ name, record }) => {
      const taskRef = followupTaskRef(record, name, source);
      // The state key is the record's ACTUAL on-disk key (the filename stem), so a legacy
      // `<n>.json` keeps its numeric key even when rediscovered under a non-github source; a
      // durable source-qualified record keeps its `<source>__<taskId>` key.
      const stateKey = String(name).replace(/\.json$/, '');
      const issue = isNumericStorageKey(stateKey) ? Number(stateKey) : stateKey;
      return { issue, taskRef, updatedAt: record.updated_at, claim_source: 'followup' };
    });
  const merged = new Map(candidates.concat(followups).map((x) => [candidateKey(x), x]));
  return [...merged.values()].sort((a, b) => {
    const updated = String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''));
    return updated || String(a.issue).localeCompare(String(b.issue), undefined, { numeric: true });
  });
}

export async function pollTaskObservation({ repoDir, guardianDir, taskSource, taskRef, leaseMs, now, trustedAuthors }) {
  const issue = schedulerStateKey(taskRef);
  const record = readState(guardianDir, issue);
  const observation = await taskSource.readTask(taskRef);
  const decision = routeIssue(record, observation, { leaseMs, now, trustedAuthors });
  return {
    issue,
    issueTitle: observation.facts?.title ?? null,
    issueBody: observation.facts?.body ?? '',
    taskRef,
    executionSpec: observation.spec,
    ...decision,
    invoke: null,
    invokeArgv: invocationArgvFor(repoDir, issue, decision),
  };
}

// A1 (decision-e8c0d364): the scheduler's per-task key used for state read/write, artifact paths,
// and lock/candidate identity. For a github ref this is the positive integer issue id (so all
// existing `<n>.json` / branch / artifact paths stay byte-identical); for any other source it is
// the source-qualified storageKey string (e.g. "pm__<uuid>"). Replaces the old
// numericSchedulerIssue(), which hard-rejected non-numeric ids.
function schedulerStateKey(ref) {
  if (ref?.source === 'github') {
    const issue = Number(ref?.taskId);
    if (!Number.isInteger(issue) || issue <= 0) {
      throw new Error(`github taskRef requires a positive numeric taskId: ${String(ref?.taskId)}`);
    }
    return issue;
  }
  return taskRefStorageKey(ref);
}

function safeReadRecord(file) {
  try {
    return readJsonFile(file);
  } catch {
    return null;
  }
}

// Rebuild the identity of a persisted followup record.
// Priority: (1) an explicit persisted task_ref (the durable, source-accurate identity for any
// non-github source); (2) otherwise reconstruct from the numeric issue under the CURRENT source
// context (`defaultSource`) — a legacy record stored as `<n>.json` carries no source of its own,
// so the discovering source is authoritative; (3) last resort, derive the taskId from the filename.
function followupTaskRef(record, fileName, defaultSource) {
  if (record.task_ref && typeof record.task_ref === 'object') {
    try {
      return makeTaskRef(record.task_ref);
    } catch {
      // fall through to reconstruction
    }
  }
  const numericIssue = Number(record.issue);
  if (Number.isInteger(numericIssue) && numericIssue > 0) {
    const taskId = String(numericIssue);
    const displayId = defaultSource === 'github' ? `#${taskId}` : taskId;
    return makeTaskRef({ source: defaultSource, taskId, displayId });
  }
  const base = String(fileName).replace(/\.json$/, '');
  return makeTaskRef({ source: defaultSource, taskId: base, displayId: base });
}

function candidateKey(candidate) {
  return `${candidate.taskRef?.source ?? 'github'}:${candidate.taskRef?.taskId ?? String(candidate.issue)}`;
}

export function createSchedulerTaskSource({ repoDir, config = {}, deps = {} }) {
  const source = typeof config.task_source === 'string' ? config.task_source : (config.task_source?.type ?? 'github');
  const trustedAuthors = config.command_authors ?? [];
  const guardianDir = guardianDirOf(repoDir);
  if (source === 'github') {
    return createGitHubTaskSource({
      repoDir,
      listIssues: deps.listIssues ?? ((targetRepoDir) => ghIssueList(targetRepoDir, ['--state', 'open', '--limit', '1000', '--json', 'number,createdAt,updatedAt,labels'])),
      readIssue: deps.readIssue ?? defaultGhReader(repoDir),
      readState: deps.readStateForSource ?? ((issue) => readState(guardianDir, issue)),
      trustedAuthors,
    });
  }
  if (source === 'http') {
    const listDispatches = deps.listDispatches ?? createConfiguredHttpListDispatches(config);
    const readDispatch = deps.readDispatch ?? createConfiguredHttpReadDispatch(config);
    if (typeof listDispatches !== 'function' || typeof readDispatch !== 'function') throw new Error('HTTP TaskSource requires listDispatches and readDispatch runtime bindings');
    return createHttpTaskSource({ listDispatches, readDispatch, trustedAuthors, authenticateEvent: deps.authenticateEvent });
  }
  throw new Error(`unknown task source: ${String(source)}`);
}

function createConfiguredHttpListDispatches(config) {
  const file = config.task_source?.dispatch_file ?? config.http_task_source?.dispatch_file;
  const baseUrl = httpTaskSourceBaseUrl(config);
  if (!file && !baseUrl) return undefined;
  if (baseUrl) return async () => fetchHttpDispatches(baseUrl, config.task_source?.list_path ?? config.http_task_source?.list_path ?? '/dispatches');
  return async () => {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed.dispatches ?? []);
  };
}

function createConfiguredHttpReadDispatch(config) {
  const file = config.task_source?.dispatch_file ?? config.http_task_source?.dispatch_file;
  const baseUrl = httpTaskSourceBaseUrl(config);
  if (!file && !baseUrl) return undefined;
  if (baseUrl) return async (id) => fetchHttpDispatch(baseUrl, config.task_source?.read_path ?? config.http_task_source?.read_path ?? '/dispatches/{id}', id);
  return async (id) => {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const dispatches = Array.isArray(parsed) ? parsed : (parsed.dispatches ?? []);
    const dispatch = dispatches.find((item) => String(item?.id) === String(id));
    if (!dispatch) throw new Error(`HTTP dispatch not found: ${String(id)}`);
    return dispatch;
  };
}

function httpTaskSourceBaseUrl(config) {
  const value = config.task_source?.base_url ?? config.task_source?.url ?? config.http_task_source?.base_url ?? config.http_task_source?.url;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim().replace(/\/$/, '');
}

async function fetchHttpDispatches(baseUrl, listPath) {
  const json = await fetchJson(`${baseUrl}${pathWithLeadingSlash(listPath)}`);
  return Array.isArray(json) ? json : (json.dispatches ?? []);
}

async function fetchHttpDispatch(baseUrl, readPath, id) {
  return fetchJson(`${baseUrl}${pathWithLeadingSlash(readPath).replace('{id}', encodeURIComponent(String(id)))}`);
}

function pathWithLeadingSlash(value) {
  const text = String(value ?? '').trim();
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP TaskSource request failed: ${response.status}`);
  return response.json();
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

function guardianDirOf(repoDir) {
  return path.join(repoDir, '.qa', 'guardian');
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
            issueData,
            opencodeClient,
            fallbackModels,
            model: resolveModelForRole(config, args.role),
            deadlineMs: resolveSessionDeadlineMs(config, 'specialist_deadline_ms'),
            progressSink: (fields) => logger.info('specialist.progress', fields),
          }),
           buildPlan: (args) => processPlanBuilder({ ...args, repoDir, qaRuntimeDir, guardianDir, issueData, opencodeClient, fallbackModels, model: resolveModelForRole(config, 'plan'), deadlineMs: resolveSessionDeadlineMs(config, 'specialist_deadline_ms') }),
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
        releaseLock(lockFile, handle);
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
      releaseLock(lockFile, handle);
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
    const qaAudit = auditQaVerdict(qaVerdict, {
      issue,
      branch: readState(guardianDir, issue)?.branch ?? undefined,
    });
    const afterRun = readState(guardianDir, issue) ?? { issue };
    writeState(guardianDir, {
      ...afterRun,
      qa_verdict_path: qaVerdict ? path.join(String(issue), 'qa-verdict.json') : null,
      qa_verdict_status: qaVerdict?.status ?? null,
      qa_verdict_hash: qaVerdict?.report_hash ?? null,
      last_child_exit_code: code,
      last_error_class: qaAudit.approved || qaVerdict?.status === 'FAIL' ? afterRun.last_error_class : qaAudit.reason,
      last_phase: qaAudit.approved || qaVerdict?.status === 'FAIL' ? afterRun.last_phase : 'qa-unapproved',
    }, { touch: false });
    if (!qaAudit.approved) logger.warn('qa.verdict_unapproved', { issue, reason: qaAudit.reason, exit_code: code });
    else logger.info('qa.verdict_passed', { issue, exit_code: code });

    if (opencodeClient && investigationMode === 'enforced' && qaAudit.approved) {
      if (!isActiveRun()) return;
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
    logger.error('run.error', { issue, error_message: error instanceof Error ? error.message : 'unknown' });
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
