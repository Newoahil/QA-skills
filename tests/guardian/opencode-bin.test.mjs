// Tests for tools/guardian/opencode-bin.mjs — cross-platform opencode CLI resolution.
// Regression for the Windows bug: spawn('opencode', {shell:false}) is ENOENT, and spawning the
// .cmd shim without a shell EINVALs on hardened Node. On win32 we resolve the real opencode.exe.

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOpencodeBin, windowsExeCandidates } from '../../tools/guardian/opencode-bin.mjs';

test('win32 resolves to the real opencode.exe when present', () => {
  const env = { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };
  const exe = windowsExeCandidates(env)[0];
  const bin = resolveOpencodeBin(env, 'win32', (p) => p === exe);
  assert.equal(bin, exe);
  assert.match(bin, /opencode-ai[\\/]bin[\\/]opencode\.exe$/);
});

test('win32 falls back to opencode.cmd when no exe found', () => {
  assert.equal(resolveOpencodeBin({ APPDATA: 'C:\\a' }, 'win32', () => false), 'opencode.cmd');
});

test('posix resolves to bare opencode', () => {
  assert.equal(resolveOpencodeBin({}, 'linux', () => false), 'opencode');
  assert.equal(resolveOpencodeBin({}, 'darwin', () => false), 'opencode');
});

test('env override wins on any platform', () => {
  assert.equal(resolveOpencodeBin({ QA_GUARDIAN_OPENCODE_BIN: '/opt/oc/opencode' }, 'win32', () => true), '/opt/oc/opencode');
  assert.equal(resolveOpencodeBin({ QA_GUARDIAN_OPENCODE_BIN: 'my-oc' }, 'linux'), 'my-oc');
});

test('empty override falls back to platform default', () => {
  assert.equal(resolveOpencodeBin({ QA_GUARDIAN_OPENCODE_BIN: '', APPDATA: 'C:\\a' }, 'win32', () => false), 'opencode.cmd');
});

test('windowsExeCandidates includes APPDATA and npm_config_prefix paths', () => {
  const c = windowsExeCandidates({ APPDATA: 'C:\\ad', npm_config_prefix: 'C:\\np' });
  assert.equal(c.length, 2);
  assert.match(c[0], /ad[\\/]npm[\\/]node_modules[\\/]opencode-ai/);
  assert.match(c[1], /np[\\/]node_modules[\\/]opencode-ai/);
});
