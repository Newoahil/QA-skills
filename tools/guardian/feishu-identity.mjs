// QA Guardian — Feishu actor identity binding (pure).
//
// A valid Feishu app signature proves the request came from the configured Feishu app, NOT that
// the acting human is authorized. This module extracts a stable actor identity from a
// card.action.trigger payload and maps it to a trusted GitHub login that is also present in the
// configured `command_authors` allowlist. Absence, ambiguity, or mismatch must reject the action.

export function extractFeishuActorId(event) {
  if (!event || typeof event !== 'object') return null;
  const operator = event.operator ?? event.action?.operator ?? event.event?.operator ?? null;
  if (!operator || typeof operator !== 'object') return null;
  return operator.open_id ?? operator.user_id ?? operator.union_id ?? null;
}

/**
 * Resolve a Feishu actor id to an allowed GitHub author.
 * @param {object} args
 *   actorId: string|null
 *   feishuAuthorizers: Record<string,string> | Array<{feishu_id,github_login}> | null
 *   commandAuthors: string[]
 * @returns {{allowed:boolean, githubLogin?:string, reason?:string}}
 */
export function resolveFeishuAuthorizer({ actorId, feishuAuthorizers, commandAuthors }) {
  if (!actorId) return { allowed: false, reason: 'missing-actor' };

  let githubLogin = null;
  if (Array.isArray(feishuAuthorizers)) {
    const entry = feishuAuthorizers.find((e) => e && e.feishu_id === actorId);
    githubLogin = entry?.github_login ?? null;
  } else if (feishuAuthorizers && typeof feishuAuthorizers === 'object') {
    githubLogin = feishuAuthorizers[actorId] ?? null;
  }
  if (!githubLogin) return { allowed: false, reason: 'unmapped-actor' };

  const authors = Array.isArray(commandAuthors) ? commandAuthors : [];
  if (!authors.includes(githubLogin)) return { allowed: false, reason: 'not-command-author' };

  return { allowed: true, githubLogin };
}

/**
 * Build a shared authorize callback for both HTTP and WebSocket transports.
 * @param {object} args { feishuAuthorizers, commandAuthors }
 * @returns {(event:object) => {allowed:boolean, githubLogin?:string, reason?:string}}
 */
export function createFeishuAuthorizer({ feishuAuthorizers, commandAuthors }) {
  return (event) => resolveFeishuAuthorizer({
    actorId: extractFeishuActorId(event),
    feishuAuthorizers,
    commandAuthors,
  });
}
