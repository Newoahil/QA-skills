// QA Guardian — poll-time state router (§11A.2)
//
// The heart of dedup + gate recovery, unified in one table. Given an issue's current state
// record (or null for a genuinely new issue), the issue's GitHub facts (closed? comments),
// and the lease, decide the SINGLE action this poll should take. This is pure logic — no
// I/O, no gh calls — so it is fully unit-testable with fixtures.
//
// Action shape: { action, reason, ...payload }
//   action ∈ START | SKIP | RESUME | STALLED | DONE | HANDED_BACK
//   RESUME carries { toState, command? } describing where the guardian run re-enters.

import {
  STATES,
  RISK,
  isActiveState,
  isLeaseExpired,
  IDEMPOTENT_STALL_STAGES,
} from './state.mjs';
import { COMMANDS } from './commands.mjs';

// STALLED auto-rerun cap (§11B.4): after this many auto-retries still stalled → HANDED_BACK.
export const MAX_STALL_RETRIES = 1;
// Fix↔verify loop cap (§11 / using-qa.md): rounds beyond this → HANDED_BACK.
export const MAX_FIX_ROUNDS = 2;

/**
 * @param {object|null} record  state record from readState(), or null if none on disk
 * @param {object} gh           { closed:boolean, comments:Array<{id,body,createdAt,author}> }
 * @param {object} opts         { leaseMs:number, now?:number, trustedAuthors?:string[] }
 * @returns {object} action descriptor
 */
export function routeIssue(record, gh, opts) {
  const { leaseMs, now = Date.now(), trustedAuthors = [] } = opts;
  const task = normalizeRouteInput(gh, record, trustedAuthors);
  const controlEvents = task.controlEvents ?? [];

  // 1. No record / DISCOVERED → brand-new issue: start the pipeline.
  if (record == null || record.state === STATES.DISCOVERED) {
    return { action: 'START', reason: 'new-issue', toState: STATES.INVESTIGATING };
  }

  const { state } = record;

  // 2. Terminal DONE → nothing to do.
  if (state === STATES.DONE) {
    const cmd = selectControlCommand(controlEvents, STATES.DONE);
    if (cmd?.verb === 'followup') return { action: 'RESUME', reason: 'followup', toState: STATES.INVESTIGATING, command: cmd, newRound: true };
    return { action: 'SKIP', reason: 'done' };
  }

  // 3. HANDED_BACK is terminal (§11.3): default permanent skip, UNLESS a /guardian retry
  //    command appears — then clear fix_rounds and re-enter from INVESTIGATING.
  if (state === STATES.HANDED_BACK) {
    if (record.last_error_class === 'fixer-completion-unverified' && record.opencode?.fixer?.last_error === 'changed-file-not-in-plan') {
      return {
        action: 'RESUME',
        reason: 'plan-scope-recovery',
        toState: STATES.INVESTIGATING,
      };
    }
    const cmd = selectControlCommand(controlEvents, STATES.HANDED_BACK);
    if (cmd && cmd.verb === 'retry') {
      return {
        action: 'RESUME',
        reason: 'retry',
        toState: STATES.INVESTIGATING,
        command: cmd,
        clearFixRounds: true,
      };
    }
    return { action: 'SKIP', reason: 'handed-back-terminal' };
  }

  // A commandless STALLED persistence is an intermediate durable state. On the next poll,
  // consume the bounded recovery attempt explicitly instead of treating the state as unknown.
  if (state === STATES.STALLED) {
    const stallRetries = record.stall_retries ?? 0;
    if (stallRetries <= MAX_STALL_RETRIES) {
      return {
        action: 'RESUME',
        reason: 'stalled-retry',
        toState: STATES.INVESTIGATING,
        stallRetries,
        retryCount: stallRetries,
      };
    }
    return {
      action: 'HANDED_BACK',
      reason: 'stalled-retry-exhausted',
      handedBackReason: 'stalled',
    };
  }

  // A failed QA pass below the cap is persisted as a bounded fixer retry. Keep it observable to
  // the scheduler so the next run re-enters the fixer, rather than looking like a fresh VERIFYING
  // lease that can be skipped or accidentally finalized.
  if (state === STATES.FIXING && record.last_error_class === 'qa-failed-retry') {
    return {
      action: 'RESUME',
      reason: 'qa-failed-retry',
      toState: STATES.FIXING,
      fixRounds: record.fix_rounds ?? 0,
    };
  }

  if (state === STATES.FIXING && record.last_error_class === 'qa-missing-supervisor-evidence') {
    return {
      action: 'RESUME',
      reason: 'qa-evidence-retry',
      toState: STATES.VERIFYING,
    };
  }

  if ((state === STATES.FIXING || state === STATES.INVESTIGATING) && isApprovedPreFixer(record)) {
    return {
      action: 'RESUME',
      reason: 'approved-pre-fixer-recovery',
      toState: STATES.FIXING,
    };
  }

  // 4. GATE_1_WAIT (HIGH only) → consume approve/revise/reject; otherwise keep waiting.
  if (state === STATES.GATE_1_WAIT) {
    const cmd = selectControlCommand(controlEvents, STATES.GATE_1_WAIT);
    if (!cmd) return { action: 'SKIP', reason: 'gate1-waiting' };
    if (cmd.verb === 'reject') {
      return {
        action: 'HANDED_BACK',
        reason: 'reject',
        handedBackReason: 'reject',
        command: cmd,
      };
    }
    if (cmd.verb === 'revise') return { action: 'RESUME', reason: 'revise', toState: STATES.INVESTIGATING, command: cmd };
    // approve → FIXING
    return { action: 'RESUME', reason: cmd.verb, toState: STATES.FIXING, command: cmd };
  }

  // 5. GATE_2_WAIT (all issues) → if the human merged, issue is closed → DONE; else consume
  //    a /guardian rework to send back to FIXING; else keep waiting.
  if (state === STATES.GATE_2_WAIT) {
    const followup = selectControlCommand(controlEvents, STATES.GATE_2_WAIT);
    if (followup?.verb === 'followup') {
      return { action: 'RESUME', reason: 'followup', toState: STATES.INVESTIGATING, command: followup, newRound: true };
    }
    if (task.terminal?.status === 'completed') {
      return { action: 'DONE', reason: 'merged-closed' };
    }
    const cmd = selectControlCommand(controlEvents, STATES.GATE_2_WAIT);
    if (cmd && cmd.verb === 'rework') {
      // rework re-enters FIXING; fix_rounds keeps counting and may still exceed the cap later.
      return { action: 'RESUME', reason: 'rework', toState: STATES.FIXING, command: cmd };
    }
    return { action: 'SKIP', reason: 'gate2-waiting' };
  }

  // 6. Active states: fresh heartbeat → really processing → skip; stale → STALLED handling.
  if (isActiveState(state)) {
    if (!isLeaseExpired(record, leaseMs, now)) {
      return { action: 'SKIP', reason: 'in-progress-fresh-lease' };
    }
    // Lease expired: the previous process died mid-flight (§11B.4).
    // Over the auto-retry cap → hand back with reason=stalled.
    if ((record.stall_retries ?? 0) >= MAX_STALL_RETRIES) {
      return {
        action: 'HANDED_BACK',
        reason: 'stalled-retry-exhausted',
        handedBackReason: 'stalled',
      };
    }
    // Auto-rerun only idempotent (safe-to-replay) stages. Non-idempotent stages
    // (FIXING/VERIFYING) require the caller to confirm the branch is not half-applied
    // before rerunning; the router flags that so the caller can gate it.
    const idempotent = IDEMPOTENT_STALL_STAGES.includes(state);
    return {
      action: 'STALLED',
      reason: 'lease-expired',
      fromState: state,
      idempotentStage: idempotent,
      nextStallRetries: (record.stall_retries ?? 0) + 1,
    };
  }

  // Any unexpected state → do not act blindly; treat as needing human attention.
  return { action: 'SKIP', reason: `unhandled-state:${state}` };
}

