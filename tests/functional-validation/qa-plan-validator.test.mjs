import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const validatorPath = path.join(repositoryRoot, 'qa-skill', 'tools', 'validate-qa-plan.mjs');
const schemaPath = path.join(repositoryRoot, 'qa-skill', 'schemas', 'qa-plan.schema.json');

const matrixCategories = Object.freeze([
  'Static/build',
  'Unit',
  'Integration',
  'Contract/API',
  'E2E',
  'Database/migration',
  'Security',
  'Performance',
  'Compatibility',
  'Accessibility/visual',
  'Regression',
]);

const applicabilityAssessments = Object.freeze([
  'Required',
  'Recommended',
  'Not Applicable',
  'Blocked',
  'Deferred',
]);

const executionStatuses = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const maxPlanInputBytes = 4 * 1024 * 1024;

function createTempRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function removeTree(root) {
  rmSync(root, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readBundledSchema() {
  return JSON.parse(readFileSync(schemaPath, 'utf8'));
}

function matrixEntry(category, assessment, index) {
  const base = {
    category,
    assessment,
    basis: `Canonical ${category} assessment basis`,
    verificationRefs: assessment === 'Required' || assessment === 'Recommended' ? [`V-${index + 1}`] : [],
  };

  if (assessment === 'Not Applicable') return { ...base, factBasis: `${category} is outside this target boundary`, verificationRefs: [] };
  if (assessment === 'Blocked') return { ...base, prerequisite: `${category} prerequisite`, rerunCondition: `Provide ${category} prerequisite and rerun validator`, verificationRefs: [] };
  if (assessment === 'Deferred') return { ...base, owner: `${category} owner`, trigger: `${category} trigger`, rerunCondition: `Rerun ${category} when trigger occurs`, residualRisk: `${category} residual risk`, verificationRefs: [] };
  return base;
}

function buildFullMatrix() {
  return matrixCategories.map((category, index) => {
    if (category === 'Static/build') return { ...matrixEntry(category, 'Required', index), verificationRefs: ['V-1'] };
    if (category === 'Unit') return { ...matrixEntry(category, 'Recommended', index), verificationRefs: ['V-2'] };
    if (category === 'Integration') return matrixEntry(category, 'Blocked', index);
    if (category === 'Contract/API') return matrixEntry(category, 'Deferred', index);
    return matrixEntry(category, 'Not Applicable', index);
  });
}

function buildLiteMatrix() {
  return matrixCategories.map((category, index) => {
    if (category === 'Static/build') return { ...matrixEntry(category, 'Required', index), verificationRefs: ['V-1'] };
    if (category === 'Unit') return { ...matrixEntry(category, 'Recommended', index), verificationRefs: ['V-2'] };
    if (category === 'Regression') return { ...matrixEntry(category, 'Required', index), verificationRefs: ['V-1'] };
    return matrixEntry(category, 'Not Applicable', index);
  });
}

function buildRisks({ lite = false } = {}) {
  const risks = [
    {
      id: 'R-1',
      category: 'Static/build',
      priority: 'Must Verify',
      description: 'Changed runtime QA plan must parse and validate deterministically.',
      sourceRefs: ['requirements/runtime-qa-plan.md#validator'],
      verificationRefs: ['V-1'],
    },
    {
      id: 'R-2',
      category: 'Unit',
      priority: 'Should Verify',
      description: 'Adjacent parser behavior should remain covered.',
      sourceRefs: ['requirements/runtime-qa-plan.md#parser'],
      verificationRefs: ['V-2'],
    },
    {
      id: 'R-3',
      category: 'E2E',
      priority: 'Optional',
      description: 'End to end behavior is optional for this fixture.',
      sourceRefs: ['requirements/runtime-qa-plan.md#optional'],
      verificationRefs: [],
    },
    {
      id: 'R-4',
      category: 'Accessibility/visual',
      priority: 'Explicitly Not Verified',
      description: 'No browser rendered surface exists.',
      sourceRefs: ['requirements/runtime-qa-plan.md#non-web'],
      verificationRefs: [],
    },
  ];

  if (lite) {
    risks.push({
      id: 'R-5',
      category: 'Regression',
      priority: 'Must Verify',
      description: 'Regression impact must be covered by the same deterministic Lite verification plan.',
      sourceRefs: ['requirements/runtime-qa-plan.md#regression'],
      verificationRefs: ['V-1'],
    });
  }
  return risks;
}

function buildPlanVerifications({ lite = false, withHumanGate = false } = {}) {
  const firstRiskRefs = lite ? ['R-1', 'R-5'] : ['R-1'];
  return [
    {
      id: 'V-1',
      riskRefs: firstRiskRefs,
      layer: 'Static/unit',
      method: 'Run the runtime QA plan validator contract test fixture.',
      preconditions: ['Repository checkout is readable', 'Node test runner is available'],
      expectedResult: 'Runtime QA plan validator contract is satisfied.',
      requiredEvidence: ['Command transcript with exit code 0', 'Stable diagnostic payload when --json is used'],
      humanGateRefs: withHumanGate ? ['H-1'] : [],
    },
    {
      id: 'V-2',
      riskRefs: ['R-2'],
      layer: 'API/integration',
      method: 'Run the existing deterministic functional contracts.',
      preconditions: ['No product writes are required'],
      expectedResult: 'Existing deterministic contracts remain green.',
      requiredEvidence: ['Command transcript with exit code 0'],
      humanGateRefs: [],
    },
  ];
}

function buildEvidence() {
  return [
    {
      id: 'E-1',
      verificationRef: 'V-1',
      kind: 'command',
      command: 'node --test tests/functional-validation/qa-plan-validator.test.mjs',
      exitCode: 0,
      observed: 'Validator contract test fixture passed in controlled run.',
      artifactRefs: ['test-results/runtime-qa-plan-validator.txt'],
    },
    {
      id: 'E-2',
      verificationRef: 'V-2',
      kind: 'command',
      command: 'node --test tests/functional-validation/contracts.test.mjs',
      exitCode: 0,
      observed: 'Existing deterministic functional contracts passed.',
      artifactRefs: ['test-results/contracts.txt'],
    },
  ];
}

function buildManualEvidence() {
  return {
    id: 'E-MANUAL-1',
    verificationRef: 'V-2',
    kind: 'manual',
    observed: 'Human reviewer confirmed the manual acceptance criterion in a read-only review session.',
    artifactRefs: ['test-results/manual-review-note.txt'],
  };
}

function buildBasePlan(profile, { lite = false, rigor = null } = {}) {
  const plan = {
    schema: 'qa-plan/v1',
    version: 'qa-plan/v1',
    kind: 'qa-plan',
    profile,
    runId: `QA-RUN-${profile.toUpperCase()}-001`,
    title: `${profile} runtime QA plan validator fixture`,
    generatedAt: '2026-08-06T00:00:00.000Z',
    canonicalValues: {
      matrixCategories: [...matrixCategories],
      applicabilityAssessments: [...applicabilityAssessments],
      executionStatuses: [...executionStatuses],
    },
    repositoryPreflight: {
      skillSourcePath: 'C:/works/QA-skills/qa-skill',
      productTargetPath: 'C:/example/product',
      productTargetExplicit: true,
      skillAndProductSeparated: true,
      baselineAvailable: true,
    },
    changeIntake: {
      targetScope: 'Runtime QA plan validation only',
      observedFacts: [
        'The runtime QA plan validator is invoked as a local Node CLI.',
        'The contract fixture uses qa-plan/v1 canonical categories and assessments.',
      ],
      inferredIntent: [
        {
          statement: 'The validator should distinguish planning artifacts from concluded execution artifacts.',
          confidence: 'HIGH',
          basis: 'The CLI accepts --require-conclusion as an explicit conclusion-stage mode.',
        },
      ],
      nonGoals: ['Do not execute real product checks'],
      authoritativeAcceptanceCriteria: [
        {
          id: 'AC-1',
          criterion: 'Validator accepts canonical qa-plan/v1 fixtures and rejects malformed runtime QA plans.',
          source: 'requirements/runtime-qa-plan.md#validator',
        },
      ],
      unresolvedQuestions: [],
    },
    applicabilityMatrix: lite ? buildLiteMatrix() : buildFullMatrix(),
    risks: buildRisks({ lite }),
    verifications: buildPlanVerifications({ lite }),
    evidence: [],
    humanGates: [],
  };

  if (rigor) plan.rigor = rigor;
  return plan;
}

function addExecutionResults(plan, { withHumanGate = false } = {}) {
  plan.evidence = buildEvidence();
  plan.verifications = plan.verifications.map((entry) => ({
    ...entry,
    status: 'PASS',
    evidenceRefs: entry.id === 'V-1' ? ['E-1'] : ['E-2'],
    humanGateRefs: withHumanGate && entry.id === 'V-1' ? ['H-1'] : entry.humanGateRefs,
  }));
  return plan;
}

function addConclusion(plan) {
  addExecutionResults(plan);
  if (plan.profile === 'Lite') {
    plan.qaLiteGate = {
      status: 'PASS',
      evidenceRefs: ['E-1', 'E-2'],
      unresolvedBlockers: [],
      pendingCriticalHumanGates: [],
    };
  }
  plan.conclusion = {
    overallStatus: 'PASS',
    qaConclusionGate: 'COMPLETE',
    evidenceRefs: ['E-1', 'E-2'],
    unresolvedBlockers: [],
    pendingCriticalHumanGates: [],
    residualRisks: ['Optional E2E/system coverage remains outside this fixture.'],
    releaseDecision: 'none',
  };
  return plan;
}

function validLitePlan({ rigor = null } = {}) {
  const plan = buildBasePlan('Lite', { lite: true, rigor });
  plan.liteEligibility = {
    decision: 'LITE',
    basis: 'Single boundary, low risk, local deterministic validator fixture.',
    disqualifiers: [],
    safeLocalVerificationAvailable: true,
    requiresFullTriggers: [],
  };
  return plan;
}

function validFullPlan({ conclusion = false, rigor = null } = {}) {
  const plan = buildBasePlan('Full', { rigor });
  plan.fullTriggerBasis = [
    'Runtime validator covers the complete applicability matrix and Full conclusion rules.',
  ];
  plan.escalationBasis = [
    'Full route is required when scope includes conclusion-gate enforcement.',
  ];
  plan.qaPlanGate = {
    status: 'OPEN',
    triggerBasis: plan.fullTriggerBasis,
    escalationBasis: plan.escalationBasis,
  };
  if (conclusion) addConclusion(plan);
  return plan;
}

function runValidator(args, options = {}) {
  return spawnSync(process.execPath, [validatorPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    ...options,
  });
}

function withPlanFile(plan, callback) {
  const root = createTempRoot('qa-plan-validator-');
  try {
    const planPath = path.join(root, 'plan.json');
    writeJson(planPath, plan);
    return callback(planPath, root);
  } finally {
    removeTree(root);
  }
}

function outputText(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assertValidatorLoaded(result) {
  assert.doesNotMatch(
    outputText(result),
    /(Cannot find module|ERR_MODULE_NOT_FOUND|ENOENT|no such file)[\s\S]*(validate-qa-plan\.mjs|qa-plan\.schema\.json)|validate-qa-plan\.mjs[\s\S]*(Cannot find module|ENOENT|no such file)|qa-plan\.schema\.json[\s\S]*(Cannot find module|ENOENT|no such file)/i,
    'runtime QA plan validator and schema must exist before behavior assertions can pass',
  );
}

function assertExit(result, expectedStatus) {
  assertValidatorLoaded(result);
  assert.equal(result.status, expectedStatus, outputText(result));
}

function parseJsonOutput(result) {
  assertValidatorLoaded(result);
  assert.doesNotThrow(() => JSON.parse(result.stdout), outputText(result));
  return JSON.parse(result.stdout);
}

function diagnosticLocations(diagnostics) {
  return diagnostics.map((diagnostic) => `${diagnostic.instanceLocation}\u0000${diagnostic.code}`);
}

function assertSortedDiagnostics(payload) {
  assert.equal(Array.isArray(payload.diagnostics), true, 'JSON diagnostics must be an array');
  const actual = diagnosticLocations(payload.diagnostics);
  assert.deepEqual(actual, [...actual].sort(), 'diagnostics must be sorted by instanceLocation then code');
}

function assertValidPlan(plan, args = []) {
  return withPlanFile(plan, (planPath) => {
    const result = runValidator([planPath, ...args]);
    assertExit(result, 0);
    assert.match(result.stdout, /valid|ok|PASS/i);
  });
}

function assertInvalidPlan(plan, expectedPatterns, args = ['--json']) {
  return withPlanFile(plan, (planPath) => {
    const result = runValidator([planPath, ...args]);
    assertExit(result, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.valid, false);
    assertSortedDiagnostics(payload);
    for (const pattern of expectedPatterns) assert.match(JSON.stringify(payload), pattern);
  });
}

function matrixRow(plan, category) {
  return plan.applicabilityMatrix.find((entry) => entry.category === category);
}

function verification(plan, id) {
  return plan.verifications.find((entry) => entry.id === id);
}

function risk(plan, id) {
  return plan.risks.find((entry) => entry.id === id);
}

test('RUNTIME-QA-PLAN-CLI-001 accepts plan-stage and concluded Lite and Full artifacts', () => {
  assertValidPlan(validLitePlan());
  assertValidPlan(addConclusion(validLitePlan()), ['--require-conclusion']);
  assertValidPlan(validFullPlan());
  assertValidPlan(validFullPlan({ conclusion: true }), ['--require-conclusion']);
});

test('RUNTIME-QA-PLAN-CLI-002 accepts optional Standard rigor and Full Audit rigor with approval', () => {
  assertValidPlan(validFullPlan({ rigor: { level: 'Standard', basis: 'Normal deterministic runtime QA plan validation.' } }));
  assertValidPlan(validFullPlan({ rigor: { level: 'Audit', basis: 'Audit-grade runtime QA validator review.', approvalRef: 'APPROVAL-123' } }));
});

test('RUNTIME-QA-PLAN-CLI-003 returns usage/read/parse exit code 2 for CLI and input failures', () => {
  const root = createTempRoot('qa-plan-validator-cli-');
  try {
    const missingPath = path.join(root, 'missing.json');
    const invalidJsonPath = path.join(root, 'invalid.json');
    const oversizedPath = path.join(root, 'oversized.json');
    const directoryPath = path.join(root, 'directory-input');
    writeFileSync(invalidJsonPath, '{ bad json }\n');
    writeFileSync(oversizedPath, Buffer.alloc(maxPlanInputBytes + 1, 0x20));
    mkdirSync(directoryPath);

    const cases = [
      { args: [], pattern: /usage|input|plan/i },
      { args: ['--unknown'], pattern: /unknown|flag|option/i },
      { args: [missingPath], pattern: /missing|not found|ENOENT|read/i },
      { args: [invalidJsonPath], pattern: /invalid JSON|parse|JSON/i },
      { args: [oversizedPath], pattern: /4 MiB|4194304|too large|oversized|maximum/i },
      { args: [directoryPath], pattern: /regular file|non-regular|directory|EISDIR|read/i },
    ];

    for (const entry of cases) {
      const result = runValidator(entry.args);
      assertExit(result, 2);
      assert.match(outputText(result), entry.pattern);
    }
  } finally {
    removeTree(root);
  }
});

test('RUNTIME-QA-PLAN-CLI-004 rejects wrong schema, version, kind, and unknown properties', () => {
  const cases = [
    ['schema', (plan) => { plan.schema = 'qa-plan/v2'; }, [/schema/i, /qa-plan\/v1/i]],
    ['version', (plan) => { plan.version = 'qa-plan/v2'; }, [/version/i, /qa-plan\/v1/i]],
    ['kind', (plan) => { plan.kind = 'qa-report'; }, [/kind/i, /qa-plan/i]],
    ['unknown property', (plan) => { plan.extraRuntimeField = true; }, [/unknown|additional/i, /extraRuntimeField/i]],
  ];

  for (const [, mutate, patterns] of cases) {
    const plan = validFullPlan({ conclusion: true });
    mutate(plan);
    assertInvalidPlan(plan, patterns);
  }
});

test('RUNTIME-QA-PLAN-CLI-005 requires observed facts and closed inferred intent records in change intake', () => {
  const missingObservedFacts = validFullPlan();
  delete missingObservedFacts.changeIntake.observedFacts;
  assertInvalidPlan(missingObservedFacts, [/changeIntake/i, /observedFacts/i]);

  const emptyObservedFacts = validFullPlan();
  emptyObservedFacts.changeIntake.observedFacts = [];
  assertInvalidPlan(emptyObservedFacts, [/observedFacts/i, /non-empty/i]);

  const missingIntentBasis = validFullPlan();
  delete missingIntentBasis.changeIntake.inferredIntent[0].basis;
  assertInvalidPlan(missingIntentBasis, [/inferredIntent/i, /basis/i]);

  const unknownIntentProperty = validFullPlan();
  unknownIntentProperty.changeIntake.inferredIntent[0].extra = true;
  assertInvalidPlan(unknownIntentProperty, [/inferredIntent/i, /unknown|additional|extra/i]);

  const invalidConfidence = validFullPlan();
  invalidConfidence.changeIntake.inferredIntent[0].confidence = 'CERTAIN';
  assertInvalidPlan(invalidConfidence, [/confidence/i, /LOW|MEDIUM|HIGH/i]);
});

test('RUNTIME-QA-PLAN-CLI-006 enforces the exact canonical applicability matrix categories', () => {
  const cases = [
    ['missing category', (plan) => { plan.applicabilityMatrix = plan.applicabilityMatrix.filter((entry) => entry.category !== 'Security'); }, [/Security/i, /missing|required/i]],
    ['duplicate category', (plan) => { plan.applicabilityMatrix.push(clone(plan.applicabilityMatrix[0])); }, [/duplicate/i, /Static\/build/i]],
    ['reordered category', (plan) => { plan.applicabilityMatrix.reverse(); }, [/order|canonical/i, /Static\/build/i]],
    ['unknown category', (plan) => { plan.applicabilityMatrix[0].category = 'Smoke'; }, [/unknown|category/i, /Smoke/i]],
  ];

  for (const [, mutate, patterns] of cases) {
    const plan = validFullPlan({ conclusion: true });
    mutate(plan);
    assertInvalidPlan(plan, patterns);
  }
});

test('RUNTIME-QA-PLAN-CLI-007 enforces state-specific Required, Not Applicable, Blocked, and Deferred matrix rules', () => {
  const cases = [
    ['Required without verification', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Required').verificationRefs; }, [/Required/i, /verification/i]],
    ['Not Applicable without fact basis', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Not Applicable').factBasis; }, [/Not Applicable/i, /fact/i]],
    ['Blocked without prerequisite', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Blocked').prerequisite; }, [/Blocked/i, /prerequisite/i]],
    ['Blocked without rerun condition', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Blocked').rerunCondition; }, [/Blocked/i, /rerun/i]],
    ['Deferred without owner', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Deferred').owner; }, [/Deferred/i, /owner/i]],
    ['Deferred without trigger', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Deferred').trigger; }, [/Deferred/i, /trigger/i]],
    ['Deferred without residual risk', (plan) => { delete plan.applicabilityMatrix.find((entry) => entry.assessment === 'Deferred').residualRisk; }, [/Deferred/i, /residual/i]],
  ];

  for (const [, mutate, patterns] of cases) {
    const plan = validFullPlan({ conclusion: true });
    mutate(plan);
    assertInvalidPlan(plan, patterns);
  }
});

test('RUNTIME-QA-PLAN-CLI-008 rejects broken risk, verification, evidence, and human-gate references', () => {
  const cases = [
    ['risk to missing verification', (plan) => { plan.risks[0].verificationRefs = ['V-MISSING']; }, [/R-1/i, /V-MISSING/i], validFullPlan()],
    ['verification to missing risk', (plan) => { plan.verifications[0].riskRefs = ['R-MISSING']; }, [/V-1/i, /R-MISSING/i], validFullPlan()],
    ['verification to missing evidence', (plan) => { plan.verifications[0].evidenceRefs = ['E-MISSING']; }, [/V-1/i, /E-MISSING/i], validFullPlan({ conclusion: true })],
    ['evidence to missing verification', (plan) => { plan.evidence[0].verificationRef = 'V-MISSING'; }, [/E-1/i, /V-MISSING/i], validFullPlan({ conclusion: true })],
    ['verification to missing human gate', (plan) => { plan.verifications[0].humanGateRefs = ['H-MISSING']; }, [/V-1/i, /H-MISSING/i], validFullPlan()],
  ];

  for (const [, mutate, patterns, plan] of cases) {
    mutate(plan);
    assertInvalidPlan(plan, patterns);
  }
});

test('RUNTIME-QA-PLAN-CLI-009 rejects Must Verify risks without a verification plan', () => {
  const missingVerification = validFullPlan();
  missingVerification.risks[0].verificationRefs = [];
  assertInvalidPlan(missingVerification, [/Must Verify/i, /verification/i]);
});

test('RUNTIME-QA-PLAN-CLI-010 rejects invalid Lite eligibility and Full plans without trigger or escalation basis', () => {
  const liteCases = [
    ['missing eligibility', (plan) => { delete plan.liteEligibility; }, [/Lite/i, /eligibility/i]],
    ['unsafe local verification', (plan) => { plan.liteEligibility.safeLocalVerificationAvailable = false; }, [/Lite/i, /safe|local/i]],
    ['Full trigger present', (plan) => { plan.liteEligibility.requiresFullTriggers = ['security risk']; }, [/Lite/i, /Full|trigger/i]],
    ['Blocked matrix row', (plan) => { Object.assign(matrixRow(plan, 'Security'), matrixEntry('Security', 'Blocked', 6)); }, [/Lite/i, /Blocked/i]],
    ['Deferred matrix row', (plan) => { Object.assign(matrixRow(plan, 'Performance'), matrixEntry('Performance', 'Deferred', 7)); }, [/Lite/i, /Deferred/i]],
  ];
  for (const [, mutate, patterns] of liteCases) {
    const plan = validLitePlan();
    mutate(plan);
    assertInvalidPlan(plan, patterns);
  }

  const fullWithoutTrigger = validFullPlan();
  fullWithoutTrigger.fullTriggerBasis = [];
  fullWithoutTrigger.qaPlanGate.triggerBasis = [];
  assertInvalidPlan(fullWithoutTrigger, [/Full/i, /trigger/i]);

  const fullWithoutEscalation = validFullPlan();
  fullWithoutEscalation.escalationBasis = [];
  fullWithoutEscalation.qaPlanGate.escalationBasis = [];
  assertInvalidPlan(fullWithoutEscalation, [/Full/i, /escalation/i]);
});

test('RUNTIME-QA-PLAN-CLI-011 rejects duplicate risk, verification, evidence, and Human Gate IDs', () => {
  const cases = [
    ['duplicate risk ID', (plan) => { plan.risks.push({ ...clone(plan.risks[0]), category: 'Regression' }); }, [/duplicate/i, /risk|R-1/i]],
    ['duplicate verification ID', (plan) => { plan.verifications.push(clone(plan.verifications[0])); }, [/duplicate/i, /verification|V-1/i]],
    ['duplicate evidence ID', (plan) => { plan.evidence.push(clone(plan.evidence[0])); }, [/duplicate/i, /evidence|E-1/i]],
    ['duplicate Human Gate ID', (plan) => { plan.humanGates = [{ id: 'H-1', critical: false, status: 'COMPLETE', question: 'First approval?' }, { id: 'H-1', critical: false, status: 'COMPLETE', question: 'Second approval?' }]; }, [/duplicate/i, /Human Gate|humanGate|H-1/i]],
  ];

  for (const [, mutate, patterns] of cases) {
    const plan = validFullPlan({ conclusion: true });
    mutate(plan);
    assertInvalidPlan(plan, patterns);
  }
});

test('RUNTIME-QA-PLAN-CLI-012 enforces matrix rows map to same-category risk semantics', () => {
  const requiredWithoutSameCategoryMustVerify = validLitePlan();
  risk(requiredWithoutSameCategoryMustVerify, 'R-5').priority = 'Should Verify';
  assertInvalidPlan(requiredWithoutSameCategoryMustVerify, [/Required/i, /Regression/i, /Must Verify/i]);

  const requiredWithoutMappedRisk = validLitePlan();
  verification(requiredWithoutMappedRisk, 'V-1').riskRefs = ['R-1'];
  assertInvalidPlan(requiredWithoutMappedRisk, [/Required/i, /Regression/i, /risk/i]);

  const recommendedWithExplicitlyNotVerifiedRisk = validLitePlan();
  risk(recommendedWithExplicitlyNotVerifiedRisk, 'R-2').priority = 'Explicitly Not Verified';
  assertInvalidPlan(recommendedWithExplicitlyNotVerifiedRisk, [/Recommended/i, /Unit/i, /Explicitly Not Verified|risk/i]);

  const recommendedWithWrongCategoryRisk = validLitePlan();
  risk(recommendedWithWrongCategoryRisk, 'R-2').category = 'Security';
  assertInvalidPlan(recommendedWithWrongCategoryRisk, [/Recommended/i, /Unit/i, /category|risk/i]);
});

test('RUNTIME-QA-PLAN-CLI-013 rejects invalid OPEN plan gates', () => {
  const blockedGate = validFullPlan({ conclusion: true });
  blockedGate.qaPlanGate.status = 'BLOCKED';
  assertInvalidPlan(blockedGate, [/QA Plan Gate|qaPlanGate/i, /OPEN/i]);

  const missingGate = validFullPlan({ conclusion: true });
  delete missingGate.qaPlanGate;
  assertInvalidPlan(missingGate, [/QA Plan Gate|qaPlanGate/i, /OPEN|required/i]);

  const triggerMismatch = validFullPlan();
  triggerMismatch.qaPlanGate.triggerBasis = ['Different trigger basis'];
  assertInvalidPlan(triggerMismatch, [/qaPlanGate|triggerBasis/i, /top-level|match|fullTriggerBasis/i]);

  const escalationMismatch = validFullPlan();
  escalationMismatch.qaPlanGate.escalationBasis = ['Different escalation basis'];
  assertInvalidPlan(escalationMismatch, [/qaPlanGate|escalationBasis/i, /top-level|match|escalationBasis/i]);
});

test('RUNTIME-QA-PLAN-CLI-014 rejects invalid rigor metadata', () => {
  assertInvalidPlan(validLitePlan({ rigor: { level: 'Audit', basis: 'Lite cannot be audit-grade.', approvalRef: 'APPROVAL-123' } }), [/rigor/i]);
  assertInvalidPlan(validFullPlan({ rigor: { level: 'Audit', basis: 'Audit-grade runtime QA validator review.' } }), [/rigor|approvalRef/i]);
  assertInvalidPlan(validFullPlan({ rigor: { level: 'Deep', basis: 'Unknown rigor level.' } }), [/rigor/i]);
});

test('RUNTIME-QA-PLAN-CLI-015 enforces phase isolation between planning and conclusion validation', () => {
  const planWithEvidence = validFullPlan();
  planWithEvidence.evidence = buildEvidence();
  assertInvalidPlan(planWithEvidence, [/plan-stage|planning/i, /evidence/i, /--require-conclusion/i]);

  const planWithStatus = validFullPlan();
  verification(planWithStatus, 'V-1').status = 'PASS';
  assertInvalidPlan(planWithStatus, [/plan-stage|planning/i, /status/i, /--require-conclusion/i]);

  const planWithEvidenceRefs = validFullPlan();
  verification(planWithEvidenceRefs, 'V-1').evidenceRefs = ['E-1'];
  assertInvalidPlan(planWithEvidenceRefs, [/plan-stage|planning/i, /evidenceRefs/i, /--require-conclusion/i]);

  const planWithLiteGate = validLitePlan();
  planWithLiteGate.qaLiteGate = { status: 'PASS', evidenceRefs: ['E-1'], unresolvedBlockers: [], pendingCriticalHumanGates: [] };
  assertInvalidPlan(planWithLiteGate, [/plan-stage|planning/i, /qaLiteGate/i, /--require-conclusion/i]);

  const planWithConclusion = validFullPlan();
  planWithConclusion.conclusion = { overallStatus: 'PASS', qaConclusionGate: 'COMPLETE', evidenceRefs: [], unresolvedBlockers: [], pendingCriticalHumanGates: [], residualRisks: [], releaseDecision: 'none' };
  assertInvalidPlan(planWithConclusion, [/plan-stage|planning/i, /conclusion/i, /--require-conclusion/i]);

  assertInvalidPlan(validFullPlan({ conclusion: true }), [/--require-conclusion/i]);
  assertInvalidPlan(addConclusion(validLitePlan()), [/--require-conclusion/i]);
});

test('RUNTIME-QA-PLAN-CLI-016 rejects broken qaLiteGate conclusion references', () => {
  const missingEvidence = addConclusion(validLitePlan());
  missingEvidence.qaLiteGate.evidenceRefs = ['E-MISSING'];
  assertInvalidPlan(missingEvidence, [/qaLiteGate|changeIntake/i, /E-MISSING|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const missingHumanGate = addConclusion(validLitePlan());
  missingHumanGate.qaLiteGate.pendingCriticalHumanGates = ['H-MISSING'];
  assertInvalidPlan(missingHumanGate, [/qaLiteGate|changeIntake/i, /H-MISSING|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const gateStatusMismatch = addConclusion(validLitePlan());
  gateStatusMismatch.qaLiteGate.status = 'FAIL';
  assertInvalidPlan(gateStatusMismatch, [/qaLiteGate|changeIntake/i, /status|overallStatus|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const passWithBlocker = addConclusion(validLitePlan());
  passWithBlocker.qaLiteGate.unresolvedBlockers = ['manual fixture unavailable'];
  assertInvalidPlan(passWithBlocker, [/qaLiteGate|changeIntake/i, /PASS|blocker|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const passWithPendingHumanGate = addConclusion(validLitePlan());
  passWithPendingHumanGate.qaLiteGate.pendingCriticalHumanGates = ['H-LITE-PENDING'];
  assertInvalidPlan(passWithPendingHumanGate, [/qaLiteGate|changeIntake/i, /PASS|Human Gate|H-LITE-PENDING|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const staleLiteGateInFull = validFullPlan({ conclusion: true });
  staleLiteGateInFull.qaLiteGate = {
    status: 'PASS',
    evidenceRefs: ['E-1', 'E-2'],
    unresolvedBlockers: [],
    pendingCriticalHumanGates: [],
  };
  assertInvalidPlan(staleLiteGateInFull, [/qaLiteGate/i, /Full|profile|stale|Lite/i], ['--require-conclusion', '--json']);
});

test('RUNTIME-QA-PLAN-CLI-017 enforces --require-conclusion and PASS conclusion blockers', () => {
  assertValidPlan(validFullPlan({ conclusion: true }), ['--require-conclusion']);

  assertInvalidPlan(validFullPlan(), [/conclusion/i, /required/i], ['--require-conclusion', '--json']);

  const passWithoutCompleteGate = validFullPlan({ conclusion: true });
  passWithoutCompleteGate.conclusion.qaConclusionGate = 'BLOCKED';
  assertInvalidPlan(passWithoutCompleteGate, [/PASS/i, /qaConclusionGate|Conclusion Gate/i, /COMPLETE/i]);

  const passWithoutEvidence = validFullPlan({ conclusion: true });
  passWithoutEvidence.conclusion.evidenceRefs = [];
  assertInvalidPlan(passWithoutEvidence, [/PASS/i, /evidence/i]);

  const passWithFailedMustVerify = validFullPlan({ conclusion: true });
  verification(passWithFailedMustVerify, 'V-1').status = 'FAIL';
  assertInvalidPlan(passWithFailedMustVerify, [/PASS/i, /Must Verify|V-1/i, /PASS/i]);

  const passWithMustVerifyWithoutEvidence = validFullPlan({ conclusion: true });
  verification(passWithMustVerifyWithoutEvidence, 'V-1').status = 'BLOCKED';
  verification(passWithMustVerifyWithoutEvidence, 'V-1').evidenceRefs = [];
  assertInvalidPlan(passWithMustVerifyWithoutEvidence, [/PASS/i, /Must Verify|V-1/i, /evidence/i]);

  const missingExecutionStatus = validFullPlan({ conclusion: true });
  delete verification(missingExecutionStatus, 'V-2').status;
  assertInvalidPlan(missingExecutionStatus, [/require-conclusion|conclusion|changeIntake/i, /status|V-2|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const emptyExecutionEvidenceRefs = validFullPlan({ conclusion: true });
  verification(emptyExecutionEvidenceRefs, 'V-2').evidenceRefs = [];
  assertInvalidPlan(emptyExecutionEvidenceRefs, [/require-conclusion|conclusion|changeIntake/i, /evidenceRefs|V-2|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);

  const passWithBlocker = validFullPlan({ conclusion: true });
  passWithBlocker.conclusion.unresolvedBlockers = ['integration environment unavailable'];
  assertInvalidPlan(passWithBlocker, [/PASS/i, /blocker/i]);

  const passWithPendingHumanGate = validFullPlan({ conclusion: true });
  passWithPendingHumanGate.humanGates = [{ id: 'H-1', critical: true, status: 'PENDING', question: 'Product owner approval required.' }];
  passWithPendingHumanGate.verifications = buildPlanVerifications({ withHumanGate: true }).map((entry) => ({ ...entry, status: 'PASS', evidenceRefs: entry.id === 'V-1' ? ['E-1'] : ['E-2'] }));
  passWithPendingHumanGate.conclusion.pendingCriticalHumanGates = ['H-1'];
  assertInvalidPlan(passWithPendingHumanGate, [/PASS/i, /Human Gate|H-1|critical/i]);

  const releaseGranted = validFullPlan({ conclusion: true });
  releaseGranted.conclusion.releaseDecision = 'approved';
  assertInvalidPlan(releaseGranted, [/releaseDecision|changeIntake/i, /none|observedFacts|inferredIntent/i], ['--require-conclusion', '--json']);
});

test('RUNTIME-QA-PLAN-CLI-018 accepts manual evidence without command fields and rejects malformed command evidence', () => {
  const manualEvidence = validFullPlan({ conclusion: true });
  manualEvidence.evidence.push(buildManualEvidence());
  verification(manualEvidence, 'V-2').evidenceRefs.push('E-MANUAL-1');
  manualEvidence.conclusion.evidenceRefs.push('E-MANUAL-1');
  assertValidPlan(manualEvidence, ['--require-conclusion']);

  const commandMissingCommand = validFullPlan({ conclusion: true });
  delete commandMissingCommand.evidence[0].command;
  assertInvalidPlan(commandMissingCommand, [/command/i, /E-1|evidence/i], ['--require-conclusion', '--json']);

  const commandMissingExitCode = validFullPlan({ conclusion: true });
  delete commandMissingExitCode.evidence[0].exitCode;
  assertInvalidPlan(commandMissingExitCode, [/exitCode/i, /integer/i], ['--require-conclusion', '--json']);
});

test('RUNTIME-QA-PLAN-CLI-019 emits deterministic --json diagnostics sorted by instanceLocation then code', () => {
  const plan = validFullPlan({ conclusion: true });
  plan.extraTopLevel = true;
  plan.applicabilityMatrix[9].category = 'Visual';
  plan.verifications[0].riskRefs = ['R-MISSING'];
  plan.risks[0].verificationRefs = ['V-MISSING'];

  withPlanFile(plan, (planPath) => {
    const first = runValidator([planPath, '--json']);
    const second = runValidator([planPath, '--json']);
    assertExit(first, 1);
    assertExit(second, 1);
    assert.equal(first.stdout, second.stdout, 'JSON diagnostics must be byte-stable across repeated runs');
    const payload = parseJsonOutput(first);
    assertSortedDiagnostics(payload);
    assert.deepEqual(
      payload.diagnostics.map((diagnostic) => Object.keys(diagnostic).sort()),
      payload.diagnostics.map(() => ['code', 'instanceLocation', 'message'].sort()),
    );
  });
});

test('RUNTIME-QA-PLAN-CLI-020 validates bundled schema contract and rejects schema drift', async () => {
  const module = await import(pathToFileURL(validatorPath).href);
  assert.equal(typeof module.validateSchemaContract, 'function', 'validateSchemaContract(schema) must be exported as a pure validator API');

  const validateSchemaContract = module.validateSchemaContract;
  assert.deepEqual(validateSchemaContract(readBundledSchema()), { valid: true, diagnostics: [] });

  const driftCases = [
    ['top-level type drift', (schema) => { schema.type = 'array'; }],
    ['top-level closure drift', (schema) => { schema.additionalProperties = true; }],
    ['top-level required drift', (schema) => { schema.required = schema.required.filter((entry) => entry !== 'changeIntake'); }],
    ['top-level properties drift', (schema) => { delete schema.properties.rigor; }],
    ['canonical profile drift', (schema) => { schema.properties.profile.enum = ['Full']; }],
    ['canonical categories drift', (schema) => { schema.$defs.canonicalValues.properties.matrixCategories.prefixItems[0].const = 'Build'; }],
    ['canonical categories open items drift', (schema) => { schema.$defs.canonicalValues.properties.matrixCategories.items = {}; }],
    ['canonical categories length drift', (schema) => { schema.$defs.canonicalValues.properties.matrixCategories.maxItems += 1; }],
    ['canonical assessments drift', (schema) => { schema.$defs.canonicalValues.properties.applicabilityAssessments.prefixItems[0].const = 'Mandatory'; }],
    ['canonical statuses drift', (schema) => { schema.$defs.canonicalValues.properties.executionStatuses.prefixItems[0].const = 'OK'; }],
    ['canonical evidence kinds drift', (schema) => { schema.$defs.evidence.properties.kind.enum = ['command']; }],
    ['changeIntake required fields drift', (schema) => { schema.$defs.changeIntake.required = schema.$defs.changeIntake.required.filter((entry) => entry !== 'observedFacts'); }],
    ['command evidence conditional requirements drift', (schema) => { schema.$defs.evidence.allOf = []; }],
    ['releaseDecision const drift', (schema) => { schema.$defs.conclusion.properties.releaseDecision = { enum: ['none', 'approved'] }; }],
  ];

  for (const [label, mutate] of driftCases) {
    const schema = readBundledSchema();
    mutate(schema);
    const result = validateSchemaContract(schema);
    assert.equal(result.valid, false, label);
    assert.equal(Array.isArray(result.diagnostics), true, label);
    assert.match(result.diagnostics.join('\n'), /schema|contract|drift|required|canonical|evidence|releaseDecision/i, label);
  }
});

test('RUNTIME-QA-PLAN-CLI-021 preserves input byte identity before and after validation', () => {
  withPlanFile(validFullPlan({ conclusion: true }), (planPath) => {
    const before = readFileSync(planPath);
    const result = runValidator([planPath, '--require-conclusion', '--json']);
    assertExit(result, 0);
    const after = readFileSync(planPath);
    assert.deepEqual(after, before, 'validator must not rewrite or normalize input plan bytes');
  });
});
