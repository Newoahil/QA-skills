// Tests for tools/guardian/notify-io.mjs — notification delivery orchestration (injected io/fs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

import { hashArtifact } from '../../tools/guardian/artifacts.mjs';
import { buildGate1Comment } from '../../tools/guardian/gate1-comment.mjs';
import { closeoutTransition, deliverNotifications, defaultCurlPost, defaultGhComment, notifyTargetState, publishGate1Proposal } from '../../tools/guardian/notify-io.mjs';
import { newState } from '../../tools/guardian/state.mjs';
import { ACTORS } from '../../tools/guardian/actor-routing.mjs';

function fakeStore(initial = {}) {
  const store = { ...initial };
  return {
    store,
    readState: (_dir, issue) => (store[issue] ? { ...store[issue] } : null),
    writeState: (_dir, record) => {
      store[record.issue] = { ...record };
      return store[record.issue];
    },
  };
}

function spyIo() {
  const calls = { comment: [], webhook: [] };
  return {
    calls,
    ghComment: (issue, text) => calls.comment.push({ issue, text }),
    curlPost: (url, body) => calls.webhook.push({ url, body }),
  };
}

function gate1Artifacts(overrides = {}) {
  const investigationId = overrides.investigation_id ?? 'inv-263';
  const plan = {
    investigation_id: investigationId,
    spec_goal: '修复分类列表空状态文案。',
    implementation_summary: '恢复正确的分类空状态和有商品状态文案。',
    primary_files: ['frontend/apps/alipay-miniapp/src/pages/classifyAgain/index.js'],
    acceptance_summary: [
      '有商品分类不显示错误引导文案。',
      '无商品分类显示预期空状态文案。',
    ],
    blocking_questions: ['是否只覆盖 classifyAgain 页面？'],
    root_cause: '分类列表文案预期需要人工确认。',
    affected_files: ['frontend/apps/alipay-miniapp/src/pages/classifyAgain/index.js'],
    test_plan: ['覆盖有商品和无商品分类。'],
    ...overrides.plan,
  };
  const dossier = {
    investigation_id: investigationId,
    unresolved_facts: ['Issue #263 已被手动恢复到等待确认状态。'],
    ...overrides.dossier,
  };
  return {
    plan,
    dossier,
    planHash: hashArtifact(plan),
    planRevision: plan.investigation_id,
  };
}

test('notifyTargetState maps STALLED/HANDED_BACK; others → null', () => {
  assert.equal(notifyTargetState({ action: 'SKIP', reason: 'gate1-waiting' }), 'GATE_1_WAIT');
  assert.equal(notifyTargetState({ action: 'SKIP', reason: 'gate2-waiting' }), 'GATE_2_WAIT');
  assert.equal(notifyTargetState({ action: 'STALLED' }), 'STALLED');
  assert.equal(notifyTargetState({ action: 'HANDED_BACK' }), 'HANDED_BACK');
  assert.equal(notifyTargetState({ action: 'DONE' }), 'DONE');
  assert.equal(notifyTargetState({ action: 'START' }), null);
  assert.equal(notifyTargetState({ action: 'SKIP' }), null);
});

test('delivers a comment for a STALLED decision and persists last_notified_state', () => {
  const fs = fakeStore({ 42: newState(42) });
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 42, action: 'STALLED', reason: 'lease-expired' }],
    guardianDir: '/g',
    config: {},
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.deepEqual(results, [{ issue: 42, delivered: true }]);
  assert.equal(io.calls.comment.length, 1);
  assert.equal(fs.store[42].last_notified_state, 'STALLED');
});

test('idempotent: a state already notified is not re-delivered', () => {
  const fs = fakeStore({ 42: { ...newState(42), last_notified_state: 'HANDED_BACK' } });
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 42, action: 'HANDED_BACK', handedBackReason: 'reject' }],
    guardianDir: '/g',
    config: {},
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results[0].skipped, true);
  assert.equal(io.calls.comment.length, 0);
});

