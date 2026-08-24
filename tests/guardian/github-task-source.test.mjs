import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitHubTaskObservation,
  createGitHubTaskSource,
  defaultGhReader,
} from '../../tools/guardian/github-task-source.mjs';
import { STATES } from '../../tools/guardian/state.mjs';

test('buildGitHubTaskObservation maps closed GitHub issue to terminal fact', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_2_WAIT, last_consumed_comment_id: null },
    githubIssue: { title: 'Done', body: 'Merged by human.', closed: true, comments: [] },
  });

  assert.deepEqual(observation.identity, { source: 'github', taskId: '42', displayId: '#42' });
  assert.deepEqual(observation.terminal, {
    status: 'completed',
    reason: 'merged-closed',
    sourceEvidence: { closed: true },
  });
  assert.deepEqual(observation.facts, { title: 'Done', body: 'Merged by human.' });
});

test('buildGitHubTaskObservation exposes the trusted command as a control event', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_1_WAIT, last_consumed_comment_id: 100 },
    trustedAuthors: ['alice'],
    githubIssue: {
      title: 'Gate',
      body: 'Need approval.',
      closed: false,
      comments: [
        { id: 100, body: '/guardian reject', createdAt: '2026-08-24T01:00:00Z', author: 'alice' },
        { id: 101, body: '/guardian approve ship it', createdAt: '2026-08-24T02:00:00Z', author: 'alice' },
      ],
    },
  });

  assert.deepEqual(observation.controlEvents, [{
    id: '101',
    kind: 'command',
    verb: 'approve',
    data: 'ship it',
    author: 'alice',
    occurredAt: '2026-08-24T02:00:00Z',
    sequence: 1,
  }]);
  assert.deepEqual(observation.cursor, { lastConsumedId: '100', lastConsumedSequence: 0 });
});

test('createGitHubTaskSource lists refs and reads observations through injected IO', async () => {
  const source = createGitHubTaskSource({
    repoDir: 'D:/repo',
    listIssues: () => [{ issue: 42 }, { number: 43 }],
    readIssue: (issue) => ({ title: `Issue ${issue}`, body: '', closed: false, comments: [] }),
  });

  assert.deepEqual(await source.listTasks(), [
    { source: 'github', taskId: '42', displayId: '#42' },
    { source: 'github', taskId: '43', displayId: '#43' },
  ]);
  assert.equal((await source.readTask({ source: 'github', taskId: '43', displayId: '#43' })).facts.title, 'Issue 43');
});

test('defaultGhReader maps gh issue JSON to the legacy GitHub fact shape', () => {
  const reader = defaultGhReader('D:/repo', {
    spawnSync: (_cmd, args, opts) => {
      assert.deepEqual(args, ['issue', 'view', '42', '--json', 'state,comments,title,body,labels']);
      assert.equal(opts.cwd, 'D:/repo');
      return {
        status: 0,
        stdout: JSON.stringify({
          title: 'Closed issue',
          body: null,
          state: 'CLOSED',
          comments: [{ id: 7, body: '/guardian retry', createdAt: '2026-08-24T03:00:00Z', author: { login: 'alice' } }],
        }),
      };
    },
  });

  assert.deepEqual(reader(42), {
    title: 'Closed issue',
    body: '',
    closed: true,
    comments: [{ id: 7, body: '/guardian retry', createdAt: '2026-08-24T03:00:00Z', author: 'alice' }],
  });
});
