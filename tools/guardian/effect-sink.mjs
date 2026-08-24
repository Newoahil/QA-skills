// QA Guardian — source-neutral effect sink contract.

import { makeTaskRef, taskRefKey } from './task-ref.mjs';
import { assertActorMayPerform } from './actor-routing.mjs';

export function normalizeEffectDescriptor({ actor, kind, ref, idempotencyKey, payload = Object.freeze({}) }) {
  const key = String(idempotencyKey ?? '').trim();
  if (!key) throw new Error('EffectDescriptor idempotencyKey must be non-empty');
  if (!ref) throw new Error('EffectDescriptor ref must be provided');
  return Object.freeze({
    actor,
    kind,
    ref: makeTaskRef(ref),
    idempotencyKey: key,
    payload: Object.freeze({ ...payload }),
  });
}

export function createEffectSink(emit) {
  const emitted = new Set();
  return Object.freeze({
    emit(descriptor) {
      const normalized = normalizeEffectDescriptor(descriptor);
      assertActorMayPerform(normalized.actor, normalized.kind);
      const dedupeKey = `${taskRefKey(normalized.ref)}:${normalized.kind}:${normalized.idempotencyKey}`;
      if (emitted.has(dedupeKey)) return effectResult({ duplicate: true, idempotencyKey: normalized.idempotencyKey });
      const result = emit(normalized);
      if (result?.ok !== false) emitted.add(dedupeKey);
      return result;
    },
  });
}

export function effectResult(value) {
  return Object.freeze({ ok: true, value });
}
