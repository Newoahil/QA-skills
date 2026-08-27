const state = {
  sessions: [],
  selectedSessionId: null,
  messages: [],
  filter: '',
  autoRefresh: true,
  intervalMs: 3000,
  timerId: null,
  eventSource: null,
};

const $ = (id) => document.getElementById(id);

function setStatus(text, type = 'ok') {
  $('statusText').textContent = text;
  $('statusBadge').className = `status-badge ${type === 'error' ? 'error' : type === 'syncing' ? 'syncing' : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(value) {
  if (!value) return '-';
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function sessionTime(session) {
  return session?.time?.updated ?? session?.time?.created ?? session?.updatedAt ?? session?.createdAt ?? null;
}

function defaultSessionId(sessions) {
  const latest = sessions[0];
  if (!latest?.id) return null;
  const child = sessions.find((session) => session?.parentID === latest.id);
  return child?.id ?? latest.id;
}

function sessionMatches(session, filter) {
  return [session?.id, session?.title, session?.agent, session?.parentID, session?.directory]
    .some((value) => String(value ?? '').toLowerCase().includes(filter));
}

function buildSessionTree(sessions) {
  const nodes = new Map();
  for (const session of sessions) {
    if (!session?.id) continue;
    nodes.set(session.id, { session, children: [] });
  }

  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.session?.parentID ? nodes.get(node.session.parentID) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (items) => {
    items.sort((a, b) => Number(sessionTime(b.session) ?? 0) - Number(sessionTime(a.session) ?? 0));
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

function nodeVisible(node, filter) {
  return filter.length === 0 || sessionMatches(node.session, filter) || node.children.some((child) => nodeVisible(child, filter));
}

function visibleCount(nodes, filter) {
  return nodes.reduce((total, node) => {
    if (!nodeVisible(node, filter)) return total;
    return total + 1 + visibleCount(node.children, filter);
  }, 0);
}

function renderSessionNode(node, filter, depth = 0) {
  if (!nodeVisible(node, filter)) return '';
  const session = node.session;
  const id = session?.id ?? 'unknown';
  const active = id === state.selectedSessionId ? ' active' : '';
  const branch = depth > 0 ? ' child' : ' root';
  const children = node.children.map((child) => renderSessionNode(child, filter, depth + 1)).join('');
  return `<div class="session-node" style="--depth:${depth}">
    <button class="session-card${active}${branch}" type="button" data-id="${escapeHtml(id)}">
      <div class="session-id">${escapeHtml(id)}</div>
      <div class="session-title">${escapeHtml(session?.title || session?.agent || '未命名会话')}</div>
      <div class="session-meta">${escapeHtml(session?.agent ?? '-')} | ${escapeHtml(formatTime(sessionTime(session)))}</div>
    </button>
    ${children ? `<div class="session-children">${children}</div>` : ''}
  </div>`;
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.messages)) return payload.messages;
  return [];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchSessions({ quiet = false } = {}) {
  if (!quiet) setStatus('同步会话...', 'syncing');
  try {
    const sessions = normalizeList(await fetchJson('/session?limit=200'));
    state.sessions = sessions.slice().sort((a, b) => Number(sessionTime(b) ?? 0) - Number(sessionTime(a) ?? 0));
    renderSessions();
    if (!state.selectedSessionId) {
      const sessionId = defaultSessionId(state.sessions);
      if (sessionId) selectSession(sessionId, { quiet: true });
    }
    if (state.selectedSessionId) await fetchMessages(state.selectedSessionId, { quiet: true });
    setStatus(`已连接 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } catch (error) {
    setStatus(`会话同步失败: ${error instanceof Error ? error.message : 'unknown'}`, 'error');
  }
}

async function fetchMessages(sessionId, { quiet = false } = {}) {
  if (!sessionId) return;
  if (!quiet) setStatus('加载消息...', 'syncing');
  try {
    state.messages = normalizeList(await fetchJson(`/session/${encodeURIComponent(sessionId)}/message?limit=160`));
    renderMessages();
    if (!quiet) setStatus('已连接');
  } catch (error) {
    if (!quiet) setStatus(`消息加载失败: ${error instanceof Error ? error.message : 'unknown'}`, 'error');
  }
}

function selectSession(sessionId, { quiet = false } = {}) {
  state.selectedSessionId = sessionId;
  renderSessions();
  fetchMessages(sessionId, { quiet });
}

