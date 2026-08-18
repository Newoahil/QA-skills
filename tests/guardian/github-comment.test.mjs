// Tests for tools/guardian/github-comment.mjs — REST issue comment via injected fetch.

import assert from 'node:assert/strict';
import test from 'node:test';

import { postIssueComment, GithubApiError } from '../../tools/guardian/github-comment.mjs';

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
    () => postIssueComment({ repo: 'o/r', issue: 1, body: 'x', token: 't', fetchImpl: async () => res }),
    (e) => e instanceof GithubApiError && e.status === 403,
  );
});

test('rejects invalid repo, empty body, missing token, bad issue', async () => {
  await assert.rejects(() => postIssueComment({ repo: 'bad', issue: 1, body: 'x', token: 't', fetchImpl: async () => ({}) }));
  await assert.rejects(() => postIssueComment({ repo: 'o/r', issue: 1, body: '', token: 't', fetchImpl: async () => ({}) }));
  await assert.rejects(() => postIssueComment({ repo: 'o/r', issue: 1, body: 'x', token: '', fetchImpl: async () => ({}) }));
  await assert.rejects(() => postIssueComment({ repo: 'o/r', issue: -1, body: 'x', token: 't', fetchImpl: async () => ({}) }));
});