test('duplicate delivery calls claim one transition before injected I/O', () => {
  const fs = fakeStore({ 43: newState(43) });
  const io = spyIo();
  const claim = (() => {
    let claimed = false;
    return () => {
      if (claimed) return false;
      claimed = true;
      return true;
    };
  })();
  const deps = { readState: fs.readState, writeState: fs.writeState, claimNotification: claim };

  const first = deliverNotifications({
    decisions: [{ issue: 43, action: 'STALLED' }], guardianDir: '/g', config: {}, io,
    actor: ACTORS.SUPERVISOR, deps,
  });
  const second = deliverNotifications({
    decisions: [{ issue: 43, action: 'STALLED' }], guardianDir: '/g', config: {}, io,
    actor: ACTORS.SUPERVISOR, deps,
  });

  assert.deepEqual(first, [{ issue: 43, delivered: true }]);
  assert.deepEqual(second, [{ issue: 43, delivered: false, skipped: true, reasonSkipped: 'transition-claimed' }]);
  assert.equal(io.calls.comment.length, 1);
  assert.equal(fs.store[43].last_notified_state, 'STALLED');
});

test('failed closeout delivery leaves the marker retryable and preserves authoritative state', () => {
  const fs = fakeStore({ 44: newState(44) });
  const order = [];
  const result = closeoutTransition({
    guardianDir: '/g',
    decision: { issue: 44, action: 'GATE_1_WAIT' },
    statePatch: { state: 'GATE_1_WAIT' },
    io: spyIo(),
    actor: ACTORS.SUPERVISOR,
    deps: {
      readState: fs.readState,
      writeState: (_dir, record) => {
        order.push(record.last_notified_state ? 'marker' : 'state');
        fs.store[record.issue] = { ...record };
      },
    },
    deliver: () => { order.push('delivery'); throw new Error('comment unavailable'); },
  });

  assert.deepEqual(result, [{ issue: 44, delivered: false, error: 'comment unavailable' }]);
  assert.deepEqual(order, ['state', 'delivery']);
  assert.equal(fs.store[44].state, 'GATE_1_WAIT');
  assert.equal(fs.store[44].last_notified_state, null);
});

test('Given custom Gate 1 closeout comment delivery with notify_webhook, When closeoutTransition succeeds, Then it also posts webhook before persisting last_notified_state', () => {
  const fs = fakeStore({ 45: newState(45) });
  const calls = [];
  const io = {
    calls: { comment: [], webhook: [] },
    ghComment: (issue, text) => { calls.push('comment'); io.calls.comment.push({ issue, text }); },
    curlPost: (url, body) => { calls.push('webhook'); io.calls.webhook.push({ url, body }); },
  };
  const result = closeoutTransition({
    guardianDir: '/g', decision: { issue: 45, action: 'SKIP', reason: 'gate1-waiting' }, statePatch: { state: 'GATE_1_WAIT' },
    config: { notify_webhook: 'https://example.test/hook' }, io, actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: (_dir, record) => { calls.push(record.last_notified_state ? 'marker' : 'state'); fs.store[record.issue] = { ...record }; } },
    deliver: () => { calls.push('deliver'); io.ghComment(45, 'custom Gate 1 closeout comment'); },
  });

  assert.deepEqual(result, [{ issue: 45, delivered: true }]);
  assert.equal(io.calls.comment.length, 1);
  assert.equal(io.calls.webhook.length, 1);
  assert.equal(fs.store[45].last_notified_state, 'GATE_1_WAIT');
  assert.deepEqual(calls, ['state', 'deliver', 'comment', 'webhook', 'marker']);
});

test('Given custom Gate 1 closeout comment delivery with failing notify_webhook, When closeoutTransition runs, Then it leaves last_notified_state retryable', () => {
  const fs = fakeStore({ 46: newState(46) });
  const calls = [];
  const io = {
    ghComment: () => { calls.push('comment'); },
    curlPost: () => { calls.push('webhook'); throw new Error('webhook unavailable'); },
  };
  const result = closeoutTransition({
    guardianDir: '/g', decision: { issue: 46, action: 'SKIP', reason: 'gate1-waiting' }, statePatch: { state: 'GATE_1_WAIT' },
    config: { notify_webhook: 'https://example.test/hook' }, io, actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: (_dir, record) => { calls.push(record.last_notified_state ? 'marker' : 'state'); fs.store[record.issue] = { ...record }; } },
    deliver: () => { calls.push('deliver'); io.ghComment(46, 'custom Gate 1 closeout comment'); },
  });

  assert.deepEqual(result, [{ issue: 46, delivered: false, error: 'webhook unavailable' }]);
  assert.deepEqual(calls, ['state', 'deliver', 'comment', 'webhook']);
  assert.equal(fs.store[46].state, 'GATE_1_WAIT');
  assert.equal(fs.store[46].last_notified_state, null);
});

