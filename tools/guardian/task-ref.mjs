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

export function githubIssueToTaskRef(issueNumber) {
  const issue = Number(issueNumber);
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new Error(`GitHub issue number must be a positive integer: ${String(issueNumber)}`);
  }
  return makeTaskRef({ source: 'github', taskId: String(issue), displayId: `#${issue}` });
}
