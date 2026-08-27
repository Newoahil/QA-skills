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
  assert.match(body, /重新生成|更新方案/);
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
  assert.match(body, /HIGH/);
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
  assert.match(body, /HIGH/);
  assert.match(body, /自动修复未满足 autonomous-ready 条件/);
  assert.match(body, /surface=小程序分类列表文案/);
  assert.match(body, /分类列表文案预期不明确，无法安全修改/);
  assert.match(body, /client\/pages\/category\/index\.tsx/);
  assert.match(body, /期望替换成哪一句中文文案/);
  assert.match(body, /下一步（仅可信人类评论有效）/);
});

test('gate1 comment puts the actionable spec before noisy investigation details', () => {
  const body = buildGate1Comment({
    issue: 263,
    plan: {
      risk: 'HIGH',
      spec_goal: '修复支付宝小程序分类列表空状态和引导文案。',
      implementation_summary: '有商品时不显示「点击继续浏览」；无商品时显示「该分类暂无商品」。',
      primary_files: ['frontend/apps/alipay-miniapp/src/pages/classifyAgain/index.js'],
      acceptance_summary: [
        '有商品分类不出现「点击继续浏览」。',
        '无商品分类显示「该分类暂无商品」。',
        '分类切换、分页、商品卡片点击、搜索/筛选行为不变。',
      ],
      blocking_questions: ['是否只覆盖底部 Tab 分类页 pages/classifyAgain/index？'],
      root_cause: '当前分类列表文案状态与 issue 预期不一致。',
      affected_files: [
        { path: 'frontend/apps/alipay-miniapp/src/pages/classifyAgain/index.js', reason: '分类页文案入口' },
        { path: 'frontend/apps/alipay-miniapp/src/pages/classify/index.js', reason: '旧分类页候选入口，需确认是否本次处理' },
      ],
      non_goals: ['不改变分类切换、分页、商品卡片点击、搜索/筛选等既有行为。'],
      test_plan: ['覆盖有商品和无商品两种分类状态。'],
    },
    dossier: {
      unresolved_facts: [
        '无法读取完整 issue body。',
        '未启动小程序模拟器复现。',
        '无法读取 git log。',
      ],
    },
    planHash: 'sha256:263-spec',
    planRevision: 'rev-263-spec',
  });

  assert.doesNotMatch(body, /\[object Object\]/);
  assert.ok(body.indexOf('## 建议 Spec') < body.indexOf('<details>'));
  assert.ok(body.indexOf('有商品时不显示「点击继续浏览」') < body.indexOf('无法读取完整 issue body'));
  assert.match(body, /无商品时显示「该分类暂无商品」/);
  assert.match(body, /frontend\/apps\/alipay-miniapp\/src\/pages\/classifyAgain\/index\.js/);
  assert.match(body, /是否只覆盖底部 Tab 分类页/);
  assert.match(body, /<summary>调查详情、证据、完整风险和未确定事实<\/summary>/);
  assert.match(body, /审计标识: plan_hash: sha256:263-spec/);
});

test('gate1 comment shows product solution, B/C impact, and product usage acceptance before technical details', () => {
  const body = buildGate1Comment({
    issue: 355,
    plan: {
      risk: 'HIGH',
      spec_goal: '修复后台权限白名单匹配绕过。',
      product_solution: '后台接口权限从前缀式误命中改为按真实业务入口校验，同时保留已确认无需菜单权限的登录态入口。',
      side_impact: {
        b_side: ['后台管理端 create/modify/getList/delete 等接口按菜单权限表现一致。'],
        c_side: ['小程序绑定会话等 C 端登录态功能不因为后台菜单权限收紧而中断。'],
      },
      related_feature_impact: ['business/notifications 历史路径继续保留登录态免菜单权限语义。'],
      product_usage_acceptance: ['后台无菜单权限账号不能使用受控管理接口。', 'C 端用户绑定会话流程保持可用。'],
      implementation_summary: '收敛 otherNoAuthUriSet 语义并补齐权限映射测试。',
      primary_files: ['backend/AuthInterceptor.java'],
      acceptance_summary: ['权限校验符合产品预期。'],
      blocking_questions: ['哪些 otherNoAuthUriSet 条目仍被产品确认允许登录即可访问？'],
      root_cause: '白名单模糊匹配导致后台接口绕过菜单权限。',
      affected_files: ['backend/AuthInterceptor.java'],
      non_goals: ['不重做菜单权限模型。'],
      test_plan: ['覆盖后台受控接口和 C 端登录态入口。'],
    },
    dossier: { unresolved_facts: [] },
    planHash: 'sha256:355-product',
    planRevision: 'rev-355-product',
  });

  assert.doesNotMatch(body, /\[object Object\]/);
  assert.ok(body.indexOf('产品方案:') < body.indexOf('拟实施:'));
  assert.ok(body.indexOf('B 侧影响:') < body.indexOf('拟实施:'));
  assert.ok(body.indexOf('C 侧影响:') < body.indexOf('拟实施:'));
  assert.ok(body.indexOf('关联功能影响:') < body.indexOf('拟实施:'));
  assert.ok(body.indexOf('产品使用验收:') < body.indexOf('验收标准:'));
  assert.match(body, /后台接口权限从前缀式误命中改为按真实业务入口校验/);
  assert.match(body, /后台管理端 create\/modify\/getList\/delete/);
  assert.match(body, /小程序绑定会话等 C 端登录态功能/);
  assert.match(body, /C 端用户绑定会话流程保持可用/);
  assert.match(body, /\/guardian approve/);
  assert.match(body, /plan_hash: sha256:355-product/);
  assert.match(body, /plan_revision: rev-355-product/);
});
