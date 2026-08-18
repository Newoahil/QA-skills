// QA Guardian — Feishu callback HTTP server (thin boundary)
//
// Cloud-deployed (Dokploy / docker compose). It only: reads the raw body, lower-cases headers,
// resolves secrets from env, and delegates to handleCallback. All decision logic + safety lives
// in callback-handler.mjs / feishu-callback.mjs. Writes GitHub comments via github-comment.mjs.
//
// Env (via Dokploy): FEISHU_VERIFICATION_TOKEN, FEISHU_ENCRYPT_KEY, GITHUB_TOKEN, GITHUB_REPO,
// optional PORT (default 8787), optional CALLBACK_PATH (default /feishu/callback).

import http from 'node:http';

import { loadSecrets, requireSecrets } from './secrets.mjs';
import { handleCallback } from './callback-handler.mjs';
import { postIssueComment } from './github-comment.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const CALLBACK_PATH = process.env.CALLBACK_PATH ?? '/feishu/callback';
// Cap the request body BEFORE buffering/parsing so an unauthenticated caller cannot exhaust
// memory ahead of signature verification. Feishu card callbacks are small (a few KB).
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 64 * 1024);

class BodyTooLargeError extends Error {}

function lowerHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        req.pause();
        reject(new BodyTooLargeError('request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer() {
  const secrets = requireSecrets(loadSecrets(), [
    'feishu_verification_token',
    'feishu_encrypt_key',
    'github_token',
    'github_repo',
  ]);
  const seen = new Set();
  const postComment = (repo, issue, body) =>
    postIssueComment({ repo, issue, body, token: secrets.github_token });

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not-found' }));
        return;
      }

      const rawBody = await readBody(req);
      const headers = lowerHeaders(req.headers);
      const result = await handleCallback({ rawBody, headers, secrets, postComment, seen });
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (e) {
      // no-excuse-ok: catch — top-level HTTP boundary, must never leak stack or crash the loop
      if (e instanceof BodyTooLargeError) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload-too-large' }));
        req.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    }
  });
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('callback-server.mjs')) {
  const server = createServer();
  server.listen(PORT, () => {
    process.stdout.write(`qa-guardian feishu callback listening on :${PORT}${CALLBACK_PATH}\n`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}
