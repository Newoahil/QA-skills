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

export const PERMISSION_POLICY_VERSION = 2;

// A session must never block on a permission prompt in headless mode. There is no broad allow:
// every role receives explicit capability rules and supervisor-owned repository operations are not
// exposed as agent permissions.
const HEADLESS_BASE = Object.freeze([
  { permission: '*', action: 'deny', pattern: '*' },
  { permission: 'question', action: 'deny', pattern: '*' },
  { permission: 'plan_enter', action: 'deny', pattern: '*' },
  { permission: 'plan_exit', action: 'deny', pattern: '*' },
  { permission: 'doom_loop', action: 'deny', pattern: '*' },
]);

const INSTALL_AND_GIT_DENIES = Object.freeze([
  'git commit*', 'git push*', 'git reset*', 'git checkout*', 'git clean*',
  'npm install*', 'npm i *', 'pnpm add*', 'pnpm install*',
  'yarn add*', 'yarn install*', 'pip install*',
]);

export function permissionRulesFor(agent) {
  if (agent === 'qa-guardian') {
    return [
      ...HEADLESS_BASE,
      { permission: 'edit', action: 'allow', pattern: '*' },
      { permission: 'write', action: 'allow', pattern: '*' },
      { permission: 'apply_patch', action: 'allow', pattern: '*' },
      { permission: 'read', action: 'allow', pattern: '*' },
      { permission: 'grep', action: 'allow', pattern: '*' },
      { permission: 'glob', action: 'allow', pattern: '*' },
      { permission: 'codegraph', action: 'allow', pattern: '*' },
      { permission: 'webfetch', action: 'deny', pattern: '*' },
      { permission: 'websearch', action: 'deny', pattern: '*' },
      { permission: 'bash', action: 'deny', pattern: '*' },
      { permission: 'bash', action: 'deny', pattern: 'gh pr merge*' },
      { permission: 'bash', action: 'deny', pattern: 'gh issue close*' },
      { permission: 'bash', action: 'deny', pattern: 'gh issue edit*' },
      ...INSTALL_AND_GIT_DENIES.map((pattern) => ({ permission: 'bash', action: 'deny', pattern })),
      { permission: 'task', action: 'deny', pattern: '*' },
    ];
  }

  if (agent === 'qa') {
    return [
      ...HEADLESS_BASE,
      { permission: 'edit', action: 'deny', pattern: '*' },
      { permission: 'write', action: 'deny', pattern: '*' },
      { permission: 'apply_patch', action: 'deny', pattern: '*' },
      { permission: 'read', action: 'allow', pattern: '*' },
      { permission: 'grep', action: 'allow', pattern: '*' },
      { permission: 'glob', action: 'allow', pattern: '*' },
      { permission: 'codegraph', action: 'allow', pattern: '*' },
       { permission: 'webfetch', action: 'deny', pattern: '*' },
       { permission: 'websearch', action: 'deny', pattern: '*' },
       { permission: 'bash', action: 'deny', pattern: '*' },
       ...INSTALL_AND_GIT_DENIES.map((pattern) => ({ permission: 'bash', action: 'deny', pattern })),
       { permission: 'task', action: 'deny', pattern: '*' },
      { permission: 'task', action: 'allow', pattern: 'qa-facet' },
    ];
  }

  // Investigation specialists + plan builder: read/search/codegraph only; repository commands are
  // supervisor-owned and therefore not represented as bash permission patterns.
  return [
    ...HEADLESS_BASE,
    { permission: 'edit', action: 'deny', pattern: '*' },
    { permission: 'write', action: 'deny', pattern: '*' },
    { permission: 'apply_patch', action: 'deny', pattern: '*' },
    { permission: 'webfetch', action: 'deny', pattern: '*' },
    { permission: 'websearch', action: 'deny', pattern: '*' },
     { permission: 'read', action: 'allow', pattern: '*' },
     { permission: 'grep', action: 'allow', pattern: '*' },
     { permission: 'glob', action: 'allow', pattern: '*' },
     { permission: 'codegraph', action: 'allow', pattern: '*' },
    { permission: 'task', action: 'deny', pattern: '*' },
  ];
}

export function isPermissionCompatible(roleOrAgent, permission) {
  if (!Array.isArray(permission)) return false;
  if (permission.some((rule) => rule?.action === 'allow' && (rule.permission === '*' || rule.permission === 'bash'))) return false;
  const fixer = roleOrAgent === 'fixer' || roleOrAgent === 'qa-guardian';
  const required = fixer ? ['edit', 'write', 'apply_patch', 'read'] : ['read', 'grep', 'glob'];
  if (!required.every((name) => permission.some((rule) => rule?.permission === name && rule.action === 'allow' && rule.pattern === '*'))) return false;
  if (!fixer && permission.some((rule) => rule?.action === 'allow' && ['edit', 'write', 'apply_patch'].includes(rule.permission))) return false;
  return true;
}

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

function messageEndpointError(error) {
  const status = Number(error?.status);
  if (status === 404) return { kind: 'unusable-session', status };
  if (isRetryableStatus(status) || !Number.isFinite(status)) return { kind: 'retryable', status: Number.isFinite(status) ? status : null, error };
  return { kind: 'message-endpoint-error', status, error };
}

