import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGate1Comment, compact } from '../../tools/guardian/gate1-comment.mjs';

test('gate1 comment carries marker, plan summary, unresolved facts, and commands', () => {
  const body = buildGate1Comment({
    issue: 211,
    plan: { risk: 'LOW', root_cause: 'color', affected_files: ['a.jsx'] },
    dossier: { unresolved_facts: ['exact pink token?'] },
    planHash: 'sha256:plan-a',
    planRevision: 'inv-a',
  });
  assert.equal(body.split('\n')[0], '[GATE_1_WAIT]');
  assert.equal(body.includes('/guardian approve'), true);
  assert.equal(body.includes('/guardian revise'), true);
  assert.equal(body.includes('/guardian reject'), true);
  assert.equal(body.includes('exact pink token?'), true);
  assert.equal(body.includes('plan_hash: sha256:plan-a'), true);
  assert.equal(body.includes('plan_revision: inv-a'), true);
});

test('gate1 comment renders structured plan and dossier fields without object placeholders', () => {
  const body = buildGate1Comment({
    issue: 205,
    plan: {
      risk: { level: 'HIGH', reason: 'oracle missing' },
      root_cause: { summary: '分类列表空状态文案缺少明确预期', evidence: ['issue body underspecified'] },
      affected_files: [{ path: 'src/pages/category/index.tsx', reason: 'empty state copy' }],
    },
    dossier: {
      unresolved_facts: [
        { question: '期望空状态文案是什么？', source: 'issue #205' },
        { question: '影响环境是什么？', source: 'issue #205' },
      ],
    },
    planHash: 'sha256:plan-205',
    planRevision: 'rev-205',
  });

  assert.doesNotMatch(body, /\[object Object\]/);
  assert.match(body, /风险: HIGH/);
  assert.match(body, /oracle missing/);
  assert.match(body, /分类列表空状态文案缺少明确预期/);
  assert.match(body, /src\/pages\/category\/index\.tsx/);
  assert.match(body, /期望空状态文案是什么/);
  assert.match(body, /影响环境是什么/);
});

test('compact renders arbitrary nested objects without JavaScript object placeholders', () => {
  const text = compact({
    reason: '需要人工确认文案预期',
    severity: { level: 'HIGH', source: '自动风险评估' },
    evidence: [
      { path: 'pages/category/index.tsx', summary: '分类页空状态文案' },
      { question: '期望替换文案是什么？', source: 'issue #263' },
    ],
  });

  assert.doesNotMatch(text, /\[object Object\]/);
  assert.match(text, /需要人工确认文案预期/);
  assert.match(text, /severity=HIGH/);
  assert.match(text, /source=自动风险评估/);
  assert.match(text, /pages\/category\/index\.tsx/);
  assert.match(text, /期望替换文案是什么/);
  assert.doesNotMatch(text, /reason=需要人工确认文案预期/);
});

test('gate1 comment renders issue 263 shaped structured plan in readable Chinese', () => {
  const body = buildGate1Comment({
    issue: 263,
    plan: {
      risk: { level: 'HIGH', reason: '自动修复未满足 autonomous-ready 条件', details: { surface: '小程序分类列表文案' } },
      root_cause: {
        summary: '分类列表文案预期不明确，无法安全修改',
        evidence: [
          { source: 'issue-data.json', observation: '无法读取完整正文' },
          { source: '运行时', observation: '未启动小程序模拟器复现' },
        ],
      },
      affected_files: [
        { path: 'client/pages/category/index.tsx', reason: '分类列表页面候选入口' },
        { path: 'server/category/service.ts', reason: '可能由后端返回文案' },
      ],
    },
    dossier: {
      unresolved_facts: [
        { question: '期望替换成哪一句中文文案？', source: 'issue #263' },
        { question: '当前文案来自前端常量还是后端数据？', source: '代码路径未确认' },
      ],
    },
    planHash: 'sha256:263',
    planRevision: 'rev-263',
  });

  assert.doesNotMatch(body, /\[object Object\]/);
  assert.match(body, /风险: HIGH/);
  assert.match(body, /自动修复未满足 autonomous-ready 条件/);
  assert.match(body, /surface=小程序分类列表文案/);
  assert.match(body, /分类列表文案预期不明确，无法安全修改/);
  assert.match(body, /client\/pages\/category\/index\.tsx/);
  assert.match(body, /期望替换成哪一句中文文案/);
  assert.match(body, /下一步（仅可信人类评论有效）/);
});
