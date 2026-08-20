import assert from 'node:assert/strict';
import test from 'node:test';

import { guidedError, listGuidedErrors } from '../../tools/guardian/dashboard-errors.mjs';

test('guidedError renders Chinese three-section guidance with interpolation', () => {
  const text = guidedError('no-issue-state', { issue: 42 });
  assert.match(text, /问题: 找不到议题 #42 的状态文件/);
  assert.match(text, /原因:/);
  assert.match(text, /下一步:/);
});

test('guidedError handles unknown keys without crashing', () => {
  const text = guidedError('unknown-key');
  assert.match(text, /问题: 发生未知错误/);
  assert.match(text, /原因:/);
  assert.match(text, /下一步:/);
});

test('all guided error entries include Chinese problem reason and next step', () => {
  for (const entry of Object.values(listGuidedErrors())) {
    assert.match(entry.problem, /[\u4e00-\u9fff]/);
    assert.match(entry.reason, /[\u4e00-\u9fff]/);
    assert.match(entry.next, /[\u4e00-\u9fff]/);
  }
});
