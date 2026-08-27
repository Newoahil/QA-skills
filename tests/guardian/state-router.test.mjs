// Tests for tools/guardian/state-router.mjs — the §11A.2 dispatch table.
// Covers acceptance 13-15 (dedup/lease), 19-22 (gate-1 resume/reject, terminal retry, gate-2
// rework), 24-25 (deterministic close-out / STALLED), with gh facts as fixtures.

import assert from 'node:assert/strict';
import test from 'node:test';

import { routeIssue, MAX_STALL_RETRIES, MAX_FIX_ROUNDS } from '../../tools/guardian/state-router.mjs';
import { STATES, newState } from '../../tools/guardian/state.mjs';
import { buildGitHubTaskObservation } from '../../tools/guardian/github-task-source.mjs';

const LEASE = 30 * 60 * 1000;
const NOW = Date.parse('2026-08-18T12:00:00Z');
const TRUSTED = ['maintainer'];
// Router opts for command-consuming tests: include the trusted-author whitelist.
const OPTS = { leaseMs: LEASE, now: NOW, trustedAuthors: TRUSTED };

function rec(overrides = {}) {
  return { ...newState(42, new Date(NOW).toISOString()), ...overrides };
}
function gh(overrides = {}) {
  return { closed: false, comments: [], ...overrides };
}
function observation(record, overrides = {}, opts = {}) {
  return buildGitHubTaskObservation({
    issueNumber: 42,
    record,
    githubIssue: gh(overrides),
    trustedAuthors: opts.trustedAuthors ?? [],
  });
}
function route(record, overrides = {}, opts = { leaseMs: LEASE, now: NOW }) {
  return routeIssue(record, observation(record, overrides, opts), opts);
}
function comment(id, body, author = 'maintainer') {
  return { id, body, author, createdAt: `2026-08-18T11:${String(id).padStart(2, '0')}:00Z` };
}

test('no record → START into INVESTIGATING (new issue)', () => {
  const d = route(null, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'START');
  assert.equal(d.toState, STATES.INVESTIGATING);
});

test('DISCOVERED → START (treated as new)', () => {
  const r = rec({ state: STATES.DISCOVERED });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'START');
});

test('active state with fresh heartbeat → SKIP (dedup, acceptance 14)', () => {
  const fresh = rec({ state: STATES.FIXING, updated_at: new Date(NOW - 60 * 1000).toISOString() });
  const d = route(fresh, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'in-progress-fresh-lease');
});

test('active state with expired lease + idempotent stage → STALLED, auto-rerunnable (acceptance 25)', () => {
  const stale = rec({ state: STATES.INVESTIGATING, updated_at: new Date(NOW - LEASE - 1000).toISOString() });
  const d = route(stale, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'STALLED');
  assert.equal(d.idempotentStage, true);
  assert.equal(d.nextStallRetries, 1);
});

test('active state with expired lease, non-idempotent stage → STALLED flagged non-idempotent', () => {
  const stale = rec({ state: STATES.FIXING, updated_at: new Date(NOW - LEASE - 1000).toISOString() });
  const d = route(stale, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'STALLED');
  assert.equal(d.idempotentStage, false);
});

test('persisted STALLED after the first commandless transition → RESUME INVESTIGATING while retry budget remains', () => {
  // Given: the scheduler already persisted STALLED after one expired-lease transition.
  const stalled = rec({ state: STATES.STALLED, stall_retries: 1, last_phase: 'stalled', last_error_class: 'lease-expired' });

  // When: the poll router sees that persisted STALLED record on the next tick.
  const d = route(stalled, {}, { leaseMs: LEASE, now: NOW });

  // Then: it must choose a recoverable action, not strand the issue in unhandled SKIP.
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.INVESTIGATING);
  assert.equal(d.reason, 'stalled-retry');
});

