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
import { selectCommand } from './commands.mjs';

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
  const comments = gh?.comments ?? [];

  // 1. No record / DISCOVERED → brand-new issue: start the pipeline.
  if (record == null || record.state === STATES.DISCOVERED) {
    return { action: 'START', reason: 'new-issue', toState: STATES.INVESTIGATING };
  }

  const { state } = record;

  // 2. Terminal DONE → nothing to do.
  if (state === STATES.DONE) {
    return { action: 'SKIP', reason: 'done' };
  }

  // 3. HANDED_BACK is terminal (§11.3): default permanent skip, UNLESS a /guardian retry
  //    command appears — then clear fix_rounds and re-enter from INVESTIGATING.
  if (state === STATES.HANDED_BACK) {
    const cmd = selectCommand(comments, STATES.HANDED_BACK, record.last_consumed_comment_id, trustedAuthors);
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

  // 4. GATE_1_WAIT (HIGH only) → consume approve/revise/reject; otherwise keep waiting.
  if (state === STATES.GATE_1_WAIT) {
    const cmd = selectCommand(comments, STATES.GATE_1_WAIT, record.last_consumed_comment_id, trustedAuthors);
    if (!cmd) return { action: 'SKIP', reason: 'gate1-waiting' };
    if (cmd.verb === 'reject') {
      return {
        action: 'HANDED_BACK',
        reason: 'reject',
        handedBackReason: 'reject',
        command: cmd,
      };
    }
    // approve | revise → FIXING
    return { action: 'RESUME', reason: cmd.verb, toState: STATES.FIXING, command: cmd };
  }

  // 5. GATE_2_WAIT (all issues) → if the human merged, issue is closed → DONE; else consume
  //    a /guardian rework to send back to FIXING; else keep waiting.
  if (state === STATES.GATE_2_WAIT) {
    if (gh?.closed) {
      return { action: 'DONE', reason: 'merged-closed' };
    }
    const cmd = selectCommand(comments, STATES.GATE_2_WAIT, record.last_consumed_comment_id, trustedAuthors);
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

export { STATES, RISK };
