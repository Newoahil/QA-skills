// QA Guardian — session create-vs-reuse resolver (Oracle design, pure).
//
// Decides, for a given role, whether to reuse a persisted OpenCode session or create a new one,
// based on the issue's state.opencode metadata and a session-validation result. This is the
// session-continuity core: fixer/qa sessions are reused across Gate 1 approve/revise, QA FAIL,
// Gate 2 rework, and followup rounds; specialist sessions are per-round.
//
import path from 'node:path';
import { isPermissionCompatible } from './opencode-client.mjs';

// Pure decision + injected getSession (async) so it is fully unit-testable without a server.

export const ROLE_AGENTS = Object.freeze({
  fixer: 'qa-guardian',
  qa: 'qa',
});

// A persisted session is reusable only if it exists and its agent matches the role's expected
// agent. A role/agent mismatch is treated as unusable (never prompt a fixer session as qa).
export async function resolveSessionForRole({ role, opencode, repoDir, issue, round = 1, expectedPermissionPolicyVersion, getSession }) {
  const expectedAgent = ROLE_AGENTS[role];
  const isSpecialist = !ROLE_AGENTS[role];
  const agent = expectedAgent ?? role;
  const record = isSpecialist
    ? opencode?.specialists?.[role]
    : opencode?.[role];

  // No persisted session -> create.
  if (!record?.session_id) return { action: 'create', agent, contextLoss: false };

  // Specialist sessions are per-round: reuse only within the same round.
  if (isSpecialist && (record.round ?? record.created_round) !== round) {
    return { action: 'create', agent, contextLoss: false };
  }

  const requested = bindingFor({ repoDir, issue, role });
  const persisted = persistedBinding(record);
  if (persisted && !sameBinding(persisted, requested)) return { action: 'create', agent, contextLoss: true };
  if (expectedPermissionPolicyVersion !== undefined && record.permission_policy_version !== undefined && record.permission_policy_version !== expectedPermissionPolicyVersion) {
    return { action: 'create', agent, contextLoss: true };
  }
  if (!requested && !getSession) return { action: 'create', agent, contextLoss: true };

  // If no validator is provided, trust the persisted record (fast path).
  if (!getSession) {
    if (!persisted) return { action: 'create', agent, contextLoss: true };
    return { action: 'reuse', sessionId: record.session_id, agent, binding: persisted, adopted: false };
  }

  const validation = await getSession(record.session_id);
  if (validation.kind === 'ok') {
    const actualAgent = validation.session?.agent;
    if (actualAgent !== agent) {
      // Role/agent mismatch: never prompt a session with a different agent.
      return { action: 'create', agent, contextLoss: true };
    }
    const liveDirectory = sessionDirectory(validation.session);
    if ((!persisted && !liveDirectory) || (liveDirectory && requested?.repo_dir && !samePath(liveDirectory, requested.repo_dir))) {
      return { action: 'create', agent, contextLoss: true };
    }
    if (expectedPermissionPolicyVersion !== undefined && record.permission_policy_version === undefined && !isPermissionCompatible(role, validation.session.permission)) {
      return { action: 'create', agent, contextLoss: true };
    }
    return {
      action: 'reuse',
      sessionId: record.session_id,
      agent,
      binding: persisted ?? requested,
      adopted: !persisted || (expectedPermissionPolicyVersion !== undefined && record.permission_policy_version === undefined),
      ...(expectedPermissionPolicyVersion !== undefined ? { permissionPolicyVersion: expectedPermissionPolicyVersion } : {}),
    };
  }
  if (validation.kind === 'unusable-session') {
    // 404 / missing -> recreate and record context loss.
    return { action: 'create', agent, contextLoss: true };
  }
  // retryable (5xx / network) -> do not recreate yet; retry the same session.
  return { action: 'retry', sessionId: record.session_id, agent };
}

export function canonicalRepoDir(repoDir) {
  if (typeof repoDir !== 'string' || repoDir.trim() === '') return null;
  const source = repoDir.trim();
  const windows = /^[A-Za-z]:[\\/]/.test(source) || source.startsWith('\\\\');
  if (!windows && source.startsWith('/')) return path.posix.normalize(source).replace(/\/$/, '');
  const resolved = windows ? path.win32.resolve(source) : path.resolve(source);
  return resolved.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

function bindingFor({ repoDir, issue, role }) {
  const repo_dir = canonicalRepoDir(repoDir);
  const number = Number(issue);
  if (!repo_dir || !Number.isFinite(number) || typeof role !== 'string' || role.length === 0) return null;
  return { repo_dir, issue: number, role };
}

function persistedBinding(record) {
  if (!record?.repo_dir || record.issue === undefined || !record.role) return null;
  return bindingFor({ repoDir: record.repo_dir, issue: record.issue, role: record.role });
}

function sameBinding(left, right) {
  return Boolean(left && right && left.repo_dir === right.repo_dir && left.issue === right.issue && left.role === right.role);
}

function sessionDirectory(session) {
  return session?.directory ?? session?.dir ?? session?.cwd ?? session?.project?.directory ?? null;
}

function samePath(left, right) {
  return canonicalRepoDir(left) === canonicalRepoDir(right);
}
