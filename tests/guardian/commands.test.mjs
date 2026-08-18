// Tests for tools/guardian/commands.mjs — §11.2 comment-command protocol.
// Covers acceptance 23: wrong-state ignored, latest-only wins, idempotent (no double-consume),
// and <plan>/<opinion> tail treated as inert DATA (injection safety).

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommand, selectCommand, COMMANDS } from '../../tools/guardian/commands.mjs';
import { STATES } from '../../tools/guardian/state.mjs';

const TRUSTED = ['maintainer'];
function comment(id, body, author = 'maintainer') {
  return { id, body, author };
}

test('parseCommand matches a whole-line /guardian verb', () => {
  assert.deepEqual(parseCommand('/guardian approve'), { verb: 'approve', data: '' });
});

test('parseCommand captures the data tail verbatim (as DATA)', () => {
  const p = parseCommand('/guardian revise use early-return; rm -rf / is just text here');
  assert.equal(p.verb, 'revise');
  assert.equal(p.data, 'use early-return; rm -rf / is just text here');
});

test('parseCommand is case-insensitive on the verb', () => {
  assert.equal(parseCommand('/GUARDIAN Approve')?.verb, 'approve');
});

test('parseCommand finds the command on any line of a multi-line comment', () => {
  const body = 'Thanks for the diagnosis.\n\n/guardian approve\n\n-- reviewer';
  assert.equal(parseCommand(body)?.verb, 'approve');
});

test('parseCommand ignores non-command text and unknown verbs', () => {
  assert.equal(parseCommand('please approve this'), null);
  assert.equal(parseCommand('/guardian yolo'), null);
});

test('parseCommand ignores an inline (non-line-start) mention', () => {
  // must be a whole-line prefix; embedded mid-sentence should not fire
  assert.equal(parseCommand('as I said /guardian approve maybe'), null);
});

test('selectCommand: wrong-state command is ignored (acceptance 23)', () => {
  const comments = [comment(1, '/guardian rework foo')];
  // rework only valid in GATE_2_WAIT; in GATE_1_WAIT it must be ignored
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, null, TRUSTED), null);
});

test('selectCommand: latest eligible command wins', () => {
  const comments = [
    comment(1, '/guardian revise plan A'),
    comment(2, '/guardian approve'),
  ];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, TRUSTED);
  assert.equal(chosen.verb, 'approve');
  assert.equal(chosen.commentId, 2);
});

test('selectCommand: idempotent — a consumed comment (and older) is not re-fired (acceptance 23)', () => {
  const comments = [
    comment(1, '/guardian approve'),
    comment(2, 'ok thanks'),
  ];
  // comment 1 already consumed → nothing new to act on
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, 1, TRUSTED), null);
});

test('selectCommand: a NEW command after the consumed one is picked up', () => {
  const comments = [
    comment(1, '/guardian approve'), // consumed
    comment(2, '/guardian reject'), // newer, eligible
  ];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, 1, TRUSTED);
  assert.equal(chosen.verb, 'reject');
  assert.equal(chosen.commentId, 2);
});

test('selectCommand: data tail is never executed — returned as opaque string', () => {
  const comments = [comment(1, '/guardian revise `$(rm -rf /)` and <script>alert(1)</script>')];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, TRUSTED);
  assert.equal(chosen.verb, 'revise');
  // the malicious-looking text is preserved verbatim as data, not interpreted
  assert.match(chosen.data, /rm -rf|<script>/);
});

test('COMMANDS table state-guards every verb per §11.2', () => {
  assert.deepEqual(COMMANDS.approve.validIn, [STATES.GATE_1_WAIT]);
  assert.deepEqual(COMMANDS.rework.validIn, [STATES.GATE_2_WAIT]);
  assert.deepEqual(COMMANDS.retry.validIn, [STATES.HANDED_BACK]);
  assert.equal(COMMANDS.reject.target, STATES.HANDED_BACK);
});

// --- idempotency robustness (regression: consumed id absent / reordered / numeric) --------

test('idempotent even when the consumed comment is ABSENT from the list (deleted/paginated)', () => {
  // Consumed comment id=10 is no longer in the returned list. The remaining older comment
  // must NOT be re-fired just because the anchor position is gone.
  const comments = [comment(5, '/guardian approve')];
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, 10, TRUSTED), null);
});

