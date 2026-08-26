import { STATES } from './state.mjs';

function command(text, description) {
  return Object.freeze({ text, description });
}

function hint(category, headline, reason, commands = []) {
  return Object.freeze({ category, headline, reason, commands: Object.freeze(commands) });
}

function approvedPlan(record) {
  return Boolean(record?.gate_1_approved_comment_id)
    && record.gate_1_approved_plan_hash === record.plan_hash
    && record.gate_1_approved_plan_revision === record.plan_revision
    && record.plan_status === 'valid'
    && record.dossier_status === 'valid';
}

function handbackHint(record) {
  if (record.last_error_class === 'qa-needs-human-review' && record.branch && (record.evidence_retries ?? 0) === 0) {
    return hint('automatic', '等待 scheduler 自动恢复一次', 'QA human-review 可能来自已修复的 Supervisor evidence 噪声；下一轮会回到 FIXING 重跑。');
  }
  if (record.last_error_class === 'supervisor-stage-failed' && record.qa_verdict_status === 'PASS' && record.branch) {
    return hint('automatic', '等待 scheduler 自动恢复 finalization', 'QA 已 PASS，但 Supervisor finalization 失败；下一轮会继续修复分支收尾。');
  }
  if (record.last_error_class === 'supervisor-run-failed' && approvedPlan(record)) {
    return hint('automatic', '等待 scheduler 自动恢复已批准计划', '运行前置步骤失败但计划仍已批准；环境/工作区恢复后会继续。');
  }
  if (record.handed_back_reason === 'fix-rounds-exceeded') {
    return hint('human', '需要人工决定是否继续修复', '修复/QA 循环已达到上限。', [
      command('/guardian continue <说明>', '基于现有 QA 报告继续当前修复轮次'),
      command('/guardian retry', '从调查阶段重新开始'),
    ]);
  }
  if (record.handed_back_reason === 'reject') return hint('done', '已人工拒绝，无需操作', '该 issue 已被交回人工并终止。');
  if (record.handed_back_reason === 'stalled') {
    return hint('human', '需要人工检查 stalled 原因', '自动 stalled 恢复次数已耗尽。', [command('/guardian retry', '确认环境恢复后重新开始')]);
  }
  return hint('human', '需要人工确认下一步', '当前处于交回人工状态。', [command('/guardian retry', '重新进入调查流程')]);
}

export function nextActionHint(record) {
  if (!record) return hint('blocked', '暂无选中议题', '队列为空或筛选隐藏了所有议题。');
  switch (record.state) {
    case STATES.DISCOVERED:
      return hint('automatic', '等待 scheduler 开始调查', '新 issue 已进入候选队列。');
    case STATES.INVESTIGATING:
      return hint('automatic', '等待调查/计划完成', 'Guardian 正在收集证据、生成或刷新计划。');
    case STATES.GATE_1_WAIT:
      return hint('human', '需要可信账号评论 /guardian approve', 'HIGH 风险计划等待 Gate 1 人工确认。', [
        command('/guardian approve', '认可计划并进入修复'),
        command('/guardian revise <意见>', '带反馈重新调查/修订计划'),
        command('/guardian reject', '拒绝本次处理并交回人工'),
      ]);
    case STATES.FIXING:
      return hint('automatic', '等待 fixer 修复或 Supervisor 收尾', '修复阶段进行中；若已有分支和 QA PASS，下一步通常是 finalization。');
    case STATES.VERIFYING:
      return hint('automatic', '等待只读 QA 验证', 'QA agent 正在独立验证当前 diff。');
    case STATES.GATE_2_WAIT:
      return hint('human', '需要人工 review PR', 'PR 已打开，等待 Gate 2 人工合并或要求返工。', [
        command('/guardian rework <意见>', '要求基于 PR 反馈继续修复'),
        command('/guardian followup <问题>', '已完成/等待合并后开启新一轮跟进'),
      ]);
    case STATES.HANDED_BACK:
      return handbackHint(record);
    case STATES.DONE:
      return hint('done', '已完成，无需操作', 'Issue 已到 DONE。');
    case STATES.STALLED:
      return hint('automatic', '等待 scheduler stalled 恢复', '租约过期被记录为 STALLED；未超限时下一轮会自动恢复。');
    default:
      return hint('blocked', '未知状态，需要人工检查', `未识别状态: ${String(record.state)}`);
  }
}

export function formatActionHintLines(record) {
  const result = nextActionHint(record);
  const lines = [`下一步: ${result.headline}`, `原因: ${result.reason}`, `类型: ${result.category}`];
  if (result.commands.length > 0) {
    lines.push('可用命令:');
    for (const item of result.commands) lines.push(`- ${item.text} — ${item.description}`);
  }
  return lines;
}
