export const projectPlanningFixture = Object.freeze({
  id: 'project-planning-three-module-fixture',
  targetKind: 'explicit-current-project',
  diffRequired: false,
  capabilities: Object.freeze({
    web: false,
    browser: false,
    cli: true,
    api: true,
  }),
  modules: Object.freeze([
    Object.freeze({
      id: 'auth',
      type: 'entry',
      entries: Object.freeze(['src/auth/login.mjs']),
      tests: Object.freeze(['tests/auth-login.test.mjs']),
      dependsOn: Object.freeze(['shared-lib']),
      acceptance: Object.freeze(['AC-AUTH-SESSION']),
      sources: Object.freeze(['README.md', 'requirements/auth.md', 'src/auth/login.mjs']),
    }),
    Object.freeze({
      id: 'billing',
      type: 'entry',
      entries: Object.freeze(['src/billing/checkout.mjs']),
      tests: Object.freeze(['tests/billing-checkout.test.mjs']),
      dependsOn: Object.freeze(['shared-lib']),
      acceptance: Object.freeze(['AC-BILLING-TOTAL']),
      sources: Object.freeze(['requirements/billing.md', 'src/billing/checkout.mjs']),
    }),
    Object.freeze({
      id: 'shared-lib',
      type: 'shared-dependency',
      entries: Object.freeze(['src/shared/money.mjs', 'src/shared/session-token.mjs']),
      tests: Object.freeze(['tests/shared-money.test.mjs']),
      usedBy: Object.freeze(['auth', 'billing']),
      acceptance: Object.freeze(['AC-SHARED-CONSISTENCY']),
      sources: Object.freeze(['src/shared/money.mjs', 'src/shared/session-token.mjs', 'package.json']),
    }),
  ]),
  lowImpactUtility: Object.freeze({
    id: 'docs-format-helper',
    path: 'scripts/docs-format-helper.mjs',
    sources: Object.freeze(['scripts/docs-format-helper.mjs']),
    omissionReason: 'Formatting helper has no runtime dependency from auth, billing, shared-lib, or the key user flow.',
  }),
  keyFlows: Object.freeze([
    Object.freeze({
      id: 'KF-AUTH-BILLING-SHARED',
      entry: 'auth',
      path: Object.freeze(['auth', 'billing', 'shared-lib']),
      dependencies: Object.freeze(['auth', 'billing', 'shared-lib']),
      affectedModules: Object.freeze(['auth', 'billing', 'shared-lib']),
      importance: 'important',
      priority: 'Must Verify',
      reasons: Object.freeze(['Cross-module authenticated checkout flow crosses both entry modules and the shared dependency.']),
      sources: Object.freeze(['requirements/auth.md', 'requirements/billing.md', 'src/auth/login.mjs', 'src/billing/checkout.mjs', 'src/shared/money.mjs']),
      expectedResult: 'Authenticated checkout preserves session identity and billing total formatting through shared-lib.',
      verificationIntent: 'Plan API/integration coverage for the cross-module auth -> billing -> shared-lib flow before execution.',
    }),
  ]),
  subjectiveDecision: Object.freeze({
    id: 'H-UX-COPY-OWNER',
    evidence: 'Executable CLI/API smoke evidence exists for auth and billing contract shape.',
    decisionQuestion: 'Product owner must decide whether checkout confirmation copy is acceptable for the target market.',
  }),
});

export function buildProjectPreflight({ fixture = projectPlanningFixture, diff = null } = {}) {
  return Object.freeze({
    explicitTarget: true,
    snapshotRecorded: true,
    diffRequired: fixture.diffRequired,
    suppliedDiff: diff,
    status: fixture.diffRequired === false ? 'OPEN' : 'BLOCKED',
  });
}

export function inventoryProjectModules(fixture = projectPlanningFixture) {
  return fixture.modules.map((module) => Object.freeze({
    moduleId: module.id,
    type: module.type,
    entries: [...module.entries],
    tests: [...module.tests],
    sharedDependencies: [...(module.dependsOn || [])],
    usedBy: [...(module.usedBy || [])],
    sources: [...module.sources],
  }));
}

export function classifyProjectItems(fixture = projectPlanningFixture) {
  const moduleClassifications = fixture.modules.map((module) => {
    const sharedReason = module.id === 'shared-lib'
      ? 'Shared dependency used by auth and billing; failure can invalidate both important modules.'
      : 'Entry module for a core project capability with authoritative acceptance criteria.';
    return Object.freeze({
      itemId: module.id,
      priority: 'Must Verify',
      importance: 'important',
      reasons: Object.freeze([sharedReason]),
      sources: module.sources,
    });
  });

  const keyFlowClassifications = fixture.keyFlows.map((flow) => Object.freeze({
    itemId: flow.id,
    itemType: 'key flow',
    priority: flow.priority,
    importance: flow.importance,
    reasons: Object.freeze([...flow.reasons]),
    sources: Object.freeze([...flow.sources]),
    affectedModules: Object.freeze([...flow.affectedModules]),
  }));

  return Object.freeze([
    ...moduleClassifications,
    ...keyFlowClassifications,
    Object.freeze({
      itemId: fixture.lowImpactUtility.id,
      priority: 'Optional',
      importance: 'lower priority',
      reasons: Object.freeze([fixture.lowImpactUtility.omissionReason]),
      sources: fixture.lowImpactUtility.sources,
    }),
  ]);
}

export function planKeyFlows(fixture = projectPlanningFixture) {
  return fixture.keyFlows.map((flow) => Object.freeze({
    flowId: flow.id,
    entry: flow.entry,
    dependencies: [...flow.dependencies],
    affectedModules: [...flow.affectedModules],
    importance: flow.importance,
    priority: flow.priority,
    reasons: [...flow.reasons],
    sources: [...flow.sources],
    expectedResult: flow.expectedResult,
    verificationIntent: flow.verificationIntent,
  }));
}

export function evaluateProjectPlanGate({ missingPrerequisites = [], subjectiveDecision = null } = {}) {
  if (missingPrerequisites.length > 0) {
    const prerequisite = missingPrerequisites[0];
    return Object.freeze({
      status: 'BLOCKED',
      missingPrerequisite: prerequisite,
      rerunCondition: `Provide ${prerequisite}, then rerun Project QA planning for the affected billing acceptance criterion.`,
    });
  }

  if (subjectiveDecision) {
    return Object.freeze({
      status: 'NEEDS_HUMAN_REVIEW',
      humanReviewItem: subjectiveDecision.id,
      decisionQuestion: subjectiveDecision.decisionQuestion,
    });
  }

  return Object.freeze({ status: 'OPEN' });
}

export function planNonWebVerification(fixture = projectPlanningFixture) {
  return Object.freeze({
    browserForced: false,
    plannedLayers: Object.freeze(['Static/unit', 'API/integration']),
    omissions: Object.freeze([
      Object.freeze({
        layer: 'E2E/system browser',
        status: 'Explicitly Not Verified',
        reason: fixture.capabilities.web || fixture.capabilities.browser
          ? 'Browser capability is available and may be selected by risk.'
          : 'Fixture declares CLI/API only with no observed browser capability; browser checks are not forced.',
      }),
    ]),
  });
}
