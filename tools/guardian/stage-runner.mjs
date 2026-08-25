// QA Guardian — built-in pipeline stage runner.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { BUILTIN_PIPELINE_MANIFEST } from './pipeline.manifest.mjs';
import { STATES } from './state.mjs';
import { readArtifactPair, writeArtifact, writeMarkdownArtifact } from './artifacts.mjs';
import { runFixerSession } from './fixer-session-runner.mjs';
import { runQaSession } from './qa-session-runner.mjs';
import { ACTORS, EFFECTS } from './actor-routing.mjs';
import { githubIssueToTaskRef } from './task-ref.mjs';
import { MAX_FIX_ROUNDS } from './state-router.mjs';

const STAGE_KEYS = Object.freeze(['id', 'agent', 'runner', 'inputArtifacts', 'outputArtifacts', 'stateTransition', 'retryPolicy', 'producesEffects', 'extensionPoint']);
const PIPELINE_MANIFEST_KEYS = Object.freeze(['stages']);
const EXTENSION_POINTS = Object.freeze(['before-fixer', 'after-qa']);
export const RUNNERS = Object.freeze({ runFixerStage, runQaStage, runNotifyStage });

export function loadPipelineManifest(manifest = BUILTIN_PIPELINE_MANIFEST, runners = RUNNERS) {
  if (!Array.isArray(manifest)) throw new Error('pipeline manifest must be an array');
  const ids = new Set();
  return orderStages(manifest.map((stage, index) => normalizeStage(stage, ids, runners, index)));
}

export function loadRuntimePipelineManifest({ repoDir, projectManifest, runners = RUNNERS, readFile = readFileSync, exists = existsSync } = {}) {
  const manifest = projectManifest ?? readProjectPipelineManifest(repoDir, readFile, exists);
  if (manifest) validateProjectPipelineManifest(manifest);
  return loadPipelineManifest(manifest ? [...BUILTIN_PIPELINE_MANIFEST, ...manifest.stages] : BUILTIN_PIPELINE_MANIFEST, runners);
}

export function loadRuntimeStageRunners({ registeredRunners = Object.freeze({}) } = {}) {
  return Object.freeze({ ...RUNNERS, ...registeredRunners });
}

// B2 (PM-adapter prep, decision-e8c0d364): map an executionType to a trusted execution profile.
// Today only `coding` is implemented, and it resolves to the existing builtin fixer->qa->notify
// pipeline (byte-identical: the GitHub fix flow is coding). Every other executionType resolves to
// an explicit unsupported result so a future PM Result of type research/design/ops is BLOCKED with
// a clear reason rather than being forced through the fixer pipeline. This is a SELECTION function
// only — it does not change runPipeline, so current behavior is unchanged. Adding a new type later
// = add a profile here (trusted core code), not open arbitrary user-defined pipelines (ADR YAGNI).
export const SUPPORTED_EXECUTION_TYPES = Object.freeze(['coding']);

// null/undefined executionType (e.g. a GitHub issue, which has no PM executionType) is treated as
// `coding` so the existing flow is unaffected.
export function selectPipelineProfile(executionType, options = {}) {
  const type = executionType == null || executionType === '' ? 'coding' : String(executionType).toLowerCase();
  if (type === 'coding') {
    return Object.freeze({
      supported: true,
      executionType: 'coding',
      stages: loadRuntimePipelineManifest(options),
    });
  }
  return Object.freeze({
    supported: false,
    executionType: type,
    reason: `unsupported-execution-type:${type}`,
    supportedTypes: SUPPORTED_EXECUTION_TYPES,
  });
}

function readProjectPipelineManifest(repoDir, readFile, exists) {
  if (!repoDir) return null;
  const manifestPath = path.join(repoDir, '.qa', 'guardian', 'pipeline.manifest.json');
  if (!exists(manifestPath)) return null;
  return JSON.parse(readFile(manifestPath, 'utf8'));
}

function validateProjectPipelineManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('pipeline manifest file must be an object');
  for (const key of Object.keys(manifest)) {
    if (!PIPELINE_MANIFEST_KEYS.includes(key)) throw new Error(`unknown pipeline manifest key: ${key}`);
  }
  if (!Array.isArray(manifest.stages)) throw new Error('pipeline manifest file stages must be an array');
}