test('persisted STALLED beyond the retry budget → HANDED_BACK(reason=stalled) instead of unhandled SKIP', () => {
  // Given: a previously stalled issue has already exhausted its bounded recovery attempts.
  const stalled = rec({ state: STATES.STALLED, stall_retries: MAX_STALL_RETRIES + 1, last_phase: 'stalled', last_error_class: 'lease-expired' });

  // When: the poll router sees that persisted STALLED record on the next tick.
  const d = route(stalled, {}, { leaseMs: LEASE, now: NOW });

  // Then: it must hand back explicitly for human action.
  assert.equal(d.action, 'HANDED_BACK');
  assert.equal(d.handedBackReason, 'stalled');
});

test('STALLED beyond retry cap → HANDED_BACK(reason=stalled) (acceptance 25)', () => {
  const stale = rec({
    state: STATES.INVESTIGATING,
    updated_at: new Date(NOW - LEASE - 1000).toISOString(),
    stall_retries: MAX_STALL_RETRIES,
  });
  const d = route(stale, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'HANDED_BACK');
  assert.equal(d.handedBackReason, 'stalled');
});

test('GATE_1_WAIT + no command → SKIP (waiting, not nagging, acceptance 19)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('GATE_1_WAIT + /guardian approve → RESUME to FIXING (acceptance 19)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian approve')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.FIXING);
  assert.equal(d.command.commentId, 1);
});

test('legacy GitHub facts shape no longer parses commands in the neutral router', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = routeIssue(r, { closed: false, comments: [comment(1, '/guardian approve')] }, OPTS);

  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('GATE_1_WAIT + /guardian reject → HANDED_BACK(reason=reject), permanent (acceptance 20)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian reject')] }, OPTS);
  assert.equal(d.action, 'HANDED_BACK');
  assert.equal(d.handedBackReason, 'reject');
});

test('GATE_1_WAIT + revise carries data tail (as DATA)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian revise use a guard clause instead')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.INVESTIGATING);
  assert.equal(d.command.verb, 'revise');
  assert.equal(d.command.data, 'use a guard clause instead');
});

