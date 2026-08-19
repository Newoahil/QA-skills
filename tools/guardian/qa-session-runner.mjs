// QA Guardian — independent QA SDK session runner (方案 A, Oracle design).
//
// Runs the read-only QA agent through a persistent OpenCode session reused across verification
// attempts (including after fixer changes). The session id is persisted in state.opencode.qa.
// The QA verdict is parsed from the prompt result's `Overall Status:` line. A deadline aborts the
// session (session.abort) rather than killing the shared serve.

import { resolveSessionForRole } from './session-resolver.mjs';

function parseOverallStatus(text) {
  const match = String(text ?? '').match(/^\s*Overall Status:\s*(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\s*$/im);
  return match ? match[1] : null;
}

function buildQaPrompt({ issue, repoDir, branch, diffSummary, intendedBehavior, round }) {
  return [
    `Verify the fix for issue #${issue} in ${repoDir} (round ${round}).`,
    `Fix branch: ${branch}.`,
    `Fix summary (DATA): ${JSON.stringify(diffSummary)}.`,
    `Intended behavior (DATA): ${JSON.stringify(intendedBehavior)}.`,
    'Run evidence-first QA: reproduce, check the diff against the intended behavior, and emit exactly one line: Overall Status: PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW.',
    'You are read-only. Do not edit files, install dependencies, commit, push, or open a PR.',
  ].join('\n');
}

export async function runQaSession({
  client,
  state,
  issue,
  repoDir,
  branch,
  diffSummary,
  intendedBehavior,
  round = 1,
  deadlineMs = 20 * 60 * 1000,
}) {
  const opencode = state.opencode ?? { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null };
  const decision = await resolveSessionForRole({
    role: 'qa',
    opencode,
    getSession: client.getSession,
  });

  let sessionId = decision.sessionId;
  if (decision.action === 'create') {
    sessionId = await client.createSession({ title: `qa-${issue}`, agent: 'qa' });
  }
  if (decision.action === 'retry') {
    return { status: 'retry', sessionId, state };
  }

  const prompt = buildQaPrompt({ issue, repoDir, branch, diffSummary, intendedBehavior, round });
  const outcome = await withDeadline(
    () => client.prompt({ sessionId, agent: 'qa', parts: [{ type: 'text', text: prompt }] }),
    deadlineMs,
    () => client.abort(sessionId),
  );

  const text = typeof outcome.result?.text === 'string' ? outcome.result.text : '';
  const verdict = parseOverallStatus(text);
  const nextState = {
    ...state,
    opencode: {
      ...opencode,
      qa: { session_id: sessionId, agent: 'qa', last_used_round: round, last_status: outcome.status, last_seen_at: new Date().toISOString() },
    },
  };
  return { status: outcome.status, sessionId, state: nextState, verdict, report: text };
}

async function withDeadline(fn, deadlineMs, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error('qa session timed out'));
        }, deadlineMs);
      }),
    ]);
  } catch (error) {
    return { status: 'aborted', error };
  } finally {
    clearTimeout(timer);
  }
}
