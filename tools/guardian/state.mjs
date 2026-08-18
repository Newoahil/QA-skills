// QA Guardian — per-issue state store (.qa/guardian/<n>.json)
//
// Design refs: §11A.3 (state persistence), §11B.4 (heartbeat/lease), §11.2 (idempotent
// command consumption), §11B.5 (idempotent notify). State lives in this file, NOT in the
// process (§11B.1 stateless re-entry). Everything here is pure I/O + schema; routing lives
// in state-router.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile } from './runtime-io.mjs';

// Canonical state set (§11 state machine). "active" states carry a heartbeat and are
// lease-checked for STALLED; "waiting"/"terminal" states do not occupy the concurrency
// budget and are consumed by comment commands or the human's merge.
export const STATES = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  INVESTIGATING: 'INVESTIGATING',
  DIAGNOSED: 'DIAGNOSED',
  RISK_ASSESSED: 'RISK_ASSESSED',
  FIXING: 'FIXING',
  VERIFYING: 'VERIFYING',
  PR_OPENED: 'PR_OPENED',
  GATE_1_WAIT: 'GATE_1_WAIT',
  GATE_2_WAIT: 'GATE_2_WAIT',
  STALLED: 'STALLED',
  HANDED_BACK: 'HANDED_BACK',
  DONE: 'DONE',
});

// Active processing states (occupy concurrency, heartbeat-tracked, lease-checked).
export const ACTIVE_STATES = Object.freeze([
  STATES.INVESTIGATING,
  STATES.DIAGNOSED,
  STATES.RISK_ASSESSED,
  STATES.FIXING,
  STATES.VERIFYING,
  STATES.PR_OPENED,
]);

// States where the automatic pipeline auto-retries after a STALLED verdict. Only stages
// that are safe to re-run without leaving half-applied edits (§11B.4 idempotent stages).
// INVESTIGATING is read-only → always safe. FIXING/VERIFYING need a clean-branch check
// performed by the caller before auto-rerun.
export const IDEMPOTENT_STALL_STAGES = Object.freeze([STATES.INVESTIGATING]);

export const RISK = Object.freeze({ LOW: 'LOW', HIGH: 'HIGH' });

// handed_back_reason vocabulary (§11A.3) — drives human triage + whether /guardian retry makes sense.
export const HANDED_BACK_REASONS = Object.freeze([
  'reject',
  'fix-rounds-exceeded',
  'stalled',
  'needs-clarification',
  'blocked',
]);

export function isActiveState(state) {
  return ACTIVE_STATES.includes(state);
}

export function isTerminalState(state) {
  return state === STATES.DONE || state === STATES.HANDED_BACK;
}

// A fresh state record for a newly discovered issue.
export function newState(issueNumber, now = new Date().toISOString()) {
  return {
    schema_version: 2,
    issue: Number(issueNumber),
    state: STATES.DISCOVERED,
    risk: null, // LOW | HIGH once assessed
    branch: null, // fix/issue-<n>
    pr_url: null,
    fix_rounds: 0,
    updated_at: now, // active-state heartbeat timestamp (§11B.4)
    stall_retries: 0, // auto-rerun count after STALLED; capped (§11B.4)
    last_consumed_comment_id: null, // idempotent command consumption (§11.2)
    last_notified_state: null, // idempotent notify (§11B.5)
    handed_back_reason: null, // one of HANDED_BACK_REASONS
    issue_class: null, // bug | request
    processing_round: 1,
    round_started_at: null,
    round_history: [],
    last_followup_comment_id: null,
    last_followup_data: null,
    claim_id: null,
    claimed_at: null,
    claim_source: null, // labeled | new-open | followup
  };
}

// Normalize an on-disk record, filling any missing fields against the current schema so
// state files written by older versions still round-trip safely.
export function normalizeState(record, issueNumber) {
  const base = newState(issueNumber ?? record.issue, record.updated_at);
  return { ...base, ...record, issue: Number(issueNumber ?? record.issue) };
}

export function startFollowupRound(record, command, now = new Date().toISOString()) {
  const previous = normalizeState(record, record.issue);
  const history = [...(previous.round_history ?? [])];
  history.push({
    round: previous.processing_round ?? 1,
    branch: previous.branch,
    pr_url: previous.pr_url,
    completed_at: previous.updated_at,
  });
  return {
    ...previous,
    schema_version: 2,
    state: STATES.INVESTIGATING,
    risk: null,
    branch: null,
    pr_url: null,
    fix_rounds: 0,
    stall_retries: 0,
    updated_at: now,
    round_started_at: now,
    processing_round: (previous.processing_round ?? 1) + 1,
    round_history: history,
    last_followup_comment_id: command.commentId,
    last_followup_data: command.data,
    last_consumed_comment_id: command.commentId,
    handed_back_reason: null,
    claim_source: 'followup',
  };
}

function statePath(guardianDir, issueNumber) {
  return path.join(guardianDir, `${Number(issueNumber)}.json`);
}

// Read a state record; returns null when no record exists (a genuinely new issue, §11A.2).
export function readState(guardianDir, issueNumber) {
  const file = statePath(guardianDir, issueNumber);
  if (!existsSync(file)) return null;
  return normalizeState(readJsonFile(file), issueNumber);
}

// Write a state record atomically-ish (write then rename would be ideal; kept simple for
// the single-writer MVP where N=1). Always stamps updated_at unless the caller froze it.
export function writeState(guardianDir, record, { touch = true, now = new Date().toISOString() } = {}) {
  mkdirSync(guardianDir, { recursive: true });
  const out = normalizeState(record, record.issue);
  if (touch) out.updated_at = now;
  const file = statePath(guardianDir, out.issue);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

// True when an active-state record's heartbeat is older than the lease (§11B.4): the
// previous process died mid-flight and this issue must be judged STALLED rather than
// treated as "still processing → skip".
export function isLeaseExpired(record, leaseMs, now = Date.now()) {
  if (!isActiveState(record.state)) return false;
  const beat = Date.parse(record.updated_at);
  if (Number.isNaN(beat)) return true; // unparseable heartbeat → treat as expired, fail toward recovery
  return now - beat > leaseMs;
}
