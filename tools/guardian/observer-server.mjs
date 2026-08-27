// QA Guardian - local observer web page and OpenCode reverse proxy.
// Serves the observer UI at GET / and proxies every API/SSE route to upstream OpenCode.

import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'observer-web');
const BINDING_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scheduler.config.json');

const STATIC_ROUTES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/observer.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/observer.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
});

export const OBSERVER_HTML = readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');

function staticAsset(pathname) {
  const route = STATIC_ROUTES[pathname];
  if (!route) return null;
  const content = readFileSync(path.join(WEB_DIR, route.file), 'utf8');
  return { body: content, type: route.type };
}

function readGuardianProjects() {
  if (!existsSync(BINDING_FILE)) return [];
  try {
    const raw = readFileSync(BINDING_FILE, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const projects = [];
    if (data?.projects && typeof data.projects === 'object') {
      for (const [key, p] of Object.entries(data.projects)) {
        if (p?.target_repo) {
          projects.push({
            name: path.basename(p.target_repo),
            target_repo: p.target_repo,
            control_worktree: p.control_worktree_path || `${p.target_repo}.qa-guardian-control`,
            qa_worktree: p.qa_snapshot_path || `${p.target_repo}.qa-guardian-qa`,
          });
        }
      }
    } else if (data?.target_repo) {
      projects.push({
        name: path.basename(data.target_repo),
        target_repo: data.target_repo,
        control_worktree: data.control_worktree_path || `${data.target_repo}.qa-guardian-control`,
        qa_worktree: data.qa_snapshot_path || `${data.target_repo}.qa-guardian-qa`,
      });
    }
    return projects;
  } catch {
    return [];
  }
}

function proxyHeaders(req, upstream) {
  return {
    ...req.headers,
    host: upstream.host,
  };
}

function writeUpstreamError(res, error) {
  if (res.headersSent) {
    res.destroy(error);
    return;
  }
  res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'upstream-unreachable', message: error.message }));
}

export function createProxyHandler({ upstreamUrl = 'http://127.0.0.1:4097', logger = null } = {}) {
  const upstream = new URL(upstreamUrl);
  return (req, res) => {
    const rawPath = req.url ?? '/';
    const pathname = rawPath.split('?')[0];

    if (req.method === 'GET' && pathname === '/api/guardian-projects') {
      const list = readGuardianProjects();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(list));
      return;
    }

    const asset = req.method === 'GET' ? staticAsset(pathname) : null;
    if (asset) {
      logger?.info?.('observer.static', { path: pathname });
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-cache' });
      res.end(asset.body);
      return;
    }

    const proxyReq = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: proxyHeaders(req, upstream),
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      logger?.warn?.('observer.proxy_error', { path: req.url, error_message: error.message });
      writeUpstreamError(res, error);
    });
    req.on('close', () => {
      if (!proxyReq.destroyed && !proxyReq.writableEnded) proxyReq.destroy();
    });
    req.pipe(proxyReq);
  };
}

export function createObserverServer({ upstreamUrl = 'http://127.0.0.1:4097', logger = null } = {}) {
  return http.createServer(createProxyHandler({ upstreamUrl, logger }));
}

export function parseCli(argv) {
  return parseArgs({
    args: argv,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string', default: '127.0.0.1' },
      upstream: { type: 'string', short: 'u' },
      'upstream-port': { type: 'string' },
    },
    allowPositionals: false,
  }).values;
}

if (process.argv[1] && process.argv[1].endsWith('observer-server.mjs')) {
  const args = parseCli(process.argv.slice(2));
  const port = Number(args.port ?? process.env.PORT ?? 4096);
  const host = args.host ?? process.env.HOST ?? '127.0.0.1';
  const upstreamUrl = args.upstream
    ?? process.env.UPSTREAM_URL
    ?? (args['upstream-port'] ? `http://127.0.0.1:${args['upstream-port']}` : `http://127.0.0.1:${port + 1}`);

  const server = createObserverServer({ upstreamUrl });
  server.listen(port, host, () => {
    console.log(`[observer-server] http://${host}:${port} -> ${upstreamUrl}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}