test('restored GATE_1_WAIT with valid plan/dossier and no proposal marker republishes exactly one full Gate 1 proposal even when last_notified_state already matches', () => {
  const issue = 263;
  const artifacts = gate1Artifacts();
  const expectedBody = buildGate1Comment({
    issue,
    plan: artifacts.plan,
    dossier: artifacts.dossier,
    planHash: artifacts.planHash,
    planRevision: artifacts.planRevision,
  });
  const fs = fakeStore({
    [issue]: {
      ...newState(issue),
      state: 'GATE_1_WAIT',
      plan_hash: artifacts.planHash,
      plan_revision: artifacts.planRevision,
      dossier_revision: artifacts.dossier.investigation_id,
      last_notified_state: 'GATE_1_WAIT',
      last_gate_1_proposal_hash: null,
    },
  });
  const io = spyIo();

  const result = closeoutTransition({
    guardianDir: '/g',
    decision: { issue, action: 'GATE_1_WAIT' },
    statePatch: { state: 'GATE_1_WAIT', plan_hash: artifacts.planHash, plan_revision: artifacts.planRevision },
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
    deliver: () => io.ghComment(issue, expectedBody),
  });

  assert.deepEqual(result, [{ issue, delivered: true }]);
  assert.deepEqual(io.calls.comment, [{ issue, text: expectedBody }]);
});

test('successful recovered Gate 1 proposal persists a dedicated proposal hash marker independent from last_notified_state', () => {
  const issue = 264;
  const artifacts = gate1Artifacts({ investigation_id: 'inv-264' });
  const expectedBody = buildGate1Comment({
    issue,
    plan: artifacts.plan,
    dossier: artifacts.dossier,
    planHash: artifacts.planHash,
    planRevision: artifacts.planRevision,
  });
  const fs = fakeStore({
    [issue]: {
      ...newState(issue),
      state: 'GATE_1_WAIT',
      plan_hash: artifacts.planHash,
      plan_revision: artifacts.planRevision,
      dossier_revision: artifacts.dossier.investigation_id,
      last_notified_state: 'GATE_1_WAIT',
      last_gate_1_proposal_hash: null,
    },
  });
  const io = spyIo();

  closeoutTransition({
    guardianDir: '/g',
    decision: { issue, action: 'GATE_1_WAIT' },
    statePatch: { state: 'GATE_1_WAIT' },
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
    deliver: () => io.ghComment(issue, expectedBody),
  });

  assert.equal(fs.store[issue].last_notified_state, 'GATE_1_WAIT');
  assert.equal(fs.store[issue].last_gate_1_proposal_hash, artifacts.planHash);
});

test('later tick with the same Gate 1 proposal hash marker does not republish the detailed proposal', () => {
  const issue = 265;
  const artifacts = gate1Artifacts({ investigation_id: 'inv-265' });
  const expectedBody = buildGate1Comment({
    issue,
    plan: artifacts.plan,
    dossier: artifacts.dossier,
    planHash: artifacts.planHash,
    planRevision: artifacts.planRevision,
  });
  const fs = fakeStore({
    [issue]: {
      ...newState(issue),
      state: 'GATE_1_WAIT',
      plan_hash: artifacts.planHash,
      plan_revision: artifacts.planRevision,
      dossier_revision: artifacts.dossier.investigation_id,
      last_notified_state: null,
      last_gate_1_proposal_hash: artifacts.planHash,
    },
  });
  const io = spyIo();

  const result = closeoutTransition({
    guardianDir: '/g',
    decision: { issue, action: 'GATE_1_WAIT' },
    statePatch: { state: 'GATE_1_WAIT' },
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
    deliver: () => io.ghComment(issue, expectedBody),
  });

  assert.deepEqual(result, [{ issue, delivered: false, skipped: true }]);
  assert.equal(io.calls.comment.length, 0);
});

