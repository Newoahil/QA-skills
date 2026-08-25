// QA Guardian — notification delivery wiring (§11B.5 / FR-21)
//
// notify.mjs is the pure decision core (idempotent per last_notified_state + safe body). This
// module supplies the two real side-effect channels (gh issue comment + curl webhook POST) and
// a `deliverNotifications` orchestrator the scheduler calls for each gate/STALLED/HANDED_BACK
// decision. Side effects are injected (ghComment/curlPost/readState/writeState) so the
// orchestration is unit-testable without gh/curl/fs.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { notify } from './notify.mjs';
import { readState, writeState } from './state.mjs';
import { assertActorMayPerform, EFFECTS } from './actor-routing.mjs';
import { withGithubBodyFile } from './github-body-file.mjs';

const claimedTransitions = new Set();

function notificationClaimKey(guardianDir, issue, targetState) {
  return `${guardianDir}:${String(issue)}:${targetState}`;
}

function claimNotificationTransition(guardianDir, issue, targetState, record) {
  if (record.last_notified_state === targetState) return false;
  const key = notificationClaimKey(guardianDir, issue, targetState);
  if (claimedTransitions.has(key)) return false;
  claimedTransitions.add(key);
  return true;
}

function releaseNotificationClaim(guardianDir, issue, targetState) {
  claimedTransitions.delete(notificationClaimKey(guardianDir, issue, targetState));
}

// Default gh-backed issue-comment channel. Writes the notification text as an issue comment.
export function defaultGhComment(repoDir, actor, run = spawnSync) {
  return function ghComment(issue, text) {
    assertActorMayPerform(actor, EFFECTS.FACT_COMMENT);
    const res = withGithubBodyFile(text, (bodyFile) => run('gh', [
      'issue', 'comment', String(issue), '--body-file', bodyFile,
    ], { cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true }));
    if (res.status !== 0) {
      throw new Error(`gh issue comment #${issue} failed: ${res.stderr || 'unknown'}`);
    }
  };
}

// Default curl-backed webhook channel. POSTs the JSON body to the one configured URL. This is
// the sole network egress allowed for notification (§11B.5); no other host is contacted.
export function defaultCurlPost(actor) {
  return function curlPost(url, body) {
    assertActorMayPerform(actor, EFFECTS.FACT_WEBHOOK);
    const res = spawnSync(
      'curl',
      ['-sS', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), url],
      { encoding: 'utf8', shell: false, windowsHide: true },
    );
    if (res.status !== 0) {
      throw new Error(`webhook POST failed: ${res.stderr || 'unknown'}`);
    }
  };
}

/**
 * Deliver notifications for a set of routing decisions that reached a notify-worthy state.
 * For each decision: read its state record, run the idempotent notify() decision, and — when it
 * actually fired — persist last_notified_state so the next tick does not re-notify.
 *
 * A single decision's delivery failure must NOT abort the others (best-effort per issue); it is
 * recorded in the returned results. notify()'s own idempotency means a retry next tick is safe.
 *
 * @param {object} args
 *   decisions: Array<{ issue:number, action:string, toState?:string, fromState?:string, reason?:string }>
 *   guardianDir: string
 *   config: object
 *   io: { ghComment(issue,text), curlPost(url,body) }
 *   deps?: { readState?, writeState?, now? }
 * @returns {Array<{ issue:number, delivered:boolean, skipped?:boolean, error?:string }>}
 */
