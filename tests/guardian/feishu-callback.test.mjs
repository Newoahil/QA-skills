// Tests for tools/guardian/feishu-callback.mjs — signature verify + parse + command mapping.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  verifySignature,
  computeSignature,
  parseCardAction,
  commandToCommentBody,
  CallbackError,
  MAX_SKEW_MS,
} from '../../tools/guardian/feishu-callback.mjs';

const ENCRYPT_KEY = 'test-encrypt-key';
const NOW = Date.parse('2026-08-18T12:00:00Z');

function signed(rawBody, tsMs = NOW, nonce = 'nonce-1') {
  const timestamp = String(Math.floor(tsMs / 1000));
  const signature = computeSignature({ timestamp, nonce, encryptKey: ENCRYPT_KEY, rawBody });
  return { timestamp, nonce, signature };
}

test('verifySignature accepts a correctly signed fresh request', () => {
  const rawBody = '{"a":1}';
  const { timestamp, nonce, signature } = signed(rawBody);
  assert.equal(
    verifySignature({ timestamp, nonce, signature, encryptKey: ENCRYPT_KEY, rawBody, now: NOW }),
    true,
  );
});

test('verifySignature rejects a tampered body', () => {
  const rawBody = '{"a":1}';
  const { timestamp, nonce, signature } = signed(rawBody);
  assert.throws(
    () => verifySignature({ timestamp, nonce, signature, encryptKey: ENCRYPT_KEY, rawBody: '{"a":2}', now: NOW }),
    (e) => e instanceof CallbackError && e.code === 'bad-signature',
  );
});

test('verifySignature rejects a stale timestamp (replay window)', () => {
  const rawBody = '{"a":1}';
  const staleTs = NOW - MAX_SKEW_MS - 1000;
  const { timestamp, nonce, signature } = signed(rawBody, staleTs);
  assert.throws(
    () => verifySignature({ timestamp, nonce, signature, encryptKey: ENCRYPT_KEY, rawBody, now: NOW }),
    (e) => e instanceof CallbackError && e.code === 'stale',
  );
});

test('verifySignature rejects a wrong encrypt key', () => {
  const rawBody = '{"a":1}';
  const { timestamp, nonce, signature } = signed(rawBody);
  assert.throws(
    () => verifySignature({ timestamp, nonce, signature, encryptKey: 'wrong', rawBody, now: NOW }),
    (e) => e instanceof CallbackError && e.code === 'bad-signature',
  );
});

test('verifySignature rejects a malformed (non-integer/NaN) timestamp before skew check', () => {
  const rawBody = '{"a":1}';
  const nonce = 'n';
  const bad = 'not-a-number';
  const signature = computeSignature({ timestamp: bad, nonce, encryptKey: ENCRYPT_KEY, rawBody });
  assert.throws(
    () => verifySignature({ timestamp: bad, nonce, signature, encryptKey: ENCRYPT_KEY, rawBody, now: NOW }),
    (e) => e instanceof CallbackError && e.code === 'malformed',
  );
});

test('verifySignature rejects a non-positive timestamp', () => {
  const rawBody = '{"a":1}';
  const nonce = 'n';
  const signature = computeSignature({ timestamp: '0', nonce, encryptKey: ENCRYPT_KEY, rawBody });
  assert.throws(
    () => verifySignature({ timestamp: '0', nonce, signature, encryptKey: ENCRYPT_KEY, rawBody, now: NOW }),
    (e) => e instanceof CallbackError && e.code === 'malformed',
  );
});

test('parseCardAction accepts an allowed plain verb', () => {
  const event = { action: { value: { issue: 191, verb: 'approve' } } };
  assert.deepEqual(parseCardAction(event), { issue: 191, verb: 'approve', text: '' });
});

test('parseCardAction rejects a verb not on the whitelist', () => {
  const event = { action: { value: { issue: 191, verb: 'merge' } } };
  assert.throws(() => parseCardAction(event), (e) => e instanceof CallbackError && e.code === 'bad-verb');
});

test('parseCardAction requires opinion text for revise', () => {
  const empty = { action: { value: { issue: 191, verb: 'revise' }, input_value: '   ' } };
  assert.throws(() => parseCardAction(empty), (e) => e instanceof CallbackError && e.code === 'missing-text');

  const ok = { action: { value: { issue: 191, verb: 'revise' }, input_value: '放开支付中状态' } };
  assert.deepEqual(parseCardAction(ok), { issue: 191, verb: 'revise', text: '放开支付中状态' });
});

test('parseCardAction requires opinion text for followup', () => {
  const empty = { action: { value: { issue: 191, verb: 'followup' }, input_value: ' ' } };
  assert.throws(() => parseCardAction(empty), (e) => e instanceof CallbackError && e.code === 'missing-text');
  const ok = { action: { value: { issue: 191, verb: 'followup' }, input_value: '新的验收问题' } };
  assert.deepEqual(parseCardAction(ok), { issue: 191, verb: 'followup', text: '新的验收问题' });
});

test('parseCardAction rejects a non-positive issue number', () => {
  const event = { action: { value: { issue: 0, verb: 'approve' } } };
  assert.throws(() => parseCardAction(event), (e) => e instanceof CallbackError && e.code === 'bad-issue');
});

test('commandToCommentBody maps verb+text to the /guardian comment', () => {
  assert.equal(commandToCommentBody({ verb: 'approve', text: '' }), '/guardian approve');
  assert.equal(commandToCommentBody({ verb: 'revise', text: '放开支付中' }), '/guardian revise 放开支付中');
});

test('parseCardAction keeps malicious-looking opinion text as inert DATA', () => {
  const event = { action: { value: { issue: 191, verb: 'rework' }, input_value: '`$(rm -rf /)` <script>' } };
  const cmd = parseCardAction(event);
  assert.match(commandToCommentBody(cmd), /rm -rf|<script>/);
});
