// QA Guardian — pluggable task-source contract helpers.

export const CONTROL_EVENT_KINDS = Object.freeze({ COMMAND: 'command' });

export function createTaskObservation({ identity, terminal = null, controlEvents = [], facts, cursor }) {
  return Object.freeze({
    identity,
    terminal,
    controlEvents: Object.freeze(controlEvents.map((event) => Object.freeze({ ...event }))),
    facts: Object.freeze({ title: facts?.title ?? '', body: facts?.body ?? '' }),
    cursor: Object.freeze({
      lastConsumedId: cursor?.lastConsumedId ?? null,
      lastConsumedSequence: cursor?.lastConsumedSequence ?? null,
    }),
  });
}
