const state = {
  sessions: [],
  selectedSessionId: null,
  messages: [],
  filter: '',
  selectedProject: 'all',
  projects: [],
  worktrees: [],
  autoRefresh: true,
  intervalMs: 3000,
  timerId: null,
  eventSource: null,
  collapsedNodes: new Set(),
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
  if (Number.isNaN(date.getTime())) return String(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString('zh-CN', { hour12: false });
  return isToday ? timeStr : `${date.getMonth() + 1}/${date.getDate()} ${timeStr}`;
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

function sessionMatches(session, filter, projectFilter = 'all') {
  if (projectFilter !== 'all') {
    const dir = String(session?.directory ?? '').toLowerCase();
    const filterDir = projectFilter.toLowerCase();
    if (!dir.startsWith(filterDir) && !dir.includes(filterDir)) return false;
  }
  if (filter.length === 0) return true;
  return [session?.id, session?.title, session?.agent, session?.parentID, session?.directory]
    .some((value) => String(value ?? '').toLowerCase().includes(filter));
}

function getAgentTagClass(agent) {
  const name = String(agent ?? '').toLowerCase();
  if (name.includes('oracle')) return 'tag-oracle';
  if (name.includes('plan')) return 'tag-plan';
  if (name.includes('qa-guardian') || name.includes('fixer')) return 'tag-junior';
  if (name.includes('qa')) return 'tag-qa';
  if (name.includes('librarian')) return 'tag-librarian';
  if (name.includes('explore')) return 'tag-explore';
  if (name.includes('junior')) return 'tag-junior';
  if (name.includes('business')) return 'tag-plan';
  if (name.includes('code')) return 'tag-qa';
  return '';
}

function buildSessionTree(sessions, projectFilter) {
  const filteredSessions = sessions.filter((s) => {
    if (projectFilter === 'all') return true;
    const dir = String(s?.directory ?? '').toLowerCase();
    return dir.startsWith(projectFilter.toLowerCase()) || dir.includes(projectFilter.toLowerCase());
  });

  const nodes = new Map();
  for (const session of filteredSessions) {
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

function nodeVisible(node, filter, projectFilter) {
  return filter.length === 0 || sessionMatches(node.session, filter, projectFilter) || node.children.some((child) => nodeVisible(child, filter, projectFilter));
}

function visibleCount(nodes, filter, projectFilter) {
  return nodes.reduce((total, node) => {
    if (!nodeVisible(node, filter, projectFilter)) return total;
    return total + 1 + visibleCount(node.children, filter, projectFilter);
  }, 0);
}

function renderSessionNode(node, filter, projectFilter, depth = 0) {
  if (!nodeVisible(node, filter, projectFilter)) return '';
  const session = node.session;
  const id = session?.id ?? 'unknown';
  const active = id === state.selectedSessionId ? ' active' : '';
  const isRoot = depth === 0;
  const branchClass = isRoot ? ' root' : ' child';
  const hasChildren = node.children.length > 0;
  const isCollapsed = state.collapsedNodes.has(id) && filter.length === 0;
  
  const childrenHtml = hasChildren
    ? `<div class="session-children${isCollapsed ? ' collapsed' : ''}">${node.children.map((child) => renderSessionNode(child, filter, projectFilter, depth + 1)).join('')}</div>`
    : '';

  const toggleBtn = hasChildren
    ? `<button class="tree-toggle-btn${isCollapsed ? ' collapsed' : ''}" type="button" data-toggle="${escapeHtml(id)}" title="${isCollapsed ? '展开子会话' : '折叠子会话'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>`
    : `<span class="tree-spacer"></span>`;

  const agentTag = session?.agent ? `<span class="agent-tag ${getAgentTagClass(session.agent)}">${escapeHtml(session.agent)}</span>` : '';

  let dirShort = '';
  if (session?.directory) {
    const parts = session.directory.replace(/\\/g, '/').split('/');
    dirShort = parts.slice(-1)[0] || '';
  }

  return `<div class="session-node" data-node-id="${escapeHtml(id)}">
    <div class="session-row">
      ${toggleBtn}
      <button class="session-card${active}${branchClass}" type="button" data-id="${escapeHtml(id)}">
        <div class="session-card-header">
          <span class="session-id">${escapeHtml(id)}</span>
          ${agentTag}
        </div>
        <div class="session-title" title="${escapeHtml(session?.title || '')}">${escapeHtml(session?.title || session?.agent || '未命名会话')}</div>
        <div class="session-meta-row">
          <span>${escapeHtml(formatTime(sessionTime(session)))}</span>
          ${dirShort ? `<span style="color:var(--muted);font-size:10px;">${escapeHtml(dirShort)}</span>` : ''}
          ${hasChildren ? `<span>${node.children.length} 子会话</span>` : ''}
        </div>
      </button>
    </div>
    ${childrenHtml}
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

async function discoverWorktrees() {
  try {
    const projects = normalizeList(await fetchJson('/project'));
    state.projects = projects;
    const dirs = new Set();
    
    // Add base project directories
    for (const p of projects) {
      if (p?.worktree && p.worktree !== '/') {
        dirs.add(p.worktree);
        // Add guardian isolated worktrees automatically
        dirs.add(`${p.worktree}.qa-guardian-qa`);
        dirs.add(`${p.worktree}.qa-guardian-control`);
      }
    }
    
    state.worktrees = Array.from(dirs);
    
    // Populate project select dropdown
    const select = $('projectSelect');
    if (select && select.options.length <= 1) {
      const uniqueBases = Array.from(new Set(projects.filter(p=>p?.worktree && p.worktree !== '/').map(p=>p.worktree)));
      for (const base of uniqueBases) {
        const opt = document.createElement('option');
        const name = base.replace(/\\/g, '/').split('/').slice(-1)[0] || base;
        opt.value = base;
        opt.textContent = `${name} (含 Guardian)`;
        select.appendChild(opt);
      }
    }
  } catch (err) {
    state.worktrees = [];
  }
}

async function fetchSessions({ quiet = false } = {}) {
  if (!quiet) setStatus('同步会话...', 'syncing');
  try {
    if (state.worktrees.length === 0) {
      await discoverWorktrees();
    }

    const queryDirs = state.worktrees.length > 0 ? state.worktrees : [''];
    
    // Fetch concurrently across all project and worktree directories
    const fetchPromises = queryDirs.map((dir) => {
      const url = dir ? `/session?directory=${encodeURIComponent(dir)}&limit=100` : `/session?limit=100`;
      return fetchJson(url).then(normalizeList).catch(() => []);
    });

    // Also include bare /session
    fetchPromises.push(fetchJson('/session?limit=100').then(normalizeList).catch(() => []));

    const results = await Promise.all(fetchPromises);
    const sessionMap = new Map();
    for (const list of results) {
      for (const s of list) {
        if (s?.id && !sessionMap.has(s.id)) {
          sessionMap.set(s.id, s);
        }
      }
    }

    state.sessions = Array.from(sessionMap.values()).sort((a, b) => Number(sessionTime(b) ?? 0) - Number(sessionTime(a) ?? 0));
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
  const projectFilter = state.selectedProject;
  const roots = buildSessionTree(state.sessions, projectFilter);
  const count = visibleCount(roots, filter, projectFilter);
  $('sessionCount').textContent = String(count);
  $('sessionList').innerHTML = count === 0 ? '<p class="empty">未找到匹配会话</p>' : roots.map((node) => renderSessionNode(node, filter, projectFilter)).join('');
  
  $('sessionList').querySelectorAll('.session-card').forEach((card) => {
    card.addEventListener('click', () => selectSession(card.getAttribute('data-id')));
  });

  $('sessionList').querySelectorAll('.tree-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-toggle');
      if (state.collapsedNodes.has(id)) state.collapsedNodes.delete(id);
      else state.collapsedNodes.add(id);
      renderSessions();
    });
  });
}

function renderPartHtml(part) {
  if (typeof part?.text === 'string') {
    return `<div class="part">${escapeHtml(part.text)}</div>`;
  }
  if (typeof part?.content === 'string') {
    return `<div class="part">${escapeHtml(part.content)}</div>`;
  }
  if (typeof part?.message === 'string') {
    return `<div class="part">${escapeHtml(part.message)}</div>`;
  }
  if (part?.type === 'tool_use' || part?.type === 'tool_call' || part?.type === 'tool') {
    const name = part.name || part.tool || part.toolName || 'tool';
    const input = part.args || part.input || part.state?.input || {};
    const inputFormatted = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const shortArg = typeof input === 'object' && input ? Object.keys(input).slice(0, 3).join(', ') : '';
    return `<details class="tool-accordion" open>
      <summary class="tool-summary">
        <span class="tool-badge">CALL</span>
        <span class="tool-name">${escapeHtml(name)}</span>
        <span style="color:var(--faint);font-size:11px;">(${escapeHtml(shortArg)})</span>
      </summary>
      <div class="tool-content">${escapeHtml(inputFormatted)}</div>
    </details>`;
  }
  if (part?.type === 'tool_result') {
    const res = part.content ?? part.output ?? part.result ?? part.state?.output ?? part.text;
    const resFormatted = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
    return `<details class="tool-accordion">
      <summary class="tool-summary" style="color:#34d399;background:rgba(52, 211, 153, 0.08);">
        <span class="tool-badge" style="background:rgba(52, 211, 153, 0.2);color:#a7f3d0;">RESULT</span>
        <span>工具执行输出</span>
      </summary>
      <div class="tool-content" style="color:#a7f3d0;">${escapeHtml(resFormatted)}</div>
    </details>`;
  }
  return `<div class="part code">${escapeHtml(JSON.stringify(part, null, 2))}</div>`;
}

function renderMessages() {
  const session = state.sessions.find((item) => item?.id === state.selectedSessionId);
  const title = session?.title || state.selectedSessionId || '请选择会话';
  $('currentSessionTitle').textContent = title;
  
  const copyBtn = $('copySessionBtn');
  if (state.selectedSessionId) {
    copyBtn.hidden = false;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(state.selectedSessionId).then(() => {
        copyBtn.style.color = 'var(--ok)';
        setTimeout(() => { copyBtn.style.color = ''; }, 1500);
      });
    };
  } else {
    copyBtn.hidden = true;
  }

  const agentLabel = session?.agent ? ` · ${session.agent}` : '';
  const dirLabel = session?.directory ? ` · ${session.directory}` : '';
  $('currentSessionMeta').textContent = state.selectedSessionId ? `${state.selectedSessionId}${agentLabel}${dirLabel} (${state.messages.length} 条消息)` : '-';
  $('scrollToBottomBtn').hidden = state.messages.length === 0;

  if (!state.selectedSessionId) {
    $('messagesContainer').innerHTML = '<p class="empty">暂无选中会话。</p>';
    return;
  }
  if (state.messages.length === 0) {
    $('messagesContainer').innerHTML = '<p class="empty">该会话暂无消息。</p>';
    return;
  }

  const wasNearBottom = $('messagesContainer').scrollHeight - $('messagesContainer').scrollTop - $('messagesContainer').clientHeight < 120;
  
  $('messagesContainer').innerHTML = state.messages.map((message, index) => {
    const role = message?.info?.role ?? message?.role ?? message?.author ?? 'unknown';
    const roleClass = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'other';
    const time = message?.info?.time?.created ?? message?.time?.created ?? message?.createdAt ?? message?.created_at;
    const agentName = message?.info?.agent || message?.agent || '';
    const parts = Array.isArray(message?.parts) ? message.parts : (typeof message?.text === 'string' ? [{ type: 'text', text: message.text }] : []);
    const partsHtml = parts.map((part) => renderPartHtml(part)).join('') || '<div class="part" style="color:var(--faint);">[空消息]</div>';
    
    return `<article class="message message-${roleClass}${index === state.messages.length - 1 ? ' latest' : ''}">
      <header class="message-head">
        <div class="message-head-left">
          <span class="role ${roleClass}">${escapeHtml(role)}</span>
          ${agentName ? `<span class="agent-name-tag">${escapeHtml(agentName)}</span>` : ''}
        </div>
        <span class="time">${escapeHtml(formatTime(time))}</span>
      </header>
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

function bindEvents() {
  $('refreshBtn')?.addEventListener('click', () => fetchSessions());

  $('projectSelect')?.addEventListener('change', (event) => {
    state.selectedProject = event.target.value;
    renderSessions();
  });

  $('sessionSearch')?.addEventListener('input', (event) => {
    state.filter = event.target.value;
    const clearBtn = $('clearSearchBtn');
    if (clearBtn) clearBtn.hidden = state.filter.length === 0;
    renderSessions();
  });

  $('clearSearchBtn')?.addEventListener('click', () => {
    const input = $('sessionSearch');
    if (input) input.value = '';
    state.filter = '';
    const clearBtn = $('clearSearchBtn');
    if (clearBtn) clearBtn.hidden = true;
    renderSessions();
  });

  $('autoRefreshToggle')?.addEventListener('change', (event) => {
    state.autoRefresh = event.target.checked;
    state.autoRefresh ? startAutoRefresh() : stopAutoRefresh();
  });

  $('refreshIntervalSelect')?.addEventListener('change', (event) => {
    state.intervalMs = Number(event.target.value) || 3000;
    startAutoRefresh();
  });

  $('scrollToBottomBtn')?.addEventListener('click', () => {
    const el = $('messagesContainer');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

bindEvents();
fetchSessions();
startAutoRefresh();
connectEvents();
