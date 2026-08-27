import assert from 'node:assert/strict';
import test from 'node:test';

import { canEnterFixing, validatePlan } from '../../tools/guardian/plan-validator.mjs';

const dossier = {
  issue: 42,
  issue_class: 'bug',
  hypotheses: [{ id: 'H1', statement: 'root cause' }],
  evidence: [{ id: 'E1', kind: 'runtime_reproduction', source: 'test', observation: 'reproduced', supports: ['H1'], contradicts: [] }],
  unresolved_facts: [],
  acceptance_criteria: [],
  selected_hypothesis: 'H1',
};

function plan(overrides = {}) {
  return {
    root_cause: 'configuration guard rejects the valid path',
    affected_files: ['src/config.mjs'],
    non_goals: ['do not change deployment'],
    test_plan: ['add regression test'],
    test_commands: [['node', '--test', 'tests/guardian/plan-validator.test.mjs']],
    acceptance_criteria: ['request returns success'],
    rollback_plan: 'revert one commit',
    evidence_ids: ['E1'],
    risk: 'LOW',
    risk_assessment: {
      certain: true,
      lowDangerSurfaceOnly: true,
      touchedSurfaces: [],
      localImpact: true,
      diffLines: 10,
      reproducibleOracle: true,
      scopeExpansionRequested: false,
    },
    ...overrides,
  };
}

function productPlan(overrides = {}) {
  return plan({
    product_solution: '小程序用户提交申请取消动作，后端固定进入 CANCEL_APPLY(14) 并等待后台审核。',
    revision_feedback_handling: ['已按反馈保留 CANCEL_APPLY(14)，并把重复申请只能等待审核纳入产品规则。'],
    side_impact: {
      b_side: ['后台/运营继续按 CANCEL_APPLY(14) 处理待审核取消申请，且不会收到重复申请副作用。'],
      c_side: ['用户重复点击申请取消时看到等待审核语义，不会再次提交可篡改状态。'],
    },
    related_feature_impact: ['已调查 setUserOrderStatus 相关入口，C 端取消申请迁移后不再暴露任意 status 改写。'],
    product_usage_acceptance: ['同一订单重复申请取消只产生一次待审核申请，其余重试按当前状态幂等返回。'],
    ...overrides,
  });
}

test('valid evidence-backed LOW bug plan is autonomous-ready', () => {
  const result = validatePlan(plan(), dossier);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, true);
  assert.equal(canEnterFixing(plan(), dossier), true);
});

test('product planning fields are optional for old plans and preserved for new plans', () => {
  const legacy = validatePlan(plan(), dossier);
  assert.equal(legacy.valid, true);
  assert.equal(legacy.errors.some((error) => error.startsWith('plan:missing-product_')), false);
  assert.equal(legacy.errors.includes('plan:missing-side_impact'), false);

  const productFields = {
    product_solution: '后台菜单权限从模糊匹配改为精确匹配，保留登录态免菜单权限入口。',
    side_impact: {
      b_side: ['后台用户访问 create/modify/getList/delete 时按菜单权限校验。'],
      c_side: ['小程序绑定会话等登录态入口不新增菜单权限要求。'],
    },
    related_feature_impact: ['现有 business/notifications 历史路径语义保持不变。'],
    product_usage_acceptance: ['后台无权限账号访问受控接口时被拒绝，有权限账号原流程可继续使用。'],
  };
  const next = validatePlan(plan(productFields), dossier);
  assert.equal(next.valid, true);
  assert.equal(next.plan.product_solution, productFields.product_solution);
  assert.deepEqual(next.plan.side_impact, productFields.side_impact);
  assert.deepEqual(next.plan.related_feature_impact, productFields.related_feature_impact);
  assert.deepEqual(next.plan.product_usage_acceptance, productFields.product_usage_acceptance);
});

test('revised plans require concrete product impact and feedback handling fields', () => {
  const result = validatePlan(plan(), dossier, { revisionFeedback: '调查 setUserOrderStatus 依赖，并确认申请取消只能申请一次' });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('plan:missing-product_solution'), true);
  assert.equal(result.errors.includes('plan:missing-revision_feedback_handling'), true);
  assert.equal(result.errors.includes('plan:missing-side_impact:b_side'), true);
  assert.equal(result.errors.includes('plan:missing-side_impact:c_side'), true);
  assert.equal(result.errors.includes('plan:missing-related_feature_impact'), true);
  assert.equal(result.errors.includes('plan:missing-product_usage_acceptance'), true);
});

