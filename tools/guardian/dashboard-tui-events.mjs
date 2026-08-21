// Pure helpers for the real-time specialist event view (official OpenCode SSE stream).
//
// The read-only TUI subscribes to client.event.subscribe() and turns each server event into one
// human-readable line, filtered to the session(s) that belong to the selected issue. These helpers
// are pure and side-effect-free so they are fully unit-testable without a live server.

const DEFAULT_EVENT_BUFFER = 200;

// Events arrive as { type, properties } (v1 SDK) or { type, payload } (v2 API). Normalize both.
function eventPayload(event) {
  if (!event || typeof event !== 'object') return {};
  return event.properties ?? event.payload ?? {};
}

// The session id an event belongs to. Handles part events (properties.part.sessionID),
// message events (properties.info.sessionID / sessionID), and session events (properties.sessionID
// / properties.info.id).
export function eventSessionId(event) {
  const payload = eventPayload(event);
  return (
    payload.sessionID
    ?? payload.part?.sessionID
    ?? payload.info?.sessionID
    ?? payload.info?.id
    ?? null
  );
}

function truncate(value, max = 160) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function firstDetail(input) {
  if (!input || typeof input !== 'object') return '';
  return input.pattern ?? input.query ?? input.filePath ?? input.path ?? input.command ?? '';
}

// Map one event to a single display line, or null when the event carries no useful progress signal.
// Keeps the vocabulary aligned with the child-process progress sink so both views read the same.
export function mapEventToLine(event, now = Date.now()) {
  const type = event?.type;
  const payload = eventPayload(event);
  const stamp = new Date(now).toLocaleTimeString('zh-CN');
  if (type === 'message.part.updated' || type === 'message.part.delta') {
    const part = payload.part ?? {};
    if (part.type === 'tool' || payload.field === 'tool') {
      const tool = part.tool ?? 'tool';
      const state = part.state ?? {};
      const status = state.status ?? '-';
      const detail = firstDetail(state.input);
      const title = state.title ?? '';
      const suffix = [title, detail].filter(Boolean).map((s) => truncate(s, 80)).join(' ');
      return `[${stamp}] 工具 ${tool} (${status})${suffix ? ` ${suffix}` : ''}`;
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      return `[${stamp}] 文本 ${truncate(part.text.trim())}`;
    }
    if (payload.field === 'text' && typeof payload.delta === 'string' && payload.delta.trim()) {
      return `[${stamp}] 文本 ${truncate(payload.delta.trim())}`;
    }
    return null;
  }
  if (type === 'tool.execute.before') return `[${stamp}] 工具开始 ${payload.tool ?? '-'}`;
  if (type === 'tool.execute.after') return `[${stamp}] 工具完成 ${payload.tool ?? '-'}`;
  if (type === 'session.idle') return `[${stamp}] 会话空闲（本轮完成）`;
  if (type === 'session.error') return `[${stamp}] 会话错误 ${truncate(payload.error?.message ?? payload.error?.name ?? '未知')}`;
  if (type === 'session.status') return `[${stamp}] 状态 ${truncate(payload.status ?? payload.info?.status ?? '-')}`;
  return null;
}

// A bounded FIFO ring buffer of rendered lines. Never grows without bound so a long investigation
// cannot exhaust memory in the resident TUI.
export function createEventBuffer(limit = DEFAULT_EVENT_BUFFER) {
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_EVENT_BUFFER;
  let lines = [];
  return {
    push(line) {
      if (line === null || line === undefined) return;
      lines.push(String(line));
      if (lines.length > cap) lines = lines.slice(lines.length - cap);
    },
    lines() {
      return lines.slice();
    },
    clear() {
      lines = [];
    },
    get size() {
      return lines.length;
    },
  };
}

// Should this event be shown for the given set of session ids? Empty/absent set → accept all
// (issue-level view before any session id is known). A session-scoped event with an unrelated id is
// dropped so one specialist's view never bleeds another's.
export function eventMatchesSessions(event, sessionIds) {
  const ids = Array.isArray(sessionIds) ? sessionIds.filter(Boolean) : [];
  if (ids.length === 0) return true;
  const sid = eventSessionId(event);
  if (!sid) return true; // non-session events (server-level) are always relevant.
  return ids.includes(sid);
}
