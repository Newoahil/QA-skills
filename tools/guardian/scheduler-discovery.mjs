// QA Guardian — task discovery and per-task identity resolution.
//
// Extracted from scheduler.mjs (P0 refactor, batch 2). Owns candidate discovery (GitHub + HTTP
// task sources + followup rescan), the source-neutral scheduler state key, and the TaskSource
// factory. No lock, no gate, no runtime-loop coupling — it reads task sources and state only.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readJsonFile } from './runtime-io.mjs';
import { defaultGhReader, invocationArgvFor } from './poll.mjs';
import { readState } from './state.mjs';
import { storageKey as taskRefStorageKey, isNumericStorageKey, makeTaskRef } from './task-ref.mjs';
import { routeIssue } from './state-router.mjs';
import { createGitHubTaskSource } from './github-task-source.mjs';
import { createHttpTaskSource } from './http-task-source.mjs';
import { guardianDirOf } from './guardian-paths.mjs';

export function ghIssueList(repoDir, args) {
  const res = spawnSync('gh', ['issue', 'list', ...args], {
    cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (res.status !== 0) throw new Error(`gh issue list failed: ${res.stderr || 'unknown'}`);
  const arr = JSON.parse(res.stdout || '[]');
  // Deterministic order: oldest updatedAt first (fairest single pick under N=1).
  return arr
    .map((x) => ({ issue: Number(x.number), createdAt: x.createdAt, updatedAt: x.updatedAt, labels: x.labels ?? [] }))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

export function listCandidates(repoDir, _config = {}, _now = new Date(), deps = {}) {
  const fields = ['number,createdAt,updatedAt,labels'];
  const issueList = deps.ghIssueList ?? ghIssueList;
  const stateReader = deps.readState ?? readState;
  const openIssues = issueList(repoDir, ['--state', 'open', '--limit', '1000', '--json', fields[0]]);
  const followups = readdirSync(path.join(repoDir, '.qa', 'guardian'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
    .map((entry) => readJsonFile(path.join(repoDir, '.qa', 'guardian', entry.name)))
    .filter((record) => record.state === 'DONE' || record.state === 'GATE_2_WAIT')
    .map((record) => ({ issue: Number(record.issue), updatedAt: record.updated_at, claim_source: 'followup' }));
  const candidates = openIssues.map((issue) => {
    const record = stateReader(path.join(repoDir, '.qa', 'guardian'), issue.issue);
    return { ...issue, claim_source: record ? 'existing' : 'discovered' };
  });
  const merged = new Map(candidates.concat(followups).map((x) => [x.issue, x]));
  const ordered = [...merged.values()].sort((a, b) => {
    const updated = String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''));
    return updated || Number(a.issue) - Number(b.issue);
  });
  if (deps.logger) {
    deps.logger.info('discovery.candidates', {
      count: ordered.length,
      open: openIssues.length,
      followups: followups.length,
      issues: ordered.map((x) => x.issue).join(','),
    });
  }
  return ordered;
}

export async function listCandidatesFromTaskSource(repoDir, taskSource, deps = {}) {
  const refs = await taskSource.listTasks();
  const stateReader = deps.readState ?? readState;
  const guardianDir = guardianDirOf(repoDir);
  const source = deps.source ?? refs[0]?.source ?? 'github';
  const candidates = refs.map((ref) => {
    const issue = schedulerStateKey(ref);
    const record = stateReader(guardianDir, issue);
    return { issue, taskRef: ref, updatedAt: ref.updatedAt ?? ref.updated_at, claim_source: record ? 'existing' : 'discovered' };
  });
  // A1 (decision-e8c0d364): the followup scan accepts BOTH legacy numeric `<n>.json` (github) and
  // source-qualified `<source>__<taskId>.json` files, rebuilding a faithful TaskRef from either.
  const followups = readdirSync(guardianDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.json$/.test(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, record: safeReadRecord(path.join(guardianDir, entry.name)) }))
    .filter(({ record }) => record && (record.state === 'DONE' || record.state === 'GATE_2_WAIT'))
    .map(({ name, record }) => {
      const taskRef = followupTaskRef(record, name, source);
      // The state key is the record's ACTUAL on-disk key (the filename stem), so a legacy
      // `<n>.json` keeps its numeric key even when rediscovered under a non-github source; a
      // durable source-qualified record keeps its `<source>__<taskId>` key.
      const stateKey = String(name).replace(/\.json$/, '');
      const issue = isNumericStorageKey(stateKey) ? Number(stateKey) : stateKey;
      return { issue, taskRef, updatedAt: record.updated_at, claim_source: 'followup' };
    });
  const merged = new Map(candidates.concat(followups).map((x) => [candidateKey(x), x]));
  return [...merged.values()].sort((a, b) => {
    const updated = String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''));
    return updated || String(a.issue).localeCompare(String(b.issue), undefined, { numeric: true });
  });
}

export async function pollTaskObservation({ repoDir, guardianDir, taskSource, taskRef, leaseMs, now, trustedAuthors }) {
  const issue = schedulerStateKey(taskRef);
  const record = readState(guardianDir, issue);
  const observation = await taskSource.readTask(taskRef);
  const decision = routeIssue(record, observation, { leaseMs, now, trustedAuthors });
  return {
    issue,
    issueTitle: observation.facts?.title ?? null,
    issueBody: observation.facts?.body ?? '',
    taskRef,
    executionSpec: observation.spec,
    ...decision,
    invoke: null,
    invokeArgv: invocationArgvFor(repoDir, issue, decision),
  };
}

