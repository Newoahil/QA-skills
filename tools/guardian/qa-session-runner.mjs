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
  pollIntervalMs = 1000,
}) {
  const opencode = state.opencode ?? { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null };
  const decision = await resolveSessionForRole({
    role: 'qa',
    opencode,
    getSession: client.getSession,
  });

  let sessionId = decision.sessionId;
  if (decision.action === 'create') {
    sessionId = await client.createSession({ title: `qa-${issue}`, agent: 'qa', directory: repoDir });
  }
  if (decision.action === 'retry') {
    return { status: 'retry', sessionId, state };
  }

  const baseline = await completedAssistantMessageIds(client, sessionId);
  const prompt = buildQaPrompt({ issue, repoDir, branch, diffSummary, intendedBehavior, round });
  const control = { cancelled: false };
  const outcome = await withDeadline(
    () => promptOrCompletedMessage({
      client,
      sessionId,
      prompt,
      baseline,
      pollIntervalMs,
      control,
    }),
    deadlineMs,
    () => client.abort(sessionId),
    () => { control.cancelled = true; },
  );

  const status = outcome.status ?? (outcome.kind === 'ok' ? 'ok' : outcome.kind);
  const text = typeof outcome.result?.text === 'string' ? outcome.result.text : '';
  const verdict = parseOverallStatus(text);
  const nextState = {
    ...state,
    opencode: {
      ...opencode,
      qa: { session_id: sessionId, agent: 'qa', last_used_round: round, last_status: status, last_seen_at: new Date().toISOString() },
    },
  };
  return { status, sessionId, state: nextState, verdict, report: text };
}

async function completedAssistantMessageIds(client, sessionId) {
  if (typeof client.getMessages !== 'function') return new Set();
  const result = await client.getMessages(sessionId);
  if (result.kind !== 'ok' || !Array.isArray(result.messages)) return new Set();
  return new Set(result.messages.filter(isCompletedAssistant).map(messageId).filter(Boolean));
}

async function promptOrCompletedMessage({ client, sessionId, prompt, baseline, pollIntervalMs, control }) {
  let settled = false;
  const promptPromise = client.prompt({
    sessionId,
    agent: 'qa',
    parts: [{ type: 'text', text: prompt }],
  });
  if (typeof client.getMessages !== 'function') return promptPromise;

  const messagePromise = (async () => {
    while (!settled && !control.cancelled) {
      await delay(pollIntervalMs);
      if (settled || control.cancelled) return null;
      const result = await client.getMessages(sessionId);
      if (result.kind !== 'ok' || !Array.isArray(result.messages)) continue;
      const completed = result.messages
        .filter(isCompletedAssistant)
        .filter((message) => !baseline.has(messageId(message)))
        .filter((message) => parseOverallStatus(messageText(message)) !== null)
        .sort((left, right) => messageCreated(right) - messageCreated(left))[0];
      if (!completed) continue;
      return { kind: 'ok', result: { text: messageText(completed) } };
    }
  })();

  try {
    return await Promise.race([promptPromise, messagePromise]);
  } finally {
    settled = true;
  }
}

function isCompletedAssistant(message) {
  return message?.info?.role === 'assistant' && Number.isFinite(Number(message?.info?.time?.completed));
}

function messageId(message) {
  return message?.info?.id ?? message?.id ?? null;
}

function messageCreated(message) {
  return Number(message?.info?.time?.created ?? 0);
}

function messageText(message) {
  return Array.isArray(message?.parts)
    ? message.parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
    : '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDeadline(fn, deadlineMs, onTimeout, onSettled = () => {}) {
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
    onSettled();
    clearTimeout(timer);
  }
}
