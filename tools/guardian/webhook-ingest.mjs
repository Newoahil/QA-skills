// QA Guardian — GitHub webhook ingest (Phase 4, cloud side).
//
// See docs/qa-guardian-webhook-idempotency.md §2, §6. This is the ONLY thing the cloud side does
// for webhooks: verify the delivery envelope, extract the TARGET ISSUE NUMBER only, and durably
// insert the delivery by its delivery id. It NEVER runs gh, never calls selectCommand, never reads
// or writes .qa/guardian/<n>.json, never launches an agent, never posts a verdict. A webhook is a
// reason to reconcile issue N — nothing more (§1). Truth always comes from GitHub at reconcile time.
//
// The durable store is INJECTED (the WakeStore interface below), so the backing store — container
// file, DB, or managed queue — is a swap, not a rewrite. A missing/ephemeral store must be backed
// by real durable storage in production (§6); the in-memory store here is for tests/local only.

import crypto from 'node:crypto';

export const SUPPORTED_EVENTS = Object.freeze(['issues', 'issue_comment', 'pull_request', 'push']);

// Verify the GitHub webhook HMAC-SHA256 signature (X-Hub-Signature-256: sha256=<hex>). Constant-time
// compare. Returns true/false; never throws on a bad signature (caller returns 401).
export function verifyWebhookSignature({ rawBody, signatureHeader, secret }) {
  if (!secret || typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Extract the target issue number from a parsed webhook payload, by event type. pull_request and
// push do not carry an issue number directly; they resolve to null here (they trigger a broader
// reconcile in the scheduler, keyed by branch/PR, not an issue wake). Returns a positive int or null.
export function extractIssueNumber(eventType, payload) {
  const n = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  switch (eventType) {
    case 'issues':
      return n(payload?.issue?.number);
    case 'issue_comment':
      return n(payload?.issue?.number);
    case 'pull_request':
      // A PR that closes/links an issue is reconciled when the human merges; the PR itself carries
      // no guardian issue wake here. Return null → recorded as a non-issue delivery.
      return null;
    case 'push':
      return null;
    default:
      return null;
  }
}

/**
 * Ingest one webhook delivery. Pure decision + a single injected durable insert.
 * @param {object} args
 *   rawBody:string, headers:Record<string,string|undefined>, secret:string,
 *   store: WakeStore  { hasDelivery(id):bool|Promise, insert(record):void|Promise }
 *   now?: string ISO
 * @returns {Promise<{status:number, body:object}>}  HTTP-shaped result for the server boundary.
 *
 * WakeStore contract (durable, keyed by delivery_id):
 *   hasDelivery(deliveryId) -> boolean
 *   insert({ delivery_id, event_type, issue_number, received_at, status:'pending' }) -> void
 */
export async function ingestWebhook(args) {
  const { rawBody, headers, secret, store } = args;
  const now = args.now ?? new Date().toISOString();

  const eventType = headers?.['x-github-event'];
  const deliveryId = headers?.['x-github-delivery'];
  const signature = headers?.['x-hub-signature-256'];

  if (!verifyWebhookSignature({ rawBody, signatureHeader: signature, secret })) {
    return { status: 401, body: { error: 'bad-signature' } };
  }
  if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
    return { status: 400, body: { error: 'missing-delivery-id' } };
  }
  if (!SUPPORTED_EVENTS.includes(eventType)) {
    // ping and unsupported events: acknowledge without recording a wake (nothing to reconcile).
    return { status: 202, body: { ok: true, ignored: eventType ?? null } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'malformed-json' } };
  }

  // Ingestion idempotency (§3.1): a replayed delivery is a no-op success.
  if (await store.hasDelivery(deliveryId)) {
    return { status: 200, body: { ok: true, deduped: true } };
  }

  const issueNumber = extractIssueNumber(eventType, payload);
  await store.insert({
    delivery_id: deliveryId,
    event_type: eventType,
    issue_number: issueNumber,
    received_at: now,
    status: 'pending',
  });
  return { status: 202, body: { ok: true, issue: issueNumber } };
}

// A minimal in-memory WakeStore for tests/local. Production must inject a durable implementation.
export function createInMemoryWakeStore() {
  const byId = new Map();
  return {
    async hasDelivery(id) { return byId.has(id); },
    async insert(rec) { if (!byId.has(rec.delivery_id)) byId.set(rec.delivery_id, { ...rec }); },
    // Pull/ack contract (§6): the local scheduler drains pending records and acks them.
    async pending() { return [...byId.values()].filter((r) => r.status === 'pending'); },
    async ack(id) { const r = byId.get(id); if (r) r.status = 'forwarded'; },
    _all() { return [...byId.values()]; },
  };
}