export async function runPipeline({ stages, context, runners = RUNNERS }) {
  const profile = selectExecutionProfile(context);
  if (!profile.supported) {
    return Object.freeze({ completion: null, qaVerdict: null, stopped: true, status: profile.reason });
  }
  const pipelineStages = stages ?? profile.stages;
  const state = { completion: null, qaVerdict: null };
  for (const stage of pipelineStages) {
    const runner = runners[stage.runner];
    if (!runner) throw new Error(`unknown stage runner: ${stage.runner}`);
    const result = await runner({ ...context, pipeline: state, stage });
    if (result?.completion) state.completion = result.completion;
    if (result?.qaVerdict) state.qaVerdict = result.qaVerdict;
    if (result?.stop) return Object.freeze({ ...state, stopped: true, stage: stage.id, status: result.status });
  }
  return Object.freeze({ ...state, stopped: false });
}

function selectExecutionProfile(context = {}) {
  const source = context.taskRef?.source ?? 'github';
  if (source === 'pm') {
    return Object.freeze({ supported: false, reason: 'pm-source-reserved' });
  }
  if (source !== 'github') {
    return Object.freeze({ supported: false, reason: `unsupported-source:${source}` });
  }
  return selectPipelineProfile(context.executionSpec?.executionType, { repoDir: context.repoDir });
}

export async function runFixerStage(context) {
  const isActiveRun = context.isActiveRun ?? (() => true);
  const currentState = context.readState(context.guardianDir, context.issue) ?? { issue: context.issue };
  const humanNote = context.command?.data
    ? {
        command_kind: context.command.verb,
        command_comment_id: context.command.commentId,
        trusted_author_id: null,
        round: currentState.processing_round ?? 1,
        human_note: context.command.data,
      }
    : null;
  const branchPreparation = context.supervisor.prepareFixBranch(context.issue);
  if (branchPreparation.status !== 0) throw new Error(`prepare fix branch failed: ${branchPreparation.stderr || 'unknown'}`);
  context.logger.info('fixer.begin', { issue: context.issue, round: currentState.processing_round ?? 1 });
  const fixerRun = await context.runFixerSession({
    client: context.client,
    state: currentState,
    issue: context.issue,
    repoDir: context.repoDir,
    dossierPath: path.join(context.guardianDir, String(context.issue), 'dossier.json'),
    planPath: path.join(context.guardianDir, String(context.issue), 'plan.json'),
    humanNote,
    round: currentState.processing_round ?? 1,
    plan: context.readArtifactPair(context.guardianDir, context.issue).plan,
    mode: context.investigationMode,
    deadlineMs: context.resolveSessionDeadlineMs(context.config, 'fixer_deadline_ms'),
    writePrSummary: (content) => context.writeMarkdownArtifact(context.guardianDir, context.issue, 'pr-summary', content),
    model: context.resolveModelForRole(context.config, 'fixer'),
    fallbackModels: context.fallbackModels,
    signal: context.signal,
    isActiveRun,
  });
  if (!isActiveRun()) return { stop: true, status: 'fenced' };
  context.writeState(context.guardianDir, fixerRun.state, { touch: false });
  const action = stageSessionStatusAction(fixerRun.status);
  if (action.retry) {
    context.logger.warn('fixer.session_retry', { issue: context.issue });
    return { stop: true, status: fixerRun.status };
  }
  if (!action.continue) {
    const reason = fixerRun.completionError ?? (fixerRun.error instanceof Error ? fixerRun.error.message : fixerRun.status);
    context.writeState(context.guardianDir, {
      ...fixerRun.state,
      state: STATES.HANDED_BACK,
      handed_back_reason: 'blocked',
      last_error_class: `fixer-completion-${fixerRun.status}`,
    }, { touch: false });
    context.logger.warn('fixer.session_stopped', { issue: context.issue, status: fixerRun.status, reason });
    return { stop: true, status: fixerRun.status };
  }
  const fixedBranch = `fix/issue-${Number(context.issue)}`;
  context.writeState(context.guardianDir, { ...fixerRun.state, branch: fixedBranch }, { touch: false });
  return { stop: false, status: fixerRun.status, completion: fixerRun.completion };
}

