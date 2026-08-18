// QA Guardian — unified 3-layer idempotency ledger (Phase 4).
//
// See docs/qa-guardian-webhook-idempotency.md §3. Three DISTINCT identities protect three different
// boundaries; they are NOT collapsed into one "event id":
//
//   1. ingestion  — webhook delivery_id           "accepted this delivery already?"
//   2. artifact   — GitHub object (comment/pr id)  "which GitHub object caused the work?"
//   3. application— applied-transition token        "already applied this logical operation?"
//
// Token DERIVATION is pure (string/hash in → string out) and independently unit-testable. The
// on-disk ledger lives under .qa/guardian/ledger/ and is written atomically (write temp + rename).
// The scheduler is the sole writer (single-writer N=1); these records are its durable memory.

import crypto from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { readJsonFile } from './runtime-io.mjs';

// ------------------------------------------------------------------ token derivation (pure)

// Application identity (§3.3). Deterministic across replays / trigger paths, so the same logical
// transition maps to the same token whether reached via webhook or compensation poll.
export function transitionToken({ repo, issue, commentId, verb, action }) {
  const basis = `${repo}:${Number(issue)}:command:${commentId ?? ''}:verb:${verb ?? ''}:action:${action ?? ''}`;
  return `sha256:${crypto.createHash('sha256').update(basis, 'utf8').digest('hex')}`;
}

// Commandless transitions (DONE / STALLED / compensation cleanup) have no comment; derive from the
// stable state + facts instead of a nonexistent comment id.
export function commandlessTransitionToken({ issue, currentState, action, factsDigest = '' }) {
  const basis = `issue:${Number(issue)}:state:${currentState ?? ''}:action:${action ?? ''}:facts:${factsDigest}`;
  return `sha256:${crypto.createHash('sha256').update(basis, 'utf8').digest('hex')}`;
}

// Artifact identity (§3.2). Stable id of the GitHub object, never the webhook delivery.
export function commandArtifactToken(issue, commentId) {
  return `issue:${Number(issue)}:comment:${commentId}`;
}
export function prArtifactToken(prNumber) {
  return `pr:${Number(prNumber)}`;
}

// ------------------------------------------------------------------ ledger paths

export function ledgerRoot(guardianDir) {
  return path.join(guardianDir, 'ledger');
}
function ingestedPath(guardianDir, deliveryId) {
  return path.join(ledgerRoot(guardianDir), 'ingested', `${safeName(deliveryId)}.json`);
}
function appliedPath(guardianDir, issue, token) {
  return path.join(ledgerRoot(guardianDir), 'applied', String(Number(issue)), `${safeName(token)}.json`);
}

// A filesystem-safe file component. delivery ids and tokens are attacker-influenced (webhook), so
// never let them escape the ledger dir via path separators.
function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._:-]/g, '_').replace(/:/g, '_');
}

// ------------------------------------------------------------------ atomic record + has

function writeJsonAtomic(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  renameSync(tmp, file); // atomic replace on same volume
}

// Ingestion layer (§3.1). Returns { inserted:boolean } — false when this delivery was already
// ingested (idempotent). Subsumes the callback in-memory `seen` set as the correctness mechanism.
export function recordIngestion(guardianDir, { deliveryId, issue, eventType, now = new Date().toISOString() }) {
  const file = ingestedPath(guardianDir, deliveryId);
  if (existsSync(file)) return { inserted: false, path: file };
  writeJsonAtomic(file, {
    delivery_id: String(deliveryId),
    issue_number: issue == null ? null : Number(issue),
    event_type: eventType ?? null,
    ingested_at: now,
    source: 'cloud-webhook-relay',
  });
  return { inserted: true, path: file };
}
export function hasIngested(guardianDir, deliveryId) {
  return existsSync(ingestedPath(guardianDir, deliveryId));
}

// Application layer (§3.3). effect_status tracks crash-safe lifecycle:
//   in_progress → committed/completed (or retryable). See §4.
export function readApplied(guardianDir, issue, token) {
  const file = appliedPath(guardianDir, issue, token);
  if (!existsSync(file)) return null;
  return readJsonFile(file, { required: false });
}
export function hasAppliedCommitted(guardianDir, issue, token) {
  const rec = readApplied(guardianDir, issue, token);
  return Boolean(rec && (rec.effect_status === 'committed' || rec.effect_status === 'completed'));
}
export function recordApplied(guardianDir, issue, token, fields = {}) {
  const file = appliedPath(guardianDir, issue, token);
  const prior = existsSync(file) ? readJsonFile(file, { required: false }) : {};
  const rec = {
    token,
    issue_number: Number(issue),
    action: fields.action ?? prior.action ?? null,
    command_comment_id: fields.commandCommentId ?? prior.command_comment_id ?? null,
    from_state: fields.fromState ?? prior.from_state ?? null,
    to_state: fields.toState ?? prior.to_state ?? null,
    applied_at: prior.applied_at ?? fields.now ?? new Date().toISOString(),
    updated_at: fields.now ?? new Date().toISOString(),
    effect_status: fields.effectStatus ?? prior.effect_status ?? 'in_progress',
  };
  writeJsonAtomic(file, rec);
  return rec;
}
