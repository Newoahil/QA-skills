// Tests for tools/guardian/notify.mjs channel routing (generic vs feishu).

import assert from 'node:assert/strict';
import test from 'node:test';

import { notify, buildChannelBody } from '../../tools/guardian/notify.mjs';
import { newState } from '../../tools/guardian/state.mjs';

function spyIo() {
  const calls = { comment: [], webhook: [] };
  return {
    calls,
    comment: (payload) => calls.comment.push(payload),
    webhook: (url, payload) => calls.webhook.push({ url, payload }),
  };
}

test('buildChannelBody generic returns the raw payload (backward compatible)', () => {
  const payload = { issue: 1, stage: 'GATE_1_WAIT' };
  assert.equal(buildChannelBody(payload, 'generic'), payload);
  assert.equal(buildChannelBody(payload), payload);
});

test('buildChannelBody feishu wraps payload into an interactive card', () => {
  const body = buildChannelBody({ issue: 1, stage: 'GATE_1_WAIT' }, 'feishu');
  assert.equal(body.msg_type, 'interactive');
  assert.ok(body.card);
});

test('notify with notify_channel=feishu sends a card body to the webhook', () => {
  const io = spyIo();
  notify(
    newState(42),
    { targetState: 'GATE_1_WAIT', link: 'https://gh/42' },
    { notify_webhook: 'https://open.feishu.cn/hook/x', notify_channel: 'feishu' },
    io,
  );
  assert.equal(io.calls.webhook.length, 1);
  assert.equal(io.calls.webhook[0].payload.msg_type, 'interactive');
});

test('notify default channel keeps the raw generic body (no regression)', () => {
  const io = spyIo();
  notify(
    newState(42),
    { targetState: 'GATE_2_WAIT' },
    { notify_webhook: 'https://hooks.example/x' },
    io,
  );
  assert.equal(io.calls.webhook.length, 1);
  assert.equal(io.calls.webhook[0].payload.msg_type, undefined);
  assert.equal(io.calls.webhook[0].payload.stage, 'GATE_2_WAIT');
});
