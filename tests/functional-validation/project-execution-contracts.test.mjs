import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildProjectExecutionContracts,
  corruptAuthorityIntegrity,
  materializeModuleResult,
  reconcileProjectStatus,
  scheduleModuleTasks,
  validateExactDelivery,
  validateModuleScopeAccess,
} from './project-harness.mjs';
import {
  artifactReference,
  authorityIntegrityOk,
  isolationWorkspaceReference,
  moduleResultFixtures,
  plannedModuleTasks,
  requiredCoverage,
  snapshotFingerprint,
} from './project-fixtures/module-results.mjs';

const targetIntegrityOk = Object.freeze({ ok: true, diagnostics: Object.freeze([]) });

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');
const fixtureOnlyProductTerms = Object.freeze([
  'MT-AUTH-001',
  'V-AUTH-SESSION',
  'F-BILLING-TOTAL',
  'KF-AUTH-BILLING-SHARED',
]);

function readPackMarkdown(relativePath) {
  const absolutePath = path.join(packRoot, relativePath);
  assert.ok(existsSync(absolutePath), `missing pack file ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function productM3Markdown() {
  return [
    readPackMarkdown('using-project-qa/SKILL.md'),
    readPackMarkdown('project-qa-plan/SKILL.md'),
    readPackMarkdown('project-qa-execute/SKILL.md'),
    readPackMarkdown('project-qa-conclude/SKILL.md'),
    readPackMarkdown('references/project-qa-run-contract.md'),
    readPackMarkdown('references/project-evidence-guide.md'),
    readPackMarkdown('templates/project-qa-report.md'),
  ].join('\n');
}

function assertNoFixtureLeakage(markdown) {
  for (const term of fixtureOnlyProductTerms) {
    assert.ok(!markdown.includes(term), `product Markdown leaked fixture-only term ${term}`);
  }
}

test('P2-M3-ROLE-001 defines read-only Coordinator and Module Agent task contracts', () => {
  const contracts = buildProjectExecutionContracts({ tasks: plannedModuleTasks, snapshotFingerprint });
  const productMarkdown = productM3Markdown();
  const plannedByModule = new Map(contracts.moduleTasks.map((task) => [task.moduleId, task]));

  assert.equal(contracts.coordinator.readOnly, true);
  assert.deepEqual(contracts.coordinator.allowedWriteTools, []);
  assert.deepEqual(contracts.coordinator.route, ['project-qa-plan', 'project-qa-execute', 'project-qa-conclude']);
  assert.ok(contracts.moduleTasks.every((task) => task.readOnly && task.canDelegate === false));
  assert.ok(contracts.moduleTasks.every((task) => task.allowedWriteTools.length === 0));
  assert.ok(contracts.moduleTasks.every((task) => task.moduleId && task.taskId && task.snapshotFingerprint));
  assert.ok(contracts.moduleTasks.every((task) => task.isolationWorkspaceReference === isolationWorkspaceReference));
  assert.ok(contracts.moduleTasks.every((task) => task.isolationWorkspaceReference && task.isolationWorkspaceReference !== 'N/A'));
  for (const result of moduleResultFixtures.allPass) {
    const plannedTask = plannedByModule.get(result.moduleId);
    assert.ok(plannedTask, `${result.moduleId} missing planned task`);
    assert.equal(result.taskId, plannedTask.taskId, `${result.moduleId} result taskId must match planned task`);
    assert.deepEqual(result.verificationIds, plannedTask.verificationIds, `${result.moduleId} result verification IDs must match planned task`);
    assert.equal(result.isolationWorkspaceReference, plannedTask.isolationWorkspaceReference, `${result.moduleId} result isolation workspace must match planned task`);
  }
  assert.match(productMarkdown, /same\s+Project\s+QA\s+Coordinator[\s\S]{0,260}project-qa-plan\s*->\s*project-qa-execute\s*->\s*project-qa-conclude/i);
  assert.match(productMarkdown, /Module\s+QA\s+Agents?[\s\S]{0,220}read-only[\s\S]{0,220}(?:do\s+not|cannot|must\s+not)\s+delegate/i);
  assert.match(productMarkdown, /module\s*ID[\s\S]{0,180}task\s*ID[\s\S]{0,180}allowed\s+paths[\s\S]{0,180}planned\s+(?:commands|tools)/i);
  assert.match(productMarkdown, /isolated\s+workspace\s+reference[\s\S]{0,180}(?:non-empty|concrete|must\s+not\s+be\s+`?N\/A`?)/i);
  assert.match(productMarkdown, /safe[\s\S]{0,80}(?:tests|checks|diagnostics)[\s\S]{0,160}only\s+inside\s+(?:that\s+)?(?:isolated\s+)?workspace/i);
  assertNoFixtureLeakage(productMarkdown);
});

test('P2-M3-SCOPE-002 rejects out-of-scope module access as infrastructure evidence', () => {
  const { moduleTasks } = buildProjectExecutionContracts({ tasks: plannedModuleTasks, snapshotFingerprint });
  const authTask = moduleTasks.find((task) => task.moduleId === 'auth');
  const productMarkdown = productM3Markdown();
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'qa-skill-m3-scope-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'qa-skill-m3-outside-'));

  try {
    mkdirSync(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    mkdirSync(path.join(workspaceRoot, 'src', 'billing'), { recursive: true });
    mkdirSync(path.join(workspaceRoot, 'src', 'shared'), { recursive: true });
    mkdirSync(path.join(workspaceRoot, 'tests'), { recursive: true });
    writeFileSync(path.join(workspaceRoot, 'src', 'auth', 'login.mjs'), 'export const ok = true;\n');
    writeFileSync(path.join(workspaceRoot, 'src', 'billing', 'checkout.mjs'), 'export const outOfScope = true;\n');
    writeFileSync(path.join(workspaceRoot, 'tests', 'auth-login.test.mjs'), 'export const test = true;\n');
    writeFileSync(path.join(workspaceRoot, 'tests', 'auth-login.test.mjs.bak'), 'prefix confusion\n');
    writeFileSync(path.join(outsideRoot, 'outside.txt'), 'outside\n');
    symlinkSync(outsideRoot, path.join(workspaceRoot, 'src', 'auth', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

    const scopeOptions = { workspaceRoot, resolver: realpathSync };
    const allowed = validateModuleScopeAccess(authTask, 'src/auth/login.mjs', scopeOptions);
    const allowedWindowsSeparators = validateModuleScopeAccess(authTask, 'src\\auth\\login.mjs', scopeOptions);
    const rejected = validateModuleScopeAccess(authTask, 'src/billing/checkout.mjs', scopeOptions);
    const rejectedTraversal = validateModuleScopeAccess(authTask, 'src/auth/../billing/checkout.mjs', scopeOptions);
    const rejectedFilePrefix = validateModuleScopeAccess(authTask, 'tests/auth-login.test.mjs.bak', scopeOptions);
    const rejectedAbsolute = validateModuleScopeAccess(authTask, path.join(workspaceRoot, 'src', 'auth', 'login.mjs'), scopeOptions);
    const rejectedNul = validateModuleScopeAccess(authTask, 'src/auth/login.mjs\0', scopeOptions);
    const rejectedMissingCanonical = validateModuleScopeAccess(authTask, 'src/auth/missing.mjs', scopeOptions);
    const rejectedRealpathEscape = validateModuleScopeAccess(authTask, 'src/auth/escape/outside.txt', scopeOptions);

    assert.equal(allowed.allowed, true);
    assert.equal(allowedWindowsSeparators.allowed, true);
    assert.equal(rejected.allowed, false);
    assert.equal(rejectedTraversal.allowed, false);
    assert.equal(rejectedFilePrefix.allowed, false);
    assert.equal(rejectedAbsolute.allowed, false);
    assert.equal(rejectedNul.allowed, false);
    assert.equal(rejectedMissingCanonical.allowed, false);
    assert.equal(rejectedRealpathEscape.allowed, false);
    assert.equal(rejected.evidence.status, 'BLOCKED');
    assert.equal(rejected.evidence.type, 'infrastructure');
    assert.match(rejected.evidence.observation, /Out-of-scope path rejected/i);
    assert.match(rejectedMissingCanonical.evidence.reason, /canonical path unavailable/i);
    assert.match(rejectedRealpathEscape.evidence.reason, /outside isolation workspace/i);
    assert.match(productMarkdown, /out-of-scope\s+path[\s\S]{0,180}(?:rejected|BLOCKED)[\s\S]{0,180}infrastructure\s+evidence/i);
    assert.match(productMarkdown, /target-relative\s+paths[\s\S]{0,180}resolved\s+inside\s+the\s+isolation\s+workspace/i);
    assert.match(productMarkdown, /symlink\/junction\/realpath\s+escape[\s\S]{0,180}(?:out-of-scope|BLOCKED)/i);
    assertNoFixtureLeakage(productMarkdown);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('P2-M3-EVIDENCE-003 materializes trajectory-shaped module evidence', () => {
  const result = materializeModuleResult(moduleResultFixtures.allPass[0]);
  const evidence = result.evidence[0];
  const productMarkdown = productM3Markdown();

  assert.equal(evidence.moduleId, result.moduleId);
  assert.equal(evidence.taskId, result.taskId);
  assert.equal(evidence.verificationId, result.verificationIds[0]);
  assert.ok(evidence.actualCommandOrTool);
  assert.ok(evidence.observation);
  assert.equal(evidence.exitStatus, 0);
  assert.ok(evidence.artifact.path);
  assert.ok(evidence.artifact.sha256);
  assert.ok(evidence.timestamp);
  assert.equal(evidence.snapshotFingerprint, snapshotFingerprint);
  assert.equal(result.isolationWorkspaceReference, isolationWorkspaceReference);
  assert.equal(evidence.isolationWorkspaceReference, isolationWorkspaceReference);
  assert.match(productMarkdown, /module\s+ID[\s\S]{0,160}task\s+ID[\s\S]{0,160}verification\s+ID[\s\S]{0,160}actual\s+(?:command|tool)[\s\S]{0,160}observation[\s\S]{0,160}exit\/?status[\s\S]{0,160}artifact[\s\S]{0,160}timestamp[\s\S]{0,160}snapshot\s+fingerprint/i);
  assert.match(productMarkdown, /Execution\s+Evidence[\s\S]{0,260}Isolation\s+workspace/i);
  assertNoFixtureLeakage(productMarkdown);
});

test('P2-M3-RESOURCE-004 schedules disjoint resources in parallel and shared resources serially', () => {
  const scheduled = scheduleModuleTasks(plannedModuleTasks);
  const sharedServiceTasks = scheduleModuleTasks([
    Object.freeze({ ...plannedModuleTasks[0], taskId: 'MT-SERVICE-A', declaredResources: Object.freeze(['service:queue']) }),
    Object.freeze({ ...plannedModuleTasks[1], taskId: 'MT-SERVICE-B', declaredResources: Object.freeze(['service:queue']) }),
  ]);
  const productMarkdown = productM3Markdown();

  assert.deepEqual(scheduled.parallelEligible, ['MT-AUTH-001']);
  assert.deepEqual(scheduled.serialGroups.map((group) => group.taskIds), [['MT-BILLING-001', 'MT-SHARED-001']]);
  assert.deepEqual(scheduled.serialGroups[0].sharedResources, ['database:checkout']);
  assert.deepEqual(sharedServiceTasks.serialGroups.map((group) => group.taskIds), [['MT-SERVICE-A', 'MT-SERVICE-B']]);
  assert.deepEqual(sharedServiceTasks.serialGroups[0].sharedResources, ['service:queue']);
  assert.match(productMarkdown, /disjoint-resource[\s\S]{0,180}parallel-eligible/i);
  assert.match(productMarkdown, /shared\s+(?:database|port|file|credential|fixture|environment|cache|service|external-system)[\s\S]{0,220}serial[\s\S]{0,180}isolation\s+evidence/i);
  assert.match(productMarkdown, /overlapping\s+read-only\s+source\s+paths[\s\S]{0,180}(?:do\s+not|do\s+not\s+by\s+themselves|alone\s+do\s+not)[\s\S]{0,120}serialization/i);
  assertNoFixtureLeakage(productMarkdown);
});

test('P2-M3-STATUS-005 reconciles four statuses and mixed results deterministically', () => {
  const allPass = reconcileProjectStatus({ moduleResults: moduleResultFixtures.allPass, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const oneFail = reconcileProjectStatus({ moduleResults: moduleResultFixtures.oneFail, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const oneBlocked = reconcileProjectStatus({ moduleResults: moduleResultFixtures.oneBlocked, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const oneHuman = reconcileProjectStatus({ moduleResults: moduleResultFixtures.oneHuman, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const mixed = reconcileProjectStatus({ moduleResults: moduleResultFixtures.mixedBlockedAndFail, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const failModule = moduleResultFixtures.oneFail.find((result) => result.moduleId === 'billing');
  const passModule = moduleResultFixtures.allPass.find((result) => result.moduleId === 'billing');
  const multiEvidenceFailResults = moduleResultFixtures.allPass.map((result) => (result.moduleId === 'billing'
    ? Object.freeze({ ...failModule, evidence: Object.freeze([passModule.evidence[0], failModule.evidence[0]]) })
    : result));
  const passEvidenceHumanResults = moduleResultFixtures.allPass.map((result) => (result.moduleId === 'shared-lib'
    ? Object.freeze({
      ...moduleResultFixtures.oneHuman.find((candidate) => candidate.moduleId === 'shared-lib'),
      evidence: result.evidence,
    })
    : result));
  const wrongModuleEvidence = moduleResultFixtures.allPass.map((result) => (result.moduleId === 'auth'
    ? Object.freeze({ ...result, evidence: moduleResultFixtures.allPass.find((candidate) => candidate.moduleId === 'billing').evidence })
    : result));
  const wrongTaskIdResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, taskId: 'MT-WRONG-001' })
    : result));
  const coverageMismatch = reconcileProjectStatus({ moduleResults: wrongModuleEvidence, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const taskIdMismatch = reconcileProjectStatus({ moduleResults: wrongTaskIdResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const multiEvidenceFail = reconcileProjectStatus({ moduleResults: multiEvidenceFailResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const passEvidenceHuman = reconcileProjectStatus({ moduleResults: passEvidenceHumanResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const productMarkdown = productM3Markdown();

  assert.equal(allPass.overallStatus, 'PASS');
  assert.equal(oneFail.overallStatus, 'FAIL');
  assert.equal(oneBlocked.overallStatus, 'BLOCKED');
  assert.equal(oneHuman.overallStatus, 'NEEDS_HUMAN_REVIEW');
  assert.equal(mixed.overallStatus, 'BLOCKED');
  assert.equal(multiEvidenceFail.overallStatus, 'FAIL');
  assert.equal(passEvidenceHuman.overallStatus, 'NEEDS_HUMAN_REVIEW');
  assert.equal(coverageMismatch.overallStatus, 'BLOCKED');
  assert.equal(coverageMismatch.coverageComplete, false);
  assert.equal(taskIdMismatch.overallStatus, 'BLOCKED');
  assert.match(coverageMismatch.diagnostics.join('\n'), /missing module evidence/i);
  assert.match(taskIdMismatch.diagnostics.join('\n'), /task ID mismatch/i);
  assert.doesNotMatch(multiEvidenceFail.diagnostics.join('\n'), /status mismatch/i);
  assert.doesNotMatch(passEvidenceHuman.diagnostics.join('\n'), /status mismatch/i);
  assert.ok(mixed.findings.some((finding) => finding.status === 'FAIL'), 'lower-level product failure must remain visible under overall BLOCKED');
  for (const result of [allPass, oneFail, oneBlocked, oneHuman, mixed]) assert.equal(result.canonical, true);
  assert.match(productMarkdown, /objective\s+required\s+blockers[\s\S]{0,140}overall\s+`?BLOCKED`?[\s\S]{0,220}confirmed\s+required\s+product\s+failure[\s\S]{0,120}`?FAIL`?[\s\S]{0,220}unresolved\s+critical\s+Human\s+Gate[\s\S]{0,140}`?NEEDS_HUMAN_REVIEW`?[\s\S]{0,220}complete\s+current\s+evidence[\s\S]{0,120}`?PASS`?/i);
  assert.match(productMarkdown, /preserve\s+all\s+lower-level\s+findings[\s\S]{0,180}overall\s+`?BLOCKED`?/i);
  assertNoFixtureLeakage(productMarkdown);
});

test('P2-M3-INFRA-006 corrupt authority integrity prohibits PASS without fifth status', () => {
  const corruptIntegrity = corruptAuthorityIntegrity(moduleResultFixtures.allPass[0]);
  const reconciled = reconcileProjectStatus({ moduleResults: moduleResultFixtures.allPass, requiredCoverage, authorityIntegrity: corruptIntegrity, currentSnapshotFingerprint: snapshotFingerprint, targetIntegrity: targetIntegrityOk });
  const missingAuthority = reconcileProjectStatus({ moduleResults: moduleResultFixtures.allPass, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, targetIntegrity: targetIntegrityOk });
  const staleModuleResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, snapshotFingerprint: 'stale-snapshot' })
    : result));
  const staleEvidenceResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, evidence: Object.freeze([Object.freeze({ ...result.evidence[0], snapshotFingerprint: 'stale-snapshot' })]) })
    : result));
  const missingArtifactResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, evidence: Object.freeze([Object.freeze({ ...result.evidence[0], artifact: Object.freeze({ path: '', sha256: '', bytes: 0 }) })]) })
    : result));
  const inconsistentStatusResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, evidence: Object.freeze([Object.freeze({ ...result.evidence[0], status: 'FAIL' })]) })
    : result));
  const wrongEvidenceTaskResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, evidence: Object.freeze([Object.freeze({ ...result.evidence[0], taskId: 'MT-WRONG-001' })]) })
    : result));
  const zeroByteArtifactResults = moduleResultFixtures.allPass.map((result, index) => (index === 0
    ? Object.freeze({ ...result, evidence: Object.freeze([Object.freeze({ ...result.evidence[0], artifact: artifactReference({ path: 'module-results/empty-output.txt', content: '' }) })]) })
    : result));
  const targetIntegrityFailed = Object.freeze({ ok: false, diagnostics: Object.freeze(['target product-file postflight hash mismatch: src/module.mjs']) });
  const targetIntegrityFailedEmpty = Object.freeze({ ok: false, diagnostics: Object.freeze([]) });
  const missingTargetIntegrity = reconcileProjectStatus({ moduleResults: moduleResultFixtures.allPass, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk });
  const staleModule = reconcileProjectStatus({ moduleResults: staleModuleResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const staleEvidence = reconcileProjectStatus({ moduleResults: staleEvidenceResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const missingArtifact = reconcileProjectStatus({ moduleResults: missingArtifactResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const inconsistentStatus = reconcileProjectStatus({ moduleResults: inconsistentStatusResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const wrongEvidenceTask = reconcileProjectStatus({ moduleResults: wrongEvidenceTaskResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const zeroByteArtifact = reconcileProjectStatus({ moduleResults: zeroByteArtifactResults, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityOk });
  const targetChanged = reconcileProjectStatus({ moduleResults: moduleResultFixtures.allPass, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityFailed });
  const targetChangedEmptyDiagnostics = reconcileProjectStatus({ moduleResults: moduleResultFixtures.allPass, requiredCoverage, currentSnapshotFingerprint: snapshotFingerprint, authorityIntegrity: authorityIntegrityOk, targetIntegrity: targetIntegrityFailedEmpty });
  const productMarkdown = productM3Markdown();

  assert.equal(reconciled.overallStatus, 'BLOCKED');
  assert.equal(missingAuthority.overallStatus, 'BLOCKED');
  assert.equal(missingTargetIntegrity.overallStatus, 'BLOCKED');
  assert.equal(staleModule.overallStatus, 'BLOCKED');
  assert.equal(staleEvidence.overallStatus, 'BLOCKED');
  assert.equal(missingArtifact.overallStatus, 'BLOCKED');
  assert.equal(inconsistentStatus.overallStatus, 'BLOCKED');
  assert.equal(wrongEvidenceTask.overallStatus, 'BLOCKED');
  assert.equal(zeroByteArtifact.overallStatus, 'PASS');
  assert.equal(targetChanged.overallStatus, 'BLOCKED');
  assert.equal(targetChangedEmptyDiagnostics.overallStatus, 'BLOCKED');
  assert.equal(reconciled.canonical, true);
  assert.equal(corruptIntegrity.ok, false);
  assert.match(corruptIntegrity.diagnostics[0], /artifact hash mismatch/i);
  assert.match(missingAuthority.diagnostics.join('\n'), /missing authority integrity/i);
  assert.match(staleModule.diagnostics.join('\n'), /snapshot fingerprint/i);
  assert.match(staleEvidence.diagnostics.join('\n'), /evidence snapshot fingerprint/i);
  assert.match(missingArtifact.diagnostics.join('\n'), /artifact reference/i);
  assert.match(inconsistentStatus.diagnostics.join('\n'), /status mismatch/i);
  assert.match(wrongEvidenceTask.diagnostics.join('\n'), /evidence task ID mismatch/i);
  assert.match(missingTargetIntegrity.diagnostics.join('\n'), /missing target postflight integrity/i);
  assert.match(targetChanged.diagnostics.join('\n'), /target product-file postflight hash mismatch/i);
  assert.match(targetChangedEmptyDiagnostics.diagnostics.join('\n'), /target postflight integrity failed/i);
  assert.match(productMarkdown, /artifact\s+hash[\s\S]{0,180}infrastructure\s+integrity[\s\S]{0,180}(?:prohibits|prevents|blocks)\s+`?PASS`?/i);
  assert.match(productMarkdown, /target\s+postflight\s+integrity[\s\S]{0,220}(?:product-file|product\s+file)[\s\S]{0,220}(?:BLOCKED|prohibits\s+`?PASS`?)/i);
  assert.match(productMarkdown, /approved\s+(?:`?\.qa`?|host)\s+artifact\s+writes[\s\S]{0,160}outside\s+the\s+product-file\s+integrity\s+comparison/i);
  assert.ok(!/^Overall Status:.*\b(?:ERROR|UNKNOWN|PARTIAL)\b/im.test(productMarkdown), 'no fifth project status may be introduced');
  assertNoFixtureLeakage(productMarkdown);
});

test('P2-M3-DELIVERY-007 enforces exact completed payload report and manifest delivery', () => {
  const completedPayload = '# Project QA Report\n\nOverall Status: PASS\n';
  const reportArtifact = artifactReference({ path: 'project-qa-report.md', content: completedPayload });
  const validManifest = { reportSha256: reportArtifact.sha256, reportBytes: reportArtifact.bytes };
  const invalidManifest = { reportSha256: reportArtifact.sha256, reportBytes: reportArtifact.bytes + 1 };
  const valid = validateExactDelivery({ completedPayload, reportArtifact, manifest: validManifest });
  const invalid = validateExactDelivery({ completedPayload, reportArtifact, manifest: invalidManifest });
  const missingPayload = validateExactDelivery({ reportArtifact, manifest: validManifest });
  const malformedArtifact = validateExactDelivery({ completedPayload, reportArtifact: { path: 'project-qa-report.md', sha256: '', bytes: -1 }, manifest: validManifest });
  const missingManifest = validateExactDelivery({ completedPayload, reportArtifact });
  const nullInput = validateExactDelivery(null);
  const productMarkdown = productM3Markdown();

  assert.equal(valid.ok, true);
  assert.equal(valid.reportMatches, true);
  assert.equal(valid.manifestMatches, true);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.manifestMatches, false);
  assert.equal(missingPayload.ok, false);
  assert.equal(malformedArtifact.ok, false);
  assert.equal(missingManifest.ok, false);
  assert.equal(nullInput.ok, false);
  assert.equal(missingPayload.deliveredSha256, null);
  assert.equal(missingPayload.deliveredBytes, null);
  assert.match(invalid.diagnostics.join('\n'), /manifest differs/i);
  assert.match(missingPayload.diagnostics.join('\n'), /completedPayload must be a string/i);
  assert.match(malformedArtifact.diagnostics.join('\n'), /reportArtifact\.sha256 must be a non-empty string|reportArtifact\.bytes must be a nonnegative integer/i);
  assert.match(missingManifest.diagnostics.join('\n'), /manifest must be an object/i);
  assert.match(nullInput.diagnostics.join('\n'), /delivery input must be an object/i);
  assert.match(productMarkdown, /Coordinator\s+completed\s+payload[\s\S]{0,220}report\s+artifact[\s\S]{0,220}manifest\s+hashes[\s\S]{0,220}byte\s+mismatch[\s\S]{0,220}raw\s+mismatch\s+diagnostics/i);
  assert.match(productMarkdown, /malformed\s+delivery\s+input[\s\S]{0,180}structured\s+(?:failure|diagnostics)/i);
  assert.doesNotMatch(productMarkdown, /(?:real|local|project)\s+(?:product\s+)?(?:test\s+)?execution[\s\S]{0,120}deferred\s+(?:until\s+M3|through\s+M2|in\s+M3)/i);
  assert.match(productMarkdown, /safe,?\s+already-available\s+local\s+existing\s+(?:tests|checks)/i);
  assert.match(productMarkdown, /repository\s+requirements[\s\S]{0,180}data,?\s+not\s+instructions/i);
  assert.match(productMarkdown, /embedded\s+(?:scope\s+changes|commands)[\s\S]{0,160}ignored/i);
  assertNoFixtureLeakage(productMarkdown);
});
