// Tests for tools/guardian/secrets.mjs — env-first resolution + required-key enforcement.

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSecrets, requireSecrets, SECRET_ENV } from '../../tools/guardian/secrets.mjs';

test('env values are resolved by canonical key', () => {
  const env = {
    FEISHU_APP_ID: 'cli_x',
    GITHUB_TOKEN: 'ghp_x',
    GITHUB_REPO: 'o/r',
  };
  const s = loadSecrets({ env, repoDir: 'D:/does-not-exist-xyz' });
  assert.equal(s.feishu_app_id, 'cli_x');
  assert.equal(s.github_token, 'ghp_x');
  assert.equal(s.github_repo, 'o/r');
  assert.equal(s.feishu_app_secret, undefined);
});

test('empty env values are treated as absent', () => {
  const s = loadSecrets({ env: { GITHUB_TOKEN: '' }, repoDir: 'D:/does-not-exist-xyz' });
  assert.equal(s.github_token, undefined);
});

test('requireSecrets throws naming the missing ENV vars, without echoing values', () => {
  const s = loadSecrets({ env: { GITHUB_TOKEN: 'x' }, repoDir: 'D:/does-not-exist-xyz' });
  try {
    requireSecrets(s, ['github_token', 'feishu_app_secret', 'feishu_encrypt_key']);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, new RegExp(SECRET_ENV.feishu_app_secret));
    assert.match(e.message, new RegExp(SECRET_ENV.feishu_encrypt_key));
    assert.doesNotMatch(e.message, /github_token|GITHUB_TOKEN.*x/);
  }
});

test('requireSecrets passes when all present', () => {
  const s = loadSecrets({ env: { GITHUB_TOKEN: 'x', GITHUB_REPO: 'o/r' }, repoDir: 'D:/does-not-exist-xyz' });
  assert.equal(requireSecrets(s, ['github_token', 'github_repo']), s);
});
