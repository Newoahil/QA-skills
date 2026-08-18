// QA Guardian — secret loader (env-first, gitignored file fallback)
//
// Secrets NEVER live in git. Resolution order per key:
//   1. process.env[ENV_NAME]           (production: Dokploy env vars)
//   2. <repo>/.qa/guardian/secrets.json (local dev, gitignored)
//   3. tools/guardian/secrets.json      (local dev, gitignored)
//
// The loader returns only the requested keys and never logs values. Callers decide which
// secrets are required and fail fast (loud, no value echoed) when one is missing.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile } from './runtime-io.mjs';

// Canonical secret keys → their env var names. One name = one concept.
export const SECRET_ENV = Object.freeze({
  feishu_app_id: 'FEISHU_APP_ID',
  feishu_app_secret: 'FEISHU_APP_SECRET',
  feishu_verification_token: 'FEISHU_VERIFICATION_TOKEN',
  feishu_encrypt_key: 'FEISHU_ENCRYPT_KEY',
  github_token: 'GITHUB_TOKEN',
  github_repo: 'GITHUB_REPO', // owner/name, e.g. LambdaTheory/tuantuanrent
});

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJsonFileSecrets(repoDir) {
  const candidates = [
    repoDir ? path.join(repoDir, '.qa', 'guardian', 'secrets.json') : null,
    path.join(HERE, 'secrets.json'),
  ].filter((p) => typeof p === 'string');

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = readJsonFile(file);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return {};
}

/**
 * Resolve secrets. env wins over file. Returns a plain object with only known keys present.
 * @param {object} opts { repoDir?: string, env?: Record<string,string|undefined> }
 * @returns {Record<string,string>} resolved secrets (missing keys omitted)
 */
export function loadSecrets(opts = {}) {
  const env = opts.env ?? process.env;
  const allowFileFallback = opts.allowFileFallback === true || String(env.NODE_ENV ?? '').toLowerCase() !== 'production';
  const fileSecrets = opts.ignoreFiles || !allowFileFallback ? {} : readJsonFileSecrets(opts.repoDir);

  const out = {};
  for (const [key, envName] of Object.entries(SECRET_ENV)) {
    const fromEnv = env[envName];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      out[key] = fromEnv;
      continue;
    }
    const fromFile = fileSecrets[key];
    if (typeof fromFile === 'string' && fromFile.length > 0) {
      out[key] = fromFile;
    }
  }
  return out;
}

/**
 * Require specific secret keys; throw a loud error (no value echoed) if any is missing.
 * @param {Record<string,string>} secrets result of loadSecrets
 * @param {readonly string[]} keys required canonical keys
 * @returns {Record<string,string>} the same secrets (narrowed by contract)
 */
export function requireSecrets(secrets, keys) {
  const missing = keys.filter((k) => !secrets[k]);
  if (missing.length > 0) {
    const names = missing.map((k) => SECRET_ENV[k] ?? k).join(', ');
    throw new Error(`missing required secret(s): ${names} (set env var or .qa/guardian/secrets.json)`);
  }
  return secrets;
}
