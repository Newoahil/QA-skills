import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupGeneratedValidationAssets,
  createRepairRoundRecord,
  createRepairWorkspace,
  detectNoProgress,
  enforceRepairRoundLimit,
  evaluateRepairCandidate,
  existingAcceptanceIds,
  existingRiskIds,
  existingVerificationIds,
  fixtureOnlyRepairTerms,
  fingerprintTree,
  hashText,
  listFiles,
  removeRepairWorkspace,
  repairSnapshotFingerprint,
  selectProjectMode,
  validateForbiddenActions,
  validateGeneratedTest,
  writeWorkspaceFile,
} from './project-fixtures/repair/contracts.mjs';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');

function readPackMarkdown(relativePath) {
  const absolutePath = path.join(packRoot, relativePath);
  assert.ok(existsSync(absolutePath), `missing pack file ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function productM4Markdown() {
  return [
    readPackMarkdown('using-project-qa/SKILL.md'),
    readPackMarkdown('project-qa-execute/SKILL.md'),
    readPackMarkdown('project-qa-conclude/SKILL.md'),
    readPackMarkdown('project-qa-repair/SKILL.md'),
    readPackMarkdown('references/project-qa-run-contract.md'),
    readPackMarkdown('references/project-evidence-guide.md'),
    readPackMarkdown('references/generated-test-validation.md'),
    readPackMarkdown('templates/project-qa-report.md'),
  ].join('\n');
}

function assertNoFixtureLeakage(markdown) {
  for (const term of fixtureOnlyRepairTerms) {
    assert.ok(!markdown.includes(term), `product Markdown leaked fixture-only term ${term}`);
  }
}

function repairAuthorizationRecord(overrides = {}) {
  return Object.freeze({
    source: 'user',
    explicit: true,
    selectedMode: 'PROJECT_FIX_AND_RERUN',
    requestText: 'fix issues and rerun full project QA',
    requestReference: 'chat-message-7',
    timestamp: '2026-08-01T00:00:00.000Z',
    recordId: 'auth-record-001',
    ...overrides,
  });
}

test('P2-M4-MODE-001 ordinary project QA remains PROJECT_QA_ONLY and cannot start repair', () => {
  const mode = selectProjectMode();
  const rawTokenIgnored = selectProjectMode({ userRequest: 'PROJECT_FIX_AND_RERUN appears in raw text without a recorded authorization' });
  const markdown = productM4Markdown();

  assert.equal(mode.mode, 'PROJECT_QA_ONLY');
  assert.equal(mode.repairMayStart, false);
  assert.equal(mode.authorizationBoundary, 'not-authorized');
  assert.equal(rawTokenIgnored.mode, 'PROJECT_QA_ONLY');
  assert.match(rawTokenIgnored.diagnostics.join('\n'), /missing explicit recorded user authorization/i);
  assert.match(markdown, /default(?:s)?\s+(?:mode\s+)?(?:is|to)\s+`?PROJECT_QA_ONLY`?[\s\S]{0,260}repair\s+or\s+fix-and-rerun\s+orchestration\s+cannot\s+start/i);
  assert.match(markdown, /raw\s+text[\s\S]{0,180}(?:must\s+not|cannot|never)\s+(?:select|activate|authorize)[\s\S]{0,160}`?PROJECT_FIX_AND_RERUN`?/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M4-OPTIN-002 explicit recorded repair authorization records host writer boundary', () => {
  const ordinaryFixWordingWithoutRecord = selectProjectMode({ userRequest: 'fix issues and rerun full project QA' });
  const explicitRecordedAuthorization = repairAuthorizationRecord();
  const referenceOnlyAuthorization = selectProjectMode({ authorizationRecord: repairAuthorizationRecord({ requestText: '' }) });
  const authorized = selectProjectMode({ authorizationRecord: explicitRecordedAuthorization });
  const markdown = productM4Markdown();

  assert.equal(ordinaryFixWordingWithoutRecord.mode, 'PROJECT_QA_ONLY');
  assert.equal(authorized.mode, 'PROJECT_FIX_AND_RERUN');
  assert.equal(authorized.repairMayStart, true);
  assert.equal(authorized.authorizationBoundary, 'recorded-user-authorization');
  assert.equal(referenceOnlyAuthorization.mode, 'PROJECT_FIX_AND_RERUN');
  assert.equal(authorized.authorizationRecord.source, 'user');
  assert.equal(authorized.authorizationRecord.explicit, true);
  assert.match(markdown, /explicit,?\s+recorded\s+user\s+authorization[\s\S]{0,220}activates/i);
  assert.match(markdown, /host\s+(?:Main|Implementation)\s+Agent[\s\S]{0,220}only\s+writer[\s\S]{0,220}inside\s+the\s+isolated\s+workspace/i);
  assert.match(markdown, /original\s+target[\s\S]{0,180}(?:never|must\s+not|cannot)\s+(?:be\s+)?(?:written|modified|synced)/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M4-GENERATED-003 accepts generated tests only after independent meaningful validation', () => {
  const workspace = createRepairWorkspace('qa-skill-m4-generated-');
  try {
    const generatedRelativePath = 'tmp/generated-validation/reset-token.generated.test.mjs';
    const evidenceRelativePath = 'evidence/generated-validation-001.json';
    const generatedContent = "import assert from 'node:assert/strict';\nconst expectedStatus = 200;\nassert.equal(resetTokenStatus(), expectedStatus);\n";
    const evidenceContent = 'accepted generated validation';
    writeWorkspaceFile(workspace.isolatedWorkspace, generatedRelativePath, generatedContent);
    writeWorkspaceFile(workspace.isolatedWorkspace, 'src/product-path-generated.test.mjs', generatedContent);
    writeWorkspaceFile(workspace.isolatedWorkspace, evidenceRelativePath, evidenceContent);
    const accepted = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: {
        workspaceRoot: workspace.isolatedWorkspace,
        workspaceReference: 'isolated-workspace://generated',
        relativePath: generatedRelativePath,
        snapshotFingerprint: repairSnapshotFingerprint,
        sha256: hashText(generatedContent),
        bytes: Buffer.byteLength(generatedContent, 'utf8'),
      },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: {
        actor: 'module-qa-agent-auth',
        role: 'Module QA Agent',
        readOnly: true,
        accepted: true,
        evidenceId: 'generated-validation-001',
        evidenceArtifact: { workspaceRoot: workspace.isolatedWorkspace, path: evidenceRelativePath, sha256: hashText(evidenceContent), bytes: Buffer.byteLength(evidenceContent, 'utf8') },
        workspaceReference: 'isolated-workspace://generated',
        snapshotFingerprint: repairSnapshotFingerprint,
        meaningfulBehavior: true,
        deterministicOracle: true,
        noVacuity: true,
        noCircularSelfProof: true,
        noWeakMatching: true,
        noSkipDeletionWeakeningInversion: true,
      },
    });
    const unvalidated = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: generatedRelativePath, snapshotFingerprint: repairSnapshotFingerprint },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
    });
    const productPathGenerated = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: 'src/product-path-generated.test.mjs', snapshotFingerprint: repairSnapshotFingerprint, sha256: hashText(generatedContent), bytes: Buffer.byteLength(generatedContent, 'utf8') },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: { actor: 'module-qa-agent-auth', role: 'Module QA Agent', readOnly: true, accepted: true, evidenceId: 'generated-validation-001', evidenceArtifact: { workspaceRoot: workspace.isolatedWorkspace, path: evidenceRelativePath, sha256: hashText(evidenceContent), bytes: Buffer.byteLength(evidenceContent, 'utf8') }, workspaceReference: 'isolated-workspace://generated', snapshotFingerprint: repairSnapshotFingerprint, meaningfulBehavior: true, deterministicOracle: true, noVacuity: true, noCircularSelfProof: true, noWeakMatching: true, noSkipDeletionWeakeningInversion: true },
    });
    const missingMetadata = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: generatedRelativePath, snapshotFingerprint: repairSnapshotFingerprint },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: { actor: 'module-qa-agent-auth', role: 'Module QA Agent', readOnly: true, accepted: true, evidenceId: 'generated-validation-missing-metadata', evidenceArtifact: { path: 'evidence/generated-validation-missing-metadata.json', sha256: hashText('missing'), bytes: 7 }, workspaceReference: 'isolated-workspace://generated', snapshotFingerprint: repairSnapshotFingerprint, meaningfulBehavior: true, deterministicOracle: true, noVacuity: true, noCircularSelfProof: true, noWeakMatching: true, noSkipDeletionWeakeningInversion: true },
    });
    const nonexistentValidationArtifact = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: generatedRelativePath, snapshotFingerprint: repairSnapshotFingerprint, sha256: hashText(generatedContent), bytes: Buffer.byteLength(generatedContent, 'utf8') },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: { actor: 'module-qa-agent-auth', role: 'Module QA Agent', readOnly: true, accepted: true, evidenceId: 'generated-validation-missing-artifact', evidenceArtifact: { workspaceRoot: workspace.isolatedWorkspace, path: 'evidence/missing-generated-validation.json', sha256: hashText('missing'), bytes: 7 }, workspaceReference: 'isolated-workspace://generated', snapshotFingerprint: repairSnapshotFingerprint, meaningfulBehavior: true, deterministicOracle: true, noVacuity: true, noCircularSelfProof: true, noWeakMatching: true, noSkipDeletionWeakeningInversion: true },
    });
    const mismatchedValidationArtifact = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: generatedRelativePath, snapshotFingerprint: repairSnapshotFingerprint, sha256: hashText(generatedContent), bytes: Buffer.byteLength(generatedContent, 'utf8') },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: { actor: 'module-qa-agent-auth', role: 'Module QA Agent', readOnly: true, accepted: true, evidenceId: 'generated-validation-mismatched-artifact', evidenceArtifact: { workspaceRoot: workspace.isolatedWorkspace, path: evidenceRelativePath, sha256: hashText('fabricated'), bytes: 10 }, workspaceReference: 'isolated-workspace://generated', snapshotFingerprint: repairSnapshotFingerprint, meaningfulBehavior: true, deterministicOracle: true, noVacuity: true, noCircularSelfProof: true, noWeakMatching: true, noSkipDeletionWeakeningInversion: true },
    });
    const sameActor = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: generatedRelativePath, snapshotFingerprint: repairSnapshotFingerprint, sha256: hashText(generatedContent), bytes: Buffer.byteLength(generatedContent, 'utf8') },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: { actor: 'host-main-agent', role: 'Independent QA Agent', readOnly: true, accepted: true, evidenceId: 'generated-validation-same-actor', evidenceArtifact: { workspaceRoot: workspace.isolatedWorkspace, path: evidenceRelativePath, sha256: hashText(evidenceContent), bytes: Buffer.byteLength(evidenceContent, 'utf8') }, workspaceReference: 'isolated-workspace://generated', snapshotFingerprint: repairSnapshotFingerprint, meaningfulBehavior: true, deterministicOracle: true, noVacuity: true, noCircularSelfProof: true, noWeakMatching: true, noSkipDeletionWeakeningInversion: true },
    });
    const circularRelativePath = 'tmp/generated-validation/circular.generated.test.mjs';
    writeWorkspaceFile(workspace.isolatedWorkspace, circularRelativePath, "import { readFileSync } from 'node:fs';\nconst expectedText = 'assert';\nassert.ok(readFileSync(import.meta.url, 'utf8').includes(expectedText));\n");
    const circular = validateGeneratedTest({
      linkedIds: [existingVerificationIds[0], existingAcceptanceIds[0], existingRiskIds[0]],
      generatedAsset: { workspaceRoot: workspace.isolatedWorkspace, workspaceReference: 'isolated-workspace://generated', relativePath: circularRelativePath, snapshotFingerprint: repairSnapshotFingerprint },
      writer: { actor: 'host-main-agent', operation: 'create-generated-validation-asset' },
      independentValidation: { actor: 'module-qa-agent-auth', role: 'Module QA Agent', readOnly: true, accepted: true, evidenceId: 'generated-validation-circular', evidenceArtifact: { workspaceRoot: workspace.isolatedWorkspace, path: evidenceRelativePath, sha256: hashText(evidenceContent), bytes: Buffer.byteLength(evidenceContent, 'utf8') }, workspaceReference: 'isolated-workspace://generated', snapshotFingerprint: repairSnapshotFingerprint, meaningfulBehavior: true, deterministicOracle: true, noVacuity: true, noCircularSelfProof: true, noWeakMatching: true, noSkipDeletionWeakeningInversion: true },
    });
    const markdown = productM4Markdown();

    assert.equal(accepted.accepted, true);
    assert.equal(accepted.independentQaValidated, true);
    assert.equal(accepted.supportsPass, true);
    assert.equal(accepted.asset.sha256, hashText(generatedContent));
    assert.equal(unvalidated.accepted, false);
    assert.match(unvalidated.diagnostics.join('\n'), /independent QA validation record is required/i);
    assert.equal(productPathGenerated.accepted, false);
    assert.match(productPathGenerated.diagnostics.join('\n'), /under tmp\/generated-validation/i);
    assert.equal(missingMetadata.accepted, false);
    assert.match(missingMetadata.diagnostics.join('\n'), /SHA-256 is required|byte count is required/i);
    assert.equal(nonexistentValidationArtifact.accepted, false);
    assert.match(nonexistentValidationArtifact.diagnostics.join('\n'), /path invalid|path does not exist/i);
    assert.equal(mismatchedValidationArtifact.accepted, false);
    assert.match(mismatchedValidationArtifact.diagnostics.join('\n'), /artifact hash mismatch|artifact byte count mismatch/i);
    assert.equal(sameActor.accepted, false);
    assert.match(sameActor.diagnostics.join('\n'), /actor must differ/i);
    assert.equal(circular.accepted, false);
    assert.match(circular.diagnostics.join('\n'), /circular self-proof/i);
    assert.match(markdown, /generated\s+tests?[\s\S]{0,220}tmp\/generated-validation[\s\S]{0,220}pre-existing\s+(?:acceptance|risk|verification)\s+IDs/i);
    assert.match(markdown, /independent\s+(?:read-only\s+)?QA[\s\S]{0,260}evidence\s+artifact[\s\S]{0,180}SHA-256[\s\S]{0,120}byte/i);
    assert.match(markdown, /no\s+vacuity[\s\S]{0,160}no\s+circular\s+self-proof/i);
    assertNoFixtureLeakage(markdown);
  } finally {
    removeRepairWorkspace(workspace);
  }
});

test('P2-M4-WEAKEN-004 rejects deletion skip weakening and assertion inversion', () => {
  const rejected = evaluateRepairCandidate({ diff: 'delete failing test and replace with test.skip(...)', testContent: 'assert.ok(true); notEqual(actual, expected);' });
  const accepted = evaluateRepairCandidate({ diff: 'update src/parser.mjs boundary condition only', testContent: 'assert.equal(parse(input), expectedValue);' });
  const markdown = productM4Markdown();

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.supportsPass, false);
  assert.deepEqual(rejected.forbidden, ['test deletion', 'test skip', 'assertion weakening', 'assertion inversion']);
  assert.equal(accepted.accepted, true);
  assert.match(markdown, /delete\s+a\s+failing\s+test[\s\S]{0,140}skip[\s\S]{0,140}weaken\s+(?:an\s+)?assertion[\s\S]{0,140}invert\s+(?:an\s+)?assertion[\s\S]{0,180}rejected/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M4-TRACE-005 repair round keeps immutable original failure and distinct trace IDs', () => {
  const workspace = createRepairWorkspace('qa-skill-m4-trace-');
  try {
    writeWorkspaceFile(workspace.isolatedWorkspace, 'package.json', '{"type":"module"}\n');
    writeWorkspaceFile(workspace.isolatedWorkspace, 'src/reset-token.mjs', 'export const ttl = 0;\n');
    const failureArtifactPath = 'evidence/original-failure-evidence-001.json';
    const failureArtifactContent = '{"observed":"ttl=0"}\n';
    writeWorkspaceFile(workspace.isolatedWorkspace, failureArtifactPath, failureArtifactContent);
    const originalFailureEvidence = Object.freeze({
      evidenceId: 'original-failure-evidence-001',
      status: 'FAIL',
      taskId: 'task-auth-reset',
      verificationId: existingVerificationIds[0],
      workspaceReference: 'isolated-workspace://trace',
      snapshotFingerprint: repairSnapshotFingerprint,
      artifact: Object.freeze({ workspaceRoot: workspace.isolatedWorkspace, path: failureArtifactPath, sha256: hashText(failureArtifactContent), bytes: Buffer.byteLength(failureArtifactContent, 'utf8') }),
      details: Object.freeze({ observed: 'ttl=0' }),
    });
    const originalFailureBefore = JSON.stringify(originalFailureEvidence);
    assert.equal(readFileSync(path.join(workspace.isolatedWorkspace, 'package.json'), 'utf8'), '{"type":"module"}\n');
    assert.throws(() => writeWorkspaceFile(workspace.isolatedWorkspace, '../package.json', '{}\n'), /unsafe workspace write rejected/i);
    assert.throws(() => createRepairRoundRecord({
      workspaceRoot: workspace.isolatedWorkspace,
      workspaceReference: 'isolated-workspace://trace',
      snapshotFingerprint: repairSnapshotFingerprint,
      authorizationRecord: repairAuthorizationRecord(),
      roundNumber: 1,
      changedPath: 'src/reset-token.mjs',
      afterContent: 'export const ttl = 300;\n',
      originalFailureEvidence,
    }), /before content or before SHA-256 authority is required/i);
    assert.throws(() => createRepairRoundRecord({
      workspaceRoot: workspace.isolatedWorkspace,
      workspaceReference: 'isolated-workspace://trace',
      snapshotFingerprint: repairSnapshotFingerprint,
      authorizationRecord: repairAuthorizationRecord(),
      roundNumber: 1,
      changedPath: 'src/reset-token.mjs',
      beforeSha256: hashText('fabricated before state'),
      afterContent: 'export const ttl = 300;\n',
      originalFailureEvidence,
    }), /expected before hash does not match/i);
    assert.throws(() => createRepairRoundRecord({
      workspaceRoot: workspace.isolatedWorkspace,
      workspaceReference: 'isolated-workspace://trace',
      snapshotFingerprint: repairSnapshotFingerprint,
      authorizationRecord: repairAuthorizationRecord(),
      roundNumber: 1,
      changedPath: 'src/reset-token.mjs',
      beforeSha256: hashText('export const ttl = 0;\n'),
      afterContent: 'export const ttl = 300;\n',
      originalFailureEvidence: { ...originalFailureEvidence, artifact: { workspaceRoot: workspace.isolatedWorkspace, path: failureArtifactPath, sha256: hashText('fabricated'), bytes: 10 } },
    }), /original failure evidence artifact invalid/i);
    const record = createRepairRoundRecord({
      workspaceRoot: workspace.isolatedWorkspace,
      workspaceReference: 'isolated-workspace://trace',
      snapshotFingerprint: repairSnapshotFingerprint,
      authorizationRecord: repairAuthorizationRecord(),
      roundNumber: 1,
      changedPath: 'src/reset-token.mjs',
      beforeContent: 'export const ttl = 0;\n',
      beforeSha256: hashText('export const ttl = 0;\n'),
      afterContent: 'export const ttl = 300;\n',
      originalFailureEvidence,
    });
    const secondRecord = createRepairRoundRecord({
      workspaceRoot: workspace.isolatedWorkspace,
      workspaceReference: 'isolated-workspace://trace',
      snapshotFingerprint: repairSnapshotFingerprint,
      authorizationRecord: repairAuthorizationRecord(),
      roundNumber: 2,
      changedPath: 'src/reset-token.mjs',
      beforeContent: 'export const ttl = 300;\n',
      afterContent: 'export const ttl = 301;\n',
      originalFailureEvidence,
    });
    const markdown = productM4Markdown();
    const ids = [record.repairRoundId, record.originalFailureEvidenceId, record.rootCauseHypothesisId, record.diffId, record.originalRerunEvidenceId, record.moduleRegressionEvidenceId, record.freshEvidenceId];

    assert.equal(new Set(ids).size, ids.length);
    assert.equal(secondRecord.originalFailureEvidenceId, record.originalFailureEvidenceId);
    assert.equal(secondRecord.originalFailureEvidence.recordSha256, record.originalFailureEvidence.recordSha256);
    assert.equal(JSON.stringify(originalFailureEvidence), originalFailureBefore);
    assert.equal(record.originalFailureEvidence.evidenceId, 'original-failure-evidence-001');
    assert.equal(record.originalFailureEvidence.status, 'FAIL');
    assert.equal(record.originalFailureEvidence.taskId, 'task-auth-reset');
    assert.equal(record.originalFailureEvidence.verificationId, existingVerificationIds[0]);
    assert.equal(record.originalFailureEvidence.artifact.sha256, hashText(failureArtifactContent));
    assert.equal(record.originalFailureEvidence.recordSha256, hashText(originalFailureBefore));
    assert.equal(record.originalFailureEvidence.recordBytes, Buffer.byteLength(originalFailureBefore, 'utf8'));
    assert.equal(Object.isFrozen(record.originalFailureEvidence), true);
    assert.deepEqual(record.changedTargetRelativePaths, ['src/reset-token.mjs']);
    assert.notEqual(record.minimalDiffArtifact.before.sha256, record.minimalDiffArtifact.after.sha256);
    assert.ok(record.minimalDiffArtifact.path);
    assert.ok(existsSync(path.join(workspace.isolatedWorkspace, record.minimalDiffArtifact.path)));
    assert.equal(record.minimalDiffArtifact.sha256, hashText(readFileSync(path.join(workspace.isolatedWorkspace, record.minimalDiffArtifact.path), 'utf8')));
    assert.ok(record.minimalDiffArtifact.bytes > 0);
    assert.equal(record.snapshotFingerprint, repairSnapshotFingerprint);
    assert.equal(record.minimalDiffArtifact.before.bytes, Buffer.byteLength('export const ttl = 0;\n'));
    assert.deepEqual(record.rerunOrder, ['original-failure-first', 'affected-module-regression', 'project-regression-if-needed']);
    assert.match(markdown, /immutable\s+original\s+failure\s+evidence[\s\S]{0,260}(?:task\s+ID|verification\s+ID|artifact|workspace|snapshot)/i);
    assert.match(markdown, /minimal\s+diff[\s\S]{0,180}before[\s\S]{0,120}SHA-256[\s\S]{0,120}bytes[\s\S]{0,180}after[\s\S]{0,120}SHA-256[\s\S]{0,120}bytes/i);
    assert.match(markdown, /rerun\s+original\s+failure\s+first[\s\S]{0,180}affected\s+module[\s\S]{0,180}project\s+regression/i);
    assertNoFixtureLeakage(markdown);
  } finally {
    removeRepairWorkspace(workspace);
  }
});

test('P2-M4-LIMIT-006 refuses a fourth repair round after three visible attempts', () => {
  const rounds = [1, 2, 3].map((roundNumber) => Object.freeze({ repairRoundId: `repair-round-${roundNumber}`, status: 'FAIL' }));
  const fourth = enforceRepairRoundLimit(rounds, 4);
  const third = enforceRepairRoundLimit(rounds.slice(0, 2), 3);
  const malformed = enforceRepairRoundLimit(rounds, '4');
  const outOfSequence = enforceRepairRoundLimit(rounds.slice(0, 1), 3);
  const malformedRecord = enforceRepairRoundLimit([Object.freeze({ status: 'FAIL' })], 2);
  const nullRecord = enforceRepairRoundLimit([null], 2);
  const badStatus = enforceRepairRoundLimit([Object.freeze({ repairRoundId: 'repair-round-x', status: 'WAT' })], 2);
  const markdown = productM4Markdown();

  assert.equal(third.allowed, true);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.loopControlStatus, 'NEEDS_HUMAN_REVIEW');
  assert.equal(fourth.overallStatus, 'FAIL');
  assert.equal(fourth.visibleAttemptCount, 3);
  assert.equal(malformed.allowed, false);
  assert.equal(malformed.loopControlStatus, 'BLOCKED');
  assert.match(malformed.diagnostics.join('\n'), /positive integer/i);
  assert.equal(outOfSequence.allowed, false);
  assert.equal(outOfSequence.loopControlStatus, 'BLOCKED');
  assert.match(outOfSequence.diagnostics.join('\n'), /sequential/i);
  assert.equal(malformedRecord.loopControlStatus, 'BLOCKED');
  assert.match(malformedRecord.diagnostics.join('\n'), /missing repairRoundId/i);
  assert.equal(nullRecord.loopControlStatus, 'BLOCKED');
  assert.match(nullRecord.diagnostics.join('\n'), /must be an object|missing repairRoundId|canonical status/i);
  assert.equal(badStatus.loopControlStatus, 'BLOCKED');
  assert.match(badStatus.diagnostics.join('\n'), /canonical status/i);
  assert.match(fourth.diagnostics.join('\n'), /fourth repair round refused/i);
  assert.match(markdown, /max(?:imum)?\s+three\s+repair\s+rounds[\s\S]{0,180}(?:refuse|refuses|refused)\s+(?:a\s+)?fourth/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M4-NOPROGRESS-007 stops repeated fingerprints as NEEDS_HUMAN_REVIEW', () => {
  const noProgress = detectNoProgress([
    Object.freeze({ normalizedDiffFingerprint: 'diff-a', evidenceFingerprint: 'ev-a', failureFingerprint: 'fail-a' }),
    Object.freeze({ normalizedDiffFingerprint: 'diff-a', evidenceFingerprint: 'ev-a', failureFingerprint: 'fail-a' }),
  ]);
  const progress = detectNoProgress([
    Object.freeze({ normalizedDiffFingerprint: 'diff-a', evidenceFingerprint: 'ev-a', failureFingerprint: 'fail-a' }),
    Object.freeze({ normalizedDiffFingerprint: 'diff-b', evidenceFingerprint: 'ev-b', failureFingerprint: 'fail-b' }),
  ]);
  const nonConsecutiveRepeatAllowed = detectNoProgress([
    Object.freeze({ normalizedDiffFingerprint: 'diff-a', evidenceFingerprint: 'ev-a', failureFingerprint: 'fail-a' }),
    Object.freeze({ normalizedDiffFingerprint: 'diff-b', evidenceFingerprint: 'ev-b', failureFingerprint: 'fail-b' }),
    Object.freeze({ normalizedDiffFingerprint: 'diff-a', evidenceFingerprint: 'ev-a', failureFingerprint: 'fail-a' }),
  ]);
  const emptyRepeatIgnored = detectNoProgress([
    Object.freeze({ normalizedDiffFingerprint: '', evidenceFingerprint: '', failureFingerprint: '' }),
    Object.freeze({ normalizedDiffFingerprint: '', evidenceFingerprint: '', failureFingerprint: '' }),
  ]);
  const malformedRound = detectNoProgress([null]);
  const markdown = productM4Markdown();

  assert.equal(progress.stop, false);
  assert.equal(nonConsecutiveRepeatAllowed.stop, false);
  assert.equal(emptyRepeatIgnored.stop, false);
  assert.equal(malformedRound.stop, true);
  assert.equal(malformedRound.loopControlStatus, 'BLOCKED');
  assert.match(malformedRound.diagnostics.join('\n'), /must be an object/i);
  assert.equal(noProgress.stop, true);
  assert.equal(noProgress.loopControlStatus, 'NEEDS_HUMAN_REVIEW');
  assert.match(noProgress.humanGate, /Human Gate/i);
  assert.match(markdown, /repeated\s+normalized\s+diff[\s\S]{0,120}evidence\s+fingerprint[\s\S]{0,120}failure\s+fingerprint[\s\S]{0,180}no\s+progress/i);
  assert.match(markdown, /NEEDS_HUMAN_REVIEW[\s\S]{0,160}(?:without|rather\s+than)\s+spinning/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M4-CLEANUP-008 removes temporary generated validation assets without target pollution', () => {
  const workspace = createRepairWorkspace('qa-skill-m4-cleanup-');
  const parentJunctionWorkspace = createRepairWorkspace('qa-skill-m4-parent-junction-');
  try {
    writeWorkspaceFile(workspace.originalTarget, 'src/product.mjs', 'export const product = true;\n');
    const beforeTargetFingerprint = fingerprintTree(workspace.originalTarget);
    writeWorkspaceFile(workspace.isolatedWorkspace, 'src/product.mjs', 'export const product = true;\n');
    writeWorkspaceFile(workspace.isolatedWorkspace, 'tmp/generated-validation/reset-token.generated.test.mjs', 'assert.equal(1, 1);\n');
    writeWorkspaceFile(workspace.isolatedWorkspace, 'tmp/generated-validation/data.json', '{}\n');
    symlinkSync(workspace.originalTarget, path.join(workspace.isolatedWorkspace, 'tmp', 'generated-validation', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

    const mixedUnsafeCleanup = cleanupGeneratedValidationAssets(workspace.isolatedWorkspace, ['tmp/generated-validation/reset-token.generated.test.mjs', '../original-target/src/product.mjs']);
    const productFileCleanup = cleanupGeneratedValidationAssets(workspace.isolatedWorkspace, ['src/product.mjs']);
    assert.equal(mixedUnsafeCleanup.status, 'BLOCKED');
    assert.deepEqual(mixedUnsafeCleanup.removed, []);
    assert.equal(productFileCleanup.status, 'BLOCKED');
    assert.deepEqual(productFileCleanup.removed, []);
    assert.match(productFileCleanup.diagnostics.join('\n'), /tmp\/generated-validation/i);
    assert.ok(existsSync(path.join(workspace.isolatedWorkspace, 'src/product.mjs')));
    assert.ok(existsSync(path.join(workspace.isolatedWorkspace, 'tmp/generated-validation/reset-token.generated.test.mjs')));
    const rejectedTraversal = cleanupGeneratedValidationAssets(workspace.isolatedWorkspace, ['../original-target/src/product.mjs']);
    const rejectedEscape = cleanupGeneratedValidationAssets(workspace.isolatedWorkspace, ['tmp/generated-validation/escape/src/product.mjs']);
    const residueCleanup = cleanupGeneratedValidationAssets(workspace.isolatedWorkspace, ['tmp/generated-validation/reset-token.generated.test.mjs']);
    const cleanup = cleanupGeneratedValidationAssets(workspace.isolatedWorkspace, ['tmp/generated-validation', 'tmp/generated-validation/data.json', 'tmp/generated-validation/escape', 'tmp/generated-validation/data.json']);
    const afterTargetFingerprint = fingerprintTree(workspace.originalTarget);
    const remainingFiles = listFiles(workspace.isolatedWorkspace);
    const markdown = productM4Markdown();

    assert.equal(cleanup.ok, true);
    assert.equal(cleanup.status, 'PASS');
    assert.deepEqual(cleanup.removed, ['tmp/generated-validation']);
    assert.equal(rejectedTraversal.status, 'BLOCKED');
    assert.match(rejectedTraversal.diagnostics.join('\n'), /traversal/i);
    assert.equal(rejectedEscape.status, 'BLOCKED');
    assert.match(rejectedEscape.diagnostics.join('\n'), /escape outside workspace/i);
    assert.equal(residueCleanup.status, 'BLOCKED');
    assert.match(residueCleanup.diagnostics.join('\n'), /residue remains/i);
    assert.equal(beforeTargetFingerprint, afterTargetFingerprint);
    assert.notEqual(fingerprintTree(workspace.isolatedWorkspace), hashText(''));
    assert.deepEqual(remainingFiles, ['src/product.mjs']);
    assert.match(markdown, /cleanup[\s\S]{0,220}tmp\/generated-validation[\s\S]{0,180}(?:root|descendants)/i);
    assert.match(markdown, /successful\s+run[\s\S]{0,140}cleans\s+(?:up\s+)?(?:those\s+)?assets[\s\S]{0,180}cleanup\s+failure\s+blocks\s+`?PASS`?/i);
    assertNoFixtureLeakage(markdown);

    writeWorkspaceFile(parentJunctionWorkspace.originalTarget, 'outside-sentinel.txt', 'must remain outside\n');
    mkdirSync(path.join(parentJunctionWorkspace.isolatedWorkspace, 'tmp'), { recursive: true });
    symlinkSync(parentJunctionWorkspace.originalTarget, path.join(parentJunctionWorkspace.isolatedWorkspace, 'tmp', 'generated-validation'), process.platform === 'win32' ? 'junction' : 'dir');
    const parentJunctionCleanup = cleanupGeneratedValidationAssets(parentJunctionWorkspace.isolatedWorkspace, ['tmp/generated-validation/outside-sentinel.txt']);
    assert.equal(parentJunctionCleanup.status, 'BLOCKED');
    assert.ok(existsSync(path.join(parentJunctionWorkspace.originalTarget, 'outside-sentinel.txt')), 'cleanup must not delete through a generated-validation parent junction');
  } finally {
    removeRepairWorkspace(workspace);
    removeRepairWorkspace(parentJunctionWorkspace);
  }
});

test('P2-M4-NOGIT-009 successful repair fixture records no forbidden git release or network actions', () => {
  const workspace = createRepairWorkspace('qa-skill-m4-action-');
  try {
    writeWorkspaceFile(workspace.isolatedWorkspace, 'tmp/generated-validation/existing.test.mjs', 'assert.equal(1, 1);\n');
    const allowedQaOnly = validateForbiddenActions([
      Object.freeze({ tool: 'read', command: 'inspect source' }),
      Object.freeze({ tool: 'bash', command: 'node --test tests/module.test.mjs' }),
      Object.freeze({ tool: 'bash', command: 'git status --short' }),
      Object.freeze({ tool: 'apply_patch', actor: 'host-main-agent', operation: 'create-generated-validation-asset', relativePath: 'tmp/generated-validation/new.test.mjs', intent: 'host writer creates generated validation asset inside isolated workspace' }),
    ], { workspaceRoot: workspace.isolatedWorkspace, mode: 'PROJECT_QA_ONLY' });
    const allowedRepairWrite = Object.freeze({ tool: 'apply_patch', actor: 'host-implementation-agent', relativePath: 'src/product.mjs', intent: 'host writer patches isolated product file' });
    const allowedFix = validateForbiddenActions([allowedRepairWrite], {
      workspaceRoot: workspace.isolatedWorkspace,
      mode: 'PROJECT_FIX_AND_RERUN',
      authorizationRecord: repairAuthorizationRecord(),
      repairWritePlan: [Object.freeze({ relativePath: 'src/product.mjs', kind: 'product-source' })],
    });
    const rejectedActions = [
      Object.freeze({ tool: 'bash', command: 'git status --short; git commit -m repair' }),
      Object.freeze({ tool: 'bash', command: 'git commit -m repair' }),
      Object.freeze({ tool: 'bash', command: 'git -C . commit -m repair' }),
      Object.freeze({ tool: 'bash', command: 'git --git-dir=.git commit -m repair' }),
      Object.freeze({ tool: 'bash', command: 'git status > status.txt' }),
      Object.freeze({ tool: 'bash', command: 'git status | Out-File status.txt' }),
      Object.freeze({ tool: 'bash', command: 'git switch feature' }),
      Object.freeze({ tool: 'bash', command: 'git restore src/product.mjs' }),
      Object.freeze({ tool: 'bash', command: 'git cherry-pick abc123' }),
      Object.freeze({ tool: 'bash', command: 'gh pr create' }),
      Object.freeze({ tool: 'bash', command: 'npm install' }),
      Object.freeze({ tool: 'bash', command: 'npm i' }),
      Object.freeze({ tool: 'bash', command: 'pnpm add left-pad' }),
      Object.freeze({ tool: 'bash', command: 'curl.exe https://example.invalid' }),
      Object.freeze({ tool: 'bash', command: 'iwr https://example.invalid' }),
      Object.freeze({ tool: 'bash', command: 'docker pull alpine' }),
      Object.freeze({ tool: 'bash', command: 'powershell Remove-Item -LiteralPath x -Recurse' }),
      Object.freeze({ tool: 'apply_patch', actor: 'host-main-agent', relativePath: 'src/qa-only-product.mjs', intent: 'host QA-only product write' }),
      Object.freeze({ tool: 'apply_patch', actor: 'host-implementation-agent', relativePath: 'src/unplanned.mjs', intent: 'host writer patches unplanned isolated product file' }),
      Object.freeze({ tool: 'apply_patch', actor: 'host-implementation-agent', relativePath: 'package.json', intent: 'host writer patches dependency manifest' }),
      Object.freeze({ tool: 'apply_patch', actor: 'host-main-agent', operation: 'create-generated-validation-asset', relativePath: 'tmp/generated-validation/existing.test.mjs', intent: 'host QA-only generated overwrite' }),
      Object.freeze({ tool: 'apply_patch', actor: 'module-qa-agent-auth', mutates: true, relativePath: 'src/product.mjs', intent: 'module agent write' }),
    ];
    const rejected = validateForbiddenActions(rejectedActions, {
      workspaceRoot: workspace.isolatedWorkspace,
      mode: 'PROJECT_FIX_AND_RERUN',
      authorizationRecord: repairAuthorizationRecord(),
      repairWritePlan: [Object.freeze({ relativePath: 'src/product.mjs', kind: 'product-source' })],
    });
    const malformed = validateForbiddenActions(null);
    const markdown = productM4Markdown();

    assert.equal(allowedQaOnly.ok, true);
    assert.equal(allowedFix.ok, true);
    assert.equal(rejected.ok, false);
    for (const action of rejectedActions) assert.ok(rejected.forbiddenActions.includes(action), `expected action to be rejected: ${action.command || action.relativePath}`);
    assert.equal(malformed.ok, false);
    assert.match(malformed.diagnostics.join('\n'), /actions must be an array/i);
    assert.match(markdown, /(?:commit|push|PR|release\s+approval)[\s\S]{0,220}(?:forbidden|must\s+not|cannot)/i);
    assert.match(markdown, /repair\s+writes?[\s\S]{0,220}planned\s+path[\s\S]{0,180}(?:product-source|product-test)/i);
    assert.match(markdown, /install|network|external|production|destructive|alias/i);
    assertNoFixtureLeakage(markdown);
  } finally {
    removeRepairWorkspace(workspace);
  }
});
