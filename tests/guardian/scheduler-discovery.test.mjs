import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSchedulerRuntime, createSchedulerTaskSource, listCandidates, listCandidatesFromTaskSource, pollTaskObservation } from '../../tools/guardian/scheduler.mjs';
import { newState, readState, STATES, writeState } from '../../tools/guardian/state.mjs';
import { pollIssue } from '../../tools/guardian/poll.mjs';

function repoWithGuardian() {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'guardian-discovery-'));
  mkdirSync(path.join(repoDir, '.qa', 'guardian'), { recursive: true });
  return repoDir;
}

test('all-open discovery includes historical unlabeled issues and orders deterministically', () => {
  const repoDir = repoWithGuardian();
  const calls = [];
  try {
    const candidates = listCandidates(repoDir, { watch_mode: 'new-open' }, new Date('2026-08-20T12:00:00Z'), {
      ghIssueList: (_repo, args) => {
        calls.push(args);
        return [
          { issue: 206, updatedAt: '2026-08-20T10:00:00Z', labels: [] },
          { issue: 205, updatedAt: '2026-08-20T10:00:00Z', labels: [] },
          { issue: 207, updatedAt: '2026-08-20T11:00:00Z', labels: [{ name: 'qa-guardian' }] },
        ];
      },
    });

    assert.deepEqual(candidates.map(({ issue }) => issue), [205, 206, 207]);
    assert.equal(candidates.find(({ issue }) => issue === 205).claim_source, 'discovered');
    assert.deepEqual(calls, [['--state', 'open', '--limit', '1000', '--json', 'number,createdAt,updatedAt,labels']]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('listCandidates logs the discovery result via injected logger', () => {
  const repoDir = repoWithGuardian();
  const events = [];
  const logger = { info: (event, fields) => events.push({ event, fields }), warn: () => {}, error: () => {} };
  try {
    listCandidates(repoDir, {}, new Date('2026-08-20T12:00:00Z'), {
      ghIssueList: () => [
        { issue: 205, updatedAt: '2026-08-20T10:00:00Z', labels: [] },
        { issue: 206, updatedAt: '2026-08-20T11:00:00Z', labels: [] },
      ],
      logger,
    });
    const discovery = events.find((e) => e.event === 'discovery.candidates');
    assert.ok(discovery, 'discovery.candidates event should be emitted');
    assert.equal(discovery.fields.count, 2);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('DONE and GATE_2_WAIT records remain followup candidates', () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(301), state: STATES.DONE }, { touch: false });
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(302), state: STATES.GATE_2_WAIT }, { touch: false });
    const candidates = listCandidates(repoDir, {}, undefined, {
      ghIssueList: () => [],
    });

    assert.deepEqual(candidates.map(({ issue, claim_source }) => ({ issue, claim_source })), [
      { issue: 301, claim_source: 'followup' },
      { issue: 302, claim_source: 'followup' },
    ]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('open issue #205 without state is a START candidate', () => {
  const repoDir = repoWithGuardian();
  try {
    const decision = pollIssue(
      path.join(repoDir, '.qa', 'guardian'),
      205,
      () => ({ state: 'OPEN', title: 'Historical issue', body: '', comments: [] }),
      { repoDir, now: Date.parse('2026-08-20T12:00:00Z') },
    );
    assert.equal(decision.issue, 205);
    assert.equal(decision.action, 'START');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('terminal HANDED_BACK state is skipped rather than claimed again', () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(400), state: STATES.HANDED_BACK }, { touch: false });
    const decision = pollIssue(
      path.join(repoDir, '.qa', 'guardian'),
      400,
      () => ({ state: 'OPEN', title: 'Handed back', body: '', comments: [] }),
      { repoDir, now: Date.parse('2026-08-20T12:00:00Z') },
    );
    assert.equal(decision.action, 'SKIP');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('initial discovery claim persists the discovered claim source', () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), {
      ...newState(205),
      claim_id: 'claim-205',
      claimed_at: '2026-08-20T12:00:00.000Z',
      claim_source: 'discovered',
    }, { touch: false });
    const claimed = readState(path.join(repoDir, '.qa', 'guardian'), 205);
    assert.equal(claimed.state, STATES.DISCOVERED);
    assert.equal(claimed.claim_source, 'discovered');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runtime discovery can list candidates through the TaskSource seam', async () => {
  const repoDir = repoWithGuardian();
  try {
    const candidates = await listCandidatesFromTaskSource(repoDir, {
      listTasks: async () => [
        { source: 'github', taskId: '205', displayId: '#205' },
        { source: 'github', taskId: '206', displayId: '#206' },
      ],
    });

    assert.deepEqual(candidates.map(({ issue, claim_source }) => ({ issue, claim_source })), [
      { issue: 205, claim_source: 'discovered' },
      { issue: 206, claim_source: 'discovered' },
    ]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runtime GitHub TaskSource discovery preserves updatedAt ordering metadata', async () => {
  const repoDir = repoWithGuardian();
  try {
    const source = createSchedulerTaskSource({
      repoDir,
      config: { task_source: 'github' },
      deps: {
        listIssues: async () => [
          { issue: 205, updatedAt: '2026-08-20T11:00:00Z' },
          { issue: 206, updatedAt: '2026-08-20T10:00:00Z' },
        ],
        readIssue: async () => ({ state: 'OPEN', title: '', body: '', comments: [] }),
      },
    });
    const candidates = await listCandidatesFromTaskSource(repoDir, source, { source: 'github' });

    assert.deepEqual(candidates.map(({ issue }) => issue), [206, 205]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runtime discovery keeps source identity separate and rejects nonnumeric IDs before NaN state', async () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(205), state: STATES.DONE }, { touch: false });
    const candidates = await listCandidatesFromTaskSource(repoDir, {
      listTasks: async () => [{ source: 'github', taskId: '205', displayId: '#205' }],
    });
    assert.deepEqual(candidates.map(({ taskRef, claim_source }) => ({ key: `${taskRef.source}:${taskRef.taskId}`, claim_source })).sort((a, b) => a.key.localeCompare(b.key)), [
      { key: 'github:205', claim_source: 'followup' },
    ]);

    await assert.rejects(() => listCandidatesFromTaskSource(repoDir, {
      listTasks: async () => [{ source: 'http', taskId: 'job-42', displayId: 'job-42' }],
    }), /positive numeric taskId until P8/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('scheduler TaskSource registry selects HTTP source through runtime config and bindings', async () => {
  const source = createSchedulerTaskSource({
    repoDir: 'D:/repo',
    config: { task_source: 'http', command_authors: ['ops'] },
    deps: {
      listDispatches: async () => [{ id: '42', displayId: 'HTTP-42' }],
      readDispatch: async (id) => ({ id, events: [{ kind: 'command', verb: 'retry', authenticatedAuthor: 'ops' }] }),
      authenticateEvent: (event) => event.authenticatedAuthor,
    },
  });

  const refs = await source.listTasks();
  assert.deepEqual(refs, [{ source: 'http', taskId: '42', displayId: 'HTTP-42' }]);
  assert.equal((await source.readTask(refs[0])).controlEvents[0].author, 'ops');
});

test('scheduler TaskSource registry selects HTTP source from production dispatch file config', async () => {
  const repoDir = repoWithGuardian();
  const dispatchFile = path.join(repoDir, 'dispatches.json');
  try {
    writeFileSync(dispatchFile, JSON.stringify({ dispatches: [{ id: '42', displayId: 'HTTP-42', events: [{ kind: 'command', verb: 'retry', authenticatedAuthor: 'ops' }] }] }), 'utf8');
    const source = createSchedulerTaskSource({
      repoDir,
      config: { task_source: { type: 'http', dispatch_file: dispatchFile }, command_authors: ['ops'] },
      deps: { authenticateEvent: (event) => event.authenticatedAuthor },
    });

    const refs = await source.listTasks();
    assert.deepEqual(refs, [{ source: 'http', taskId: '42', displayId: 'HTTP-42' }]);
    assert.equal((await source.readTask(refs[0])).controlEvents[0].author, 'ops');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('scheduler TaskSource registry selects HTTP source from production URL config', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/dispatches')) return { ok: true, json: async () => ({ dispatches: [{ id: '42', displayId: 'HTTP-42' }] }) };
      if (String(url).endsWith('/dispatches/42')) return { ok: true, json: async () => ({ id: '42', displayId: 'HTTP-42', events: [{ kind: 'command', verb: 'retry', authenticatedAuthor: 'ops' }] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const source = createSchedulerTaskSource({
      repoDir: 'D:/repo',
      config: { task_source: { type: 'http', base_url: 'https://dispatch.test' }, command_authors: ['ops'] },
      deps: { authenticateEvent: (event) => event.authenticatedAuthor },
    });

    const refs = await source.listTasks();
    assert.deepEqual(refs, [{ source: 'http', taskId: '42', displayId: 'HTTP-42' }]);
    assert.equal((await source.readTask(refs[0])).controlEvents[0].author, 'ops');
    assert.deepEqual(calls, ['https://dispatch.test/dispatches', 'https://dispatch.test/dispatches/42']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP runtime discovery preserves source for durable followup records', async () => {
  const repoDir = repoWithGuardian();
  try {
    writeState(path.join(repoDir, '.qa', 'guardian'), { ...newState(42), state: STATES.DONE }, { touch: false });
    const candidates = await listCandidatesFromTaskSource(repoDir, {
      listTasks: async () => [{ source: 'http', taskId: '42', displayId: 'HTTP-42' }],
    }, { source: 'http' });

    assert.deepEqual(candidates.map(({ taskRef, claim_source }) => ({ source: taskRef.source, taskId: taskRef.taskId, claim_source })), [
      { source: 'http', taskId: '42', claim_source: 'followup' },
    ]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('createSchedulerRuntime loads registries once for restart-level semantics', () => {
  const repoDir = repoWithGuardian();
  const dispatchFile = path.join(repoDir, 'dispatches.json');
  try {
    writeFileSync(dispatchFile, JSON.stringify([{ id: '42' }]), 'utf8');
    const runtime = createSchedulerRuntime({ repoDir, config: { task_source: { type: 'http', dispatch_file: dispatchFile } } });
    assert.equal(typeof runtime.taskSource.listTasks, 'function');
    assert.equal(Object.isFrozen(runtime.pipelineStages), true);
    assert.equal(Object.isFrozen(runtime.agentRegistry), true);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runtime polling routes TaskSource observations without legacy gh reader', async () => {
  const repoDir = repoWithGuardian();
  try {
    const decision = await pollTaskObservation({
      repoDir,
      guardianDir: path.join(repoDir, '.qa', 'guardian'),
      taskSource: {
        readTask: async () => ({
          identity: { source: 'github', taskId: '205', displayId: '#205' },
          terminal: null,
          controlEvents: [],
          facts: { title: 'TaskSource issue', body: 'body' },
          cursor: { lastConsumedId: null, lastConsumedSequence: null },
        }),
      },
      taskRef: { source: 'github', taskId: '205', displayId: '#205' },
      leaseMs: 1800000,
      now: Date.parse('2026-08-20T12:00:00Z'),
      trustedAuthors: [],
    });

    assert.equal(decision.action, 'START');
    assert.equal(decision.issueTitle, 'TaskSource issue');
    assert.equal(decision.invokeArgv.cmd, 'opencode');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('discovered claim projects doing before the agent run', () => {
  const source = readFileSync(new URL('../../tools/guardian/scheduler.mjs', import.meta.url), 'utf8');
  assert.match(source, /claimProjection = projectLabels\(repoDir, issue/);
  assert.match(source, /state: 'INVESTIGATING'/);
});
