// QA Guardian — source-neutral in-memory task identity.

function cleanText(value, label) {
  const text = String(value ?? '').trim();
  if (text.length === 0) throw new Error(`TaskRef ${label} must be non-empty`);
  return text;
}

export function makeTaskRef({ source, taskId, displayId }) {
  return Object.freeze({
    source: cleanText(source, 'source'),
    taskId: cleanText(taskId, 'taskId'),
    displayId: cleanText(displayId, 'displayId'),
  });
}

export function taskRefKey(ref) {
  const normalized = makeTaskRef(ref);
  return `${normalized.source}:${normalized.taskId}`;
}

// A1 (PM-adapter prep, decision-e8c0d364): storage identity, separate from displayId.
// This is the filesystem-safe key used for on-disk state filenames, artifact/branch paths,
// ledger tokens and session bindings — it must be stable and collision-free across sources.
//
// COMPATIBILITY INVARIANT: a GitHub ref keeps its bare numeric storage key (e.g. "123"), so
// `${storageKey}.json` stays byte-identical to today's `${Number(issue)}.json`. Only
// non-github sources get a source-qualified key (e.g. "pm__<uuid>"), which cannot collide
// with a numeric GitHub key because it always contains the "<source>__" prefix.
const NUMERIC_TASK_ID = /^[1-9][0-9]*$/;
const STORAGE_KEY_UNSAFE = /[^A-Za-z0-9._-]/g;

export function storageKey(ref) {
  const normalized = makeTaskRef(ref);
  if (normalized.source === 'github') {
    // GitHub taskId is always a positive integer string; keep the bare-numeric filename.
    if (!NUMERIC_TASK_ID.test(normalized.taskId)) {
      throw new Error(`github TaskRef requires a positive numeric taskId: ${normalized.taskId}`);
    }
    return normalized.taskId;
  }
  const safeSource = normalized.source.replace(STORAGE_KEY_UNSAFE, '-');
  const safeTaskId = normalized.taskId.replace(STORAGE_KEY_UNSAFE, '-');
  return `${safeSource}__${safeTaskId}`;
}

// True for a storage key that is a bare positive integer (i.e. a GitHub key). Non-github keys
// always contain "__" and never match, so callers can cheaply tell the two apart.
export function isNumericStorageKey(key) {
  return NUMERIC_TASK_ID.test(String(key));
}

export function githubIssueToTaskRef(issueNumber) {
  const issue = Number(issueNumber);
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new Error(`GitHub issue number must be a positive integer: ${String(issueNumber)}`);
  }
  return makeTaskRef({ source: 'github', taskId: String(issue), displayId: `#${issue}` });
}
