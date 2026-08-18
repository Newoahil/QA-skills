// QA Guardian — GitHub issue comment via REST (PAT, injected fetch)
//
// The callback server runs in a cloud container with no gh CLI and no local git identity, so
// it writes issue comments through the GitHub REST API using a fine-grained PAT scoped to the
// one repo's issues:write. fetch is injected so this is fully unit-testable without network.
//
// This is the ONLY GitHub side-effect the callback path performs: append a `/guardian <verb>`
// comment. It never merges, closes, edits labels, or pushes code — the same safety envelope as
// the human typing the command in GitHub.

export class GithubApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
  }
}

const GITHUB_API = 'https://api.github.com';

function parseRepo(repo) {
  const parts = String(repo).split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GithubApiError(0, `invalid repo (want owner/name): ${String(repo)}`);
  }
  return { owner: parts[0], name: parts[1] };
}

/**
 * Post an issue comment. Pure except for the injected fetch.
 * @param {object} args { repo, issue, body, token, fetchImpl?, apiBase? }
 * @returns {Promise<{ id:number, url:string }>}
 */
export async function postIssueComment(args) {
  const { repo, issue, body, token } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const apiBase = args.apiBase ?? GITHUB_API;

  if (!token) throw new GithubApiError(0, 'missing GitHub token');
  if (!body || String(body).length === 0) throw new GithubApiError(0, 'empty comment body');
  const { owner, name } = parseRepo(repo);
  const issueNum = Number(issue);
  if (!Number.isInteger(issueNum) || issueNum <= 0) {
    throw new GithubApiError(0, `invalid issue number: ${String(issue)}`);
  }

  const url = `${apiBase}/repos/${owner}/${name}/issues/${issueNum}/comments`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'qa-guardian-callback',
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GithubApiError(res.status, `github comment failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return { id: Number(data.id), url: String(data.html_url ?? data.url ?? '') };
}
