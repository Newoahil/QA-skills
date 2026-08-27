import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitHubTaskObservation,
  createGitHubTaskSource,
  defaultGhReader,
} from '../../tools/guardian/github-task-source.mjs';
import { STATES } from '../../tools/guardian/state.mjs';

test('buildGitHubTaskObservation maps closed issue with matching merged PR to terminal fact', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_2_WAIT, last_consumed_comment_id: null, pr_url: 'https://github.com/o/r/pull/7' },
    githubIssue: {
      title: 'Done',
      body: 'Merged by human.',
      closed: true,
      comments: [],
      pullRequests: [{ number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'fix/issue-42', baseRefName: 'dev', merged: true }],
    },
  });

  assert.deepEqual(observation.identity, { source: 'github', taskId: '42', displayId: '#42' });
  assert.deepEqual(observation.terminal, {
    status: 'completed',
    reason: 'merged-closed',
    sourceEvidence: {
      issue_closed: true,
      matching_pr_merged: true,
      pr_number: 7,
      pr_url: 'https://github.com/o/r/pull/7',
      head: 'fix/issue-42',
      base: 'dev',
    },
  });
  assert.deepEqual(observation.facts, { title: 'Done', body: 'Merged by human.' });
});

test('buildGitHubTaskObservation maps open issue with matching merged PR to terminal fact', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_2_WAIT, last_consumed_comment_id: null, pr_url: 'https://github.com/o/r/pull/7' },
    githubIssue: {
      title: 'PR merged',
      body: 'Issue left open after merge.',
      closed: false,
      comments: [],
      pullRequests: [{ number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'fix/issue-42', baseRefName: 'dev', merged: true }],
    },
  });

  assert.deepEqual(observation.terminal, {
    status: 'completed',
    reason: 'merged-closed',
    sourceEvidence: {
      issue_closed: false,
      matching_pr_merged: true,
      pr_number: 7,
      pr_url: 'https://github.com/o/r/pull/7',
      head: 'fix/issue-42',
      base: 'dev',
    },
  });
});

test('buildGitHubTaskObservation does not treat issue closure alone as terminal', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_2_WAIT, last_consumed_comment_id: null },
    githubIssue: { title: 'Closed manually', body: '', closed: true, comments: [], pullRequests: [] },
  });

  assert.equal(observation.terminal, null);
});

test('buildGitHubTaskObservation ignores unrelated merged PRs when closing an issue', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_2_WAIT, last_consumed_comment_id: null, pr_url: 'https://github.com/o/r/pull/7' },
    githubIssue: {
      title: 'Closed',
      body: '',
      closed: true,
      comments: [],
      pullRequests: [{ number: 8, url: 'https://github.com/o/r/pull/8', headRefName: 'fix/issue-99', baseRefName: 'dev', merged: true }],
    },
  });

  assert.equal(observation.terminal, null);
});

