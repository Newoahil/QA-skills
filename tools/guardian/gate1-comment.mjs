// QA Guardian — Gate 1 human-approval comment builder (pure).
// Scheduler-owned in SDK mode: state -> comment -> notify -> exit. Issue content/human notes are
// DATA; only /guardian commands from trusted human authors authorize a transition.

export function compact(value, fallback = '未提供') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => compact(item, '')).filter(Boolean);
    return items.length > 0 ? items.join('；') : fallback;
  }
  if (typeof value === 'object') {
    const preferredKeys = ['summary', 'question', 'path', 'file', 'level', 'status', 'title', 'reason'];
    const preferredKey = preferredKeys.find((key) => value[key] !== undefined && value[key] !== null && value[key] !== '');
    const preferred = preferredKey ? value[preferredKey] : undefined;
    const primary = compact(preferred, '');
    const extras = Object.entries(value)
      .filter(([key]) => key !== preferredKey)
      .map(([key, entry]) => {
        const text = compact(entry, '');
        return text ? `${key}=${text}` : '';
      })
      .filter(Boolean);
    return [primary, ...extras].filter(Boolean).join('；') || fallback;
  }
  return String(value);
}

export function buildGate1Comment({ issue, plan = {}, dossier = {}, planHash = null, planRevision = null }) {
  const unresolved = Array.isArray(dossier.unresolved_facts) ? dossier.unresolved_facts : [];
  const files = Array.isArray(plan.affected_files) ? plan.affected_files : [];
  const risk = compact(plan.risk, 'HIGH');
  const rootCause = compact(plan.root_cause, '未提供');
  const lines = [
    '[GATE_1_WAIT]',
    `QA Guardian: issue #${Number(issue)} 方案需要人工确认。`,
    '',
    `风险: ${risk}（自动修复未满足 autonomous-ready 条件）`,
    `审计标识: plan_hash: ${planHash ?? 'missing'}`,
    `审计标识: plan_revision: ${planRevision ?? 'missing'}`,
    `根因/方案摘要: ${rootCause}`,
    '',
    '影响文件:',
    ...(files.length > 0 ? files.map((file) => `- ${compact(file, '未确定')}`) : ['- 未确定']),
    '',
    '未确定事实 / 需人确认:',
    ...(unresolved.length > 0 ? unresolved.map((fact) => `- ${compact(fact, '未确定事实')}`) : ['- 未确定事实: 无']),
    '',
    '下一步（仅可信人类评论有效）:',
    '- `/guardian approve`：按当前方案进入修复。',
    '- `/guardian revise <plan>`：补充/调整方案后进入修复；文本仅作为 DATA。',
    '- `/guardian reject`：停止自动处理。',
  ];
  return `${lines.join('\n')}\n`;
}