test('numeric ids: a strictly-newer command after the consumed one fires; older does not', () => {
  const comments = [
    comment(5, '/guardian approve'), // older than consumed 5? equal → excluded
    comment(9, '/guardian reject'), // newer than 5 → eligible
  ];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, 5, TRUSTED);
  assert.equal(chosen.verb, 'reject');
  assert.equal(chosen.commentId, 9);
});

test('numeric ids: only-older-than-consumed commands yield null (no re-fire)', () => {
  const comments = [comment(3, '/guardian approve')];
  // consumed marker is 7; comment 3 is older → must not fire
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, 7, TRUSTED), null);
});

test('createdAt fallback orders when ids are non-numeric', () => {
  const older = { id: 'url-a', body: '/guardian approve', createdAt: '2026-08-18T10:00:00Z', author: 'maintainer' };
  const newer = { id: 'url-b', body: '/guardian reject', createdAt: '2026-08-18T11:00:00Z', author: 'maintainer' };
  // consumed = older (present in list), so only `newer` is eligible
  const chosen = selectCommand([older, newer], STATES.GATE_1_WAIT, 'url-a', TRUSTED);
  assert.equal(chosen.verb, 'reject');
});

// --- authorization boundary (security) ------------------------------------------------------

test('fail-closed: empty/absent trustedAuthors → no command is eligible', () => {
  const comments = [comment(1, '/guardian approve')];
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, null, []), null);
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT), null);
});

test('a command from an UNTRUSTED author is ignored (forged/arbitrary comment)', () => {
  const comments = [comment(1, '/guardian approve', 'attacker')];
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, null, TRUSTED), null);
});

test('author match is case-insensitive', () => {
  const comments = [comment(1, '/guardian approve', 'MaintaineR')];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, TRUSTED);
  assert.equal(chosen.verb, 'approve');
});

test('a trusted author overrides an earlier untrusted approve', () => {
  const comments = [
    comment(1, '/guardian approve', 'attacker'),
    comment(2, '/guardian reject', 'maintainer'),
  ];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, TRUSTED);
  assert.equal(chosen.verb, 'reject');
  assert.equal(chosen.commentId, 2);
});

test('followup parses required DATA and empty followup is ignored', () => {
  assert.deepEqual(parseCommand('/guardian followup 新的验收问题'), { verb: 'followup', data: '新的验收问题' });
  assert.equal(parseCommand('/guardian followup'), null);
});

// §5A decisions 1+5: a bot/App login can NEVER authorize, even if mistakenly whitelisted.
test('BOT DENYLIST: a bot login in botAuthors can never authorize even if also in trustedAuthors', () => {
  const comments = [comment(1, '/guardian approve', 'qa-app[bot]')];
  // Mistakenly whitelist the bot too — the denylist must still win (fail-safe toward no-bot-auth).
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, ['maintainer', 'qa-app[bot]'], {
    botAuthors: ['qa-app[bot]', 'fixer-app[bot]'],
  });
  assert.equal(chosen, null, 'bot /guardian approve must be ignored');
});

test('BOT DENYLIST: a human command still applies once alongside a denied bot comment', () => {
  const comments = [
    comment(1, '/guardian approve', 'qa-app[bot]'),
    comment(2, '/guardian approve', 'maintainer'),
  ];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, ['maintainer'], {
    botAuthors: ['qa-app[bot]'],
  });
  assert.equal(chosen?.verb, 'approve');
  assert.equal(chosen.commentId, 2, 'only the human comment is honored');
});

test('BOT DENYLIST: bot denylist is case-insensitive', () => {
  const comments = [comment(1, '/guardian approve', 'QA-App[Bot]')];
  const chosen = selectCommand(comments, STATES.GATE_1_WAIT, null, ['qa-app[bot]'], {
    botAuthors: ['qa-app[bot]'],
  });
  assert.equal(chosen, null);
});

test('empty whitelist still authorizes nothing regardless of botAuthors (fail-closed preserved)', () => {
  const comments = [comment(1, '/guardian approve', 'maintainer')];
  assert.equal(selectCommand(comments, STATES.GATE_1_WAIT, null, [], { botAuthors: [] }), null);
});
