import test from 'node:test';
import assert from 'node:assert/strict';

import { createHttpTaskSource, buildHttpTaskObservation } from '../../tools/guardian/http-task-source.mjs';

test('buildHttpTaskObservation maps HTTP dispatch data to TaskObservation', () => {
  const observation = buildHttpTaskObservation({
    dispatch: {
      id: 'job-42',
      displayId: 'HTTP-42',
      title: 'Fix billing sync',
      body: 'Acceptance data',
      status: 'completed',
      cursor: 'evt-9',
      events: [{ id: 'evt-9', kind: 'command', verb: 'retry', data: 'again', author: 'ops', occurredAt: '2026-08-24T00:00:00.000Z' }],
    },
  });

  assert.deepEqual(observation.identity, { source: 'http', taskId: 'job-42', displayId: 'HTTP-42' });
  assert.deepEqual(observation.terminal, { status: 'completed', reason: 'http-status-completed', sourceEvidence: { status: 'completed' } });
  assert.deepEqual(observation.facts, { title: 'Fix billing sync', body: 'Acceptance data' });
  assert.deepEqual(observation.cursor, { lastConsumedId: 'evt-9', lastConsumedSequence: null });
  assert.deepEqual(observation.controlEvents, [{ id: 'evt-9', kind: 'command', verb: 'retry', data: 'again', author: 'ops', occurredAt: '2026-08-24T00:00:00.000Z', sequence: 0 }]);
});

test('createHttpTaskSource lists and reads injected API dispatches', async () => {
  const source = createHttpTaskSource({
    listDispatches: async () => [{ id: 'job-1', title: 'One' }, { id: 'job-2', title: 'Two' }],
    readDispatch: async (id) => ({ id, title: `Task ${id}`, body: 'body' }),
  });

  const refs = await source.listTasks();
  assert.deepEqual(refs.map((ref) => ref.taskId), ['job-1', 'job-2']);
  assert.deepEqual(await source.readTask(refs[0]), buildHttpTaskObservation({ dispatch: { id: 'job-1', title: 'Task job-1', body: 'body' } }));
  await assert.rejects(() => source.readTask({ source: 'github', taskId: '1', displayId: '#1' }), /cannot read source/);
});
