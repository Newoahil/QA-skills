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

function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(values, fallback = '未提供') {
  const candidates = Array.isArray(values) ? values : [values];
  for (const value of candidates) {
    const text = compact(value, '');
    if (text) return text;
  }
  return fallback;
}

function bulletItems(items, fallback, limit = 5) {
  const rendered = arrayItems(items).map((item) => compact(item, '')).filter(Boolean).slice(0, limit);
  return rendered.length > 0 ? rendered.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function primaryFiles(plan) {
  const preferred = arrayItems(plan.primary_files);
  const fallback = arrayItems(plan.affected_files);
  return preferred.length > 0 ? preferred : fallback;
}

function blockingQuestions(plan) {
  return arrayItems(plan.blocking_questions);
}

function renderBlockingQuestion(item) {
  if (typeof item === 'string') {
    const question = compact(item, '');
    if (!question) return '';
    return `${question}（建议默认: 按当前方案继续执行。）`;
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const question = compact(item.question, '');
  const recommendedDefault = compact(item.recommended_default, '');
  if (!question || !recommendedDefault) return '';
  return `${question}（建议默认: ${recommendedDefault}）`;
}

function blockingQuestionItems(items, fallback, limit = 3) {
  const rendered = arrayItems(items)
    .map((item) => renderBlockingQuestion(item))
    .filter(Boolean)
    .slice(0, limit);
  return rendered.length > 0 ? rendered.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function sideImpactItems(plan, side) {
  const value = plan.side_impact?.[side];
  return arrayItems(value);
}

export function buildGate1Comment({ issue, plan = {}, dossier = {}, planHash = null, planRevision = null }) {
  const unresolved = blockingQuestions(plan);
  const files = primaryFiles(plan);
  const risk = compact(plan.risk, 'HIGH');
  const goal = firstText([plan.spec_goal, plan.root_cause], '未提供');
  const productSolution = firstText([plan.product_solution, plan.spec_goal, plan.implementation_summary], '未提供');
  const summary = firstText([plan.implementation_summary, plan.root_cause], '未提供');
  const acceptance = arrayItems(plan.acceptance_summary).length > 0 ? plan.acceptance_summary : plan.acceptance_criteria;
  const confirmationSection = unresolved.length > 0 ? [
    '',
    '需要你确认:',
    ...blockingQuestionItems(unresolved, '无', 3),
  ] : [];
  const lines = [
    '[GATE_1_WAIT]',
    `QA Guardian: issue #${Number(issue)} 方案需要人工确认。`,
    '',
    '## 建议 Spec',
    '',
    `目标: ${goal}`,
    '',
    `产品方案: ${productSolution}`,
    '',
    '反馈处理:',
    ...bulletItems(plan.revision_feedback_handling, '无', 6),
    '',
    'B 侧影响:',
    ...bulletItems(sideImpactItems(plan, 'b_side'), '无', 5),
    '',
    'C 侧影响:',
    ...bulletItems(sideImpactItems(plan, 'c_side'), '无', 5),
    '',
    '关联功能影响:',
    ...bulletItems(plan.related_feature_impact, '无', 6),
    '',
    '产品使用验收:',
    ...bulletItems(plan.product_usage_acceptance, '未提供', 6),
    '',
    '拟实施:',
    ...bulletItems([summary], '未提供'),
    '',
    '主要改动文件:',
    ...bulletItems(files, '未确定', 3),
    '',
    '验收标准:',
    ...bulletItems(acceptance, '未提供', 5),
    ...confirmationSection,
    '',
    '风险摘要:',
    `- ${risk}（自动修复未满足 autonomous-ready 条件）`,
    '',
    '下一步（仅可信人类评论有效）:',
    '- `/guardian approve`：按当前方案进入修复，并接受全部建议默认值。',
    '- `/guardian revise <feedback>`：补充信息或调整要求；系统会重新生成/更新方案并再次等待确认，文本仅作为 DATA。',
    '- `/guardian reject`：停止自动处理。',
    '',
    '<details>',
    '<summary>调查详情、证据、完整风险和未确定事实</summary>',
    '',
    `审计标识: plan_hash: ${planHash ?? 'missing'}`,
    `审计标识: plan_revision: ${planRevision ?? 'missing'}`,
    `根因/方案摘要: ${compact(plan.root_cause, '未提供')}`,
    '',
    '完整影响文件:',
    ...bulletItems(plan.affected_files, '未确定'),
    '',
    '非目标:',
    ...bulletItems(plan.non_goals, '未提供'),
    '',
    '测试计划:',
    ...bulletItems(plan.test_plan, '未提供'),
    '',
    '未确定事实 / 需人确认:',
    ...bulletItems(dossier.unresolved_facts, '无'),
    '',
    '</details>',
  ];
  return `${lines.join('\n')}\n`;
}
