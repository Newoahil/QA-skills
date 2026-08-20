import assert from 'node:assert/strict';
import test from 'node:test';

import { memoryConfig, recallEngineeringMemory, recordEngineeringMemory } from '../../tools/guardian/memory-provider.mjs';

test('memoryConfig keeps SyberMem disabled unless configured', () => {
  assert.deepEqual(memoryConfig({}), {
    enabled: false,
    provider: 'none',
    recallBeforeInvestigation: true,
    recallBeforePlan: true,
    recordAfterGate2: false,
    recordFailures: false,
    maxRecallItems: 5,
  });
});

test('recallEngineeringMemory degrades when SyberMem is unavailable', () => {
  const result = recallEngineeringMemory({
    config: { memory: { provider: 'sybermem' } },
    repoDir: 'D:/repo',
    issue: 42,
    issueData: { title: 'Wrong badge', body: 'Observed red' },
    env: { QA_GUARDIAN_SYBERMEM_CLI: 'sybermem' },
    spawn: () => ({ status: 1, stdout: '', stderr: 'missing cli' }),
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.items.length, 0);
});

test('recallEngineeringMemory returns bounded normalized memory hints', () => {
  const calls = [];
  const result = recallEngineeringMemory({
    config: { memory: { provider: 'sybermem', max_recall_items: 1 } },
    repoDir: 'D:/repo',
    issue: 42,
    issueData: { title: 'Wrong badge', body: 'Observed red' },
    env: { QA_GUARDIAN_SYBERMEM_CLI: 'sybermem' },
    spawn: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: JSON.stringify({ items: [{ id: 'REQ-1', title: 'Badge rule', summary: 'Use pink for debt.' }, { id: 'REQ-2', title: 'Other', summary: 'Other.' }] }), stderr: '' };
    },
  });
  assert.equal(calls[0].cmd, 'sybermem');
  assert.equal(calls[0].args[0], 'search');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items, [{ id: 'REQ-1', title: 'Badge rule', summary: 'Use pink for debt.' }]);
});

test('recordEngineeringMemory is opt-in and non-blocking', () => {
  assert.equal(recordEngineeringMemory({ config: {}, repoDir: 'D:/repo', issue: 1, summary: 'x' }).status, 'disabled');
  const result = recordEngineeringMemory({
    config: { memory: { provider: 'sybermem', record_after_gate2: true } },
    repoDir: 'D:/repo',
    issue: 1,
    summary: '中文记录',
    env: { QA_GUARDIAN_SYBERMEM_CLI: 'sybermem' },
    spawn: () => ({ status: 0, stdout: '', stderr: '' }),
  });
  assert.equal(result.status, 'ok');
});