function normalizeRouteInput(input, record, trustedAuthors) {
  if (input && Array.isArray(input.controlEvents)) return input;
  return {
    terminal: input?.closed ? { status: 'completed', reason: 'merged-closed', sourceEvidence: { closed: true } } : null,
    controlEvents: [],
  };
}

function selectControlCommand(events, currentState) {
  if (!Array.isArray(events)) return null;
  let chosen = null;
  for (const event of events) {
    if (event?.kind !== 'command') continue;
    const spec = COMMANDS[event.verb];
    if (!spec?.validIn.includes(currentState)) continue;
    chosen = {
      verb: event.verb,
      data: event.data ?? '',
      commentId: commandIdFromEvent(event),
      target: spec.target,
    };
  }
  return chosen;
}

function commandIdFromEvent(event) {
  const n = Number(event.id);
  return Number.isInteger(n) && String(n) === String(event.id) ? n : event.id;
}

function isApprovedPreFixer(record) {
  return Boolean(record.gate_1_approved_comment_id)
    && record.gate_1_approved_plan_hash === record.plan_hash
    && record.gate_1_approved_plan_revision === record.plan_revision
    && record.plan_status === 'valid'
    && record.dossier_status === 'valid'
    && !record.branch
    && !record.opencode?.fixer?.session_id
    && (!record.opencode?.inflight || isStartingFixerInflight(record.opencode.inflight));
}

function isStartingFixerInflight(inflight) {
  return inflight?.kind === 'fixer-start'
    && inflight?.role === 'fixer'
    && inflight?.status === 'starting';
}

export { STATES, RISK };
