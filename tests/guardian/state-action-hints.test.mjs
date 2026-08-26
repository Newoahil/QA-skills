import assert from 'node:assert/strict';
import test from 'node:test';

import { nextActionHint, formatActionHintLines } from '../../tools/guardian/state-action-hints.mjs';
import { newState, STATES } from '../../tools/guardian/state.mjs';

test('nextActionHint returns Gate 1 command guidance for human approval states', () => {
  const record = { ...newState(324), state: STATES.GATE_1_WAIT, risk: 'HIGH' };

  const hint = nextActionHint(record);

  assert.equal(hint.category, 'human');
  assert.equal(hint.commands.map((item) => item.text).join('|'), '/guardian approve|/guardian revise <意见>|/guardian reject');
  assert.match(formatActionHintLines(record).join('\n'), /下一步: .*approve/);
});

test('nextActionHint marks active pipeline states as automatic work', () => {
  for (const state of [STATES.DISCOVERED, STATES.INVESTIGATING, STATES.FIXING, STATES.VERIFYING, STATES.STALLED]) {
    const hint = nextActionHint({ ...newState(325), state });
    assert.equal(hint.category, 'automatic');
    assert.equal(hint.commands.length, 0);
  }
});

test('nextActionHint returns Gate 2 PR review commands', () => {
  const hint = nextActionHint({ ...newState(263), state: STATES.GATE_2_WAIT, pr_url: 'https://github.test/pr/263' });

  assert.equal(hint.category, 'human');
  assert.deepEqual(hint.commands.map((item) => item.text), ['/guardian rework <意见>', '/guardian followup <问题>']);
});

test('nextActionHint recognizes retryable handbacks without asking for comments', () => {
  const qaReview = nextActionHint({
    ...newState(325),
    state: STATES.HANDED_BACK,
    branch: 'fix/issue-325',
    last_error_class: 'qa-needs-human-review',
    evidence_retries: 0,
  });
  assert.equal(qaReview.category, 'automatic');
  assert.equal(qaReview.commands.length, 0);

  const supervisorRun = nextActionHint({
    ...newState(324),
    state: STATES.HANDED_BACK,
    last_error_class: 'supervisor-run-failed',
    gate_1_approved_comment_id: 'comment-1',
    gate_1_approved_plan_hash: 'sha256:plan',
    gate_1_approved_plan_revision: 'rev-1',
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
    plan_status: 'valid',
    dossier_status: 'valid',
  });
  assert.equal(supervisorRun.category, 'automatic');
});

test('nextActionHint returns terminal handback and done guidance', () => {
  const exhausted = nextActionHint({ ...newState(42), state: STATES.HANDED_BACK, handed_back_reason: 'fix-rounds-exceeded' });
  assert.equal(exhausted.category, 'human');
  assert.deepEqual(exhausted.commands.map((item) => item.text), ['/guardian continue <说明>', '/guardian retry']);

  const done = nextActionHint({ ...newState(43), state: STATES.DONE });
  assert.equal(done.category, 'done');
  assert.equal(done.commands.length, 0);
});
