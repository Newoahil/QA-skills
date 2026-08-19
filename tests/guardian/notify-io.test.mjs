// Tests for tools/guardian/notify-io.mjs — notification delivery orchestration (injected io/fs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

import { deliverNotifications, defaultCurlPost, defaultGhComment, notifyTargetState } from '../../tools/guardian/notify-io.mjs';
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
