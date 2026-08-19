// QA Guardian — Feishu callback request handler (pure-ish, injected side-effects)
//
// Given a raw request body + headers + resolved secrets + a comment poster, decide the HTTP
// response. Two request kinds:
//   1. url_verification challenge (Feishu setup) → echo challenge. No signature required by
//      Feishu for the plaintext challenge, but we still require it to match our token.
//   2. card action → verify signature, parse verb/issue/text, post the /guardian comment.
//
// Idempotency: Feishu retries deliver the same event_id; a caller-provided `seen` set dedups.

import {
  CallbackError,
  parseCardAction,
  verifySignature,
} from './feishu-callback.mjs';
import { executeNormalizedAction } from './action-executor.mjs';

function json(status, obj) {
  return { status, body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } };
}

function eventIdOf(event) {
  return event?.header?.event_id ?? event?.uuid ?? event?.event_id ?? null;
}

/**
 * Handle a Feishu callback. Injected deps keep it testable and side-effect-explicit.
 * @param {object} args
 *   rawBody: string, headers: Record<string,string|undefined>, secrets: {feishu_verification_token, feishu_encrypt_key, github_token, github_repo},
 *   postComment: (repo, issue, body) => Promise<{id,url}>, seen?: Set<string>, now?: number
 * @returns {Promise<{status:number, body:string, headers:object}>}
 */
export async function handleCallback(args) {
  const { rawBody, headers, secrets, postComment } = args;
  const seen = args.seen ?? new Set();
  const now = args.now ?? Date.now();

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'malformed-json' });
  }

  // 1. URL verification challenge (setup). Feishu sends { type:'url_verification', token, challenge }.
  if (event?.type === 'url_verification') {
    if (event.token !== secrets.feishu_verification_token) {
      return json(401, { error: 'bad-verification-token' });
    }
    return json(200, { challenge: String(event.challenge ?? '') });
  }

  // 2. Card action → must be signature-verified.
  try {
    verifySignature({
      timestamp: headers['x-lark-request-timestamp'],
      nonce: headers['x-lark-request-nonce'],
      signature: headers['x-lark-signature'],
      encryptKey: secrets.feishu_encrypt_key,
      rawBody,
      now,
    });
  } catch (e) {
    if (e instanceof CallbackError) return json(401, { error: e.code });
    throw e;
  }

  const id = eventIdOf(event);

  let cmd;
  try {
    cmd = parseCardAction(event);
  } catch (e) {
    if (e instanceof CallbackError) return json(400, { error: e.code });
    throw e;
  }

  // A valid app signature proves transport authenticity, not human authorization. Require the
  // acting Feishu user to map to a trusted GitHub command author before posting.
  if (args.authorize) {
    const auth = args.authorize(event);
    if (!auth.allowed) return json(403, { error: `unauthorized:${auth.reason ?? 'denied'}` });
  }

  const result = await executeNormalizedAction({
    eventId: id,
    cmd,
    repo: secrets.github_repo,
    seen,
    postComment,
  });
  if (result.deduped) return json(200, { ok: true, deduped: true });

  return json(200, {
    ok: true,
    issue: cmd.issue,
    verb: cmd.verb,
    comment_url: result.comment.url,
    toast: { type: 'success', content: `已提交 /guardian ${cmd.verb}` },
  });
}