// A1 (decision-e8c0d364): the scheduler's per-task key used for state read/write, artifact paths,
// and lock/candidate identity. For a github ref this is the positive integer issue id (so all
// existing `<n>.json` / branch / artifact paths stay byte-identical); for any other source it is
// the source-qualified storageKey string (e.g. "pm__<uuid>"). Replaces the old
// numericSchedulerIssue(), which hard-rejected non-numeric ids.
export function schedulerStateKey(ref) {
  if (ref?.source === 'github') {
    const issue = Number(ref?.taskId);
    if (!Number.isInteger(issue) || issue <= 0) {
      throw new Error(`github taskRef requires a positive numeric taskId: ${String(ref?.taskId)}`);
    }
    return issue;
  }
  return taskRefStorageKey(ref);
}

function safeReadRecord(file) {
  try {
    return readJsonFile(file);
  } catch {
    return null;
  }
}

// Rebuild the identity of a persisted followup record.
// Priority: (1) an explicit persisted task_ref (the durable, source-accurate identity for any
// non-github source); (2) otherwise reconstruct from the numeric issue under the CURRENT source
// context (`defaultSource`) — a legacy record stored as `<n>.json` carries no source of its own,
// so the discovering source is authoritative; (3) last resort, derive the taskId from the filename.
function followupTaskRef(record, fileName, defaultSource) {
  if (record.task_ref && typeof record.task_ref === 'object') {
    try {
      return makeTaskRef(record.task_ref);
    } catch {
      // fall through to reconstruction
    }
  }
  const numericIssue = Number(record.issue);
  if (Number.isInteger(numericIssue) && numericIssue > 0) {
    const taskId = String(numericIssue);
    const displayId = defaultSource === 'github' ? `#${taskId}` : taskId;
    return makeTaskRef({ source: defaultSource, taskId, displayId });
  }
  const base = String(fileName).replace(/\.json$/, '');
  return makeTaskRef({ source: defaultSource, taskId: base, displayId: base });
}

function candidateKey(candidate) {
  return `${candidate.taskRef?.source ?? 'github'}:${candidate.taskRef?.taskId ?? String(candidate.issue)}`;
}

export function createSchedulerTaskSource({ repoDir, config = {}, deps = {} }) {
  const source = typeof config.task_source === 'string' ? config.task_source : (config.task_source?.type ?? 'github');
  const trustedAuthors = config.command_authors ?? [];
  const guardianDir = guardianDirOf(repoDir);
  if (source === 'github') {
    return createGitHubTaskSource({
      repoDir,
      listIssues: deps.listIssues ?? ((targetRepoDir) => ghIssueList(targetRepoDir, ['--state', 'open', '--limit', '1000', '--json', 'number,createdAt,updatedAt,labels'])),
      readIssue: deps.readIssue ?? defaultGhReader(repoDir),
      readState: deps.readStateForSource ?? ((issue) => readState(guardianDir, issue)),
      trustedAuthors,
    });
  }
  if (source === 'http') {
    const listDispatches = deps.listDispatches ?? createConfiguredHttpListDispatches(config);
    const readDispatch = deps.readDispatch ?? createConfiguredHttpReadDispatch(config);
    if (typeof listDispatches !== 'function' || typeof readDispatch !== 'function') throw new Error('HTTP TaskSource requires listDispatches and readDispatch runtime bindings');
    return createHttpTaskSource({ listDispatches, readDispatch, trustedAuthors, authenticateEvent: deps.authenticateEvent });
  }
  throw new Error(`unknown task source: ${String(source)}`);
}

function createConfiguredHttpListDispatches(config) {
  const file = config.task_source?.dispatch_file ?? config.http_task_source?.dispatch_file;
  const baseUrl = httpTaskSourceBaseUrl(config);
  if (!file && !baseUrl) return undefined;
  if (baseUrl) return async () => fetchHttpDispatches(baseUrl, config.task_source?.list_path ?? config.http_task_source?.list_path ?? '/dispatches');
  return async () => {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed.dispatches ?? []);
  };
}

function createConfiguredHttpReadDispatch(config) {
  const file = config.task_source?.dispatch_file ?? config.http_task_source?.dispatch_file;
  const baseUrl = httpTaskSourceBaseUrl(config);
  if (!file && !baseUrl) return undefined;
  if (baseUrl) return async (id) => fetchHttpDispatch(baseUrl, config.task_source?.read_path ?? config.http_task_source?.read_path ?? '/dispatches/{id}', id);
  return async (id) => {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const dispatches = Array.isArray(parsed) ? parsed : (parsed.dispatches ?? []);
    const dispatch = dispatches.find((item) => String(item?.id) === String(id));
    if (!dispatch) throw new Error(`HTTP dispatch not found: ${String(id)}`);
    return dispatch;
  };
}

function httpTaskSourceBaseUrl(config) {
  const value = config.task_source?.base_url ?? config.task_source?.url ?? config.http_task_source?.base_url ?? config.http_task_source?.url;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim().replace(/\/$/, '');
}

async function fetchHttpDispatches(baseUrl, listPath) {
  const json = await fetchJson(`${baseUrl}${pathWithLeadingSlash(listPath)}`);
  return Array.isArray(json) ? json : (json.dispatches ?? []);
}

async function fetchHttpDispatch(baseUrl, readPath, id) {
  return fetchJson(`${baseUrl}${pathWithLeadingSlash(readPath).replace('{id}', encodeURIComponent(String(id)))}`);
}

function pathWithLeadingSlash(value) {
  const text = String(value ?? '').trim();
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP TaskSource request failed: ${response.status}`);
  return response.json();
}
