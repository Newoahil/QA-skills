// QA Guardian — OpenCode SDK wrapper (Oracle-designed seam).
//
// Owns the single long-lived `opencode serve` client. Exposes createSession / prompt / abort /
// getSession with:
//   - no-ask permission at create (headless hang guard, issue #16367);
//   - json_schema structured output support;
//   - error normalization into { kind: 'ok' | 'unusable-session' | 'retryable' } so the scheduler
//     can decide recreate vs retry without leaking SDK/network details.
// The SDK client is injected for unit tests (no real network).

import { createOpencodeClient as createSdkClient } from '@opencode-ai/sdk';

// A session must never block on a permission prompt in headless mode. Every rule is allow/deny.
const NO_ASK_PERMISSION = Object.freeze([
  { permission: 'question', action: 'deny', pattern: '*' },
  { permission: 'plan_enter', action: 'deny', pattern: '*' },
  { permission: 'plan_exit', action: 'deny', pattern: '*' },
]);

function isRetryableStatus(status) {
  return status >= 500 || status === 429 || status === 408;
}

function classifyError(error) {
  const status = Number(error?.status);
  if (status === 404) return { kind: 'unusable-session' };
  if (isRetryableStatus(status)) return { kind: 'retryable' };
  // Network / connection errors (no status) are retryable (serve may be starting).
  if (!Number.isFinite(status)) return { kind: 'retryable' };
  return { kind: 'unusable-session' };
}

export function createOpencodeClient({ baseUrl, sdk } = {}) {
  const client = sdk ?? createSdkClient({ baseUrl });

  async function createSession({ title, agent, parentID = null }) {
    const body = { title, agent, permission: [...NO_ASK_PERMISSION] };
    if (parentID) body.parentID = parentID;
    const result = await client.session.create({ body });
    return result?.id ?? result;
  }

  async function prompt({ sessionId, agent, parts, format = null, system = null }) {
    try {
      const body = { agent, parts };
      if (format) body.format = format;
      if (system) body.system = system;
      const result = await client.session.prompt({ path: { sessionID: sessionId }, body });
      return { kind: 'ok', result };
    } catch (error) {
      return { kind: classifyError(error).kind, error };
    }
  }

  async function abort(sessionId) {
    await client.session.abort({ path: { sessionID: sessionId } });
  }

  async function getSession(sessionId) {
    try {
      const result = await client.session.get({ path: { sessionID: sessionId } });
      return { kind: 'ok', session: result };
    } catch (error) {
      return { kind: classifyError(error).kind, error };
    }
  }

  return { createSession, prompt, abort, getSession };
}
