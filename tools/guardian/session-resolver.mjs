// QA Guardian — session create-vs-reuse resolver (Oracle design, pure).
//
// Decides, for a given role, whether to reuse a persisted OpenCode session or create a new one,
// based on the issue's state.opencode metadata and a session-validation result. This is the
// session-continuity core: fixer/qa sessions are reused across Gate 1 approve/revise, QA FAIL,
// Gate 2 rework, and followup rounds; specialist sessions are per-round.
//
// Pure decision + injected getSession (async) so it is fully unit-testable without a server.

export const ROLE_AGENTS = Object.freeze({
  fixer: 'qa-guardian',
  qa: 'qa',
});

// A persisted session is reusable only if it exists and its agent matches the role's expected
// agent. A role/agent mismatch is treated as unusable (never prompt a fixer session as qa).
export async function resolveSessionForRole({ role, opencode, round = 1, getSession }) {
  const expectedAgent = ROLE_AGENTS[role];
  const isSpecialist = !ROLE_AGENTS[role];
  const record = isSpecialist
    ? opencode?.specialists?.[role]
    : opencode?.[role];

  // No persisted session -> create.
  if (!record?.session_id) return { action: 'create', agent: expectedAgent ?? role, contextLoss: false };

  // Specialist sessions are per-round: reuse only within the same round.
  if (isSpecialist && record.round !== round) {
    return { action: 'create', agent: role, contextLoss: false };
  }

  // If no validator is provided, trust the persisted record (fast path).
  if (!getSession) {
    return { action: 'reuse', sessionId: record.session_id, agent: expectedAgent ?? role };
  }

  const validation = await getSession(record.session_id);
  if (validation.kind === 'ok') {
    const actualAgent = validation.session?.agent;
    if (actualAgent && actualAgent !== (expectedAgent ?? role)) {
      // Role/agent mismatch: never prompt a session with a different agent.
      return { action: 'create', agent: expectedAgent ?? role, contextLoss: true };
    }
    return { action: 'reuse', sessionId: record.session_id, agent: expectedAgent ?? role };
  }
  if (validation.kind === 'unusable-session') {
    // 404 / missing -> recreate and record context loss.
    return { action: 'create', agent: expectedAgent ?? role, contextLoss: true };
  }
  // retryable (5xx / network) -> do not recreate yet; retry the same session.
  return { action: 'retry', sessionId: record.session_id, agent: expectedAgent ?? role };
}