export async function runQaStage(context) {
  const isActiveRun = context.isActiveRun ?? (() => true);
  const afterFix = context.readState(context.guardianDir, context.issue) ?? { issue: context.issue };
  context.logger.info('qa.begin', { issue: context.issue, round: afterFix.processing_round ?? 1 });
  const qaRun = await context.runQaSession({
    client: context.client,
    state: afterFix,
    issue: context.issue,
    repoDir: context.repoDir,
    branch: afterFix.branch ?? null,
    diffSummary: {
      branch: afterFix.branch ?? 'unknown',
      changed_files: context.pipeline.completion?.changedFiles ?? [],
      fixer_summary: context.pipeline.completion?.summary ?? null,
    },
    intendedBehavior: context.issueTitle ?? `issue #${context.issue}`,
    round: afterFix.processing_round ?? 1,
    deadlineMs: context.resolveSessionDeadlineMs(context.config, 'qa_deadline_ms'),
    writeQaAcceptance: (content) => context.writeMarkdownArtifact(context.guardianDir, context.issue, 'qa-acceptance', content),
    model: context.resolveModelForRole(context.config, 'qa'),
    fallbackModels: context.fallbackModels,
    signal: context.signal,
    isActiveRun,
  });
  if (!isActiveRun()) return { stop: true, status: 'fenced' };
  context.writeState(context.guardianDir, qaRun.state, { touch: false });
  const action = stageSessionStatusAction(qaRun.status);
  if (action.retry) {
    context.logger.warn('qa.session_retry', { issue: context.issue });
    return { stop: true, status: qaRun.status };
  }
  if (!action.continue) {
    context.logger.warn('qa.session_stopped', { issue: context.issue, status: qaRun.status });
    return { stop: true, status: qaRun.status };
  }
  context.writeState(context.guardianDir, qaRun.state, { touch: false });
  if (!qaRun.verdict) return { stop: false, status: qaRun.status };
  if (!isActiveRun()) return { stop: true, status: 'fenced' };
  const qaVerdict = {
    issue: Number(context.issue),
    branch: afterFix.branch ?? null,
    status: qaRun.verdict,
    verified_at: new Date().toISOString(),
    report_hash: `sha256:${createHash('sha256').update(qaRun.report ?? '', 'utf8').digest('hex')}`,
    evidence_summary: qaRun.report ?? null,
    plan_hash: afterFix.plan_hash ?? null,
    plan_revision: afterFix.plan_revision ?? null,
  };
  context.writeArtifact(context.guardianDir, context.issue, 'qa-verdict', qaVerdict);

  if (qaRun.verdict === 'FAIL') {
    const fixRounds = afterFix.fix_rounds ?? 0;
    if (fixRounds >= MAX_FIX_ROUNDS) {
      context.writeState(context.guardianDir, {
        ...qaRun.state,
        state: STATES.HANDED_BACK,
        handed_back_reason: 'fix-rounds-exceeded',
        last_phase: 'qa-failed',
        last_error_class: 'qa-failed',
      }, { touch: false });
      return { stop: true, status: qaRun.status };
    }

    context.writeState(context.guardianDir, {
      ...qaRun.state,
      state: STATES.FIXING,
      fix_rounds: fixRounds + 1,
      handed_back_reason: null,
      last_phase: 'qa-failed-retry',
      last_error_class: 'qa-failed-retry',
      qa_verdict_status: qaVerdict.status,
      qa_verdict_hash: qaVerdict.report_hash,
    }, { touch: false });
    return { stop: false, status: qaRun.status, qaVerdict };
  }

  return { stop: false, status: qaRun.status, qaVerdict };
}

