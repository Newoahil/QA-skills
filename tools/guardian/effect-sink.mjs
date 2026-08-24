// QA Guardian — source-neutral effect sink contract.

export function normalizeEffectDescriptor({ actor, kind, payload = Object.freeze({}) }) {
  return Object.freeze({
    actor,
    kind,
    payload: Object.freeze({ ...payload }),
  });
}

export function createEffectSink(emit) {
  return Object.freeze({
    emit(descriptor) {
      return emit(normalizeEffectDescriptor(descriptor));
    },
  });
}

export function effectResult(value) {
  return Object.freeze({ ok: true, value });
}
