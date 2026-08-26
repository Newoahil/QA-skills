// QA Guardian — scheduler config validation and repo resolution (pure, no I/O side effects).
//
// Extracted from scheduler.mjs (P0 refactor, batch 1). These are the stateless
// config/validation and repo-path helpers with no lock, state, or gate coupling.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_LEASE_MS } from './poll.mjs';

export const DEFAULT_INTERVAL_MS = 10 * 1000;
// Fix↔QA repair loop default bound. QA FAIL resumes the same fixer session with the previous
// report until QA passes, up to this cap; beyond it the issue is handed back with a human-review
// recommendation. Configurable per project via config.max_fix_rounds.
export const MAX_FIX_ROUNDS_DEFAULT = 5;

function normalizePositiveMs(value, fallback) {
  const candidate = value ?? fallback;
  const normalized = Number(candidate);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

export function validateSchedulerConfig(config = {}) {
  const pollIntervalMs = normalizePositiveMs(config.poll_interval_ms, DEFAULT_INTERVAL_MS);
  if (pollIntervalMs === null) {
    throw new Error('scheduler poll_interval_ms must be a finite positive number');
  }

  const leaseMs = normalizePositiveMs(config.lease_ms, DEFAULT_LEASE_MS);
  if (leaseMs === null) {
    throw new Error('scheduler lease_ms must be a finite positive number');
  }

  if (leaseMs < pollIntervalMs * 2) {
    throw new Error('scheduler lease_ms must be at least 2x poll_interval_ms');
  }

  const maxFixRounds = config.max_fix_rounds ?? MAX_FIX_ROUNDS_DEFAULT;
  if (!Number.isInteger(maxFixRounds) || maxFixRounds < 1) {
    throw new Error('scheduler max_fix_rounds must be a positive integer');
  }

  return Object.freeze({
    ...config,
    poll_interval_ms: pollIntervalMs,
    lease_ms: leaseMs,
    max_fix_rounds: maxFixRounds,
  });
}

export function resolveRepoDir(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (typeof env.QA_GUARDIAN_REPO === 'string' && env.QA_GUARDIAN_REPO.length > 0) {
    return env.QA_GUARDIAN_REPO;
  }
  return process.cwd();
}

export function assertTargetRepoConfigured(repoDir) {
  const configPath = path.join(repoDir, '.qa', 'guardian', 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`目标项目未配置 Guardian: ${configPath}；请使用 --repo <项目目录> 或设置 QA_GUARDIAN_REPO`);
  }
  return repoDir;
}
