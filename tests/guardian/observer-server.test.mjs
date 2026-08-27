// Tests for tools/guardian/observer-server.mjs — Observer server & OpenCode reverse proxy.
// Covers root HTML marker, GET /session, GET /session/:id/message, POST body forwarding,
// and text/event-stream (SSE) pass-through using a fake upstream server.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createObserverServer, OBSERVER_HTML } from '../../tools/guardian/observer-server.mjs';

function startFakeUpstream() {
  const recorded = [];
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyStr = Buffer.concat(chunks).toString('utf8');
    recorded.push({ method: req.method, url, headers: req.headers, body: bodyStr });

    if (req.method === 'GET' && url === '/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 'ses_1', title: 'Fix Bug 123', time: { created: 1720000000000 } }]));
      return;
    }

    if (req.method === 'GET' && url === '/session/ses_1/message') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        {
          info: { role: 'user', time: { created: 1720000000000 } },
          parts: [{ type: 'text', text: 'Investigate the issue' }],
        },
        {
          info: { role: 'assistant', time: { created: 1720000001000 } },
          parts: [{ type: 'text', text: 'Found root cause in module X' }],
        },
      ]));
      return;
    }

    if (req.method === 'POST' && url === '/session/ses_1/message') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        kind: 'ok',
        received: JSON.parse(bodyStr || '{}'),
      }));
      return;
    }

    if (req.method === 'GET' && url === '/event') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('event: heartbeat\ndata: {"ok":true}\n\n');
      setTimeout(() => {
        res.write('event: session.updated\ndata: {"id":"ses_1"}\n\n');
        res.end();
      }, 20);
      return;
    }

    if (req.method === 'GET' && url === '/global/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.18.18' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not-found' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        recorded,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function startObserver(upstreamUrl) {
  const server = createObserverServer({ upstreamUrl });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('observer-server serves HTML observer page at GET / with data-guardian-observer marker', async () => {
  const upstream = await startFakeUpstream();
  const observer = await startObserver(upstream.url);
  try {
    const res = await fetch(`${observer.url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /data-guardian-observer/);
    assert.match(body, /QA Guardian/);
    assert.match(body, /\/observer\.js/);

    const script = await fetch(`${observer.url}/observer.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /application\/javascript/);
    const scriptBody = await script.text();
    assert.match(scriptBody, /\/session\?/);
    assert.doesNotMatch(scriptBody, /roots=true/);
    assert.match(scriptBody, /buildSessionTree/);
    assert.match(scriptBody, /discoverWorktrees/);
  } finally {
    await observer.close();
    await upstream.close();
  }
});

test('observer-server proxies GET /session to upstream and returns JSON', async () => {
  const upstream = await startFakeUpstream();
  const observer = await startObserver(upstream.url);
  try {
    const res = await fetch(`${observer.url}/session`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const data = await res.json();
    assert.deepEqual(data, [{ id: 'ses_1', title: 'Fix Bug 123', time: { created: 1720000000000 } }]);
    assert.equal(upstream.recorded.length, 1);
    assert.equal(upstream.recorded[0].url, '/session');
  } finally {
    await observer.close();
    await upstream.close();
  }
});

test('observer-server proxies GET /session/:id/message to upstream and returns messages', async () => {
  const upstream = await startFakeUpstream();
  const observer = await startObserver(upstream.url);
  try {
    const res = await fetch(`${observer.url}/session/ses_1/message`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(Array.isArray(data), true);
    assert.equal(data.length, 2);
    assert.equal(data[0].info.role, 'user');
    assert.equal(data[1].info.role, 'assistant');
  } finally {
    await observer.close();
    await upstream.close();
  }
});

test('observer-server forwards POST request body and headers to upstream', async () => {
  const upstream = await startFakeUpstream();
  const observer = await startObserver(upstream.url);
  try {
    const payload = { parts: [{ type: 'text', text: 'Please check logs' }], agent: 'qa' };
    const res = await fetch(`${observer.url}/session/ses_1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Custom-Header': 'test-val' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.kind, 'ok');
    assert.deepEqual(data.received, payload);
    const lastReq = upstream.recorded[upstream.recorded.length - 1];
    assert.equal(lastReq.method, 'POST');
    assert.equal(lastReq.url, '/session/ses_1/message');
    assert.equal(lastReq.headers['x-custom-header'], 'test-val');
  } finally {
    await observer.close();
    await upstream.close();
  }
});

test('observer-server passes text/event-stream (SSE) through without buffering', async () => {
  const upstream = await startFakeUpstream();
  const observer = await startObserver(upstream.url);
  try {
    const res = await fetch(`${observer.url}/event`, {
      headers: { Accept: 'text/event-stream' },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /event: heartbeat/);
    assert.match(text, /event: session\.updated/);
  } finally {
    await observer.close();
    await upstream.close();
  }
});

test('observer-server returns 502 when upstream is unreachable', async () => {
  // Point to a non-existent port
  const observer = await startObserver('http://127.0.0.1:59999');
  try {
    const res = await fetch(`${observer.url}/session`);
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error, 'upstream-unreachable');
  } finally {
    await observer.close();
  }
});
