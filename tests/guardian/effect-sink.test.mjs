import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTORS, EFFECTS } from '../../tools/guardian/actor-routing.mjs';
import { createEffectSink, normalizeEffectDescriptor } from '../../tools/guardian/effect-sink.mjs';
import { createGitHubEffectSink } from '../../tools/guardian/github-effect-sink.mjs';

test('normalizeEffectDescriptor freezes the effect contract', () => {
  const descriptor = normalizeEffectDescriptor({
    actor: ACTORS.SUPERVISOR,
    kind: EFFECTS.FACT_COMMENT,
    ref: { source: 'github', taskId: '42', displayId: '#42' },
    idempotencyKey: 'comment:42:hello',
    payload: { issue: 42, text: 'hello' },
  });

  assert.deepEqual(descriptor, {
    actor: ACTORS.SUPERVISOR,
    kind: EFFECTS.FACT_COMMENT,
    ref: { source: 'github', taskId: '42', displayId: '#42' },
    idempotencyKey: 'comment:42:hello',
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

  const descriptor = { actor: ACTORS.SUPERVISOR, kind: EFFECTS.READ, ref: { source: 'github', taskId: '42', displayId: '#42' }, idempotencyKey: 'read:42' };
  assert.deepEqual(sink.emit(descriptor), { ok: true, value: 'done' });
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.deepEqual(sink.emit(descriptor), { ok: true, value: { duplicate: true, idempotencyKey: 'read:42' } });
  assert.equal(seen.length, 1);
});

test('createEffectSink retries effects whose first emission fails', () => {
  const calls = [];
  const sink = createEffectSink((descriptor) => {
    calls.push(descriptor.idempotencyKey);
    return calls.length === 1 ? { ok: false, error: 'transient' } : { ok: true, value: 'delivered' };
  });

  const descriptor = { actor: ACTORS.SUPERVISOR, kind: EFFECTS.READ, ref: { source: 'github', taskId: '42', displayId: '#42' }, idempotencyKey: 'read:42' };
  assert.deepEqual(sink.emit(descriptor), { ok: false, error: 'transient' });
  assert.deepEqual(sink.emit(descriptor), { ok: true, value: 'delivered' });
  assert.deepEqual(sink.emit(descriptor), { ok: true, value: { duplicate: true, idempotencyKey: 'read:42' } });
  assert.deepEqual(calls, ['read:42', 'read:42']);
});

test('createEffectSink rejects unauthorized actor/effect pairs before emitter IO', () => {
  const calls = [];
  const sink = createEffectSink((descriptor) => {
    calls.push(descriptor.kind);
    return { ok: true, value: 'delivered' };
  });

  assert.throws(() => sink.emit({ actor: ACTORS.BOT_EXECUTOR, kind: EFFECTS.FACT_WEBHOOK, ref: { source: 'github', taskId: '42', displayId: '#42' }, idempotencyKey: 'webhook:42' }), /may not perform/);
  assert.deepEqual(calls, []);
});

test('normalizeEffectDescriptor requires ref and idempotencyKey', () => {
  assert.throws(() => normalizeEffectDescriptor({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.READ, idempotencyKey: 'x' }), /ref/);
  assert.throws(() => normalizeEffectDescriptor({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.READ, ref: { source: 'github', taskId: '42', displayId: '#42' } }), /idempotencyKey/);
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

  const ref = { source: 'github', taskId: '42', displayId: '#42' };
  assert.throws(() => sink.emit({ actor: ACTORS.BOT_FACT_WRITER, kind: EFFECTS.LABEL, ref, idempotencyKey: 'label:42', payload: { issue: 42, record: {} } }), /may not perform/);
  assert.throws(() => sink.emit({ actor: ACTORS.BOT_FACT_WRITER, kind: EFFECTS.PR_CREATE, ref, idempotencyKey: 'pr:42', payload: { head: 'h', base: 'b', title: 't', body: 'b' } }), /may not perform/);
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

  const ref = { source: 'github', taskId: '42', displayId: '#42' };
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.FACT_COMMENT, ref, idempotencyKey: 'comment:42', payload: { issue: 42, text: 'note' } }), { ok: true, value: undefined });
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.FACT_WEBHOOK, ref, idempotencyKey: 'webhook:42', payload: { url: 'https://hook', body: { kind: 'notify' } } }), { ok: true, value: undefined });
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.LABEL, ref, idempotencyKey: 'label:42', payload: { issue: 42, record: { state: 'DONE' } } }), { ok: true, value: { add: [], remove: [], errors: [] } });
  assert.deepEqual(sink.emit({ actor: ACTORS.SUPERVISOR, kind: EFFECTS.PR_CREATE, ref, idempotencyKey: 'pr:42', payload: { head: 'fix/issue-42', base: 'dev', title: 't', body: 'b' } }), { ok: true, value: 'https://example.test/pr/1' });
  assert.deepEqual(calls, [
    ['comment', 42, 'note'],
    ['webhook', 'https://hook', 'notify'],
    ['label', 'D:/repo', 42, 'DONE'],
    ['pr', 'D:/repo', 'fix/issue-42', 'dev'],
  ]);
});

test('GitHub sink preserves failed dispatch results so retries are not deduped', () => {
  const calls = [];
  const sink = createGitHubEffectSink({
    repoDir: 'D:/repo',
    io: {
      ghComment: () => {
        calls.push('comment');
        return calls.length === 1 ? { ok: false, error: 'transient' } : { ok: true, value: 'posted' };
      },
    },
  });

  const descriptor = { actor: ACTORS.SUPERVISOR, kind: EFFECTS.FACT_COMMENT, ref: { source: 'github', taskId: '42', displayId: '#42' }, idempotencyKey: 'comment:42', payload: { issue: 42, text: 'note' } };
  assert.deepEqual(sink.emit(descriptor), { ok: false, error: 'transient' });
  assert.deepEqual(sink.emit(descriptor), { ok: true, value: 'posted' });
  assert.deepEqual(sink.emit(descriptor), { ok: true, value: { duplicate: true, idempotencyKey: 'comment:42' } });
  assert.deepEqual(calls, ['comment', 'comment']);
});
