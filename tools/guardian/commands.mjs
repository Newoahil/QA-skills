// QA Guardian — comment-command protocol parser (§11.2)
//
// The gate "stop → resume" mechanism. A one-shot process cannot wait; resume is driven by
// convention commands humans leave in issue/PR comments, consumed by the next poll. This
// module is PURE parsing + selection: given the comment list and the current state, decide
// which command (if any) applies. Idempotency (last_consumed_comment_id) is enforced here.
//
// Injection safety: only the "/guardian <verb>" prefix is a command. The <plan>/<opinion>
// tail is DATA — returned as an opaque string, never interpreted (§11.2, §12).

import { STATES } from './state.mjs';

// verb → { validIn: [states], target: state } (§11.2 table).
export const COMMANDS = Object.freeze({
  approve: { validIn: [STATES.GATE_1_WAIT], target: STATES.FIXING },
  revise: { validIn: [STATES.GATE_1_WAIT], target: STATES.FIXING },
  reject: { validIn: [STATES.GATE_1_WAIT], target: STATES.HANDED_BACK },
  rework: { validIn: [STATES.GATE_2_WAIT], target: STATES.FIXING },
  retry: { validIn: [STATES.HANDED_BACK], target: STATES.INVESTIGATING },
});

const VERBS = Object.keys(COMMANDS);
// Whole-line prefix match: start-of-line, optional leading whitespace, "/guardian <verb>",
// then either end-of-line or a whitespace-separated data tail. Case-insensitive verb.
const LINE_RE = new RegExp(String.raw`^\s*/guardian\s+(${VERBS.join('|')})\b[ \t]*(.*)$`, 'i');

// Parse a single comment body into the FIRST valid guardian command line it contains, or
// null. The data tail is trimmed but otherwise preserved verbatim (never executed).
export function parseCommand(body) {
  if (typeof body !== 'string') return null;
  for (const line of body.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (m) {
      return { verb: m[1].toLowerCase(), data: (m[2] ?? '').trim() };
    }
  }
  return null;
}

// A comment record is expected as { id, body, createdAt, author } (mirrors `gh issue view
// --json comments`, where author is the login string). Order is preserved as given; callers
// pass them oldest→newest.
//
// selectCommand picks the command to act on THIS poll:
//   - only commands from a TRUSTED author are eligible (authorization boundary, security);
//   - only commands valid in `currentState` are eligible (wrong-state commands ignored, §11.2);
//   - only the LATEST eligible command counts (later humans override earlier ones);
//   - a comment already consumed — the last-consumed one, and anything not strictly newer —
//     is never re-fired (idempotent, §11.2).
//
// AUTHORIZATION (fail-closed): `trustedAuthors` is the whitelist of GitHub logins allowed to
// drive `/guardian` commands. A command from any other author — including a forged/replayed
// Feishu callback comment or an arbitrary repo commenter — is IGNORED. If `trustedAuthors` is
// empty or not provided, NO command is eligible (fail-closed): an unconfigured whitelist must
// never let an untrusted comment approve a HIGH-risk plan. Author match is case-insensitive.
//
// Idempotency must survive a comment list where the consumed comment is NOT present at a
// known position (pagination, reorder, or a deleted comment). We therefore do NOT rely on
// list index alone: a comment is eligible only when it is strictly NEWER than the consumed
// marker. "Newer" is decided by isNewerComment() below, which prefers monotonic numeric ids
// (GitHub comment ids), then ISO createdAt, and finally list position as a last resort.
//
// Returns { verb, data, commentId, target } or null.
export function selectCommand(comments, currentState, lastConsumedCommentId = null, trustedAuthors = []) {
  if (!Array.isArray(comments)) return null;

  // Fail-closed: an empty/absent whitelist means no comment is authorized to command.
  const trusted = new Set(
    (Array.isArray(trustedAuthors) ? trustedAuthors : [])
      .filter((a) => typeof a === 'string' && a.length > 0)
      .map((a) => a.toLowerCase()),
  );
  if (trusted.size === 0) return null;

  const consumedIdx =
    lastConsumedCommentId == null
      ? -1
      : comments.findIndex((c) => String(c.id) === String(lastConsumedCommentId));

  let chosen = null;
  for (let i = 0; i < comments.length; i += 1) {
    const c = comments[i];
    // Authorization: only trusted authors may command (case-insensitive login match).
    const author = typeof c.author === 'string' ? c.author.toLowerCase() : '';
    if (!trusted.has(author)) continue;
    // Never re-consume the exact comment we already acted on.
    if (lastConsumedCommentId != null && String(c.id) === String(lastConsumedCommentId)) continue;
    // Skip anything not strictly newer than the consumed marker (position-independent).
    if (lastConsumedCommentId != null && !isNewerComment(c, i, lastConsumedCommentId, consumedIdx, comments)) {
      continue;
    }
    const parsed = parseCommand(c.body);
    if (!parsed) continue;
    const spec = COMMANDS[parsed.verb];
    if (!spec.validIn.includes(currentState)) continue; // wrong state → ignore
    // latest wins: keep overwriting so the final eligible command is chosen
    chosen = {
      verb: parsed.verb,
      data: parsed.data,
      commentId: c.id,
      target: spec.target,
    };
  }
  return chosen;
}

// Decide whether candidate comment `c` (at list index `i`) is strictly newer than the
// consumed marker. Robust to the consumed comment being absent from the list.
function isNewerComment(c, i, consumedId, consumedIdx, comments) {
  // 1. Numeric ids (GitHub comment ids are monotonically increasing) → compare directly.
  const cid = Number(c.id);
  const consumedNum = Number(consumedId);
  if (Number.isFinite(cid) && Number.isFinite(consumedNum)) {
    return cid > consumedNum;
  }
  // 2. Fall back to ISO createdAt ordering when available on both sides.
  const consumed = comments.find((x) => String(x.id) === String(consumedId));
  if (c.createdAt && consumed?.createdAt) {
    return Date.parse(c.createdAt) > Date.parse(consumed.createdAt);
  }
  // 3. Last resort: list position, but only when the consumed comment WAS found in the list.
  //    If it was not found (consumedIdx === -1), we cannot prove `c` is older, so — to avoid
  //    silently re-firing a command — treat only comments after the last list index we can
  //    trust as newer. With no positional anchor, be conservative: NOT newer.
  if (consumedIdx >= 0) return i > consumedIdx;
  return false;
}
