// QA Guardian — scheduler state-transition fragments, gate-1 proposal publishing, and watch-state I/O.
//
// Extracted from scheduler.mjs (P0 refactor, batches 3+4). These are the tick-adjacent orchestration
// helpers that compute or persist state transitions and publish waiting gate-1 proposals. They take
// their state readers/writers and I/O by dependency injection and hold NO lock — the N=1 critical
// section stays in scheduler.mjs. Pure/near-pure and independently unit-tested.

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { readJsonFile } from './runtime-io.mjs';
import { readState, writeState, STATES } from './state.mjs';
import { commandlessStateTransition } from './scheduler-core.mjs';
import { readArtifactPair, artifactIdentity } from './artifacts.mjs';
import { publishGate1Proposal } from './notify-io.mjs';
import { ACTORS } from './actor-routing.mjs';
import { atomicWriteJson } from './atomic-io.mjs';
import { guardianDirOf } from './guardian-paths.mjs';

const FIXER_START_KIND = 'fixer-start';

export function sessionStatusAction(status) {
  if (status === 'ok') return { continue: true, retry: false, failClosed: false };
  if (status === 'retry') return { continue: false, retry: true, failClosed: false };
  return { continue: false, retry: false, failClosed: true };
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

export function buildRunFailureState({ currentState, error, phase = 'run-error' }) {
  const message = error instanceof Error ? error.message : 'run failed';
  return {
    ...currentState,
    state: STATES.HANDED_BACK,
    handed_back_reason: 'supervisor-run-failed',
    last_error_class: message.startsWith('stage failed:') ? 'supervisor-stage-failed' : 'supervisor-run-failed',
    last_phase: phase,
    run_error_message: message,
  };
}

export function applyGateCommandState({ currentBeforeRun, command, currentIdentity, repoDir, qaRuntimeDir, now = new Date().toISOString() }) {
  const gateApproved = command.verb === 'approve';
  const gateRevision = command.verb === 'revise';
  const manualFixResume = command.verb === 'continue' && command.manualFixResume === true;
  const qaEnvironmentRetry = command.verb === 'continue' && command.qaEnvironmentRetry === true;
  return {
    ...currentBeforeRun,
    control_repo_dir: repoDir,
    qa_runtime_dir: qaRuntimeDir,
    state: qaEnvironmentRetry ? STATES.VERIFYING : (gateApproved || manualFixResume ? STATES.FIXING : (gateRevision ? STATES.INVESTIGATING : currentBeforeRun.state)),
    last_consumed_comment_id: command.commentId,
    last_command_verb: command.verb,
    last_command_comment_id: command.commentId,
    gate_1_approved_comment_id: gateApproved ? command.commentId : (gateRevision ? null : currentBeforeRun.gate_1_approved_comment_id),
    gate_1_approved_plan_hash: gateApproved ? currentIdentity.plan_hash : (gateRevision ? null : currentBeforeRun.gate_1_approved_plan_hash),
    gate_1_approved_plan_revision: gateApproved ? currentIdentity.plan_revision : (gateRevision ? null : currentBeforeRun.gate_1_approved_plan_revision),
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
    last_phase: qaEnvironmentRetry ? 'qa-environment-retry' : (gateRevision ? 'gate1-revision' : currentBeforeRun.last_phase),
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

function watchStatePath(repoDir) { return path.join(guardianDirOf(repoDir), 'watch-state.json'); }

export function readWatchState(repoDir) {
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
