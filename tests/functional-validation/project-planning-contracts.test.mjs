import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildProjectPreflight,
  classifyProjectItems,
  evaluateProjectPlanGate,
  inventoryProjectModules,
  planKeyFlows,
  planNonWebVerification,
  projectPlanningFixture,
} from './project-scenarios.mjs';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');
const fixtureOnlyProductTerms = Object.freeze([
  'KF-AUTH-BILLING-SHARED',
  'src/auth/login.mjs',
  'AC-BILLING-TOTAL',
  'docs-format-helper',
]);

function readPackMarkdown(relativePath) {
  const absolutePath = path.join(packRoot, relativePath);
  assert.ok(existsSync(absolutePath), `missing pack file ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function productM2Markdown() {
  return [
    readPackMarkdown('project-qa-plan/SKILL.md'),
    readPackMarkdown('references/project-risk-classification.md'),
    readPackMarkdown('templates/project-qa-report.md'),
  ].join('\n');
}

function assertNoFixtureLeakage(markdown) {
  for (const term of fixtureOnlyProductTerms) {
    assert.ok(!markdown.includes(term), `product Markdown leaked fixture-only term ${term}`);
  }
}

test('P2-M2-PREFLIGHT-001 project planning preflight succeeds without a Diff', () => {
  const preflight = buildProjectPreflight({ diff: null });
  const usingProjectQa = readPackMarkdown('using-project-qa/SKILL.md');
  const projectPlan = readPackMarkdown('project-qa-plan/SKILL.md');

  assert.equal(preflight.explicitTarget, true);
  assert.equal(preflight.snapshotRecorded, true);
  assert.equal(preflight.diffRequired, false);
  assert.equal(preflight.status, 'OPEN');
  assert.match(`${usingProjectQa}\n${projectPlan}`, /Project\s+Intake[\s\S]{0,260}(?:does\s+not\s+require|without)\s+(?:a\s+)?Diff/i);
  assertNoFixtureLeakage(productM2Markdown());
});

test('P2-M2-INVENTORY-002 inventories exactly three modules with shared dependency and tests', () => {
  const inventory = inventoryProjectModules();
  const projectPlan = readPackMarkdown('project-qa-plan/SKILL.md');
  const reportTemplate = readPackMarkdown('templates/project-qa-report.md');

  assert.deepEqual(inventory.map((module) => module.moduleId), ['auth', 'billing', 'shared-lib']);
  assert.equal(inventory.length, 3);
  assert.deepEqual(inventory.find((module) => module.moduleId === 'auth').sharedDependencies, ['shared-lib']);
  assert.deepEqual(inventory.find((module) => module.moduleId === 'billing').sharedDependencies, ['shared-lib']);
  assert.deepEqual(inventory.find((module) => module.moduleId === 'shared-lib').usedBy, ['auth', 'billing']);
  assert.ok(inventory.every((module) => module.entries.length > 0 && module.tests.length > 0));
  assert.match(`${projectPlan}\n${reportTemplate}`, /modules?[\s\S]{0,180}entries[\s\S]{0,180}tests[\s\S]{0,180}shared\s+dependenc/i);
  assert.match(`${projectPlan}\n${reportTemplate}`, /fixture\s+expectations[\s\S]{0,160}belong\s+only\s+in\s+functional-validation\s+fixtures\s+and\s+tests/i);
  assertNoFixtureLeakage(productM2Markdown());
});

test('P2-M2-CLASSIFY-003 classifies important modules and low-impact omissions with reasons and sources', () => {
  const classifications = classifyProjectItems();
  const riskReference = readPackMarkdown('references/project-risk-classification.md');
  const reportTemplate = readPackMarkdown('templates/project-qa-report.md');

  for (const itemId of ['auth', 'billing', 'shared-lib']) {
    const item = classifications.find((candidate) => candidate.itemId === itemId);
    assert.equal(item.importance, 'important');
    assert.equal(item.priority, 'Must Verify');
    assert.ok(item.reasons.length > 0, `${itemId} missing reason`);
    assert.ok(item.sources.length > 0, `${itemId} missing sources`);
  }

  const utility = classifications.find((candidate) => candidate.itemId === 'docs-format-helper');
  assert.equal(utility.importance, 'lower priority');
  assert.match(utility.reasons.join('\n'), /no runtime dependency/i);
  const keyFlow = classifications.find((candidate) => candidate.itemId === 'KF-AUTH-BILLING-SHARED');
  assert.equal(keyFlow.importance, 'important');
  assert.equal(keyFlow.priority, 'Must Verify');
  assert.ok(keyFlow.reasons.length > 0, 'key flow missing reason');
  assert.ok(keyFlow.sources.length > 0, 'key flow missing sources');
  assert.match(`${riskReference}\n${reportTemplate}`, /important[\s\S]{0,180}Must\s+Verify[\s\S]{0,180}(?:reason|basis)[\s\S]{0,180}source/i);
  assertNoFixtureLeakage(productM2Markdown());
});

test('P2-M2-FLOW-004 records auth to billing to shared-lib key flow with verification intent', () => {
  const flows = planKeyFlows();
  const projectPlan = readPackMarkdown('project-qa-plan/SKILL.md');
  const reportTemplate = readPackMarkdown('templates/project-qa-report.md');

  assert.equal(flows.length, 1);
  assert.equal(flows[0].entry, 'auth');
  assert.deepEqual(flows[0].dependencies, ['auth', 'billing', 'shared-lib']);
  assert.deepEqual(flows[0].affectedModules, ['auth', 'billing', 'shared-lib']);
  assert.equal(flows[0].importance, 'important');
  assert.equal(flows[0].priority, 'Must Verify');
  assert.ok(flows[0].reasons.length > 0);
  assert.ok(flows[0].sources.length > 0);
  assert.match(flows[0].expectedResult, /Authenticated checkout/i);
  assert.match(flows[0].verificationIntent, /API\/integration/i);
  assert.match(`${projectPlan}\n${reportTemplate}`, /Flow\s+ID[\s\S]{0,120}Entry[\s\S]{0,120}Dependencies[\s\S]{0,120}Expected\s+result[\s\S]{0,120}Verification\s+intent[\s\S]{0,120}Sources[\s\S]{0,120}Affected\s+modules/i);
  assert.match(`${projectPlan}\n${reportTemplate}`, /<flow-id>[\s\S]{0,120}<entry\s+module/i);
  assertNoFixtureLeakage(productM2Markdown());
});

test('P2-M2-GATE-005 blocks on objective missing billing prerequisite with rerun condition', () => {
  const gate = evaluateProjectPlanGate({ missingPrerequisites: ['requirements/billing-total.md#AC-BILLING-TOTAL'] });
  const projectPlan = readPackMarkdown('project-qa-plan/SKILL.md');
  const reportTemplate = readPackMarkdown('templates/project-qa-report.md');

  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.missingPrerequisite, 'requirements/billing-total.md#AC-BILLING-TOTAL');
  assert.match(gate.rerunCondition, /Provide requirements\/billing-total\.md#AC-BILLING-TOTAL, then rerun Project QA planning/i);
  assert.match(`${projectPlan}\n${reportTemplate}`, /missing\s+objective\s+prerequisite[\s\S]{0,220}BLOCKED[\s\S]{0,220}rerun\s+condition/i);
  assert.match(reportTemplate, /^Project QA Plan Gate: OPEN\/BLOCKED\/NEEDS_HUMAN_REVIEW$/m);
  assertNoFixtureLeakage(productM2Markdown());
});

test('P2-M2-HUMAN-006 maps subjective unresolved decision to NEEDS_HUMAN_REVIEW', () => {
  const gate = evaluateProjectPlanGate({ subjectiveDecision: projectPlanningFixture.subjectiveDecision });
  const riskReference = readPackMarkdown('references/project-risk-classification.md');
  const reportTemplate = readPackMarkdown('templates/project-qa-report.md');

  assert.equal(gate.status, 'NEEDS_HUMAN_REVIEW');
  assert.notEqual(gate.status, 'BLOCKED');
  assert.notEqual(gate.status, 'FAIL');
  assert.match(gate.decisionQuestion, /Product owner/i);
  assert.match(`${riskReference}\n${reportTemplate}`, /subjective[\s\S]{0,200}NEEDS_HUMAN_REVIEW[\s\S]{0,200}(?:not|never)[\s\S]{0,120}(?:BLOCKED|FAIL)/i);
  assert.match(reportTemplate, /^Project QA Plan Gate: OPEN\/BLOCKED\/NEEDS_HUMAN_REVIEW$/m);
  assertNoFixtureLeakage(productM2Markdown());
});

test('P2-M2-NONWEB-007 plans CLI and API verification without forced browser checks', () => {
  const plan = planNonWebVerification();
  const projectPlan = readPackMarkdown('project-qa-plan/SKILL.md');
  const reportTemplate = readPackMarkdown('templates/project-qa-report.md');

  assert.equal(plan.browserForced, false);
  assert.deepEqual(plan.plannedLayers, ['Static/unit', 'API/integration']);
  assert.equal(plan.omissions[0].status, 'Explicitly Not Verified');
  assert.match(plan.omissions[0].reason, /CLI\/API only/i);
  assert.match(`${projectPlan}\n${reportTemplate}`, /(?:no|without)\s+forced\s+(?:Web|browser|Playwright)/i);
  assertNoFixtureLeakage(productM2Markdown());
});
