import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTORS, EFFECTS } from '../../tools/guardian/actor-routing.mjs';
import { createEffectSink, normalizeEffectDescriptor } from '../../tools/guardian/effect-sink.mjs';
import { createGitHubEffectSink } from '../../tools/guardian/github-effect-sink.mjs';

test('normalizeEffectDescriptor freezes the effect contract', () => {
  const descriptor = normalizeEffectDescriptor({
    actor: ACTORS.SUPERVISOR,
    kind: EFFECTS.FACT_COMMENT,
    payload: { issue: 42, text: 'hello' },
  });

  assert.deepEqual(descriptor, {
    actor: ACTORS.SUPERVISOR,
    kind: EFFECTS.FACT_COMMENT,
    payload: { issue: 42, text: 'hello' },
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.payload), true);
});

test('createEffectSink delegates normalized descriptors', () => {
  const seen = [];
  const sink = createEffectSink((descriptor) => {
    seen.push(descriptor);
    return { ok: true, value: 'done' };
  });

  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.READ }), { ok: true, value: 'done' });
  assert.equal(Object.isFrozen(seen[0]), true);
});

test('GitHub sink rejects unauthorized effects before IO', () => {
  const calls = [];
  const sink = createGitHubEffectSink({
    repoDir: 'D:/repo',
    io: {
      ghComment: () => calls.push('comment'),
      curlPost: () => calls.push('webhook'),
      projectLabels: () => calls.push('label'),
      createPullRequest: () => calls.push('pr'),
    },
  });

  assert.throws(() => sink.emit({ actor: ACTORS.BOT_FACT_WRITER, kind: EFFECTS.LABEL, payload: { issue: 42, record: {} } }), /may not perform/);
  assert.throws(() => sink.emit({ actor: ACTORS.BOT_FACT_WRITER, kind: EFFECTS.PR_CREATE, payload: { head: 'h', base: 'b', title: 't', body: 'b' } }), /may not perform/);
  assert.deepEqual(calls, []);
});

test('GitHub sink dispatches allowed effect payloads', () => {
  const calls = [];
  const sink = createGitHubEffectSink({
    repoDir: 'D:/repo',
    io: {
      ghComment: (issue, text) => { calls.push(['comment', issue, text]); },
      curlPost: (url, body) => { calls.push(['webhook', url, body.kind]); },
      projectLabels: (repoDir, issue, record) => {
        calls.push(['label', repoDir, issue, record.state]);
        return { add: [], remove: [], errors: [] };
      },
      createPullRequest: (payload) => {
        calls.push(['pr', payload.repoDir, payload.head, payload.base]);
        return 'https://example.test/pr/1';
      },
    },
  });

  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.FACT_COMMENT, payload: { issue: 42, text: 'note' } }), { ok: true, value: undefined });
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.FACT_WEBHOOK, payload: { url: 'https://hook', body: { kind: 'notify' } } }), { ok: true, value: undefined });
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.LABEL, payload: { issue: 42, record: { state: 'DONE' } } }), { ok: true, value: { add: [], remove: [], errors: [] } });
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.PR_CREATE, payload: { head: 'fix/issue-42', base: 'dev', title: 't', body: 'b' } }), { ok: true, value: 'https://example.test/pr/1' });
  assert.deepEqual(calls, [
    ['comment', 42, 'note'],
    ['webhook', 'https://hook', 'notify'],
    ['label', 'D:/repo', 42, 'DONE'],
    ['pr', 'D:/repo', 'fix/issue-42', 'dev'],
  ]);
});
