import { spawnSync } from 'node:child_process';
import path from 'node:path';

function bool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  return Boolean(value);
}

function sybermemCommand(env) {
  if (env.QA_GUARDIAN_SYBERMEM_CLI) return env.QA_GUARDIAN_SYBERMEM_CLI;
  if (env.USERPROFILE) return path.join(env.USERPROFILE, '.claude', 'sybermem', 'cli', 'sybermem.cmd');
  if (env.HOME) return path.join(env.HOME, '.claude', 'sybermem', 'cli', 'sybermem');
  return 'sybermem';
}

function runSybermem({ args, repoDir, env, spawn = spawnSync }) {
  const command = sybermemCommand(env);
  const result = spawn(command, args, { cwd: repoDir, env, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.status !== 0) return { ok: false, reason: result.stderr?.trim() || result.error?.message || 'sybermem command failed' };
  return { ok: true, stdout: result.stdout ?? '' };
}

function parseRecall(stdout, maxItems) {
  const text = String(stdout ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
    return rows.slice(0, maxItems).map((item) => ({
      id: String(item.id ?? item.record_id ?? item.source_id ?? 'unknown'),
      title: String(item.title ?? item.name ?? item.document ?? item.id ?? 'SyberMem record'),
      summary: String(item.summary ?? item.content ?? item.text ?? '').slice(0, 1200),
    }));
  } catch {
    return text.split(/\r?\n/).filter(Boolean).slice(0, maxItems).map((line, index) => ({ id: `line-${index + 1}`, title: 'SyberMem recall', summary: line.slice(0, 1200) }));
  }
}

export function memoryConfig(config = {}) {
  const memory = config.memory ?? {};
  const provider = memory.provider ?? 'none';
  return {
    enabled: provider === 'sybermem' && memory.enabled !== false,
    provider,
    recallBeforeInvestigation: bool(memory.recall_before_investigation, true),
    recallBeforePlan: bool(memory.recall_before_plan, true),
    recordAfterGate2: bool(memory.record_after_gate2, false),
    recordFailures: bool(memory.record_failures, false),
    maxRecallItems: Number.isInteger(memory.max_recall_items) ? memory.max_recall_items : 5,
  };
}

export function recallEngineeringMemory({ config = {}, repoDir, issue, issueData, env = process.env, spawn = spawnSync }) {
  const cfg = memoryConfig(config);
  if (!cfg.enabled || !cfg.recallBeforeInvestigation) return { provider: cfg.provider, items: [], status: 'disabled' };
  const query = [`issue #${issue}`, issueData?.title, issueData?.body].filter(Boolean).join('\n').slice(0, 2000);
  const result = runSybermem({ args: ['search', '--format', 'json', query], repoDir, env, spawn });
  if (!result.ok) return { provider: 'sybermem', items: [], status: 'unavailable', reason: result.reason };
  return { provider: 'sybermem', items: parseRecall(result.stdout, cfg.maxRecallItems), status: 'ok' };
}

export function recordEngineeringMemory({ config = {}, repoDir, issue, summary, env = process.env, spawn = spawnSync }) {
  const cfg = memoryConfig(config);
  if (!cfg.enabled || !cfg.recordAfterGate2) return { provider: cfg.provider, status: 'disabled' };
  const text = String(summary ?? '').trim();
  if (!text) return { provider: 'sybermem', status: 'skipped', reason: 'empty-summary' };
  const result = runSybermem({ args: ['record', '--type', 'change', '--title', `QA Guardian issue #${issue}`, '--body', text], repoDir, env, spawn });
  if (!result.ok) return { provider: 'sybermem', status: 'unavailable', reason: result.reason };
  return { provider: 'sybermem', status: 'ok' };
}