test('approved FIXING without branch or fixer session resumes pre-fixer work despite a fresh lease', () => {
  const r = rec({
    state: STATES.FIXING,
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
    branch: null,
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    plan_status: 'valid',
    dossier_status: 'valid',
    opencode: { fixer: null, qa: null, specialists: {}, inflight: null },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'approved-pre-fixer-recovery');
  assert.equal(d.toState, STATES.FIXING);
});

test('approved INVESTIGATING with valid plan identity resumes the pre-fixer handoff without reset', () => {
  const r = rec({
    state: STATES.INVESTIGATING,
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
    branch: null,
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    plan_status: 'valid',
    dossier_status: 'valid',
    opencode: { fixer: null, qa: null, specialists: {}, inflight: null },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'approved-pre-fixer-recovery');
  assert.equal(d.toState, STATES.FIXING);
});

test('approved INVESTIGATING with invalid plan status does not bypass fresh lease', () => {
  const r = rec({
    state: STATES.INVESTIGATING,
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
    branch: null,
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    plan_status: 'invalid',
    dossier_status: 'valid',
    opencode: { fixer: null, qa: null, specialists: {}, inflight: null },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'in-progress-fresh-lease');
});

test('approved FIXING with starting fixer inflight marker resumes the crash window', () => {
  const r = rec({
    state: STATES.FIXING,
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
    branch: null,
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    plan_status: 'valid',
    dossier_status: 'valid',
    opencode: {
      fixer: null,
      qa: null,
      specialists: {},
      inflight: { kind: 'fixer-start', role: 'fixer', status: 'starting' },
    },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'approved-pre-fixer-recovery');
  assert.equal(d.toState, STATES.FIXING);
});

test('active FIXING with a fixer session still skips on a fresh lease', () => {
  const r = rec({
    state: STATES.FIXING,
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
    branch: 'fix/issue-42',
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    opencode: { fixer: { session_id: 'ses_fixer' }, qa: null, specialists: {}, inflight: null },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'in-progress-fresh-lease');
});

test('FIXING qa-failed-retry resumes even when legacy state has blank error class', () => {
  const r = rec({
    state: STATES.FIXING,
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
    last_phase: 'qa-failed-retry',
    last_error_class: '',
    branch: 'fix/issue-42',
    fix_rounds: 1,
    qa_verdict_status: 'FAIL',
    opencode: { fixer: { session_id: 'ses_fixer' }, qa: { session_id: 'ses_qa' }, specialists: {}, inflight: null },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'qa-failed-retry');
  assert.equal(d.toState, STATES.FIXING);
  assert.equal(d.fixRounds, 1);
});

test('handed back changed-file-not-in-plan from old incomplete scope resumes investigation without reset', () => {
  const r = rec({
    state: STATES.HANDED_BACK,
    last_error_class: 'fixer-completion-unverified',
    opencode: { fixer: { session_id: 'ses_old', last_status: 'unverified', last_error: 'changed-file-not-in-plan' } },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'plan-scope-recovery');
  assert.equal(d.toState, STATES.INVESTIGATING);
});

test('handed back supervisor stage failure after QA PASS resumes without a fresh active lease', () => {
  const r = rec({
    state: STATES.HANDED_BACK,
    branch: 'fix/issue-42',
    qa_verdict_status: 'PASS',
    last_error_class: 'supervisor-stage-failed',
    handed_back_reason: 'supervisor-run-failed',
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'supervisor-stage-recovery');
  assert.equal(d.toState, STATES.FIXING);
});

test('handed back QA human review with a branch resumes once for cleaned supervisor evidence', () => {
  const r = rec({
    state: STATES.HANDED_BACK,
    branch: 'fix/issue-42',
    last_error_class: 'qa-needs-human-review',
    handed_back_reason: 'needs-clarification',
    evidence_retries: 0,
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'qa-human-review-recovery');
  assert.equal(d.toState, STATES.FIXING);
});

test('handed back QA human review is terminal after the one cleaned-evidence retry', () => {
  const r = rec({
    state: STATES.HANDED_BACK,
    branch: 'fix/issue-42',
    last_error_class: 'qa-needs-human-review',
    handed_back_reason: 'needs-clarification',
    evidence_retries: 1,
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'handed-back-terminal');
});

test('handed back supervisor run failure before fixer resumes approved plan once worktree clears', () => {
  const r = rec({
    state: STATES.HANDED_BACK,
    branch: null,
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    plan_status: 'valid',
    dossier_status: 'valid',
    last_error_class: 'supervisor-run-failed',
    handed_back_reason: 'supervisor-run-failed',
    opencode: { fixer: null, qa: null, specialists: {}, inflight: { kind: 'fixer-start', role: 'fixer', status: 'starting' } },
  });

  const d = route(r, {}, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'supervisor-run-recovery');
  assert.equal(d.toState, STATES.FIXING);
});

test('HANDED_BACK default → SKIP permanently even with label (acceptance 20)', () => {
  const r = rec({ state: STATES.HANDED_BACK, handed_back_reason: 'reject' });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'handed-back-terminal');
});

test('HANDED_BACK + /guardian retry → RESUME INVESTIGATING, clears fix_rounds (acceptance 21)', () => {
  const r = rec({ state: STATES.HANDED_BACK, fix_rounds: 2 });
  const d = route(r, { comments: [comment(1, '/guardian retry')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.INVESTIGATING);
  assert.equal(d.clearFixRounds, true);
});

test('HANDED_BACK fix-rounds-exceeded + /guardian continue → RESUME FIXING without clearing fix_rounds', () => {
  const r = rec({
    state: STATES.HANDED_BACK,
    handed_back_reason: 'fix-rounds-exceeded',
    last_error_class: 'fix-rounds-exceeded-human-review',
    fix_rounds: MAX_FIX_ROUNDS,
  });

  const d = route(r, { comments: [comment(2, '/guardian continue use the QA failure report')] }, OPTS);

  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'manual-fix-resume');
  assert.equal(d.toState, STATES.FIXING);
  assert.equal(d.manualFixResume, true);
  assert.equal(d.clearFixRounds, undefined);
  assert.equal(d.command.data, 'use the QA failure report');
});

test('HANDED_BACK non-fix-cap + /guardian continue remains terminal', () => {
  const r = rec({ state: STATES.HANDED_BACK, handed_back_reason: 'reject', last_error_class: 'reject' });
  const d = route(r, { comments: [comment(3, '/guardian continue')] }, OPTS);

  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'handed-back-terminal');
});

test('GATE_2_WAIT + typed closed-and-merged terminal fact → DONE (acceptance 9)', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = routeIssue(r, {
    terminal: { status: 'completed', reason: 'merged-closed', sourceEvidence: { issue_closed: true, matching_pr_merged: true } },
    controlEvents: [],
  }, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'DONE');
  assert.equal(d.reason, 'merged-closed');
});

test('GATE_2_WAIT + open issue with matching merged PR observation → DONE', () => {
  const r = rec({ state: STATES.GATE_2_WAIT, pr_url: 'https://github.com/o/r/pull/7' });
  const d = route(r, {
    closed: false,
    pullRequests: [{ number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'fix/issue-42', baseRefName: 'dev', merged: true }],
  }, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'DONE');
  assert.equal(d.reason, 'merged-closed');
});

test('GATE_2_WAIT + legacy issue closed without matching PR evidence does not reach DONE', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = routeIssue(r, { closed: true, comments: [] }, { leaseMs: LEASE, now: NOW });

  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate2-waiting');
});

test('GATE_2_WAIT + /guardian rework → RESUME FIXING (acceptance 22)', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian rework please also cover the null case')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.FIXING);
  assert.equal(d.command.verb, 'rework');
});

test('GATE_2_WAIT + no command + open → SKIP (still waiting on human review)', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate2-waiting');
});

test('DONE → SKIP', () => {
  const r = rec({ state: STATES.DONE });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'done');
});

test('wrong-state command is ignored (gate-2 rework offered while in gate-1)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian rework nope')] }, { leaseMs: LEASE, now: NOW });
  // rework is invalid in GATE_1_WAIT → no command consumed → keep waiting
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('MAX_FIX_ROUNDS is exported and sane', () => {
  assert.equal(MAX_FIX_ROUNDS >= 1, true);
});

test('FIXING with missing Supervisor evidence resumes QA instead of creating a fixer residue', () => {
  const r = rec({ state: STATES.FIXING, last_error_class: 'qa-missing-supervisor-evidence' });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'qa-evidence-retry');
  assert.equal(d.toState, STATES.VERIFYING);
});

