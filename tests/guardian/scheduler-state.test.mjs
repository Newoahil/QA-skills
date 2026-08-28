import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashArtifact, writeArtifact } from '../../tools/guardian/artifacts.mjs';
import { ACTORS } from '../../tools/guardian/actor-routing.mjs';
import { deliverNotifications } from '../../tools/guardian/notify-io.mjs';
import { buildGate1Comment } from '../../tools/guardian/gate1-comment.mjs';
import { applyGateCommandState, buildInvestigationFailureState, buildRunFailureState, createLeaseFence, materializeQaVerdictState, persistCommandlessTransitions, publishWaitingGate1Proposals, summarizeSupervisorEvidence } from '../../tools/guardian/scheduler.mjs';
import { newState, readState, STATES, writeState } from '../../tools/guardian/state.mjs';

function fakeStore(initial) {
  const store = { ...initial };
  const writes = [];
  return {
    store,
    writes,
    readState: (_dir, issue) => (store[issue] ? { ...store[issue] } : null),
    writeState: (_dir, record) => {
      writes.push({ issue: record.issue, state: record.state, last_phase: record.last_phase });
      store[record.issue] = { ...record };
      return store[record.issue];
    },
  };
}

function spyIo(order) {
  return {
    ghComment: (issue) => order.push(`notify:${issue}`),
    curlPost: () => {},
  };
}

function tempGuardianDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'guardian-scheduler-state-')), '.qa', 'guardian');
}

function gate1Artifacts(investigationId = 'inv-263') {
  return {
    plan: {
      investigation_id: investigationId,
      spec_goal: 'Repair Gate 1 compensation replay.',
      implementation_summary: 'Publish the stored Gate 1 plan and dossier exactly once for recovered waiting records.',
      primary_files: ['tools/guardian/scheduler.mjs'],
      acceptance_summary: [
        'Recovered Gate 1 waiting records publish one full proposal.',
        'Invalid plan or dossier status blocks compensation replay.',
      ],
      blocking_questions: [],
      root_cause: 'Recovery compensation only checked artifact pair completeness.',
      affected_files: ['tools/guardian/scheduler.mjs', 'tests/guardian/scheduler-state.test.mjs'],
      test_plan: ['Call publishWaitingGate1Proposals twice against persisted artifacts.'],
    },
    dossier: {
      investigation_id: investigationId,
      unresolved_facts: ['Issue #263 remained in GATE_1_WAIT with valid persisted artifacts.'],
    },
  };
}

