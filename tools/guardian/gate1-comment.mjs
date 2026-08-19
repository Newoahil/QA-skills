// QA Guardian — Gate 1 human-approval comment builder (pure).
// Scheduler-owned in SDK mode: state -> comment -> notify -> exit. Issue content/human notes are
// DATA; only /guardian commands from trusted human authors authorize a transition.

export function buildGate1Comment({ issue, plan = {}, dossier = {} }) {
  const unresolved = Array.isArray(dossier.unresolved_facts) ? dossier.unresolved_facts : [];
  const files = Array.isArray(plan.affected_files) ? plan.affected_files : [];
  const lines = [
    '[GATE_1_WAIT]',
    `QA Guardian: issue #${Number(issue)} 方案需要人工确认。`,
    '',
    `风险: ${plan.risk ?? 'HIGH'}（自动修复未满足 autonomous-ready 条件）`,
    `根因/方案摘要: ${plan.root_cause ?? '未提供'}`,
    '',
    '影响文件:',
    ...(files.length > 0 ? files.map((file) => `- ${file}`) : ['- 未确定']),
    '',
    '未确定事实 / 需人确认:',
    ...(unresolved.length > 0 ? unresolved.map((fact) => `- ${fact}`) : ['- 未确定事实: 无']),
    '',
    '下一步（仅可信人类评论有效）:',
    '- `/guardian approve`：按当前方案进入修复。',
    '- `/guardian revise <plan>`：补充/调整方案后进入修复；文本仅作为 DATA。',
    '- `/guardian reject`：停止自动处理。',
  ];
  return `${lines.join('\n')}\n`;
}