test('VERIFYING with missing Supervisor evidence is not a retryable router state', () => {
  const r = rec({
    state: STATES.VERIFYING,
    last_error_class: 'qa-missing-supervisor-evidence',
    updated_at: new Date(NOW - 60 * 1000).toISOString(),
  });
  const d = route(r, {}, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'in-progress-fresh-lease');
});

test('GATE_1_WAIT + approve from an UNTRUSTED author → SKIP (authorization boundary)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian approve', 'attacker')] }, OPTS);
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('GATE_1_WAIT + approve but no trustedAuthors configured → SKIP (fail-closed)', () => {
  const r = rec({ state: STATES.GATE_1_WAIT });
  const d = route(r, { comments: [comment(1, '/guardian approve')] }, { leaseMs: LEASE, now: NOW });
  assert.equal(d.action, 'SKIP');
  assert.equal(d.reason, 'gate1-waiting');
});

test('DONE + trusted /guardian followup → RESUME new INVESTIGATING round', () => {
  const r = rec({ state: STATES.DONE });
  const d = route(r, { comments: [comment(10, '/guardian followup new acceptance failure')] }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.toState, STATES.INVESTIGATING);
  assert.equal(d.newRound, true);
  assert.equal(d.command.data, 'new acceptance failure');
});

test('closed GATE_2_WAIT + followup wins over DONE transition', () => {
  const r = rec({ state: STATES.GATE_2_WAIT });
  const d = routeIssue(r, {
    terminal: { status: 'completed', reason: 'merged-closed', sourceEvidence: { issue_closed: true, matching_pr_merged: true } },
    controlEvents: [{ id: '10', kind: 'command', verb: 'followup', data: 'post-merge issue', author: 'maintainer', occurredAt: '2026-08-18T11:10:00Z', sequence: 0 }],
  }, OPTS);
  assert.equal(d.action, 'RESUME');
  assert.equal(d.reason, 'followup');
  assert.equal(d.newRound, true);
});
