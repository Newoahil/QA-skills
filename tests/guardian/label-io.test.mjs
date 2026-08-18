import assert from 'node:assert/strict';
import test from 'node:test';

import { labelsForState, projectLabels } from '../../tools/guardian/label-io.mjs';

test('labelsForState projects class, risk, and gate without replacing JSON authority', () => {
  assert.deepEqual(labelsForState({ issue_class: 'bug', risk: 'HIGH', state: 'GATE_1_WAIT' }), [
    'qa-guardian:bug', 'qa-guardian:risk-high', 'qa-guardian:gate-1',
  ]);
});

test('projectLabels performs scheduler-owned add/remove operations', () => {
  const calls = [];
  const run = (_cmd, args) => { calls.push(args); return { status: 0, stderr: '' }; };
  const result = projectLabels('D:/repo', 42, { issue_class: 'request', risk: 'LOW', state: 'GATE_2_WAIT' }, run);
  assert.deepEqual(result.errors, []);
  assert.equal(calls.some((args) => args.includes('qa-guardian:request')), true);
  assert.equal(calls.some((args) => args.includes('qa-guardian:risk-low')), true);
  assert.equal(calls.some((args) => args.includes('qa-guardian:gate-2')), true);
});

test('projection failures are returned and do not throw', () => {
  const run = () => ({ status: 1, stderr: 'permission denied' });
  const result = projectLabels('D:/repo', 42, { risk: 'HIGH' }, run);
  assert.equal(result.errors.length > 0, true);
});
