// QA Guardian — independent QA SDK session runner (方案 A, Oracle design).

import { randomUUID } from 'node:crypto';
import { resolveSessionForRole } from './session-resolver.mjs';
import { PERMISSION_POLICY_VERSION } from './opencode-client.mjs';

const MAX_MESSAGES = 200;
const MAX_TEXT_BYTES = 64 * 1024;
const CLOCK_TOLERANCE_MS = 5000;

function parseOverallStatus(text) {
  const match = String(text ?? '').match(/^\s*Overall Status:\s*(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\s*$/im);
  return match ? match[1] : null;
}

function buildQaPrompt({ issue, repoDir, branch, diffSummary, intendedBehavior, round, operationMarker }) {
  return [
    `Verify the fix for issue #${issue} in ${repoDir} (round ${round}).`,
    `Fix branch: ${branch}.`,
    `Fix summary (DATA): ${JSON.stringify(diffSummary)}.`,
    `Intended behavior (DATA): ${JSON.stringify(intendedBehavior)}.`,
    `QA_OPERATION_MARKER=${operationMarker}`,
    'Use the supervisor-provided status/diff/test evidence; do not run shell commands. Check the diff against the intended behavior and emit exactly one line: Overall Status: PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW.',
    'Write the report in Chinese. It MUST include these Markdown sections: ## QA 验收结论, ## 验收依据, ## 风险与未覆盖项, ## 下一步. The prose must explain the evidence semantically, not as a mechanical template.',
    'You are read-only. Do not edit files, install dependencies, commit, push, or open a PR.',
  ].join('\n');
}

export async function runQaSession({
  client, state, issue, repoDir, branch, diffSummary, intendedBehavior, round = 1,
  deadlineMs = 20 * 60 * 1000, pollIntervalMs = 1000,
  writeQaAcceptance = null,
}) {
  const startedAt = Date.now();
  const opencode = state.opencode ?? { schema_version: 1, fixer: null, qa: null, specialists: {}, inflight: null };
  let sessionId = opencode.qa?.session_id ?? null;
  const remaining = () => Math.max(0, deadlineMs - (Date.now() - startedAt));
  let decision;
  try {
    decision = await raceDeadline(() => resolveSessionForRole({ role: 'qa', opencode, repoDir, issue, round, expectedPermissionPolicyVersion: PERMISSION_POLICY_VERSION, getSession: client.getSession }), remaining());
    sessionId = decision.sessionId ?? sessionId;
    if (decision.action === 'retry') return { status: 'retry', sessionId, state };
    if (decision.action === 'create') sessionId = await raceDeadline(() => client.createSession({ title: `qa-${issue}`, agent: 'qa', directory: repoDir }), remaining());
  } catch (error) {
    return { status: 'aborted', sessionId, state, error };
  }

  const baselineResult = await raceDeadline(() => baselineMessageIds(client, sessionId), remaining()).catch((error) => ({ error }));
  if (baselineResult?.error) return { status: baselineResult.error.name === 'DeadlineError' ? 'aborted' : 'retry', sessionId, state, error: baselineResult.error };

  const operationMarker = randomUUID();
  const prompt = buildQaPrompt({ issue, repoDir, branch, diffSummary, intendedBehavior, round, operationMarker });
  const control = { cancelled: false };
  const outcome = await withDeadline(
    () => promptOrCompletedMessage({ client, sessionId, prompt, baseline: baselineResult, promptStartedAt: Date.now(), operationMarker, pollIntervalMs, control, deadlineMs: remaining() }),
    remaining(),
    () => client.abort(sessionId),
    () => { control.cancelled = true; },
  );
  const status = normalizeOutcomeStatus(outcome);
  const text = typeof outcome?.result?.text === 'string' ? outcome.result.text : '';
  const verdict = status === 'ok' ? parseOverallStatus(text) : null;
  if (status === 'ok' && text.trim() && typeof writeQaAcceptance === 'function') {
    writeQaAcceptance(text);
  }
  const nextState = {
    ...state,
    opencode: {
      ...opencode,
      qa: status === 'unusable-session' ? null : {
        ...(opencode.qa ?? {}),
        session_id: sessionId,
        agent: 'qa',
        repo_dir: decision.binding?.repo_dir ?? opencode.qa?.repo_dir ?? repoDir,
        issue: Number(issue),
        role: 'qa',
        permission_policy_version: PERMISSION_POLICY_VERSION,
        created_round: opencode.qa?.created_round ?? round,
        last_used_round: round,
        last_status: status,
        last_seen_at: new Date().toISOString(),
      },
    },
  };
  return { status, sessionId, state: nextState, verdict, report: text, error: outcome?.error, abortError: outcome?.abortError, recreateOnNextRun: status === 'unusable-session' };
}

async function baselineMessageIds(client, sessionId) {
  if (typeof client.getMessages !== 'function') throw new Error('qa baseline message reader is required');
  const result = await client.getMessages(sessionId);
  if (result.kind !== 'ok' || !Array.isArray(result.messages)) throw new Error('qa baseline message read failed');
  return new Set(result.messages.map(messageId).filter(Boolean));
}

async function promptOrCompletedMessage({ client, sessionId, prompt, baseline, promptStartedAt, operationMarker, pollIntervalMs, control, deadlineMs }) {
  let promptResult = null;
  let promptSettled = false;
  const rawPromptPromise = client.prompt({ sessionId, agent: 'qa', parts: [{ type: 'text', text: prompt }] })
    .then((result) => { promptResult = result; promptSettled = true; return result; });
  if (typeof client.getMessages !== 'function') return rawPromptPromise;

  const attempts = Math.max(1, Math.ceil(deadlineMs / Math.max(1, pollIntervalMs)));
  let promptId = null;
  for (let attempt = 0; attempt < attempts && !control.cancelled; attempt += 1) {
    if (promptSettled) {
      const status = normalizeOutcomeStatus(promptResult);
      if (status !== 'ok') return promptResult ?? { status: 'unverified' };
      if (parseOverallStatus(promptResult?.result?.text) !== null) return promptResult;
      promptId = promptIdFromResult(promptResult);
    }

    await delay(pollIntervalMs);
    const result = await client.getMessages(sessionId);
    if (result.kind !== 'ok' || !Array.isArray(result.messages)) continue;
    const messages = result.messages.slice(-MAX_MESSAGES);
    promptId ??= discoverPromptUserId(messages, baseline, promptStartedAt, prompt, operationMarker);
    if (!promptId) continue;
    const candidate = messages
      .filter(isCompletedAssistant)
      .filter((message) => message?.info?.parentID === promptId)
      .filter((message) => parseOverallStatus(messageText(message)) !== null)
      .sort((left, right) => messageCreated(right) - messageCreated(left))[0];
    if (candidate) return { kind: 'ok', status: 'ok', result: { text: messageText(candidate) } };
  }
  throw new DeadlineError();
}

function discoverPromptUserId(messages, baseline, promptStartedAt, prompt, operationMarker) {
  return messages.find((message) => {
    const created = messageCreated(message);
    return message?.info?.role === 'user'
      && !baseline.has(messageId(message))
      && created >= promptStartedAt - CLOCK_TOLERANCE_MS
      && (messageText(message) === prompt || messageText(message).includes(operationMarker));
  })?.info?.id ?? null;
}

function promptIdFromResult(result) {
  const info = result?.result?.info;
  if (info?.role === 'user') return info.id ?? null;
  if (info?.role === 'assistant') return info.parentID ?? null;
  return null;
}

function isCompletedAssistant(message) { return message?.info?.role === 'assistant' && Number.isFinite(Number(message?.info?.time?.completed)); }
function messageId(message) { return message?.info?.id ?? message?.id ?? null; }
function messageCreated(message) { return Number(message?.info?.time?.created ?? 0); }
function messageText(message) {
  const text = Array.isArray(message?.parts) ? message.parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('') : '';
  return text.slice(0, MAX_TEXT_BYTES);
}
function normalizeOutcomeStatus(outcome) {
  if (outcome?.status === 'ok' || outcome?.kind === 'ok') return 'ok';
  if (outcome?.status) return outcome.status;
  if (outcome?.kind === 'retryable') return 'retry';
  if (outcome?.kind === 'unusable-session') return 'unusable-session';
  return 'unverified';
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
class DeadlineError extends Error { constructor() { super('qa session timed out'); this.name = 'DeadlineError'; } }
async function raceDeadline(fn, timeoutMs) {
  if (timeoutMs <= 0) throw new DeadlineError();
  let timer;
  try { return await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new DeadlineError()), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
async function withDeadline(fn, deadlineMs, onTimeout, onSettled = () => {}) {
  let timer;
  let cleanupStarted = false;
  const timeoutResult = async (error) => {
    if (cleanupStarted) return { status: 'aborted', error };
    cleanupStarted = true;
    let abortError = null;
    try { await onTimeout(); } catch (cleanupError) { abortError = cleanupError; }
    return { status: 'aborted', error, abortError };
  };
  try {
    return await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(async () => reject(await timeoutResult(new Error('qa session timed out'))), deadlineMs); })]);
  } catch (error) {
    if (error?.status === 'aborted') return error;
    if (error?.name === 'DeadlineError') return timeoutResult(error);
    return { status: 'aborted', error, abortError: error?.abortError ?? null };
  } finally { onSettled(); clearTimeout(timer); }
}