test('Gate 1 first-entry proposal survives generic notification and compensation without duplication', () => {
  const writes = [];
  const comments = [];
  let record = {
    issue: 217,
    state: 'GATE_1_WAIT',
    plan_hash: 'sha256:plan-217',
    last_notified_state: null,
    gate_1_comment_hash: null,
    last_gate_1_proposal_hash: null,
  };
  const deps = {
    readState: () => record,
    writeState: (_dir, next) => { writes.push(next); record = next; },
    claimNotification: () => true,
    releaseNotificationClaim: () => {},
  };
  const io = { ghComment: (_issue, body) => { comments.push(body); return { ok: true }; }, curlPost: () => ({ ok: true }) };
  const decision = {
    issue: 217,
    action: 'GATE_1_WAIT',
    proposal: { plan: { root_cause: 'root' }, dossier: { issue: 217 }, planHash: 'sha256:plan-217', planRevision: 'rev-1' },
  };

  closeoutTransition({ guardianDir: 'D:/guardian', decision, statePatch: { state: 'GATE_1_WAIT' }, io, actor: 'supervisor', deps });
  closeoutTransition({ guardianDir: 'D:/guardian', decision: { issue: 217, action: 'SKIP', reason: 'gate1-waiting' }, statePatch: {}, io, actor: 'supervisor', deps, deliver: () => {} });
  const recovered = publishGate1Proposal({ guardianDir: 'D:/guardian', issue: 217, record, plan: decision.proposal.plan, dossier: decision.proposal.dossier, planHash: 'sha256:plan-217', planRevision: 'rev-1', ghComment: io.ghComment, actor: 'supervisor', deps });

  assert.equal(comments.length, 1);
  assert.equal(recovered.published, false);
  assert.equal(typeof record.gate_1_comment_hash, 'string');
  assert.equal(record.last_gate_1_proposal_hash, 'sha256:plan-217');
});

test('publication failure keeps the Gate 1 proposal marker absent so the next tick can retry the same recovered proposal', () => {
  const issue = 266;
  const artifacts = gate1Artifacts({ investigation_id: 'inv-266' });
  const fs = fakeStore({
    [issue]: {
      ...newState(issue),
      state: 'GATE_1_WAIT',
      plan_hash: artifacts.planHash,
      plan_revision: artifacts.planRevision,
      dossier_revision: artifacts.dossier.investigation_id,
      last_notified_state: 'GATE_1_WAIT',
      last_gate_1_proposal_hash: null,
    },
  });
  let attempts = 0;

  const runRecoveredPublish = () => closeoutTransition({
    guardianDir: '/g',
    decision: { issue, action: 'GATE_1_WAIT' },
    statePatch: { state: 'GATE_1_WAIT' },
    io: spyIo(),
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
    deliver: () => {
      attempts += 1;
      throw new Error('comment unavailable');
    },
  });

  assert.deepEqual(runRecoveredPublish(), [{ issue, delivered: false, error: 'comment unavailable' }]);
  assert.equal(fs.store[issue].last_gate_1_proposal_hash, null);
  assert.deepEqual(runRecoveredPublish(), [{ issue, delivered: false, error: 'comment unavailable' }]);
  assert.equal(attempts, 2);
});

test('Gate 1 proposal publication respects the active-run fence before comment I/O', () => {
  const issue = 267;
  const artifacts = gate1Artifacts({ investigation_id: 'inv-267' });
  const fs = fakeStore({ [issue]: { ...newState(issue), state: 'GATE_1_WAIT' } });
  const io = spyIo();
  assert.throws(() => publishGate1Proposal({
    guardianDir: '/g',
    issue,
    record: fs.store[issue],
    plan: artifacts.plan,
    dossier: artifacts.dossier,
    planHash: artifacts.planHash,
    planRevision: artifacts.planRevision,
    ghComment: io.ghComment,
    actor: ACTORS.SUPERVISOR,
    deps: { writeState: fs.writeState },
    isActiveRun: () => false,
  }), /fenced/);
  assert.equal(io.calls.comment.length, 0);
  assert.equal(fs.store[issue].gate_1_comment_hash, null);
});

test('webhook fires when notify_webhook configured (feishu channel wraps a card)', () => {
  const fs = fakeStore({ 7: newState(7) });
  const io = spyIo();
  deliverNotifications({
    decisions: [{ issue: 7, action: 'STALLED' }],
    guardianDir: '/g',
    config: { notify_webhook: 'https://open.feishu.cn/hook', notify_channel: 'feishu' },
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(io.calls.webhook.length, 1);
  assert.equal(io.calls.webhook[0].body.msg_type, 'interactive');
});

test('missing state record is skipped, not fatal', () => {
  const fs = fakeStore({});
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 99, action: 'STALLED' }],
    guardianDir: '/g',
    config: {},
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].error, 'no-state-record');
});

