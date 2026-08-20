const ERROR_CATALOG = Object.freeze({
  'no-guardian-dir': {
    problem: '找不到 Guardian 状态目录',
    reason: '目标仓库下不存在 .qa/guardian/ 目录，Guardian 可能尚未初始化。',
    next: '先在目标仓库创建 .qa/guardian/config.json，再启动 Guardian scheduler。',
  },
  'no-issue-state': {
    problem: '找不到议题 #{issue} 的状态文件',
    reason: '.qa/guardian/{issue}.json 不存在，该议题可能尚未被 Guardian 认领。',
    next: '确认议题已添加 qa-guardian 标签，并且 scheduler 已至少运行过一次。',
  },
  'no-session': {
    problem: '议题 #{issue} 没有 {role} 角色的 OpenCode 会话',
    reason: '该角色会话尚未创建，或议题尚未进入需要该角色的阶段。当前状态：{state}。',
    next: '先用 dashboard 查看议题状态；修复者通常在 FIXING 后出现，QA 通常在 VERIFYING 后出现。',
  },
  'opencode-unreachable': {
    problem: '无法连接 OpenCode 服务',
    reason: 'baseUrl={baseUrl} 不可达。OpenCode serve 可能未启动，或端口配置不正确。',
    next: '运行 opencode serve，或用 --base-url 指定正确地址。',
  },
  'session-not-found': {
    problem: '会话 {sessionId} 不存在',
    reason: 'OpenCode 返回该会话不可用。会话可能已过期、被清理，或 ID 填错。',
    next: '改用 --repo <项目> --issue <编号> --agent <角色> 从 Guardian 状态重新查找会话。',
  },
  'session-fetch-error': {
    problem: '获取会话消息失败',
    reason: 'OpenCode 返回错误 kind={kind}。服务可能正在重启、过载或暂时不可达。',
    next: '稍后重试；如果持续失败，检查 opencode serve 日志和 --base-url。',
  },
  'missing-argument': {
    problem: '命令参数不完整',
    reason: '参数缺失或组合不合法：{reason}',
    next: '运行 node tools/guardian/dashboard.mjs --help 查看中文用法。',
  },
});

export function listGuidedErrors() {
  return ERROR_CATALOG;
}

function interpolate(template, context) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = context?.[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

export function guidedError(key, context = {}) {
  const entry = ERROR_CATALOG[key] ?? {
    problem: '发生未知错误',
    reason: '没有匹配的错误说明：{key}。',
    next: '保留终端输出，并检查命令参数或 Guardian 状态文件。',
  };
  const data = { key, ...context };
  return [
    `问题: ${interpolate(entry.problem, data)}`,
    `原因: ${interpolate(entry.reason, data)}`,
    `下一步: ${interpolate(entry.next, data)}`,
  ].join('\n');
}