test('buildGitHubTaskObservation ignores unrelated merged PRs while issue remains open', () => {
  const observation = buildGitHubTaskObservation({
    issueNumber: 42,
    record: { state: STATES.GATE_2_WAIT, last_consumed_comment_id: null, pr_url: 'https://github.com/o/r/pull/7' },
    githubIssue: {
      title: 'Open',
      body: '',
      closed: false,
      comments: [],
      pullRequests: [{ number: 8, url: 'https://github.com/o/r/pull/8', headRefName: 'fix/issue-99', baseRefName: 'dev', merged: true }],
    },
  });

  assert.equal(observation.terminal, null);
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
  const calls = [];
  const reader = defaultGhReader('D:/repo', {
    spawnSync: (_cmd, args, opts) => {
      calls.push(args);
      assert.equal(opts.cwd, 'D:/repo');
      if (args[0] === 'pr') {
        assert.deepEqual(args, ['pr', 'list', '--head', 'fix/issue-42', '--state', 'all', '--json', 'number,url,headRefName,baseRefName,mergedAt']);
        return { status: 0, stdout: '[]' };
      }
      assert.deepEqual(args, ['issue', 'view', '42', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences']);
      return {
        status: 0,
        stdout: JSON.stringify({
          title: 'Closed issue',
          body: null,
          state: 'CLOSED',
          comments: [{ id: 7, body: '/guardian retry', createdAt: '2026-08-24T03:00:00Z', author: { login: 'alice' } }],
          closedByPullRequestsReferences: [{ number: 9, url: 'https://github.com/o/r/pull/9', headRefName: 'fix/issue-42', baseRefName: 'dev', merged: true }],
        }),
      };
    },
  });

  assert.deepEqual(reader(42), {
    title: 'Closed issue',
    body: '',
    closed: true,
    comments: [{ id: 7, body: '/guardian retry', createdAt: '2026-08-24T03:00:00Z', author: 'alice' }],
    pullRequests: [{ number: 9, url: 'https://github.com/o/r/pull/9', headRefName: 'fix/issue-42', baseRefName: 'dev', merged: true }],
  });
  assert.deepEqual(calls, [
    ['issue', 'view', '42', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ['pr', 'list', '--head', 'fix/issue-42', '--state', 'all', '--json', 'number,url,headRefName,baseRefName,mergedAt'],
  ]);
});

test('defaultGhReader augments open issues with PR facts from the fix branch', () => {
  const calls = [];
  const reader = defaultGhReader('D:/repo', {
    spawnSync: (_cmd, args, opts) => {
      calls.push(args);
      assert.equal(opts.cwd, 'D:/repo');
      if (args[0] === 'issue') {
        return {
          status: 0,
          stdout: JSON.stringify({
            title: 'Open after merge',
            body: 'PR merged but issue stayed open.',
            state: 'OPEN',
            comments: [],
            closedByPullRequestsReferences: [],
          }),
        };
      }
      assert.deepEqual(args, ['pr', 'list', '--head', 'fix/issue-42', '--state', 'all', '--json', 'number,url,headRefName,baseRefName,mergedAt']);
      return {
        status: 0,
        stdout: JSON.stringify([{ number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'fix/issue-42', baseRefName: 'dev', mergedAt: '2026-08-27T03:12:49Z' }]),
      };
    },
  });

  assert.deepEqual(reader(42).pullRequests, [
    { number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'fix/issue-42', baseRefName: 'dev', merged: true },
  ]);
  assert.equal(calls.length, 2);
});

test('defaultGhReader retries transient EOF failures and still reads PR facts once after success', () => {
  const calls = [];
  const sleeps = [];
  let issueAttempts = 0;
  const reader = defaultGhReader('D:/repo', {
    maxAttempts: 3,
    sleep: (ms) => {
      sleeps.push(ms);
    },
    spawnSync: (_cmd, args, opts) => {
      calls.push(args);
      assert.equal(opts.cwd, 'D:/repo');
      assert.equal(opts.shell, false);
      if (args[0] === 'pr') {
        return { status: 0, stdout: '[]' };
      }
      issueAttempts += 1;
      if (issueAttempts < 3) {
        return { status: 1, stderr: 'Post "https://api.github.com/graphql": EOF' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          title: 'Recovered issue',
          body: 'body',
          state: 'OPEN',
          comments: [],
          closedByPullRequestsReferences: [],
        }),
      };
    },
  });

  assert.equal(reader(42).title, 'Recovered issue');
  assert.deepEqual(calls, [
    ['issue', 'view', '42', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ['issue', 'view', '42', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ['issue', 'view', '42', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ['pr', 'list', '--head', 'fix/issue-42', '--state', 'all', '--json', 'number,url,headRefName,baseRefName,mergedAt'],
  ]);
  assert.deepEqual(sleeps, [1000, 1000]);
});

test('defaultGhReader does not retry permanent auth or not found failures', () => {
  for (const stderr of ['HTTP 401: authentication required', 'HTTP 404: Not Found']) {
    const calls = [];
    const sleeps = [];
    const reader = defaultGhReader('D:/repo', {
      maxAttempts: 3,
      sleep: (ms) => {
        sleeps.push(ms);
      },
      spawnSync: (_cmd, args, opts) => {
        calls.push(args);
        assert.equal(opts.shell, false);
        return { status: 1, stderr };
      },
    });

    assert.throws(() => reader(42), new Error(`gh issue view #42 failed: ${stderr}`));
    assert.deepEqual(calls, [
      ['issue', 'view', '42', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ]);
    assert.deepEqual(sleeps, []);
  }
});

test('defaultGhReader exhausts transient retries and throws the final diagnostic', () => {
  const calls = [];
  const sleeps = [];
  const reader = defaultGhReader('D:/repo', {
    maxAttempts: 3,
    sleep: (ms) => {
      sleeps.push(ms);
    },
    spawnSync: (_cmd, args, opts) => {
      calls.push(args);
      assert.equal(opts.shell, false);
      return { status: 1, stderr: 'HTTP 503 Service Unavailable' };
    },
  });

  assert.throws(() => reader(25), new Error('gh issue view #25 failed: HTTP 503 Service Unavailable'));
  assert.deepEqual(calls, [
    ['issue', 'view', '25', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ['issue', 'view', '25', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
    ['issue', 'view', '25', '--json', 'state,comments,title,body,labels,closedByPullRequestsReferences'],
  ]);
  assert.deepEqual(sleeps, [1000, 1000]);
});