test('one issue delivery failure does not abort the others (best-effort)', () => {
  const fs = fakeStore({ 1: newState(1), 2: newState(2) });
  const io = {
    calls: { comment: [] },
    ghComment: (issue, text) => {
      if (issue === 1) throw new Error('gh boom');
      io.calls.comment.push({ issue, text });
    },
    curlPost: () => {},
  };
  const results = deliverNotifications({
    decisions: [{ issue: 1, action: 'STALLED' }, { issue: 2, action: 'HANDED_BACK' }],
    guardianDir: '/g',
    config: {},
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results.find((r) => r.issue === 1).error, 'gh boom');
  assert.equal(results.find((r) => r.issue === 2).delivered, true);
  // Failed issue must NOT have its marker persisted (so it retries next tick).
  assert.equal(fs.store[1].last_notified_state, null);
  assert.equal(fs.store[2].last_notified_state, 'HANDED_BACK');
});

test('non-notify decisions are ignored', () => {
  const fs = fakeStore({ 5: newState(5) });
  const io = spyIo();
  const results = deliverNotifications({
    decisions: [{ issue: 5, action: 'START' }, { issue: 5, action: 'SKIP' }],
    guardianDir: '/g',
    config: {},
    io,
    actor: ACTORS.SUPERVISOR,
    deps: { readState: fs.readState, writeState: fs.writeState },
  });
  assert.equal(results.length, 0);
  assert.equal(io.calls.comment.length, 0);
});

test('deliverNotifications rejects QA, fixer, and unknown actors before comment/webhook I/O', () => {
  for (const actor of ['qa', ACTORS.BOT_EXECUTOR, 'unknown']) {
    const fs = fakeStore({ 42: newState(42) });
    const io = spyIo();
    assert.throws(() => deliverNotifications({
      decisions: [{ issue: 42, action: 'STALLED' }], guardianDir: '/g', config: {}, io, actor,
      deps: { readState: fs.readState, writeState: fs.writeState },
    }), /may not perform|unknown actor/);
    assert.equal(io.calls.comment.length, 0, actor);
    assert.equal(io.calls.webhook.length, 0, actor);
  }
});

test('default gh/curl adapters reject unauthorized actors before subprocess creation', () => {
  for (const actor of ['qa', ACTORS.BOT_EXECUTOR, 'unknown']) {
    assert.throws(() => defaultGhComment('D:/repo', actor)(42, 'fact'), /may not perform|unknown actor/);
    assert.throws(() => defaultCurlPost(actor)('https://example.test/hook', { fact: true }), /may not perform|unknown actor/);
  }
});

test('defaultGhComment writes exact Unicode body through --body-file and cleans after success', () => {
  let captured;
  defaultGhComment('D:/repo', ACTORS.SUPERVISOR, (_cmd, args, opts) => {
    const bodyFile = args[args.indexOf('--body-file') + 1];
    captured = { args, opts, bodyFile, body: readFileSync(bodyFile, 'utf8'), existsDuringRun: existsSync(bodyFile) };
    return { status: 0, stdout: '', stderr: '' };
  })(42, '诊断结论：修复成功 ✅');
  assert.equal(captured.args.includes('--body-file'), true);
  assert.equal(captured.args.includes('--body'), false);
  assert.equal(captured.body, '诊断结论：修复成功 ✅');
  assert.equal(captured.opts.shell, false);
  assert.equal(captured.existsDuringRun, true);
  assert.equal(existsSync(captured.bodyFile), false);
});

test('defaultGhComment cleans body file after failure without including body in error', () => {
  let bodyFile;
  assert.throws(() => defaultGhComment('D:/repo', ACTORS.SUPERVISOR, (_cmd, args) => {
    bodyFile = args[args.indexOf('--body-file') + 1];
    return { status: 1, stderr: 'forbidden' };
  })(42, '中文秘密'), /forbidden/);
  assert.equal(existsSync(bodyFile), false);
});

test('defaultGhComment rejects unauthorized actor before temp creation or subprocess', () => {
  let calls = 0;
  assert.throws(() => defaultGhComment('D:/repo', 'qa', () => { calls += 1; return { status: 0 }; })(42, '不会写入'), /may not perform|unknown actor/);
  assert.equal(calls, 0);
});