test('closed GATE_2_WAIT is persisted DONE before notification reads state', () => {
  const store = fakeStore({ 211: { ...newState(211), state: STATES.GATE_2_WAIT, last_phase: 'pr-opened' } });
  const order = [];
  const deps = { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' };
  const decision = { issue: 211, action: 'DONE', reason: 'merged-closed' };

  persistCommandlessTransitions({ decisions: [decision], guardianDir: '/injected', deps });
  deliverNotifications({
    decisions: [decision],
    guardianDir: '/injected',
    config: {},
    io: spyIo(order),
    actor: ACTORS.SUPERVISOR,
    deps,
  });

  assert.equal(store.store[211].state, STATES.DONE);
  assert.equal(store.store[211].last_notified_state, STATES.DONE);
  assert.deepEqual(store.writes.map((write) => write.state), [STATES.DONE, STATES.DONE]);
  assert.deepEqual(order, ['notify:211']);
});

test('STALLED and HANDED_BACK commandless decisions persist before their notifications', () => {
  const store = fakeStore({
    42: { ...newState(42), state: STATES.INVESTIGATING, stall_retries: 0 },
    7: { ...newState(7), state: STATES.GATE_1_WAIT },
  });
  const order = [];
  const deps = { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' };
  const decisions = [
    { issue: 42, action: 'STALLED', reason: 'lease-expired', nextStallRetries: 1 },
    { issue: 7, action: 'HANDED_BACK', reason: 'reject', handedBackReason: 'reject' },
  ];

  persistCommandlessTransitions({ decisions, guardianDir: '/injected', deps });
  deliverNotifications({ decisions, guardianDir: '/injected', config: {}, io: spyIo(order), actor: ACTORS.SUPERVISOR, deps });

  assert.equal(store.store[42].state, STATES.STALLED);
  assert.equal(store.store[42].stall_retries, 1);
  assert.equal(store.store[42].last_phase, 'stalled');
  assert.equal(store.store[7].state, STATES.HANDED_BACK);
  assert.equal(store.store[7].handed_back_reason, 'reject');
  assert.equal(store.store[7].last_phase, 'handed-back');
  assert.deepEqual(order, ['notify:42', 'notify:7']);
});

test('persisted STALLED recovery is written to INVESTIGATING before the runnable action', () => {
  const store = fakeStore({
    42: { ...newState(42), state: STATES.STALLED, stall_retries: 1 },
  });
  const decision = {
    issue: 42,
    action: 'RESUME',
    reason: 'stalled-retry',
    toState: STATES.INVESTIGATING,
  };

  persistCommandlessTransitions({
    decisions: [decision],
    guardianDir: '/injected',
    deps: { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' },
  });

  assert.equal(store.store[42].state, STATES.INVESTIGATING);
  assert.equal(store.store[42].last_phase, 'stalled-retry');
  assert.deepEqual(store.writes.map((write) => write.state), [STATES.INVESTIGATING]);
});

test('investigation failure becomes explicit handback instead of a fresh active lease', () => {
  const failureState = {
    ...newState(263),
    state: STATES.INVESTIGATING,
    claim_id: 'claim-263',
    claimed_at: '2026-08-25T09:39:19.350Z',
    investigation_attempts: 1,
  };
  const investigationState = {
    opencode: {
      specialists: {
        'guardian-business': { last_status: 'failed', duration_ms: 357855 },
        'guardian-code': { last_status: 'ok', duration_ms: 376239 },
      },
    },
  };
  const error = new Error('specialist-final-json parse failed for guardian-business: Unexpected end of JSON input');
  error.specialist_failures = ['guardian-business'];
  error.specialist_durations_ms = { 'guardian-business': 357855, 'guardian-code': 376239 };

  const record = buildInvestigationFailureState({ failureState, investigationState, error });

  assert.equal(record.state, STATES.HANDED_BACK);
  assert.equal(record.handed_back_reason, 'investigation-failed');
  assert.equal(record.dossier_status, 'failed');
  assert.equal(record.plan_status, 'failed');
  assert.equal(record.investigation_attempts, 2);
  assert.deepEqual(record.specialist_failures, ['guardian-business']);
  assert.deepEqual(record.specialist_durations_ms, { 'guardian-business': 357855, 'guardian-code': 376239 });
  assert.deepEqual(record.plan_validation_errors, [error.message]);
});

test('post-QA supervisor stage failure becomes explicit handback instead of a fresh active lease', () => {
  const currentState = {
    ...newState(325),
    state: STATES.INVESTIGATING,
    branch: 'fix/issue-325',
    qa_verdict_status: 'PASS',
    qa_verdict_hash: 'sha256:qa',
    last_phase: 'qa-passed',
  };
  const error = new Error("stage failed: fatal: pathspec 'backend/service/Foo.java：说明' did not match any files\n");

  const record = buildRunFailureState({ currentState, error, phase: 'finalization' });

  assert.equal(record.state, STATES.HANDED_BACK);
  assert.equal(record.handed_back_reason, 'supervisor-run-failed');
  assert.equal(record.last_error_class, 'supervisor-stage-failed');
  assert.equal(record.last_phase, 'finalization');
  assert.equal(record.qa_verdict_status, 'PASS');
  assert.match(record.run_error_message, /pathspec/);
});

test('post-QA finalization isolation failure is classified as supervisor-stage-failed for commandless recovery', () => {
  const currentState = {
    ...newState(325),
    state: STATES.INVESTIGATING,
    branch: 'fix/issue-325',
    qa_verdict_status: 'PASS',
    qa_verdict_hash: 'sha256:qa',
    last_phase: 'qa-passed',
  };
  const error = new Error('worktree has changes outside plan scope: .omo/run-continuation/325.json');

  const record = buildRunFailureState({ currentState, error, phase: 'finalization' });

  assert.equal(record.state, STATES.HANDED_BACK);
  assert.equal(record.handed_back_reason, 'supervisor-run-failed');
  assert.equal(record.last_error_class, 'supervisor-stage-failed');
  assert.equal(record.last_phase, 'finalization');
  assert.equal(record.qa_verdict_status, 'PASS');
  assert.match(record.run_error_message, /outside plan scope/);
});

test('gate waiting SKIP does not rewrite authoritative state', () => {
  const original = { ...newState(9), state: STATES.GATE_2_WAIT, last_phase: 'pr-opened' };
  const store = fakeStore({ 9: original });

  persistCommandlessTransitions({
    decisions: [{ issue: 9, action: 'SKIP', reason: 'gate2-waiting' }],
    guardianDir: '/injected',
    deps: { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' },
  });

  assert.deepEqual(store.writes, []);
  assert.deepEqual(store.store[9], original);
});

test('materializeQaVerdictState overwrites stale QA report when latest verdict passes', () => {
  const afterRun = {
    ...newState(324),
    state: STATES.FIXING,
    last_phase: 'qa-failed-retry',
    last_error_class: 'qa-failed-retry',
    qa_verdict_status: 'FAIL',
    qa_verdict_hash: 'sha256:old-fail',
    qa_verdict_report: 'Overall Status: FAIL\nold failure report',
    supervisor_test_evidence: { tests: [{ exit_code: 1 }] },
  };
  const next = materializeQaVerdictState({
    afterRun,
    issue: 324,
    code: 0,
    qaAudit: { approved: true, reason: 'qa-pass' },
    qaVerdict: {
      status: 'PASS',
      report_hash: 'sha256:new-pass',
      evidence_summary: 'Overall Status: PASS\nnew passing report',
      supervisor_evidence: { tests: [{ exit_code: 0 }] },
    },
  });

  assert.equal(next.qa_verdict_path, path.join('324', 'qa-verdict.json'));
  assert.equal(next.qa_verdict_status, 'PASS');
  assert.equal(next.qa_verdict_hash, 'sha256:new-pass');
  assert.equal(next.qa_verdict_report, 'Overall Status: PASS\nnew passing report');
  assert.deepEqual(next.supervisor_test_evidence, { tests: [{ exit_code: 0 }] });
  assert.equal(next.last_phase, 'qa-failed-retry');
  assert.equal(next.last_error_class, 'qa-failed-retry');
});

test('repeated DONE persistence is idempotent after the first transition', () => {
  const store = fakeStore({ 211: { ...newState(211), state: STATES.GATE_2_WAIT } });
  const deps = { readState: store.readState, writeState: store.writeState, now: '2026-08-19T12:00:00.000Z' };
  const decision = { issue: 211, action: 'DONE', reason: 'merged-closed' };

  persistCommandlessTransitions({ decisions: [decision], guardianDir: '/injected', deps });
  persistCommandlessTransitions({ decisions: [decision], guardianDir: '/injected', deps });

  assert.equal(store.writes.length, 1);
  assert.equal(store.store[211].state, STATES.DONE);
});

test('applyGateCommandState records manual fixer continuation without clearing QA context', () => {
  const current = {
    ...newState(324),
    state: STATES.HANDED_BACK,
    fix_rounds: 5,
    handed_back_reason: 'fix-rounds-exceeded',
    last_error_class: 'fix-rounds-exceeded-human-review',
    qa_verdict_path: '324/qa-verdict.json',
    qa_verdict_status: 'FAIL',
    qa_verdict_hash: 'sha256:qa',
    qa_verdict_report: 'Overall Status: FAIL\nStill broken',
    supervisor_test_evidence: { tests: [{ command: ['node', '--test'], exit_code: 1 }] },
    opencode: {
      schema_version: 1,
      fixer: { session_id: 'ses_fixer', last_status: 'ok' },
      qa: { session_id: 'ses_qa', last_status: 'ok' },
      specialists: {},
      inflight: null,
    },
  };

  const next = applyGateCommandState({
    currentBeforeRun: current,
    command: { verb: 'continue', commentId: 99, data: 'continue with QA report', manualFixResume: true },
    currentIdentity: { plan_hash: 'sha256:plan', plan_revision: 'rev-1' },
    repoDir: 'D:/repo',
    qaRuntimeDir: 'D:/repo.qa',
    now: '2026-08-26T01:00:00.000Z',
  });

  assert.equal(next.state, STATES.FIXING);
  assert.equal(next.fix_rounds, 5);
  assert.equal(next.manual_fix_resume, true);
  assert.equal(next.manual_fix_resume_comment_id, 99);
  assert.equal(next.manual_fix_resume_data, 'continue with QA report');
  assert.equal(next.qa_verdict_status, 'FAIL');
  assert.equal(next.opencode.fixer.session_id, 'ses_fixer');
  assert.equal(next.opencode.qa.session_id, 'ses_qa');
  assert.equal(next.last_consumed_comment_id, 99);
});

test('applyGateCommandState consumes environment retry continue without manual fixer resume or Gate1 overwrite', () => {
  const current = {
    ...newState(325),
    state: STATES.HANDED_BACK,
    branch: 'fix/issue-325',
    handed_back_reason: 'environment-blocked',
    last_error_class: 'qa-blocked-environment',
    fix_rounds: 2,
    gate_1_approved_comment_id: 7,
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    qa_verdict_status: 'BLOCKED',
    opencode: {
      schema_version: 1,
      fixer: { session_id: 'ses_fixer', last_status: 'ok' },
      qa: { session_id: 'ses_qa', last_status: 'ok' },
      specialists: {},
      inflight: null,
    },
  };

  const next = applyGateCommandState({
    currentBeforeRun: current,
    command: { verb: 'continue', commentId: 100, data: 'venv provisioned', qaEnvironmentRetry: true },
    currentIdentity: { plan_hash: 'sha256:other-plan', plan_revision: 'rev-other' },
    repoDir: 'D:/repo',
    qaRuntimeDir: 'D:/repo.qa',
    now: '2026-08-26T02:00:00.000Z',
  });

  assert.equal(next.state, STATES.VERIFYING);
  assert.equal(next.last_phase, 'qa-environment-retry');
  assert.equal(next.last_consumed_comment_id, 100);
  assert.equal(next.fix_rounds, 2);
  assert.equal(next.manual_fix_resume, current.manual_fix_resume);
  assert.equal(next.manual_fix_resume_comment_id, current.manual_fix_resume_comment_id);
  assert.equal(next.gate_1_approved_comment_id, 7);
  assert.equal(next.gate_1_approved_plan_hash, 'sha256:plan');
  assert.equal(next.gate_1_approved_plan_revision, 'rev-1');
  assert.equal(next.opencode.fixer.session_id, 'ses_fixer');
  assert.equal(next.opencode.qa.session_id, 'ses_qa');
  assert.equal(next.opencode.inflight, null);
});

test('publishWaitingGate1Proposals publishes one recovered Gate 1 proposal and persists the marker for the second call skip', () => {
  const guardianDir = tempGuardianDir();
  const issue = 263;
  const artifacts = gate1Artifacts();
  const comments = [];
  try {
    writeState(guardianDir, {
      ...newState(issue),
      state: STATES.GATE_1_WAIT,
      last_notified_state: STATES.GATE_1_WAIT,
      plan_status: 'valid',
      dossier_status: 'valid',
      gate_1_comment_hash: null,
      last_gate_1_proposal_hash: null,
    }, { touch: false });
    writeArtifact(guardianDir, issue, 'plan', artifacts.plan);
    writeArtifact(guardianDir, issue, 'dossier', artifacts.dossier);

    const decisions = [{ issue, action: 'SKIP', reason: 'gate1-waiting' }];
    const expectedPlanHash = hashArtifact(artifacts.plan);
    const expectedBody = buildGate1Comment({
      issue,
      plan: artifacts.plan,
      dossier: artifacts.dossier,
      planHash: expectedPlanHash,
      planRevision: artifacts.plan.investigation_id,
    });

    const first = publishWaitingGate1Proposals({
      decisions,
      guardianDir,
      io: { ghComment: (commentIssue, body) => comments.push({ issue: commentIssue, body }) },
      actor: ACTORS.SUPERVISOR,
    });

    assert.equal(first.length, 1);
    assert.equal(first[0].published, true);
    assert.equal(first[0].skipped, false);
    assert.equal(comments.length, 1);
    assert.deepEqual(comments[0], { issue, body: expectedBody });

    const afterFirst = readState(guardianDir, issue);
    assert.equal(typeof afterFirst.gate_1_comment_hash, 'string');
    assert.ok(afterFirst.gate_1_comment_hash.length > 0);
    assert.equal(afterFirst.last_gate_1_proposal_hash, expectedPlanHash);

    const second = publishWaitingGate1Proposals({
      decisions,
      guardianDir,
      io: { ghComment: (commentIssue, body) => comments.push({ issue: commentIssue, body }) },
      actor: ACTORS.SUPERVISOR,
    });

    assert.equal(second.length, 1);
    assert.equal(second[0].published, false);
    assert.equal(second[0].skipped, true);
    assert.equal(comments.length, 1);
  } finally {
    rmSync(path.dirname(path.dirname(guardianDir)), { recursive: true, force: true });
  }
});

test('publishWaitingGate1Proposals does not republish complete artifacts when plan or dossier status is not valid', () => {
  const guardianDir = tempGuardianDir();
  const invalidIssue = 264;
  const incompleteDossierIssue = 265;
  const artifacts = gate1Artifacts('inv-invalid-status');
  const comments = [];
  try {
    writeState(guardianDir, {
      ...newState(invalidIssue),
      state: STATES.GATE_1_WAIT,
      last_notified_state: STATES.GATE_1_WAIT,
      plan_status: 'invalid',
      dossier_status: 'valid',
      gate_1_comment_hash: null,
      last_gate_1_proposal_hash: null,
    }, { touch: false });
    writeArtifact(guardianDir, invalidIssue, 'plan', artifacts.plan);
    writeArtifact(guardianDir, invalidIssue, 'dossier', artifacts.dossier);

    writeState(guardianDir, {
      ...newState(incompleteDossierIssue),
      state: STATES.GATE_1_WAIT,
      last_notified_state: STATES.GATE_1_WAIT,
      plan_status: 'valid',
      dossier_status: 'missing',
      gate_1_comment_hash: null,
      last_gate_1_proposal_hash: null,
    }, { touch: false });
    writeArtifact(guardianDir, incompleteDossierIssue, 'plan', artifacts.plan);
    writeArtifact(guardianDir, incompleteDossierIssue, 'dossier', artifacts.dossier);

    const results = publishWaitingGate1Proposals({
      decisions: [
        { issue: invalidIssue, action: 'SKIP', reason: 'gate1-waiting' },
        { issue: incompleteDossierIssue, action: 'SKIP', reason: 'gate1-waiting' },
      ],
      guardianDir,
      io: { ghComment: (issue, body) => comments.push({ issue, body }) },
      actor: ACTORS.SUPERVISOR,
    });

    assert.deepEqual(results, []);
    assert.deepEqual(comments, []);
    assert.equal(readState(guardianDir, invalidIssue).gate_1_comment_hash, null);
    assert.equal(readState(guardianDir, incompleteDossierIssue).gate_1_comment_hash, null);
  } finally {
    rmSync(path.dirname(path.dirname(guardianDir)), { recursive: true, force: true });
  }
});

test('lease fence aborts active work when heartbeat renewal loses ownership', () => {
  let heartbeat;
  let cleared = false;
  const fence = createLeaseFence({
    lockFile: 'lock-file',
    handle: { token: 'owner' },
    leaseMs: 1000,
    renew: () => false,
    setIntervalFn: (callback) => {
      heartbeat = callback;
      return { unref() {} };
    },
    clearIntervalFn: () => { cleared = true; },
  });

  assert.equal(fence.isActiveRun(), true);
  heartbeat();
  assert.equal(fence.isActiveRun(), false);
  assert.equal(fence.signal.aborted, true);
  fence.stop();
  assert.equal(cleared, true);
});

test('approve persists a pre-fixer inflight marker for crash-window recovery', () => {
  const record = applyGateCommandState({
    currentBeforeRun: {
      ...newState(325),
      state: STATES.GATE_1_WAIT,
      opencode: { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null },
    },
    command: { verb: 'approve', commentId: 'comment-approve' },
    currentIdentity: { plan_hash: 'sha256:plan', plan_revision: 'rev-1' },
    repoDir: 'D:/control',
    qaRuntimeDir: 'D:/snapshot',
    now: '2026-08-25T14:34:12.000Z',
  });

  assert.equal(record.state, STATES.FIXING);
  assert.equal(record.gate_1_approved_comment_id, 'comment-approve');
  assert.equal(record.gate_1_approved_plan_hash, 'sha256:plan');
  assert.equal(record.gate_1_approved_plan_revision, 'rev-1');
  assert.equal(record.last_command_verb, 'approve');
  assert.equal(record.last_command_comment_id, 'comment-approve');
  assert.equal(record.opencode.inflight.kind, 'fixer-start');
  assert.equal(record.opencode.inflight.status, 'starting');
});

test('revise clears approval/proposal markers and routes back to investigation', () => {
  const record = applyGateCommandState({
    currentBeforeRun: {
      ...newState(324),
      state: STATES.GATE_1_WAIT,
      gate_1_approved_comment_id: 'old-approve',
      gate_1_approved_plan_hash: 'sha256:old',
      gate_1_approved_plan_revision: 'old-rev',
      gate_1_comment_hash: 'old-comment',
      last_gate_1_proposal_hash: 'sha256:old',
      last_notified_state: STATES.GATE_1_WAIT,
      dossier_status: 'valid',
      plan_status: 'valid',
      dossier_hash: 'sha256:old-dossier',
      dossier_revision: 'old-rev',
      plan_hash: 'sha256:old',
      plan_revision: 'old-rev',
      opencode: { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null },
    },
    command: { verb: 'revise', commentId: 'comment-revise', data: '只确认触发场景' },
    currentIdentity: { plan_hash: 'sha256:old', plan_revision: 'old-rev' },
    repoDir: 'D:/control',
    qaRuntimeDir: 'D:/snapshot',
    now: '2026-08-25T14:30:42.000Z',
  });

  assert.equal(record.state, STATES.INVESTIGATING);
  assert.equal(record.gate_1_revision_data, '只确认触发场景');
  assert.equal(record.gate_1_approved_comment_id, null);
  assert.equal(record.gate_1_approved_plan_hash, null);
  assert.equal(record.gate_1_approved_plan_revision, null);
  assert.equal(record.last_command_verb, 'revise');
  assert.equal(record.last_command_comment_id, 'comment-revise');
  assert.equal(record.gate_1_comment_hash, null);
  assert.equal(record.last_gate_1_proposal_hash, null);
  assert.equal(record.last_notified_state, null);
  assert.equal(record.dossier_status, 'superseded');
  assert.equal(record.plan_status, 'superseded');
  assert.equal(record.dossier_hash, null);
  assert.equal(record.dossier_revision, null);
  assert.equal(record.plan_hash, null);
  assert.equal(record.plan_revision, null);
  assert.equal(record.opencode.inflight, null);
});

test('summarizeSupervisorEvidence renders only allow-listed facts, never raw output', () => {
  const summary = summarizeSupervisorEvidence({
    status_diff: { exit_code: 0 },
    tests: [{ command: ['node', '--test', 'tests/guardian/foo.test.mjs'], exit_code: 0 }],
  });
  assert.match(summary, /status\/diff 退出码: 0/);
  assert.match(summary, /foo\.test\.mjs/);
  assert.doesNotMatch(summary, /secret|token|password/i);
  // Non-object / empty returns null.
  assert.equal(summarizeSupervisorEvidence(null), null);
  assert.equal(summarizeSupervisorEvidence({}), null);
});
