// QA Guardian — Feishu callback verify + parse (pure core)
//
// Security-critical. This module does NOT open a socket; it is the pure decision layer the
// HTTP boundary (callback-server.mjs) calls: verify the request signature, then parse the
// card-action payload into a validated { issue, verb, text } command — or reject it.
//
// Feishu signature (event subscription "encrypt"/security): the request carries headers
//   X-Lark-Request-Timestamp, X-Lark-Request-Nonce, X-Lark-Signature
// and the signature is sha256(timestamp + nonce + encryptKey + rawBody) hex. We verify it in
// constant time. A URL-verification challenge (type=url_verification) is handled separately by
// the boundary and does not reach parseCardAction.

import crypto from 'node:crypto';

import { ALLOWED_CALLBACK_VERBS } from './notify-feishu.mjs';

// Verbs that require accompanying opinion text (revise/rework). Plain verbs ignore text.
export const VERBS_REQUIRING_TEXT = Object.freeze(['revise', 'rework']);

export class CallbackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CallbackError';
    this.code = code; // 'bad-signature' | 'stale' | 'bad-verb' | 'bad-issue' | 'missing-text' | 'malformed'
  }
}

// Max clock skew for a callback to be accepted (replay window). 5 minutes.
export const MAX_SKEW_MS = 5 * 60 * 1000;

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Compute the Feishu signature for a raw body given the security headers + encrypt key.
 * @returns {string} hex sha256
 */
export function computeSignature({ timestamp, nonce, encryptKey, rawBody }) {
  const h = crypto.createHash('sha256');
  h.update(String(timestamp) + String(nonce) + String(encryptKey) + String(rawBody));
  return h.digest('hex');
}

/**
 * Verify a Feishu callback signature + freshness. Throws CallbackError on failure.
 * @param {object} args { timestamp, nonce, signature, encryptKey, rawBody, now? }
 * @returns {true}
 */
export function verifySignature(args) {
  const { timestamp, nonce, signature, encryptKey, rawBody } = args;
  const now = args.now ?? Date.now();

  if (!timestamp || !nonce || !signature || !encryptKey || rawBody == null) {
    throw new CallbackError('malformed', 'missing signature material');
  }

  // Require a finite, non-negative integer epoch (seconds or millis). A malformed timestamp
  // (NaN, fractional, negative, non-numeric) must be rejected BEFORE the skew check, otherwise
  // NaN comparisons silently pass the window and let a malformed request reach signature compare.
  const tsRaw = Number(timestamp);
  if (!Number.isInteger(tsRaw) || tsRaw <= 0) {
    throw new CallbackError('malformed', 'callback timestamp is not a positive integer');
  }
  const tsMs = tsRaw * (String(timestamp).trim().length <= 10 ? 1000 : 1);
  if (Math.abs(now - tsMs) > MAX_SKEW_MS) {
    throw new CallbackError('stale', 'callback timestamp outside allowed window');
  }

  const expected = computeSignature({ timestamp, nonce, encryptKey, rawBody });
  if (!timingSafeEqualHex(expected, signature)) {
    throw new CallbackError('bad-signature', 'signature mismatch');
  }
  return true;
}

function extractActionValue(event) {
  // Feishu card action callback shape (card.action.trigger): event.action.value carries our
  // { issue, verb }; input fields arrive under event.action.input_value or form_value.
  const action = event?.action ?? event?.event?.action;
  if (!action || typeof action !== 'object') {
    throw new CallbackError('malformed', 'no card action in payload');
  }
  const value = action.value ?? {};
  const text =
    action.input_value ??
    action.form_value?.[`guardian_${value.verb}`] ??
    action.tag_value ??
    '';
  return { value, text };
}

/**
 * Parse a verified Feishu card-action event into a validated guardian command.
 * @param {object} event parsed JSON event (already signature-verified by the boundary)
 * @returns {{ issue:number, verb:string, text:string }}
 */
export function parseCardAction(event) {
  const { value, text } = extractActionValue(event);

  const verb = typeof value.verb === 'string' ? value.verb.toLowerCase() : '';
  if (!ALLOWED_CALLBACK_VERBS.includes(verb)) {
    throw new CallbackError('bad-verb', `verb not allowed: ${verb || '(empty)'}`);
  }

  const issue = Number(value.issue);
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new CallbackError('bad-issue', `invalid issue number: ${String(value.issue)}`);
  }

  const opinion = typeof text === 'string' ? text.trim() : '';
  if (VERBS_REQUIRING_TEXT.includes(verb) && opinion.length === 0) {
    throw new CallbackError('missing-text', `verb ${verb} requires opinion text`);
  }

  return { issue, verb, text: opinion };
}

/**
 * Render the exact /guardian comment body a command maps to. Text is DATA appended verbatim.
 * @param {{verb:string,text:string}} cmd
 * @returns {string}
 */
export function commandToCommentBody(cmd) {
  const base = `/guardian ${cmd.verb}`;
  return cmd.text && cmd.text.length > 0 ? `${base} ${cmd.text}` : base;
}
