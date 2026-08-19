// Tests for tools/guardian/github-comment.mjs — REST issue comment via injected fetch.

import assert from 'node:assert/strict';
import test from 'node:test';

import { postIssueComment, GithubApiError } from '../../tools/guardian/github-comment.mjs';
import { ACTORS, EFFECTS } from '../../tools/guardian/actor-routing.mjs';

function fakeFetch(captured, response) {
  return async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return response;
  };
}

test('posts to the correct issue comments endpoint with auth + body', async () => {
  const captured = {};
  const res = {
    ok: true,
    status: 201,
    json: async () => ({ id: 42, html_url: 'https://github.com/o/r/issues/191#c42' }),
  };
  const out = await postIssueComment({
    actor: ACTORS.SUPERVISOR,
    repo: 'o/r',
    issue: 191,
    body: '/guardian approve',
    token: 'tkn',
    fetchImpl: fakeFetch(captured, res),
  });

  assert.equal(captured.url, 'https://api.github.com/repos/o/r/issues/191/comments');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer tkn');
  assert.equal(JSON.parse(captured.opts.body).body, '/guardian approve');
  assert.deepEqual(out, { id: 42, url: 'https://github.com/o/r/issues/191#c42' });
});

test('throws GithubApiError with status on non-2xx', async () => {
  const res = { ok: false, status: 403, text: async () => 'forbidden' };
  await assert.rejects(
    () => postIssueComment({ actor: ACTORS.SUPERVISOR, repo: 'o/r', issue: 1, body: 'x', token: 't', fetchImpl: async () => res }),
    (e) => e instanceof GithubApiError && e.status === 403,
  );
});

test('rejects invalid repo, empty body, missing token, bad issue', async () => {
  await assert.rejects(() => postIssueComment({ actor: ACTORS.SUPERVISOR, repo: 'bad', issue: 1, body: 'x', token: 't', fetchImpl: async () => ({}) }));
  await assert.rejects(() => postIssueComment({ actor: ACTORS.SUPERVISOR, repo: 'o/r', issue: 1, body: '', token: 't', fetchImpl: async () => ({}) }));
  await assert.rejects(() => postIssueComment({ actor: ACTORS.SUPERVISOR, repo: 'o/r', issue: 1, body: 'x', token: '', fetchImpl: async () => ({}) }));
  await assert.rejects(() => postIssueComment({ actor: ACTORS.SUPERVISOR, repo: 'o/r', issue: -1, body: 'x', token: 't', fetchImpl: async () => ({}) }));
});

test('fact writer may post facts, while QA/fixer/unknown are rejected before fetch', async () => {
  const allowed = { ok: true, status: 201, json: async () => ({ id: 1, html_url: 'u' }) };
  const out = await postIssueComment({ actor: ACTORS.BOT_FACT_WRITER, effect: EFFECTS.FACT_COMMENT, repo: 'o/r', issue: 1, body: 'fact', token: 't', fetchImpl: async () => allowed });
  assert.equal(out.id, 1);
  for (const actor of [ACTORS.BOT_EXECUTOR, 'unknown']) {
    let calls = 0;
    await assert.rejects(() => postIssueComment({ actor, repo: 'o/r', issue: 1, body: 'fact', token: 't', fetchImpl: async () => { calls += 1; return allowed; } }), /may not perform|unknown actor/);
    assert.equal(calls, 0, actor);
  }
});
