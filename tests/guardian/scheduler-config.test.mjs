import assert from 'node:assert/strict';
import test from 'node:test';

import * as scheduler from '../../tools/guardian/scheduler.mjs';

const { DEFAULT_INTERVAL_MS, validateSchedulerConfig } = scheduler;

const VALID_POLL_INTERVAL_MS = DEFAULT_INTERVAL_MS;
const VALID_LEASE_MS = VALID_POLL_INTERVAL_MS * 3;

function assertRejectsInvalidSchedulerConfig(config, expectedMessage) {
  assert.throws(
    () => validateSchedulerConfig(config),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, expectedMessage);
      return true;
    },
  );
}

test('scheduler defaults to a 10 second polling interval', () => {
  assert.equal(DEFAULT_INTERVAL_MS, 10 * 1000);
});

test('validateSchedulerConfig accepts bare config and explicit safe defaults', () => {
  assert.doesNotThrow(() => validateSchedulerConfig({}));
  assert.doesNotThrow(() => validateSchedulerConfig({
    poll_interval_ms: VALID_POLL_INTERVAL_MS,
    lease_ms: VALID_LEASE_MS,
  }));
});

test('validateSchedulerConfig rejects nonnumeric, NaN, zero, and negative poll intervals', () => {
  for (const poll_interval_ms of ['abc', Number.NaN, 0, -1]) {
    assertRejectsInvalidSchedulerConfig(
      { poll_interval_ms, lease_ms: VALID_LEASE_MS },
      /poll[_ ]interval/i,
    );
  }
});

test('validateSchedulerConfig rejects nonnumeric, NaN, zero, and negative leases', () => {
  for (const lease_ms of ['abc', Number.NaN, 0, -1]) {
    assertRejectsInvalidSchedulerConfig(
      { poll_interval_ms: VALID_POLL_INTERVAL_MS, lease_ms },
      /lease/i,
    );
  }
});

test('validateSchedulerConfig rejects leases shorter than double the poll interval', () => {
  assertRejectsInvalidSchedulerConfig(
    {
      poll_interval_ms: VALID_POLL_INTERVAL_MS,
      lease_ms: (VALID_POLL_INTERVAL_MS * 2) - 1,
    },
    /lease.*poll|poll.*lease|2/i,
  );
});