test('revised plans reject placeholder product impact values', () => {
  const result = validatePlan(productPlan({
    product_solution: '未提供',
    revision_feedback_handling: ['无'],
    side_impact: { b_side: ['无影响'], c_side: ['N/A'] },
    related_feature_impact: ['不涉及'],
    product_usage_acceptance: ['暂无'],
  }), dossier, { revisionFeedback: '重复申请只能申请一次' });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('plan:missing-product_solution'), true);
  assert.equal(result.errors.includes('plan:missing-revision_feedback_handling'), true);
  assert.equal(result.errors.includes('plan:missing-side_impact:b_side'), true);
  assert.equal(result.errors.includes('plan:missing-side_impact:c_side'), true);
  assert.equal(result.errors.includes('plan:missing-related_feature_impact'), true);
  assert.equal(result.errors.includes('plan:missing-product_usage_acceptance'), true);
});

test('revised plans pass with concrete feedback assimilation and product impacts', () => {
  const result = validatePlan(productPlan(), dossier, { revisionFeedback: '重复申请只能申请一次' });

  assert.equal(result.valid, true);
  assert.equal(result.plan.revision_feedback_handling.length, 1);
  assert.match(result.plan.side_impact.b_side[0], /后台/);
  assert.match(result.plan.product_usage_acceptance[0], /重复申请取消只产生一次/);
});

test('missing plan fields block fixing', () => {
  const result = validatePlan({ risk: 'LOW' }, dossier);
  assert.equal(result.valid, false);
  assert.equal(result.autonomousReady, false);
  assert.equal(canEnterFixing({ risk: 'LOW' }, dossier), false);
});

test('request LOW plan is blocked from autonomous execution', () => {
  const request = { ...dossier, issue_class: 'request', acceptance_criteria: [{ id: 'AC1' }] };
  const result = validatePlan(plan(), request);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('plan:request-cannot-autonomously-low'), true);
});

test('unresolved facts make plan non-autonomous', () => {
  const uncertain = { ...dossier, unresolved_facts: [{ id: 'F1', unknown: 'production state' }] };
  const result = validatePlan(plan(), uncertain);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.gateRequired, true);
});

test('unknown evidence id blocks plan', () => {
  const result = validatePlan(plan({ evidence_ids: ['E404'] }), dossier);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('plan:unknown-evidence:E404'), true);
});

test('HIGH plan is structurally valid but still requires Gate 1', () => {
  const result = validatePlan(plan({ risk: 'HIGH' }), dossier);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.gateRequired, true);
});

test('model LOW without mechanical risk assessment requires Gate 1', () => {
  const result = validatePlan(plan({ risk_assessment: undefined }), dossier);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.gateRequired, true);
  assert.equal(result.mechanicalRisk.risk, 'HIGH');
  assert.ok(result.errors.includes('plan:risk-assessment-not-low:uncertain-or-insufficient-info'));
});

test('mechanical HIGH overrides model LOW and blocks autonomous fixing', () => {
  const result = validatePlan(plan({ risk_assessment: { certain: true, lowDangerSurfaceOnly: false } }), dossier);
  assert.equal(result.valid, true);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.gateRequired, true);
  assert.equal(result.mechanicalRisk.risk, 'HIGH');
  assert.ok(result.errors.some((error) => error.startsWith('plan:risk-assessment-not-low:')));
});

test('valid plan materializes executable test_commands as argv arrays', () => {
  const result = validatePlan(plan({ test_commands: [['node', 'frontend/apps/alipay-miniapp/scripts/test-category-builder-runtime.js']] }), dossier);
  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.test_commands, [['node', 'frontend/apps/alipay-miniapp/scripts/test-category-builder-runtime.js']]);
});

test('valid Python pytest command is accepted and normalized into affected_files', () => {
  const result = validatePlan(plan({
    affected_files: ['src/config.mjs'],
    test_commands: [['python', '-m', 'pytest', 'tests/guardian/test_plan_validator.py']],
  }), dossier);

  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.test_commands, [['python', '-m', 'pytest', 'tests/guardian/test_plan_validator.py']]);
  assert.deepEqual(result.plan.affected_files, ['src/config.mjs', 'tests/guardian/test_plan_validator.py']);
});

test('pytest node id is stripped to its file path before affected_files merge', () => {
  const result = validatePlan(plan({
    affected_files: ['src/config.mjs'],
    test_commands: [['py', '-m', 'pytest', 'tests/guardian/test_plan_validator.py::test_accepts_python'] ],
  }), dossier);

  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.test_commands, [['py', '-m', 'pytest', 'tests/guardian/test_plan_validator.py::test_accepts_python']]);
  assert.deepEqual(result.plan.affected_files, ['src/config.mjs', 'tests/guardian/test_plan_validator.py']);
});

