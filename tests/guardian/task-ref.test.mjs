import test from 'node:test';
import assert from 'node:assert/strict';

import {
  githubIssueToTaskRef,
  makeTaskRef,
  taskRefKey,
} from '../../tools/guardian/task-ref.mjs';

test('makeTaskRef returns a frozen normalized reference', () => {
  const ref = makeTaskRef({ source: ' github ', taskId: 42, displayId: ' #42 ' });

  assert.deepEqual(ref, { source: 'github', taskId: '42', displayId: '#42' });
  assert.equal(Object.isFrozen(ref), true);
});

test('makeTaskRef rejects blank identity fields', () => {
  for (const input of [
    { source: '', taskId: '1', displayId: '#1' },
    { source: 'github', taskId: '', displayId: '#1' },
    { source: 'github', taskId: '1', displayId: '' },
  ]) {
    assert.throws(() => makeTaskRef(input), /TaskRef/);
  }
});

test('taskRefKey joins source and task id without using display id', () => {
  const ref = makeTaskRef({ source: 'github', taskId: '42', displayId: 'custom label' });

  assert.equal(taskRefKey(ref), 'github:42');
});

test('githubIssueToTaskRef maps a numeric issue into GitHub identity', () => {
  assert.deepEqual(githubIssueToTaskRef(42), {
    source: 'github',
    taskId: '42',
    displayId: '#42',
  });
});

test('githubIssueToTaskRef rejects invalid issue numbers', () => {
  for (const issue of [0, -1, 1.5, Number.NaN, 'abc']) {
    assert.throws(() => githubIssueToTaskRef(issue), /GitHub issue/);
  }
});
