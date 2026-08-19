import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionStatusAction } from '../../tools/guardian/scheduler.mjs';

test('session status routing continues only for ok and stops fail-closed otherwise', () => {
  assert.deepEqual(sessionStatusAction('ok'), { continue: true, retry: false, failClosed: false });
  assert.deepEqual(sessionStatusAction('retry'), { continue: false, retry: true, failClosed: false });
  for (const status of ['unusable-session', 'unverified', 'aborted', 'unexpected']) {
    assert.deepEqual(sessionStatusAction(status), { continue: false, retry: false, failClosed: true });
  }
});