export function deliverNotifications(args) {
  const { decisions, guardianDir, config, io } = args;
  const actor = args.actor;
  if (decisions.some((decision) => notifyTargetState(decision))) {
    assertActorMayPerform(actor, EFFECTS.FACT_COMMENT);
    if (config?.notify_webhook) assertActorMayPerform(actor, EFFECTS.FACT_WEBHOOK);
  }
  const rs = args.deps?.readState ?? readState;
  const ws = args.deps?.writeState ?? writeState;
  const now = args.deps?.now;
  const claim = args.deps?.claimNotification ?? claimNotificationTransition;
  const releaseClaim = args.deps?.releaseNotificationClaim ?? releaseNotificationClaim;

  const results = [];
  for (const d of decisions) {
    const targetState = notifyTargetState(d);
    if (!targetState) continue;
    try {
      if (d.taskRef && d.taskRef.source !== 'github') {
        results.push({ issue: d.issue, delivered: false, skipped: true, error: `unsupported-source:${d.taskRef.source}` });
        continue;
      }
      const record = rs(guardianDir, d.issue);
      if (!record) {
        results.push({ issue: d.issue, delivered: false, skipped: true, error: 'no-state-record' });
        continue;
      }
      if (!claim(guardianDir, d.issue, targetState, record)) {
        results.push({ issue: d.issue, delivered: false, skipped: true, reasonSkipped: 'transition-claimed' });
        continue;
      }
      const outcome = notify(
        record,
        { targetState, link: config?.issue_url_for?.(d.issue) ?? null, reason: d.reason ?? d.handedBackReason ?? null },
        config,
        {
          comment: (payload) => {
            assertActorMayPerform(actor, EFFECTS.FACT_COMMENT);
            return io.ghComment(d.issue, payload.text);
          },
          webhook: (url, body) => {
            assertActorMayPerform(actor, EFFECTS.FACT_WEBHOOK);
            return io.curlPost(url, body);
          },
        },
      );
      if (outcome.skipped) {
        releaseClaim(guardianDir, d.issue, targetState);
        results.push({ issue: d.issue, delivered: false, skipped: true });
        continue;
      }
      // Persist idempotency marker so the same state is not re-notified next tick.
      ws(guardianDir, { ...record, last_notified_state: targetState }, { touch: false, ...(now ? { now } : {}) });
      releaseClaim(guardianDir, d.issue, targetState);
      results.push({ issue: d.issue, delivered: true });
    } catch (e) {
      releaseClaim(guardianDir, d.issue, targetState);
      const msg = e instanceof Error ? e.message : 'unknown';
      results.push({ issue: d.issue, delivered: false, error: msg });
    }
  }
  return results;
}

export function closeoutTransition({ guardianDir, decision, statePatch, config = {}, io, actor, deps = {}, deliver = null }) {
  const rs = deps.readState ?? readState;
  const ws = deps.writeState ?? writeState;
  const now = deps.now;
  const claim = deps.claimNotification ?? claimNotificationTransition;
  const releaseClaim = deps.releaseNotificationClaim ?? releaseNotificationClaim;
  const current = rs(guardianDir, decision.issue);
  if (!current) return [{ issue: decision.issue, delivered: false, skipped: true, error: 'no-state-record' }];
  const targetState = notifyTargetState(decision);
  if (!claim(guardianDir, decision.issue, targetState, current)) {
    return [{ issue: decision.issue, delivered: false, skipped: true, reasonSkipped: 'transition-claimed' }];
  }
  ws(guardianDir, { ...current, ...statePatch }, { touch: false, ...(deps.now ? { now: deps.now } : {}) });
  if (typeof deliver === 'function') {
    try {
      deliver();
      const patchedRecord = { ...current, ...statePatch };
      const outcome = notify(
        patchedRecord,
        { targetState, link: config?.issue_url_for?.(decision.issue) ?? null, reason: decision.reason ?? decision.handedBackReason ?? null },
        config,
        {
          comment: () => {},
          webhook: (url, body) => {
            assertActorMayPerform(actor, EFFECTS.FACT_WEBHOOK);
            return io.curlPost(url, body);
          },
        },
      );
      if (outcome.skipped) {
        releaseClaim(guardianDir, decision.issue, targetState);
        return [{ issue: decision.issue, delivered: false, skipped: true }];
      }
      ws(guardianDir, { ...patchedRecord, last_notified_state: targetState }, { touch: false, ...(now ? { now } : {}) });
      releaseClaim(guardianDir, decision.issue, targetState);
      return [{ issue: decision.issue, delivered: true }];
    } catch (error) {
      releaseClaim(guardianDir, decision.issue, targetState);
      return [{ issue: decision.issue, delivered: false, error: error instanceof Error ? error.message : 'unknown' }];
    }
  }
  return deliverNotifications({ decisions: [decision], guardianDir, config, io, actor, deps });
}

// The state a notify-worthy decision announces. STALLED/HANDED_BACK come straight from the
// action; gate waits are announced by their state when a decision carries one.
export function notifyTargetState(decision) {
  switch (decision.action) {
    case 'GATE_1_WAIT':
      return 'GATE_1_WAIT';
    case 'GATE_2_WAIT':
      return 'GATE_2_WAIT';
    case 'SKIP':
      if (decision.reason === 'gate1-waiting') return 'GATE_1_WAIT';
      if (decision.reason === 'gate2-waiting') return 'GATE_2_WAIT';
      return null;
    case 'STALLED':
      return 'STALLED';
    case 'HANDED_BACK':
      return 'HANDED_BACK';
    case 'DONE':
      return 'DONE';
    default:
      return null;
  }
}
