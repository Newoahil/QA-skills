import assert from 'node:assert/strict';
import test from 'node:test';

test('native opentui solid runtime is importable from repo root with required exports', async () => {
  const runtime = await import('@opentui/solid');
  assert.equal(typeof runtime.createElement, 'function');
  assert.equal(typeof runtime.insert, 'function');
  assert.equal(typeof runtime.setProp, 'function');
});