function normalizeProviderError(infoError) {
  const data = infoError?.data && typeof infoError.data === 'object' ? infoError.data : {};
  const responseBody = typeof data.responseBody === 'string' ? safeJson(data.responseBody) : null;
  const bodyError = responseBody?.error && typeof responseBody.error === 'object' ? responseBody.error : {};
  const statusCode = Number(data.statusCode ?? infoError?.statusCode);
  return {
    name: typeof infoError?.name === 'string' ? infoError.name : 'OpenCodeProviderError',
    message: typeof data.message === 'string' ? data.message : (typeof infoError?.message === 'string' ? infoError.message : 'OpenCode provider error'),
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    code: typeof data.code === 'string' ? data.code : (typeof bodyError.code === 'string' ? bodyError.code : null),
    reset_seconds: Number.isFinite(Number(data.reset_seconds)) ? Number(data.reset_seconds) : (Number.isFinite(Number(bodyError.reset_seconds)) ? Number(bodyError.reset_seconds) : null),
    reset_time: typeof data.reset_time === 'string' ? data.reset_time : (typeof bodyError.reset_time === 'string' ? bodyError.reset_time : null),
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createOpencodeClient({ baseUrl, sdk } = {}) {
  const client = sdk ?? createSdkClient({ baseUrl });

  async function createSession({ title, agent, parentID = null, directory = null }) {
    const body = { title, agent, permission: permissionRulesFor(agent) };
    if (parentID) body.parentID = parentID;
    const params = { body };
    if (directory) params.query = { directory };
    const result = await client.session.create(params);
    // SDK returns { data: { id, ... }, request, response }; unwrap .data.
    return result?.data?.id ?? result?.id ?? result;
  }

  async function prompt({ sessionId, agent, parts, format = null, system = null, signal = null }) {
    try {
      const body = { agent, parts };
      if (format) body.format = format;
      if (system) body.system = system;
      // Cooperative abort: when the caller's signal fires, tell the server to abort the session so
      // an in-flight investigation prompt does not keep running after Ctrl+C.
      const onAbort = () => { abort(sessionId).catch(() => undefined); };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      // SDK 1.18.18 generated path template is broken (`/session/%7Bid%7D/message`) even when
      // path.sessionID is supplied. Use the SDK's low-level client with an explicit URL until the
      // upstream codegen bug is fixed. Still uses the official SDK transport/interceptors.
      const result = await client._client.post({
        url: `/session/${encodeURIComponent(sessionId)}/message`,
        body,
        headers: { 'Content-Type': 'application/json' },
        ...(signal ? { signal } : {}),
      }).finally(() => { if (signal) signal.removeEventListener('abort', onAbort); });
      const data = result?.data ?? result;
      if (data?.info?.error) return { kind: 'provider-error', error: normalizeProviderError(data.info.error) };
      const responseParts = Array.isArray(data?.parts) ? data.parts : [];
      const text = responseParts.length > 0
        ? responseParts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
        : (typeof data?.text === 'string' ? data.text : '');
      const structured = data?.info?.structured_output ?? data?.info?.structured ?? null;
      const prompt_response = {
        parts_count: responseParts.length,
        text_bytes: Buffer.byteLength(text, 'utf8'),
        has_structured: data?.info?.structured !== undefined,
        has_structured_output: data?.info?.structured_output !== undefined,
      };
      return { kind: 'ok', status: 'ok', result: { ...data, text, structured, prompt_response } };
    } catch (error) {
      return { kind: classifyError(error).kind, error };
    }
  }

  async function abort(sessionId) {
    await client._client.post({ url: `/session/${encodeURIComponent(sessionId)}/abort` });
  }

  async function getSession(sessionId) {
    try {
      const result = await client._client.get({ url: `/session/${encodeURIComponent(sessionId)}` });
      return { kind: 'ok', status: 'ok', session: result?.data ?? result };
    } catch (error) {
      return { kind: classifyError(error).kind, error };
    }
  }

  async function getMessages(sessionId) {
    try {
      const result = await client._client.get({ url: `/session/${encodeURIComponent(sessionId)}/message` });
      return { kind: 'ok', status: 'ok', messages: result?.data ?? result ?? [] };
    } catch (error) {
      return messageEndpointError(error);
    }
  }

  async function getAgents(directory = null) {
    try {
      const params = { url: '/agent' };
      if (directory) params.query = { directory };
      const result = await client._client.get(params);
      const data = result?.data ?? result ?? {};
      const names = Array.isArray(data)
        ? data.map((agent) => agent?.name ?? agent?.id).filter((name) => typeof name === 'string')
        : Object.keys(data).filter((name) => data?.[name] && typeof data[name] === 'object');
      return { kind: 'ok', status: 'ok', agents: names };
    } catch (error) {
      return { kind: classifyError(error).kind, error };
    }
  }

  // Official real-time event stream (SSE): client.event.subscribe() → { stream } async-iterable of
  // { type, properties }. Returns { kind:'ok', stream } or a normalized error kind. The caller owns
  // iteration + cancellation (break out of the for-await loop, or call the returned cancel()).
  async function subscribeEvents() {
    try {
      const subscription = await client.event.subscribe();
      const stream = subscription?.stream ?? subscription;
      const cancel = typeof subscription?.controller?.abort === 'function'
        ? () => subscription.controller.abort()
        : (typeof subscription?.cancel === 'function' ? () => subscription.cancel() : () => {});
      return { kind: 'ok', stream, cancel };
    } catch (error) {
      return { kind: classifyError(error).kind, error };
    }
  }

  return { createSession, prompt, abort, getSession, getMessages, getAgents, subscribeEvents };
}