test('dotted unittest targets are accepted without creating fake affected file paths', () => {
  const result = validatePlan(plan({
    affected_files: ['src/config.mjs'],
    test_commands: [['python', '-m', 'unittest', 'tests.guardian.test_plan_validator']],
  }), dossier);

  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.test_commands, [['python', '-m', 'unittest', 'tests.guardian.test_plan_validator']]);
  assert.deepEqual(result.plan.affected_files, ['src/config.mjs']);
});

test('unsafe Python command keeps the existing plan:test_commands error path', () => {
  const result = validatePlan(plan({ test_commands: [['python', 'script.py']] }), dossier);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('plan:test_commands:test command is not allowed'));
});

test('valid plan normalizes primary and declared test command files into affected_files', () => {
  const result = validatePlan(plan({
    primary_files: ['src/config.mjs', 'tests/guardian/new-regression.test.mjs'],
    affected_files: ['src/config.mjs'],
    test_commands: [['node', '--test', 'tests/guardian/new-regression.test.mjs']],
  }), dossier);

  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.affected_files, ['src/config.mjs', 'tests/guardian/new-regression.test.mjs']);
});

test('primary_files display suffix is stripped before validation and scope merge', () => {
  const result = validatePlan(plan({
    affected_files: ['src/config.mjs'],
    primary_files: ['src/display.mjs：中文说明', { path: 'src/other.mjs：另一处说明' }],
  }), dossier);

  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.affected_files, [
    'src/config.mjs',
    'src/display.mjs',
    'src/other.mjs',
    'tests/guardian/plan-validator.test.mjs',
  ]);
});

test('declared plan file annotations are stripped before validation and scope merge', () => {
  const result = validatePlan(plan({
    primary_files: [
      'backend/services/components-center/src/main/java/com/hzsx/rent/components/center/controller/SendSmsController.java（实现 `simpleSend` 的非假成功返回与兼容标识）',
    ],
    affected_files: [
      'backend/services/components-center/src/main/java/com/hzsx/rent/components/center/controller/SendSmsController.java（本次修改）',
      'backend/services/components-center/src/test/java/com/hzsx/rent/components/center/controller/SendSmsControllerTest.java（新增/改造控制器行为测试）',
    ],
  }), dossier);

  assert.equal(result.valid, true);
  assert.deepEqual(result.plan.affected_files, [
    'backend/services/components-center/src/main/java/com/hzsx/rent/components/center/controller/SendSmsController.java',
    'backend/services/components-center/src/test/java/com/hzsx/rent/components/center/controller/SendSmsControllerTest.java',
    'tests/guardian/plan-validator.test.mjs',
  ]);
});

test('declared plan file annotation stripping does not allow unsafe prose', () => {
  const result = validatePlan(plan({ affected_files: ['这不是一个路径（说明）'] }), dossier);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('plan:unsafe-affected_files:这不是一个路径'));
});

test('primary_files display suffix cannot hide an unsafe path prefix', () => {
  const result = validatePlan(plan({ primary_files: ['../outside.test.mjs：说明'] }), dossier);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('plan:unsafe-primary_files:../outside.test.mjs'));
});

test('plan validation rejects unsafe declared primary files', () => {
  const result = validatePlan(plan({ primary_files: ['../outside.test.mjs'] }), dossier);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('plan:unsafe-primary_files:../outside.test.mjs'));
});

test('plan validation accepts legitimate CJK relative paths', () => {
  const cjkPath = 'docs/短信/2026-06-26-阿里云短信迁移阶段0准备与治理开发文档.md';
  const result = validatePlan(plan({ primary_files: [cjkPath], affected_files: [cjkPath] }), dossier);
  assert.equal(result.errors.some((error) => error.startsWith('plan:unsafe-')), false);
});

test('plan validation rejects mid-path traversal segments', () => {
  const result = validatePlan(plan({ primary_files: ['a/../outside.test.mjs'] }), dossier);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('plan:unsafe-primary_files:a/../outside.test.mjs'));
});

test('plan validation rejects control characters in declared files', () => {
  const result = validatePlan(plan({ primary_files: ['docs/x\nmalicious.md'] }), dossier);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith('plan:unsafe-primary_files')));
});

test('plan validation requires executable test_commands before Gate 1 or fixing', () => {
  const result = validatePlan(plan({ test_commands: undefined }), dossier);
  assert.equal(result.valid, false);
  assert.equal(result.autonomousReady, false);
  assert.equal(result.errors.includes('plan:missing-test_commands'), true);
  assert.equal(result.plan, null);
});

test('plan validation rejects string and unsafe test_commands', () => {
  for (const commands of [
    ['node frontend/apps/alipay-miniapp/scripts/test-category-builder-runtime.js'],
    [['node', 'frontend/apps/alipay-miniapp/scripts/../../secret.js']],
  ]) {
    const result = validatePlan(plan({ test_commands: commands }), dossier);
    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => error.startsWith('plan:test_commands')), true);
  }
});