export async function runNotifyStage(context) {
  const settings = context.notifyStage ?? {};
  if (settings.enabled !== true || !context.effectSink || !settings.webhookUrl) {
    return { stop: false, status: 'skipped' };
  }
  const qaVerdict = context.pipeline.qaVerdict ?? null;
  const effectKey = `notify:${context.issue}:after-qa:${qaVerdict?.report_hash ?? 'no-verdict'}`;
  const result = context.effectSink.emit({
    actor: ACTORS.SUPERVISOR,
    kind: EFFECTS.FACT_WEBHOOK,
    ref: context.taskRef ?? githubIssueToTaskRef(context.issue),
    idempotencyKey: effectKey,
    payload: {
      url: settings.webhookUrl,
      body: {
        source: 'qa-guardian',
        stage: 'after-qa',
        issue: Number(context.issue),
        status: qaVerdict?.status ?? null,
        report_hash: qaVerdict?.report_hash ?? null,
      },
    },
  });
  return { stop: false, status: 'ok', effect: result };
}

export function stageRunnerContext(values) {
  return Object.freeze({
    ...values,
    isActiveRun: values.isActiveRun ?? (() => true),
    readState: values.readState,
    writeState: values.writeState,
    readArtifactPair: values.readArtifactPair ?? readArtifactPair,
    writeArtifact: values.writeArtifact ?? writeArtifact,
    writeMarkdownArtifact: values.writeMarkdownArtifact ?? writeMarkdownArtifact,
    runFixerSession: values.runFixerSession ?? runFixerSession,
    runQaSession: values.runQaSession ?? runQaSession,
  });
}

function normalizeStage(stage, ids, runners, index) {
  assertKnownKeys(stage, STAGE_KEYS, 'stage');
  const id = cleanString(stage.id, 'stage id');
  if (ids.has(id)) throw new Error(`duplicate stage id: ${id}`);
  ids.add(id);
  const runner = cleanString(stage.runner, 'stage runner');
  if (!runners[runner]) throw new Error(`unknown stage runner: ${runner}`);
  if (!EXTENSION_POINTS.includes(stage.extensionPoint)) throw new Error(`unknown extension point: ${String(stage.extensionPoint)}`);
  validateTransition(stage.stateTransition);
  validateRetryPolicy(stage.retryPolicy);
  return Object.freeze({ ...stage, id, runner, manifestOrder: index });
}

function orderStages(stages) {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  if (!byId.has('fixer') || !byId.has('qa')) return Object.freeze(stages);
  const builtInIds = new Set(BUILTIN_PIPELINE_MANIFEST.map((stage) => stage.id));
  const extensionStages = stages.filter((stage) => !builtInIds.has(stage.id));
  const beforeFixer = extensionStages.filter((stage) => stage.extensionPoint === 'before-fixer');
  const afterQa = extensionStages.filter((stage) => stage.extensionPoint === 'after-qa');
  const trailingBuiltIns = stages.filter((stage) => builtInIds.has(stage.id) && stage.id !== 'fixer' && stage.id !== 'qa');
  return Object.freeze([...beforeFixer, byId.get('fixer'), byId.get('qa'), ...afterQa, ...trailingBuiltIns]);
}

function validateTransition(transition) {
  if (!transition || typeof transition !== 'object') throw new Error('stage transition is required');
  const values = new Set(Object.values(STATES));
  if (!values.has(transition.from)) throw new Error(`unknown stateTransition.from: ${String(transition.from)}`);
  if (!values.has(transition.to)) throw new Error(`unknown stateTransition.to: ${String(transition.to)}`);
}

function validateRetryPolicy(retryPolicy) {
  if (!retryPolicy || typeof retryPolicy !== 'object') throw new Error('retryPolicy is required');
  if (!Number.isInteger(retryPolicy.maxRounds) || retryPolicy.maxRounds < 0) {
    throw new Error('retryPolicy.maxRounds must be a non-negative integer');
  }
}

function assertKnownKeys(value, keys, label) {
  for (const key of Object.keys(value ?? {})) {
    if (!keys.includes(key)) throw new Error(`unknown ${label} key: ${key}`);
  }
}

function cleanString(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function stageSessionStatusAction(status) {
  if (status === 'ok') return { continue: true, retry: false, failClosed: false };
  if (status === 'retry') return { continue: false, retry: true, failClosed: false };
  return { continue: false, retry: false, failClosed: true };
}
