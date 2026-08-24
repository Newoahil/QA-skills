// QA Guardian — HTTP/API dispatch TaskSource adapter.

import { CONTROL_EVENT_KINDS, createTaskObservation } from './task-source.mjs';
import { makeTaskRef } from './task-ref.mjs';
import { COMMANDS } from './commands.mjs';

export function httpDispatchToTaskRef(dispatch) {
  const taskId = String(dispatch?.id ?? '').trim();
  return makeTaskRef({
    source: 'http',
    taskId,
    displayId: String(dispatch?.displayId ?? dispatch?.display_id ?? taskId).trim(),
  });
}

export function buildHttpTaskObservation({ dispatch, trustedAuthors = [], authenticateEvent = () => null }) {
  const status = String(dispatch?.status ?? '').trim().toLowerCase();
  const terminal = status === 'completed'
    ? Object.freeze({ status: 'completed', reason: 'http-status-completed', sourceEvidence: Object.freeze({ status }) })
    : null;
  return createTaskObservation({
    identity: httpDispatchToTaskRef(dispatch),
    terminal,
    controlEvents: normalizeEvents(dispatch?.events ?? [], trustedAuthors, authenticateEvent),
    facts: { title: dispatch?.title ?? '', body: dispatch?.body ?? '' },
    cursor: { lastConsumedId: dispatch?.cursor == null ? null : String(dispatch.cursor), lastConsumedSequence: null },
  });
}

export function createHttpTaskSource({ listDispatches, readDispatch, trustedAuthors = [], authenticateEvent = () => null }) {
  return Object.freeze({
    async listTasks() {
      const dispatches = await listDispatches();
      return Object.freeze(dispatches.map((dispatch) => httpDispatchToTaskRef(dispatch)));
    },
    async readTask(ref) {
      if (ref?.source !== 'http') throw new Error(`HTTP TaskSource cannot read source ${String(ref?.source)}`);
      return buildHttpTaskObservation({ dispatch: await readDispatch(ref.taskId), trustedAuthors, authenticateEvent });
    },
    getId(rawTask) {
      return httpDispatchToTaskRef(rawTask);
    },
  });
}

function normalizeEvents(events, trustedAuthors, authenticateEvent) {
  const trusted = new Set(Array.isArray(trustedAuthors) ? trustedAuthors.map((author) => String(author)) : []);
  return Object.freeze(events.flatMap((event, index) => {
    if (event?.kind !== CONTROL_EVENT_KINDS.COMMAND) return [];
    const author = verifiedAuthor(event, authenticateEvent);
    if (!author || !trusted.has(author)) return [];
    const verb = String(event.verb ?? '').trim().toLowerCase();
    if (!COMMANDS[verb]) return [];
    return [Object.freeze({
      id: String(event.id ?? index),
      kind: CONTROL_EVENT_KINDS.COMMAND,
      verb,
      data: event.data ?? '',
      author,
      occurredAt: event.occurredAt ?? event.occurred_at ?? null,
      sequence: Number.isInteger(event.sequence) ? event.sequence : index,
    })];
  }));
}

function verifiedAuthor(event, authenticateEvent) {
  try {
    const value = authenticateEvent(event);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}
