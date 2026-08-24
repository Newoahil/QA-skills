// QA Guardian — pluggable task-source contract helpers.

export const CONTROL_EVENT_KINDS = Object.freeze({ COMMAND: 'command' });

// A2 (PM-adapter prep, decision-e8c0d364): a source-neutral execution specification a task source
// MAY attach to an observation. GitHub does not populate it (spec stays null), so existing
// observations are unchanged; a future PM source fills it from pm_get_work(resultId). Kept as a
// SEPARATE top-level field (not merged into `facts`) so `facts` remains exactly {title, body}.
export function normalizeExecutionSpec(spec) {
  if (!spec || typeof spec !== 'object') return null;
  return Object.freeze({
    executionType: spec.executionType ?? null,          // coding | research | design | ops | ...
    acceptanceCriteria: Object.freeze(Array.isArray(spec.acceptanceCriteria)
      ? spec.acceptanceCriteria.map((c) => Object.freeze({ ...c }))
      : []),
    expectedEvidence: spec.expectedEvidence ?? null,     // free-form hint of what evidence is wanted
    owner: spec.owner ?? null,
    ownerType: spec.ownerType ?? null,                   // human | agent
    suggestedRole: spec.suggestedRole ?? null,
    repoContext: spec.repoContext ? Object.freeze({ ...spec.repoContext }) : null, // {url, branch, credentialRef}
    sourceMeta: spec.sourceMeta ? Object.freeze({ ...spec.sourceMeta }) : null,    // opaque per-source extras
  });
}

export function createTaskObservation({ identity, terminal = null, controlEvents = [], facts, cursor, spec = null }) {
  return Object.freeze({
    identity,
    terminal,
    controlEvents: Object.freeze(controlEvents.map((event) => Object.freeze({ ...event }))),
    facts: Object.freeze({ title: facts?.title ?? '', body: facts?.body ?? '' }),
    cursor: Object.freeze({
      lastConsumedId: cursor?.lastConsumedId ?? null,
      lastConsumedSequence: cursor?.lastConsumedSequence ?? null,
    }),
    // Null for github/http today; a PM source attaches the execution spec here.
    spec: normalizeExecutionSpec(spec),
  });
}
