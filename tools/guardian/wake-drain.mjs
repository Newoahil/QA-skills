// QA Guardian — scheduler wake-drain planner (Phase 4, local side, pure).
//
// See docs/qa-guardian-webhook-idempotency.md §2, §5. The scheduler is the SOLE consumer and SOLE
// writer. Two producers add issue numbers to reconcile: the relay drain (webhook wakes) and the
// interval compensation (open qa-guardian issues). This module is the PURE coalescing + guard
// logic; the scheduler calls it while holding the existing N=1 lease and then performs the actual
// gh reads / state-router / state writes. Nothing here touches gh, the lock, or the filesystem
// except through injected helpers, so it is fully unit-testable.

import { transitionToken, commandlessTransitionToken, hasAppliedCommitted } from './ledger.mjs';

/**
 * Coalesce relay wake targets + interval compensation targets into ONE deduped, ordered issue set.
 * A webhook wake is only a REASON to reconcile issue N (§1); it never carries a command. Deliveries
 * whose issue_number is null (pull_request/push) contribute no issue wake here.
 *
 * @param {object} args
 *   wakeRecords: Array<{ delivery_id, issue_number:number|null }>   drained from the relay
 *   compensationIssues: number[]                                     open qa-guardian issues this tick
 * @returns {{ issues:number[], deliveryIds:string[] }}
 *   issues       — sorted unique issue numbers to reconcile once each this tick
 *   deliveryIds  — the relay deliveries consumed (to ack after a successful drain)
 */
export function planWakeTargets({ wakeRecords = [], compensationIssues = [] }) {
  const issues = new Set();
  const deliveryIds = [];
  for (const rec of wakeRecords) {
    if (rec && typeof rec.delivery_id === 'string') deliveryIds.push(rec.delivery_id);
    const n = Number(rec?.issue_number);
    if (Number.isInteger(n) && n > 0) issues.add(n);
  }
  for (const n of compensationIssues) {
    const v = Number(n);
    if (Number.isInteger(v) && v > 0) issues.add(v);
  }
  return {
    issues: [...issues].sort((a, b) => a - b),
    deliveryIds,
  };
}

/**
 * Application-token guard (§3.3). Given the reconcile inputs for one issue, derive the deterministic
 * transition token and decide whether the effect should be applied or SKIPPED because it was already
 * committed (via webhook OR a prior compensation poll — both converge here). This is what makes
 * "webhook + compensation see the same command" apply exactly once.
 *
 * @param {object} args
 *   guardianDir:string, repo:string, issue:number,
 *   decision:{ action, command?:{ commentId, verb } },  // from the pure state-router
 *   currentState?:string, factsDigest?:string,
 *   deps?: { hasAppliedCommitted? }
 * @returns {{ token:string, alreadyApplied:boolean, action:string }}
 */
export function guardTransition(args) {
  const { guardianDir, repo, issue, decision } = args;
  const has = args.deps?.hasAppliedCommitted ?? hasAppliedCommitted;
  const cmd = decision?.command ?? null;
  const token = cmd
    ? transitionToken({ repo, issue, commentId: cmd.commentId, verb: cmd.verb, action: decision.action })
    : commandlessTransitionToken({ issue, currentState: args.currentState, action: decision?.action, factsDigest: args.factsDigest ?? '' });
  return {
    token,
    alreadyApplied: has(guardianDir, issue, token),
    action: decision?.action ?? null,
  };
}
