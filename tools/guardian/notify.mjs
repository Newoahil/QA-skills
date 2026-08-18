// QA Guardian — dual-channel notification (§11B.5)
//
// At every gate stop / STALLED / hand-back, before the process exits, push through TWO
// channels so a human learns about it without watching GitHub:
//   1. issue/PR comment (gh) — team-visible, always sent.
//   2. webhook (curl POST) — to the ONE fixed notify_webhook URL in config; degrades to
//      comment-only when absent.
//
// This module is the deterministic core: given the current record, the target state, and
// the config, decide (a) whether a webhook push should happen at all (idempotent per
// last_notified_state), and (b) the exact, minimal body (issue# + stage + link only — never
// code/secrets). The actual `gh`/`curl` execution is injected so it is fully unit-testable.

// States that warrant a proactive notification (§11B.5): gate stops, stalled recovery,
// and hand-backs. Progress-only active states do not notify.
export const NOTIFY_STATES = Object.freeze([
  'GATE_1_WAIT',
  'GATE_2_WAIT',
  'STALLED',
  'HANDED_BACK',
]);

// Build the minimal, safe notification payload. NO code, NO secrets — only issue number,
// stage, an optional link (issue/PR URL), and an optional short reason keyword.
export function buildNotification({ issue, state, link = null, reason = null }) {
  const payload = {
    issue: Number(issue),
    stage: state,
    link: link ?? null,
  };
  if (reason) payload.reason = reason;
  payload.text = `QA Guardian: issue #${issue} → ${state}` +
    (reason ? ` (${reason})` : '') +
    (link ? ` ${link}` : '');
  return payload;
}

// Guard against accidentally leaking anything beyond the allowed keys.
const ALLOWED_KEYS = Object.freeze(['issue', 'stage', 'link', 'reason', 'text']);
export function assertSafeBody(payload) {
  const extra = Object.keys(payload).filter((k) => !ALLOWED_KEYS.includes(k));
  if (extra.length > 0) {
    throw new Error(`notification body has disallowed keys: ${extra.join(', ')}`);
  }
  return true;
}

/**
 * Decide + perform notification. Pure decision + injected side-effects.
 *
 * @param {object} record   state record (uses last_notified_state for idempotency)
 * @param {object} args     { targetState, link?, reason? }
 * @param {object} config   parsed .qa/guardian/config.json ({ notify_webhook? }) or {}
 * @param {object} io       { comment(payload):void, webhook(url,payload):void }
 * @returns {object} { commented, webhookPushed, skipped, reasonSkipped?, payload }
 */
export function notify(record, args, config, io) {
  const { targetState, link = null, reason = null } = args;

  // Idempotent: same issue + same state already notified → do not re-push (§11B.5).
  if (record.last_notified_state === targetState) {
    return {
      commented: false,
      webhookPushed: false,
      skipped: true,
      reasonSkipped: 'already-notified-for-state',
      payload: null,
    };
  }

  const payload = buildNotification({
    issue: record.issue,
    state: targetState,
    link,
    reason,
  });
  assertSafeBody(payload);

  // Channel 1: issue/PR comment — always.
  io.comment(payload);

  // Channel 2: webhook — only when configured; else degrade to comment-only, never block.
  let webhookPushed = false;
  const url = config?.notify_webhook;
  if (typeof url === 'string' && url.length > 0) {
    io.webhook(url, payload);
    webhookPushed = true;
  }

  // Caller persists last_notified_state = targetState after this returns.
  return { commented: true, webhookPushed, skipped: false, payload };
}
