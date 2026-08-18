// Tests for tools/guardian/notify-feishu.mjs — Feishu card builder.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFeishuCard, CARD_ACTIONS, ALLOWED_CALLBACK_VERBS } from '../../tools/guardian/notify-feishu.mjs';

function verbsIn(card) {
  const verbs = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (node.value && typeof node.value === 'object' && node.value.verb) verbs.push(node.value.verb);
      Object.values(node).forEach(walk);
    }
  };
  walk(card);
  return Array.from(new Set(verbs));
}

test('GATE_1_WAIT card offers approve/revise/reject buttons', () => {
  const card = buildFeishuCard({ issue: 191, stage: 'GATE_1_WAIT', link: 'https://x/191' });
  assert.equal(card.msg_type, 'interactive');
  assert.deepEqual(verbsIn(card).sort(), ['approve', 'reject', 'revise']);
});

test('GATE_2_WAIT card offers only rework', () => {
  const card = buildFeishuCard({ issue: 191, stage: 'GATE_2_WAIT' });
  assert.deepEqual(verbsIn(card), ['rework']);
});

test('DONE card offers followup input for a new acceptance round', () => {
  const card = buildFeishuCard({ issue: 191, stage: 'DONE' });
  assert.deepEqual(verbsIn(card), ['followup']);
  assert.equal(JSON.stringify(card).includes('guardian_followup'), true);
});

test('STALLED and HANDED_BACK offer retry', () => {
  assert.deepEqual(verbsIn(buildFeishuCard({ issue: 1, stage: 'STALLED' })), ['retry']);
  assert.deepEqual(verbsIn(buildFeishuCard({ issue: 1, stage: 'HANDED_BACK' })), ['retry']);
});

test('revise/rework render an input element (opinion travels with callback)', () => {
  const card = buildFeishuCard({ issue: 191, stage: 'GATE_1_WAIT' });
  const hasInput = JSON.stringify(card).includes('"tag":"input"');
  assert.equal(hasInput, true);
});

test('card body carries no code/secret keys, only issue/stage/reason/link', () => {
  const card = buildFeishuCard({ issue: 191, stage: 'GATE_1_WAIT', reason: 'high-risk', link: 'https://x/191' });
  const s = JSON.stringify(card);
  assert.match(s, /191/);
  assert.match(s, /GATE_1_WAIT/);
  assert.doesNotMatch(s, /token|secret|password|apikey/i);
});

test('ALLOWED_CALLBACK_VERBS is the union of card action verbs', () => {
  const union = Array.from(new Set(Object.values(CARD_ACTIONS).flat().map((a) => a.verb))).sort();
  assert.deepEqual([...ALLOWED_CALLBACK_VERBS].sort(), union);
});
