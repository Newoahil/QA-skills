import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_INTERVAL_MS } from '../../tools/guardian/scheduler.mjs';

test('scheduler defaults to a 10 second polling interval', () => {
  assert.equal(DEFAULT_INTERVAL_MS, 10 * 1000);
});