function renderSessions() {
  const filter = state.filter.toLowerCase();
  const roots = buildSessionTree(state.sessions);
  const count = visibleCount(roots, filter);
  $('sessionCount').textContent = String(count);
  $('sessionList').innerHTML = count === 0 ? '<p class="empty">未找到会话</p>' : roots.map((node) => renderSessionNode(node, filter)).join('');
  $('sessionList').querySelectorAll('.session-card').forEach((card) => {
    card.addEventListener('click', () => selectSession(card.getAttribute('data-id')));
  });
}

function partText(part) {
  if (typeof part?.text === 'string') return part.text;
  if (typeof part?.content === 'string') return part.content;
  if (typeof part?.message === 'string') return part.message;
  if (part?.type === 'tool_use' || part?.type === 'tool_call') {
    const name = part.name || part.tool || part.toolName || 'tool';
    const args = part.args || part.input || {};
    return `[Call: ${name}]\n${JSON.stringify(args, null, 2)}`;
  }
  if (part?.type === 'tool_result') {
    const res = part.content ?? part.output ?? part.result ?? part.text;
    return `[Result]\n${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`;
  }
  return JSON.stringify(part, null, 2);
}

function partClass(part) {
  return ['tool', 'tool_use', 'tool_call', 'tool_result', 'patch', 'file'].includes(part?.type) ? 'part code' : 'part';
}

function renderMessages() {
  const session = state.sessions.find((item) => item?.id === state.selectedSessionId);
  $('currentSessionTitle').textContent = session?.title || state.selectedSessionId || '请选择会话';
  $('currentSessionMeta').textContent = state.selectedSessionId ? `${state.selectedSessionId} (${state.messages.length} 条消息)` : '-';
  $('scrollToBottomBtn').hidden = state.messages.length === 0;
  if (!state.selectedSessionId) {
    $('messagesContainer').innerHTML = '<p class="empty">暂无选中会话。</p>';
    return;
  }
  if (state.messages.length === 0) {
    $('messagesContainer').innerHTML = '<p class="empty">该会话暂无消息。</p>';
    return;
  }
  const wasNearBottom = $('messagesContainer').scrollHeight - $('messagesContainer').scrollTop - $('messagesContainer').clientHeight < 100;
  $('messagesContainer').innerHTML = state.messages.map((message, index) => {
    const role = message?.info?.role ?? message?.role ?? message?.author ?? 'unknown';
    const roleClass = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'other';
    const time = message?.info?.time?.created ?? message?.time?.created ?? message?.createdAt ?? message?.created_at;
    const parts = Array.isArray(message?.parts) ? message.parts : (typeof message?.text === 'string' ? [{ type: 'text', text: message.text }] : []);
    const partsHtml = parts.map((part) => `<div class="${partClass(part)}">${escapeHtml(partText(part))}</div>`).join('') || '<div class="part" style="color:var(--faint);">[空消息]</div>';
    return `<article class="message${index === state.messages.length - 1 ? ' latest' : ''}">
      <header class="message-head"><span class="role ${roleClass}">${escapeHtml(role)}</span><span class="time">${escapeHtml(formatTime(time))}</span></header>
      ${partsHtml}
    </article>`;
  }).join('');
  if (wasNearBottom) {
    $('messagesContainer').scrollTop = $('messagesContainer').scrollHeight;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (!state.autoRefresh) return;
  state.timerId = setInterval(() => {
    if (document.visibilityState !== 'hidden') fetchSessions({ quiet: true });
  }, state.intervalMs);
}

function stopAutoRefresh() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function connectEvents() {
  if (!window.EventSource) return;
  const source = new EventSource('/event');
  state.eventSource = source;
  source.onmessage = () => fetchSessions({ quiet: true });
  source.onerror = () => setStatus('事件流不可用，使用轮询', 'syncing');
}

$('refreshBtn').addEventListener('click', () => fetchSessions());
$('sessionSearch').addEventListener('input', (event) => { state.filter = event.target.value; renderSessions(); });
$('autoRefreshToggle').addEventListener('change', (event) => { state.autoRefresh = event.target.checked; state.autoRefresh ? startAutoRefresh() : stopAutoRefresh(); });
$('refreshIntervalSelect').addEventListener('change', (event) => { state.intervalMs = Number(event.target.value) || 3000; startAutoRefresh(); });
$('scrollToBottomBtn').addEventListener('click', () => { $('messagesContainer').scrollTop = $('messagesContainer').scrollHeight; });

fetchSessions();
startAutoRefresh();
connectEvents();
