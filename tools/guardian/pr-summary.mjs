import { spawnSync } from 'node:child_process';
import path from 'node:path';

function line(value, fallback = '未提供') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text.replace(/\s+/g, ' ') : fallback;
}

function list(values, fallback) {
  const raw = Array.isArray(values) ? values : [values];
  const items = raw.map((value) => line(value, '')).filter(Boolean);
  return items.length > 0 ? items.map((value) => `- ${value}`) : [`- ${fallback}`];
}

function affectedFiles(plan) {
  return Array.isArray(plan?.affected_files) ? plan.affected_files.map((file) => line(file, '')).filter(Boolean) : [];
}

function sqlFiles(files) {
  return files.filter((file) => /(?:^|\/)(?:db\/migration\/|migrations\/)|\.sql$/i.test(file) || /(?:^|\/)V\d+__.*\.sql$/i.test(file));
}

function scriptAndConfigFiles(files) {
  return files.filter((file) => /(?:\.sh|\.ps1|\.bat|\.cmd|\.py)$/i.test(file)
    || /(?:^|\/)(?:deploy|scripts|\.github\/workflows)\//i.test(file)
    || /(?:docker-compose|\.env\.example|config|schema)\b/i.test(file)
    || /\.(?:ya?ml|json)$/i.test(file));
}

export function collectCommitSummaries({ repoDir, base, head, run = spawnSync }) {
  const cwd = path.resolve(line(repoDir, '.'));
  const range = `${line(base, 'dev')}..${line(head, '')}`;
  if (range.endsWith('..')) throw new Error('collectCommitSummaries: head branch is required');
  const result = run('git', ['log', '--oneline', '--no-decorate', range], {
    cwd, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git log for PR commits failed: ${result.stderr || 'unknown'}`);
  return String(result.stdout).split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean).map((raw) => {
    const [sha, ...rest] = raw.split(/\s+/);
    return { sha, title: rest.join(' ') };
  });
}

export function buildGuardianPrBody({ issue, issueTitle, base, head, plan, dossier, verdict, commits }) {
  const files = affectedFiles(plan);
  const sql = sqlFiles(files);
  const scripts = scriptAndConfigFiles(files);
  const commitLines = Array.isArray(commits) && commits.length > 0
    ? commits.map((commit) => `- \`${line(commit.sha, 'unknown')}\` - ${line(commit.title, 'no headline')}`)
    : ['- 未能在分支范围内找到提交记录。'];
  const testPlan = Array.isArray(plan?.test_plan) ? plan.test_plan : plan?.test_plan;
  const acceptance = Array.isArray(plan?.acceptance_criteria) ? plan.acceptance_criteria : plan?.acceptance_criteria;

  return [
    '## PR 概述',
    '',
    `本 PR 由 QA Guardian 自动创建，将分支 \`${line(head)}\` 合入 \`${line(base, 'dev')}\`，处理 issue #${Number(issue)}。`,
    `Issue 标题：${line(issueTitle)}`,
    `风险等级：${line(plan?.risk, '未标注')}`,
    `问题类型：${line(dossier?.issue_class, '未标注')}`,
    '',
    '## 本次变更内容',
    '',
    '### 影响文件',
    ...list(files, 'plan 未提供 affected_files'),
    '',
    '### 根因 / 方案摘要',
    `- ${line(plan?.root_cause)}`,
    '',
    '### 验收标准',
    ...list(acceptance, 'plan 未提供 acceptance_criteria'),
    '',
    '## 关联 Commit SHA',
    '',
    ...commitLines,
    '',
    '## SQL / 数据库影响',
    '',
    ...(sql.length > 0 ? sql.map((file) => `- ${file}`) : ['本 PR 不包含 SQL 文件变更，未发现新增 Flyway / DDL / DML 脚本。']),
    '',
    '## 关联脚本与配置文件',
    '',
    ...(scripts.length > 0 ? scripts.map((file) => `- ${file}`) : ['本 PR 不涉及脚本或配置文件变更。']),
    '',
    '## 测试与验证说明',
    '',
    `- 独立 QA 结论：Overall Status: ${line(verdict?.status, 'UNKNOWN')}`,
    `- QA 报告指纹：${line(verdict?.report_hash, 'missing')}`,
    ...list(testPlan, 'plan 未提供 test_plan'),
    '',
    '## 人工评审说明',
    '',
    '- QA Guardian 已在 Gate 2 停止，不会自动合并 PR，也不会自动关闭 issue。',
    '- 请人工评审 PR；如需返工，请在 issue 中由可信维护者发起 rework 流程。',
  ].join('\n');
}

export function buildGuardianPrBodyFromAgentSummary({ summary, issue, base, head, verdict, commits }) {
  const commitLines = Array.isArray(commits) && commits.length > 0
    ? commits.map((commit) => `- \`${line(commit.sha, 'unknown')}\` - ${line(commit.title, 'no headline')}`)
    : ['- 未能在分支范围内找到提交记录。'];
  return [
    String(summary ?? '').trim(),
    '',
    '## 关联 Commit SHA',
    '',
    ...commitLines,
    '',
    '## QA Guardian 机器校验',
    '',
    `- Issue：#${Number(issue)}`,
    `- 分支：\`${line(head)}\` -> \`${line(base, 'dev')}\``,
    `- 独立 QA 结论：Overall Status: ${line(verdict?.status, 'UNKNOWN')}`,
    `- QA 报告指纹：${line(verdict?.report_hash, 'missing')}`,
    '- QA Guardian 已在 Gate 2 停止，不会自动合并 PR，也不会自动关闭 issue。',
  ].join('\n');
}
