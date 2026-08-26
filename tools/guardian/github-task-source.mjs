// QA Guardian — GitHub TaskSource adapter.

import { spawnSync as nodeSpawnSync } from 'node:child_process';

import { selectCommand } from './commands.mjs';
import { STATES } from './state.mjs';
import { CONTROL_EVENT_KINDS, createTaskObservation } from './task-source.mjs';
import { githubIssueToTaskRef } from './task-ref.mjs';

export function defaultGhReader(repoDir, deps = {}) {
  const spawnSync = deps.spawnSync ?? nodeSpawnSync;
  return function readGithubIssue(issueNumber) {
    const args = [
      'issue', 'view', String(issueNumber),
      '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences',
    ];
    const res = spawnSync('gh', args, {
      cwd: repoDir,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (res.status !== 0) {
      throw new Error(`gh issue view #${issueNumber} failed: ${res.stderr || res.stdout || 'unknown'}`);
    }
    const data = JSON.parse(res.stdout);
    return legacyGithubFacts(data);
  };
}

export function legacyGithubFacts(data) {
  return {
    title: data.title ?? null,
    body: data.body ?? '',
    closed: String(data.state).toUpperCase() === 'CLOSED',
    pullRequests: pullRequestFactsFromIssue(data).map(normalizePullRequestFact),
    comments: (data.comments ?? []).map((c) => ({
      id: c.id ?? c.url ?? c.createdAt,
      body: c.body ?? '',
      createdAt: c.createdAt ?? null,
      author: c.author?.login ?? c.author ?? null,
    })),
  };
}

export function buildGitHubTaskObservation({ issueNumber, record = null, githubIssue, trustedAuthors = [] }) {
  const identity = githubIssueToTaskRef(issueNumber);
  const currentState = record?.state ?? STATES.DISCOVERED;
  const lastConsumedId = record?.last_consumed_comment_id ?? null;
  const comments = githubIssue?.comments ?? [];
  const selected = selectCommand(comments, currentState, lastConsumedId, trustedAuthors);
  const controlEvents = selected ? [commandEventFromSelection(selected, comments)] : [];
  const terminal = githubIssue?.closed ? terminalFactForClosedIssue({ issueNumber, record, pullRequests: githubIssue.pullRequests }) : null;
  return createTaskObservation({
    identity,
    terminal,
    controlEvents,
    facts: { title: githubIssue?.title ?? '', body: githubIssue?.body ?? '' },
    cursor: {
      lastConsumedId: lastConsumedId == null ? null : String(lastConsumedId),
      lastConsumedSequence: sequenceForCommentId(comments, lastConsumedId),
    },
  });
}

function pullRequestFactsFromIssue(data) {
  if (Array.isArray(data.pullRequests)) return data.pullRequests;
  if (Array.isArray(data.closedByPullRequestsReferences)) return data.closedByPullRequestsReferences;
  return [];
}

function normalizePullRequestFact(pr) {
  return {
    number: pr.number ?? null,
    url: pr.url ?? null,
    headRefName: pr.headRefName ?? pr.head ?? null,
    baseRefName: pr.baseRefName ?? pr.base ?? null,
    merged: pr.merged === true || Boolean(pr.mergedAt),
  };
}

function terminalFactForClosedIssue({ issueNumber, record, pullRequests }) {
  const match = matchingMergedPullRequest({ issueNumber, record, pullRequests });
  if (!match) return null;
  return Object.freeze({
    status: 'completed',
    reason: 'merged-closed',
    sourceEvidence: Object.freeze({
      issue_closed: true,
      matching_pr_merged: true,
      pr_number: match.number ?? null,
      pr_url: match.url ?? null,
      head: match.headRefName ?? null,
      base: match.baseRefName ?? null,
    }),
  });
}

function matchingMergedPullRequest({ issueNumber, record, pullRequests }) {
  if (!Array.isArray(pullRequests)) return null;
  const expectedUrl = typeof record?.pr_url === 'string' && record.pr_url.length > 0 ? record.pr_url : null;
  const expectedHead = `fix/issue-${Number(issueNumber)}`;
  return pullRequests
    .map(normalizePullRequestFact)
    .find((pr) => pr.merged && ((expectedUrl && pr.url === expectedUrl) || pr.headRefName === expectedHead)) ?? null;
}

function commandEventFromSelection(command, comments) {
  const index = comments.findIndex((comment) => String(comment.id) === String(command.commentId));
  const comment = index >= 0 ? comments[index] : null;
  return Object.freeze({
    id: String(command.commentId),
    kind: CONTROL_EVENT_KINDS.COMMAND,
    verb: command.verb,
    data: command.data,
    author: comment?.author ?? null,
    occurredAt: comment?.createdAt ?? null,
    sequence: index,
  });
}

function sequenceForCommentId(comments, commentId) {
  if (commentId == null) return null;
  const index = comments.findIndex((comment) => String(comment.id) === String(commentId));
  return index >= 0 ? index : null;
}

export function createGitHubTaskSource({ repoDir, listIssues, readIssue = defaultGhReader(repoDir), readState = () => null, trustedAuthors = [] }) {
  return Object.freeze({
    async listTasks() {
      const issues = await listIssues(repoDir);
      return Object.freeze(issues.map((issue) => githubIssueToTaskRefWithMetadata(issue)));
    },
    async readTask(ref) {
      if (ref?.source !== 'github') throw new Error(`GitHub TaskSource cannot read source ${String(ref?.source)}`);
      const issueNumber = Number(ref.taskId);
      const record = readState(issueNumber);
      const githubIssue = await readIssue(issueNumber);
      return buildGitHubTaskObservation({ issueNumber, record, githubIssue, trustedAuthors });
    },
    getId(rawTask) {
      return githubIssueToTaskRef(rawTask.issue ?? rawTask.number);
    },
  });
}

function githubIssueToTaskRefWithMetadata(issue) {
  const ref = githubIssueToTaskRef(issue.issue ?? issue.number);
  const updatedAt = issue.updatedAt ?? issue.updated_at ?? null;
  return updatedAt == null ? ref : Object.freeze({ ...ref, updatedAt });
}
