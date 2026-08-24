// QA Guardian — HTTP/API dispatch TaskSource adapter.

import { CONTROL_EVENT_KINDS, createTaskObservation } from './task-source.mjs';
import { makeTaskRef } from './task-ref.mjs';

export function httpDispatchToTaskRef(dispatch) {
  const taskId = String(dispatch?.id ?? '').trim();
  return makeTaskRef({
    source: 'http',
    taskId,
    displayId: String(dispatch?.displayId ?? dispatch?.display_id ?? taskId).trim(),
  });
}

export function buildHttpTaskObservation({ dispatch }) {
  const status = String(dispatch?.status ?? '').trim().toLowerCase();
  const terminal = status === 'completed'
    ? Object.freeze({ status: 'completed', reason: 'http-status-completed', sourceEvidence: Object.freeze({ status }) })
    : null;
  return createTaskObservation({
    identity: httpDispatchToTaskRef(dispatch),
    terminal,
    controlEvents: normalizeEvents(dispatch?.events ?? []),
    facts: { title: dispatch?.title ?? '', body: dispatch?.body ?? '' },
    cursor: { lastConsumedId: dispatch?.cursor == null ? null : String(dispatch.cursor), lastConsumedSequence: null },
  });
}

export function createHttpTaskSource({ listDispatches, readDispatch }) {
  return Object.freeze({
    async listTasks() {
      const dispatches = await listDispatches();
      return Object.freeze(dispatches.map((dispatch) => httpDispatchToTaskRef(dispatch)));
    },
    async readTask(ref) {
      if (ref?.source !== 'http') throw new Error(`HTTP TaskSource cannot read source ${String(ref?.source)}`);
      return buildHttpTaskObservation({ dispatch: await readDispatch(ref.taskId) });
    },
    getId(rawTask) {
      return httpDispatchToTaskRef(rawTask);
    },
  });
}

function normalizeEvents(events) {
  return Object.freeze(events.map((event, index) => Object.freeze({
    id: String(event.id ?? index),
    kind: event.kind ?? CONTROL_EVENT_KINDS.COMMAND,
    verb: event.verb ?? null,
    data: event.data ?? '',
    author: event.author ?? null,
    occurredAt: event.occurredAt ?? event.occurred_at ?? null,
    sequence: Number.isInteger(event.sequence) ? event.sequence : index,
  })));
}
