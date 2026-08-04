import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  classifyHistory,
  computeStaleInvalidation,
  createCheckpointRecord,
  createInitialRun,
  createRecoveryWorkspace,
  createResumeRun,
  decideRecoveryStorage,
  detectConflictStop,
  evaluateEvidenceReuse,
  fileRecord,
  fingerprintTree,
  fixtureOnlyRecoveryTerms,
  hashText,
  reconcileCurrentStatus,
  removeRecoveryWorkspace,
  stableFindingIdentity,
  targetBaseline,
  validateCheckpointRecord,
  validateRunLineage,
  writeWorkspaceFile,
} from './project-fixtures/recovery/contracts.mjs';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');

function readPackMarkdown(relativePath) {
  const absolutePath = path.join(packRoot, relativePath);
  assert.ok(existsSync(absolutePath), `missing pack file ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function productM5Markdown() {
  return [
    readPackMarkdown('using-project-qa/SKILL.md'),
    readPackMarkdown('project-qa-execute/SKILL.md'),
    readPackMarkdown('project-qa-conclude/SKILL.md'),
    readPackMarkdown('project-qa-repair/SKILL.md'),
    readPackMarkdown('references/project-qa-run-contract.md'),
    readPackMarkdown('references/project-run-recovery.md'),
    readPackMarkdown('templates/project-qa-report.md'),
  ].join('\n');
}

function assertNoFixtureLeakage(markdown) {
  for (const term of fixtureOnlyRecoveryTerms) {
    assert.ok(!markdown.includes(term), `product Markdown leaked fixture-only term ${term}`);
  }
}

test('P2-M5-IDENTITY-001 resume identity keeps session stable and history separate from lineage', () => {
  const initial = createInitialRun();
  const firstResume = createResumeRun(initial, { runId: 'm5-run-002', compatiblePriorHistoryRunId: 'm5-history-run-compatible' });
  const secondResume = createResumeRun(firstResume, { runId: 'm5-run-003', compatiblePriorHistoryRunId: 'm5-history-run-compatible' });
  const valid = validateRunLineage([initial, firstResume, secondResume], { compatiblePriorHistoryRunId: 'm5-history-run-compatible' });
  const selfParent = validateRunLineage([{ ...initial, parent_run_id: initial.run_id }]);
  const crossSession = validateRunLineage([initial, { ...firstResume, qa_session_id: 'other-session' }]);
  const malformed = validateRunLineage([initial, { ...firstResume, run_id: '' }]);
  const parentAsHistory = validateRunLineage([initial, firstResume], { compatiblePriorHistoryRunId: initial.run_id });
  const embeddedParentAsHistory = validateRunLineage([initial, { ...firstResume, compatible_prior_history_run_id: initial.run_id }]);
  const malformedEmbeddedHistory = validateRunLineage([initial, { ...firstResume, compatible_prior_history_run_id: 42 }]);
  const markdown = productM5Markdown();

  assert.equal(valid.ok, true);
  assert.equal(firstResume.qa_session_id, initial.qa_session_id);
  assert.notEqual(firstResume.run_id, initial.run_id);
  assert.equal(firstResume.parent_run_id, initial.run_id);
  assert.equal(secondResume.parent_run_id, firstResume.run_id);
  assert.equal(valid.compatible_prior_history_run_id, 'm5-history-run-compatible');
  assert.equal(selfParent.ok, false);
  assert.match(selfParent.diagnostics.join('\n'), /self parent_run_id/i);
  assert.equal(crossSession.ok, false);
  assert.match(crossSession.diagnostics.join('\n'), /crosses qa_session_id/i);
  assert.equal(malformed.ok, false);
  assert.match(malformed.diagnostics.join('\n'), /malformed identity/i);
  assert.equal(parentAsHistory.ok, false);
  assert.match(parentAsHistory.diagnostics.join('\n'), /prior-history reference must be separate|parent_run_id must not be reused/i);
  assert.equal(embeddedParentAsHistory.ok, false);
  assert.match(embeddedParentAsHistory.diagnostics.join('\n'), /prior-history reference must be separate|parent_run_id must not be reused/i);
  assert.equal(malformedEmbeddedHistory.ok, false);
  assert.match(malformedEmbeddedHistory.diagnostics.join('\n'), /compatible prior-history reference must be a non-empty string/i);
  assert.match(markdown, /`qa_session_id`[\s\S]{0,180}stable[\s\S]{0,180}resume/i);
  assert.match(markdown, /every\s+resume[\s\S]{0,160}new\s+`?run_id`?/i);
  assert.match(markdown, /`parent_run_id`[\s\S]{0,220}immediate[\s\S]{0,120}same-session[\s\S]{0,140}resume lineage/i);
  assert.match(markdown, /compatible\s+prior-history\s+run[\s\S]{0,180}separate[\s\S]{0,160}`?parent_run_id`?/i);
  assert.match(markdown, /reject[\s\S]{0,120}self[\s\S]{0,120}cross-session[\s\S]{0,120}malformed[\s\S]{0,160}parent-as-history/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M5-UNCHANGED-002 exact unchanged tuple permits carried-forward evidence only with original provenance', () => {
  const workspace = createRecoveryWorkspace('qa-skill-m5-unchanged-');
  try {
    writeWorkspaceFile(workspace.hostStorage, 'evidence/m5-evidence-original.json', '{"ok":true}\n');
    const originalEvidence = fileRecord(workspace.hostStorage, 'evidence/m5-evidence-original.json', { source_run_id: 'm5-run-001', result_id: 'result-auth', evidence_id: 'evidence-auth-pass' });
    const prior = Object.freeze({ target_scope_identity: 'scope-a', module_fingerprint: 'module-a', dependency_closure_fingerprint: 'closure-a', module_id: 'module-auth', task_id: 'task-auth', verification_id: 'verify-auth', snapshot_fingerprint: 'snap-a', workspace_reference: 'isolated://snap-a', evidence: originalEvidence });
    const current = Object.freeze({ ...prior, evidence: originalEvidence });
    const reused = evaluateEvidenceReuse({ current, prior, storageRoot: workspace.hostStorage });
    const changedScope = evaluateEvidenceReuse({ current: { ...current, target_scope_identity: 'scope-b' }, prior });
    const changedModule = evaluateEvidenceReuse({ current: { ...current, module_fingerprint: 'module-b' }, prior });
    const fabricatedEvidence = evaluateEvidenceReuse({ current: { ...current, evidence: { ...originalEvidence, sha256: hashText('fresh fabricated') } }, prior, storageRoot: workspace.hostStorage });
    const missingEvidence = Object.freeze({ ...prior, evidence: { ...originalEvidence, path: 'evidence/missing.json' } });
    const missingArtifact = evaluateEvidenceReuse({ current: missingEvidence, prior: missingEvidence, storageRoot: workspace.hostStorage });
    const missingStorageRoot = evaluateEvidenceReuse({ current, prior });
    const forgedProvenance = evaluateEvidenceReuse({ current: { ...current, evidence: { ...originalEvidence, provenance: { ...originalEvidence.provenance, evidence_id: 'forged-evidence' } } }, prior, storageRoot: workspace.hostStorage });
    const storage = decideRecoveryStorage({ runId: 'm5-run-002', projectLocalIgnoredOrExcluded: false, repositoryRoot });
    const markdown = productM5Markdown();

    assert.equal(reused.reusable, true);
    assert.equal(reused.supportsCurrentCoverage, true);
    assert.equal(reused.carriedForwardEvidence.carried_forward, true);
    assert.equal(reused.carriedForwardEvidence.current_applicability_validated, true);
    assert.equal(reused.carriedForwardEvidence.provenance.source_run_id, 'm5-run-001');
    assert.equal(changedScope.supportsCurrentCoverage, false);
    assert.equal(changedScope.reusable, false);
    assert.match(changedScope.diagnostics.join('\n'), /target scope identity/i);
    assert.equal(changedModule.reusable, false);
    assert.match(changedModule.diagnostics.join('\n'), /module fingerprint/i);
    assert.equal(fabricatedEvidence.reusable, false);
    assert.match(fabricatedEvidence.diagnostics.join('\n'), /original evidence sha256/i);
    assert.equal(missingArtifact.reusable, false);
    assert.match(missingArtifact.diagnostics.join('\n'), /missing|reference mismatch|path does not exist/i);
    assert.equal(missingStorageRoot.reusable, false);
    assert.match(missingStorageRoot.diagnostics.join('\n'), /storage\/artifact root is required/i);
    assert.equal(forgedProvenance.reusable, false);
    assert.match(forgedProvenance.diagnostics.join('\n'), /provenance/i);
    assert.equal(storage.kind, 'host-owned-external');
    assert.equal(storage.writesRepositoryQa, false);
    assert.equal(existsSync(path.join(repositoryRoot, '.qa')), false);
    assert.match(markdown, /unchanged\s+reuse[\s\S]{0,220}exact\s+target\s+scope\s+identity[\s\S]{0,220}module\s+fingerprint[\s\S]{0,220}dependency-closure\s+fingerprint/i);
    assert.match(markdown, /original\s+evidence\s+path[\s\S]{0,160}hash[\s\S]{0,80}bytes[\s\S]{0,160}source\s+run[\s\S]{0,120}provenance/i);
    assert.match(markdown, /storage\/artifact\s+root[\s\S]{0,120}re-read[\s\S]{0,120}actual\s+artifact[\s\S]{0,120}SHA-256[\s\S]{0,80}bytes/i);
    assert.match(markdown, /carried-forward\s+evidence[\s\S]{0,180}validated[\s\S]{0,180}not\s+fabricated/i);
    assert.match(markdown, /\.qa\/runs\/<run_id>\/[\s\S]{0,200}already\s+ignored\s+or\s+local-excluded[\s\S]{0,220}host-owned\s+external/i);
    assertNoFixtureLeakage(markdown);
  } finally {
    removeRecoveryWorkspace(workspace);
  }
});

test('P2-M5-STALE-003 changed scope invalidates dependency closure and persists repair loop state', () => {
  const stale = computeStaleInvalidation({
    modules: { 'M5-AUTH-MODULE': {}, 'M5-BILLING-MODULE': {}, 'M5-DEPENDENT-FLOW': {} },
    dependencyEdges: [['M5-AUTH-MODULE', 'M5-DEPENDENT-FLOW']],
    changedModules: ['M5-AUTH-MODULE'],
    priorReuseTuples: { 'M5-AUTH-MODULE': { exact: false }, 'M5-BILLING-MODULE': { exact: true }, 'M5-DEPENDENT-FLOW': { exact: false } },
    repairState: { usedRounds: 2, noProgressFingerprints: ['diff-a', 'evidence-a'] },
  });
  const markdown = productM5Markdown();

  assert.deepEqual(stale.invalidated, ['M5-AUTH-MODULE', 'M5-DEPENDENT-FLOW']);
  assert.deepEqual(stale.reusable, ['M5-BILLING-MODULE']);
  assert.deepEqual(stale.historicalOnly, ['M5-AUTH-MODULE', 'M5-DEPENDENT-FLOW']);
  assert.equal(stale.repairState.usedRounds, 2);
  assert.deepEqual(stale.repairState.noProgressFingerprints, ['diff-a', 'evidence-a']);
  assert.match(markdown, /changed\s+module[\s\S]{0,180}invalidates\s+itself[\s\S]{0,200}dependent\s+modules[\s\S]{0,120}key\s+flows[\s\S]{0,120}coverage[\s\S]{0,180}dependency\s+edges/i);
  assert.match(markdown, /unaffected\s+modules[\s\S]{0,180}reusable[\s\S]{0,180}exact\s+tuple/i);
  assert.match(markdown, /stale\s+evidence[\s\S]{0,140}historical[\s\S]{0,120}diagnostic[\s\S]{0,160}cannot\s+support\s+current\s+`?PASS`?/i);
  assert.match(markdown, /repair\s+round\s+count[\s\S]{0,160}no-progress\s+state[\s\S]{0,160}persist[\s\S]{0,160}resume/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M5-CORRUPT-004 checkpoint and manifest corruption is structured infrastructure BLOCKED', () => {
  const workspace = createRecoveryWorkspace('qa-skill-m5-corrupt-');
  try {
    const checkpoint = createCheckpointRecord({ storageRoot: workspace.hostStorage });
    const valid = validateCheckpointRecord(checkpoint);
    const outsideRoot = path.join(workspace.root, 'outside-storage-target');
    mkdirSync(outsideRoot, { recursive: true });
    writeWorkspaceFile(outsideRoot, 'sentinel.txt', 'outside bytes must remain\n');
    symlinkSync(outsideRoot, path.join(workspace.hostStorage, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => writeWorkspaceFile(workspace.hostStorage, 'link/escaped.txt', 'must not escape\n'), /unsafe workspace write rejected/i);
    assert.equal(existsSync(path.join(outsideRoot, 'escaped.txt')), false);
    assert.equal(readFileSync(path.join(outsideRoot, 'sentinel.txt'), 'utf8'), 'outside bytes must remain\n');
    symlinkSync(outsideRoot, path.join(workspace.hostStorage, 'leaf-junction'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => writeWorkspaceFile(workspace.hostStorage, 'leaf-junction', 'must not overwrite leaf junction\n'), /unsafe workspace write rejected/i);
    assert.equal(readFileSync(path.join(outsideRoot, 'sentinel.txt'), 'utf8'), 'outside bytes must remain\n');
    writeWorkspaceFile(workspace.hostStorage, 'regular-existing.txt', 'before\n');
    writeWorkspaceFile(workspace.hostStorage, 'regular-existing.txt', 'after\n');
    assert.equal(readFileSync(path.join(workspace.hostStorage, 'regular-existing.txt'), 'utf8'), 'after\n');
    writeWorkspaceFile(workspace.hostStorage, checkpoint.checkpoint.path, '{"schema_version":');
    const truncated = validateCheckpointRecord(checkpoint);
    const restored = createCheckpointRecord({ storageRoot: workspace.hostStorage });
    const unsupported = createCheckpointRecord({ storageRoot: workspace.hostStorage, schemaVersion: 99 });
    const unsupportedResult = validateCheckpointRecord(unsupported);
    const invalidBudget = createCheckpointRecord({ storageRoot: workspace.hostStorage, repairRoundBudget: { maxRounds: 4, usedRounds: 5 } });
    const invalidBudgetResult = validateCheckpointRecord(invalidBudget);
    const invalidNoProgress = createCheckpointRecord({ storageRoot: workspace.hostStorage, noProgressFingerprints: { normalizedDiff: '', evidence: 3 } });
    const invalidNoProgressResult = validateCheckpointRecord(invalidNoProgress);
    const missingProvenance = createCheckpointRecord({ storageRoot: workspace.hostStorage, completedResults: [{ result_id: 'result-auth', task_id: 'task-auth', status: 'FAIL', evidence: [{ ...restored.evidence, provenance: { source_run_id: 'm5-run-002', evidence_id: 'm5-current-fail-evidence' } }] }] });
    const missingProvenanceResult = validateCheckpointRecord(missingProvenance);
    const defaultResult = restored.checkpointPayload.completed_results[0];
    const missingModule = createCheckpointRecord({ storageRoot: workspace.hostStorage, completedResults: [{ ...defaultResult, module_id: '' }] });
    const missingModuleResult = validateCheckpointRecord(missingModule);
    const missingVerification = createCheckpointRecord({ storageRoot: workspace.hostStorage, completedResults: [{ ...defaultResult, verification_ids: [] }] });
    const missingVerificationResult = validateCheckpointRecord(missingVerification);
    const missingSnapshot = createCheckpointRecord({ storageRoot: workspace.hostStorage, completedResults: [{ ...defaultResult, snapshot_fingerprint: '' }] });
    const missingSnapshotResult = validateCheckpointRecord(missingSnapshot);
    const missingWorkspaceReference = createCheckpointRecord({ storageRoot: workspace.hostStorage, completedResults: [{ ...defaultResult, workspace_reference: '' }] });
    const missingWorkspaceReferenceResult = validateCheckpointRecord(missingWorkspaceReference);
    const coverageBase = createCheckpointRecord({ storageRoot: workspace.hostStorage });
    const directoryReference = validateCheckpointRecord({ ...coverageBase, checkpoint: { ...coverageBase.checkpoint, path: 'run-state' } });
    const missingManifestContent = `${JSON.stringify({ ...coverageBase.manifestPayload, artifacts: [] }, null, 2)}\n`;
    writeWorkspaceFile(workspace.hostStorage, 'run-state/manifest-missing-artifact.json', missingManifestContent);
    const missingManifestArtifact = validateCheckpointRecord({ ...coverageBase, manifest: { ...coverageBase.manifest, path: 'run-state/manifest-missing-artifact.json', sha256: hashText(missingManifestContent), bytes: Buffer.byteLength(missingManifestContent) } });
    const duplicateManifestContent = `${JSON.stringify({ ...coverageBase.manifestPayload, artifacts: [coverageBase.evidence, coverageBase.evidence] }, null, 2)}\n`;
    writeWorkspaceFile(workspace.hostStorage, 'run-state/manifest-duplicate-artifact.json', duplicateManifestContent);
    const duplicateManifestArtifact = validateCheckpointRecord({ ...coverageBase, manifest: { ...coverageBase.manifest, path: 'run-state/manifest-duplicate-artifact.json', sha256: hashText(duplicateManifestContent), bytes: Buffer.byteLength(duplicateManifestContent) } });
    const missing = validateCheckpointRecord({ ...restored, checkpoint: { ...restored.checkpoint, path: 'run-state/missing.json' } });
    const hashMismatch = validateCheckpointRecord({ ...restored, checkpoint: { ...restored.checkpoint, sha256: hashText('wrong') } });
    const byteMismatch = validateCheckpointRecord({ ...restored, manifest: { ...restored.manifest, bytes: restored.manifest.bytes + 1 } });
    const referenceMismatch = validateCheckpointRecord({ ...restored, manifest: { ...restored.manifest, path: restored.checkpoint.path } });
    const markdown = productM5Markdown();

    assert.equal(valid.status, 'PASS');
    assert.equal(truncated.status, 'BLOCKED');
    assert.match(truncated.diagnostics.join('\n'), /corrupt or truncated/i);
    assert.equal(unsupportedResult.status, 'BLOCKED');
    assert.match(unsupportedResult.diagnostics.join('\n'), /unsupported checkpoint schema version/i);
    assert.equal(invalidBudgetResult.status, 'BLOCKED');
    assert.match(invalidBudgetResult.diagnostics.join('\n'), /repair round budget/i);
    assert.equal(invalidNoProgressResult.status, 'BLOCKED');
    assert.match(invalidNoProgressResult.diagnostics.join('\n'), /no-progress/i);
    assert.equal(missingProvenanceResult.status, 'BLOCKED');
    assert.match(missingProvenanceResult.diagnostics.join('\n'), /provenance result_id/i);
    assert.equal(missingModuleResult.status, 'BLOCKED');
    assert.match(missingModuleResult.diagnostics.join('\n'), /module_id/i);
    assert.equal(missingVerificationResult.status, 'BLOCKED');
    assert.match(missingVerificationResult.diagnostics.join('\n'), /verification_ids/i);
    assert.equal(missingSnapshotResult.status, 'BLOCKED');
    assert.match(missingSnapshotResult.diagnostics.join('\n'), /snapshot_fingerprint/i);
    assert.equal(missingWorkspaceReferenceResult.status, 'BLOCKED');
    assert.match(missingWorkspaceReferenceResult.diagnostics.join('\n'), /workspace_reference/i);
    assert.equal(directoryReference.status, 'BLOCKED');
    assert.match(directoryReference.diagnostics.join('\n'), /must be a regular file|directory/i);
    assert.equal(missingManifestArtifact.status, 'BLOCKED');
    assert.match(missingManifestArtifact.diagnostics.join('\n'), /manifest artifacts must cover completed evidence/i);
    assert.equal(duplicateManifestArtifact.status, 'BLOCKED');
    assert.match(duplicateManifestArtifact.diagnostics.join('\n'), /duplicate manifest artifact identity/i);
    assert.equal(missing.status, 'BLOCKED');
    assert.match(missing.diagnostics.join('\n'), /missing|reference mismatch/i);
    assert.equal(hashMismatch.status, 'BLOCKED');
    assert.match(hashMismatch.diagnostics.join('\n'), /hash mismatch/i);
    assert.equal(byteMismatch.status, 'BLOCKED');
    assert.match(byteMismatch.diagnostics.join('\n'), /byte count mismatch/i);
    assert.equal(referenceMismatch.status, 'BLOCKED');
    assert.match(referenceMismatch.diagnostics.join('\n'), /manifest checkpoint hash mismatch|artifact references/i);
    assert.match(markdown, /Run-state\s+authority\s+subdomain[\s\S]{0,220}not\s+a\s+fifth\s+authority[\s\S]{0,120}status/i);
    assert.match(markdown, /checkpoint[\s\S]{0,260}schema\s+version[\s\S]{0,160}checkpoint\s+ID[\s\S]{0,160}originating\s+session[\s\S]{0,120}run/i);
    assert.match(markdown, /per-module[\s\S]{0,160}dependency-closure\s+fingerprints[\s\S]{0,220}completed\s+task[\s\S]{0,120}result[\s\S]{0,120}evidence\s+refs/i);
    assert.match(markdown, /actual\s+SHA-256[\s\S]{0,120}bytes[\s\S]{0,120}provenance[\s\S]{0,160}manifest[\s\S]{0,120}checkpoint\s+hash/i);
    assert.match(markdown, /same-directory\s+temporary\s+file[\s\S]{0,180}verify\s+hash[\s\S]{0,80}bytes[\s\S]{0,180}atomic\s+rename/i);
    assert.match(markdown, /repair\s+round\s+budget[\s\S]{0,120}max(?:imum)?\s*=\s*3[\s\S]{0,160}used[\s\S]{0,120}0\s+to\s+3/i);
    assert.match(markdown, /corrupt[\s\S]{0,80}truncated[\s\S]{0,80}missing[\s\S]{0,80}unsupported[\s\S]{0,80}hash[\s\S]{0,80}byte[\s\S]{0,80}reference\s+mismatch[\s\S]{0,180}`?BLOCKED`?/i);
    assert.match(markdown, /context[\s\S]{0,80}report[\s\S]{0,80}agent\s+summary[\s\S]{0,180}cannot\s+reconstruct\s+authority/i);
    assertNoFixtureLeakage(markdown);
  } finally {
    removeRecoveryWorkspace(workspace);
  }
});

test('P2-M5-CONFLICT-005 conflict detection stops before sync and preserves original target bytes', () => {
  const workspace = createRecoveryWorkspace('qa-skill-m5-conflict-');
  try {
    writeWorkspaceFile(workspace.originalTarget, 'src/product.mjs', 'export const value = 1;\n');
    writeWorkspaceFile(workspace.originalTarget, 'src/other.mjs', 'export const other = 1;\n');
    const baseline = targetBaseline(workspace.originalTarget);
    const beforeFingerprint = fingerprintTree(workspace.originalTarget);
    writeWorkspaceFile(workspace.originalTarget, 'src/product.mjs', 'export const value = 2;\n');
    writeWorkspaceFile(workspace.originalTarget, 'src/other.mjs', 'export const other = 2;\n');
    writeWorkspaceFile(workspace.originalTarget, 'src/added.mjs', 'export const added = true;\n');
    const userBytes = readFileSync(path.join(workspace.originalTarget, 'src/product.mjs'), 'utf8');
    const conflict = detectConflictStop({ originalTargetRoot: workspace.originalTarget, repairStartBaseline: baseline });
    const deletedBaselineWorkspace = createRecoveryWorkspace('qa-skill-m5-conflict-delete-');
    try {
      writeWorkspaceFile(deletedBaselineWorkspace.originalTarget, 'a.txt', 'a\n');
      writeWorkspaceFile(deletedBaselineWorkspace.originalTarget, 'b.txt', 'b\n');
      const deleteBaseline = targetBaseline(deletedBaselineWorkspace.originalTarget);
      rmSync(path.join(deletedBaselineWorkspace.originalTarget, 'b.txt'));
      const deletedConflict = detectConflictStop({ originalTargetRoot: deletedBaselineWorkspace.originalTarget, repairStartBaseline: deleteBaseline });
      assert.equal(deletedConflict.status, 'BLOCKED');
      assert.deepEqual(deletedConflict.conflictingPaths.map((entry) => entry.path), ['b.txt']);
    } finally {
      removeRecoveryWorkspace(deletedBaselineWorkspace);
    }
    const afterBytes = readFileSync(path.join(workspace.originalTarget, 'src/product.mjs'), 'utf8');
    const afterFingerprint = fingerprintTree(workspace.originalTarget);
    const markdown = productM5Markdown();

    assert.notEqual(afterFingerprint, beforeFingerprint);
    assert.equal(conflict.status, 'BLOCKED');
    assert.deepEqual(conflict.conflictingPaths.map((entry) => entry.path).sort(), ['src/added.mjs', 'src/other.mjs', 'src/product.mjs']);
    assert.ok(conflict.conflictingPaths.find((entry) => entry.path === 'src/product.mjs').expected.sha256);
    assert.ok(conflict.conflictingPaths.find((entry) => entry.path === 'src/product.mjs').current.sha256);
    assert.deepEqual(conflict.actions, []);
    assert.equal(afterBytes, userBytes);
    assert.match(markdown, /conflict\s+detection[\s\S]{0,120}stop\s+only[\s\S]{0,180}not\s+successful\s+sync/i);
    assert.match(markdown, /repair-start[\s\S]{0,120}original-target[\s\S]{0,160}per-path\s+bytes[\s\S]{0,80}hash\s+baseline[\s\S]{0,200}current\s+original\s+target/i);
    assert.match(markdown, /complete\s+original-target\s+regular-file\s+manifest[\s\S]{0,180}tree\s+fingerprint[\s\S]{0,180}added[\s\S]{0,80}deleted[\s\S]{0,80}changed/i);
    assert.match(markdown, /before\s+any\s+sync-like\s+action[\s\S]{0,220}conflicting\s+paths[\s\S]{0,120}expected[\s\S]{0,120}current\s+fingerprints/i);
    assert.match(markdown, /emit\s+no\s+copy[\s\S]{0,80}merge[\s\S]{0,80}sync[\s\S]{0,80}back-propagation\s+action[\s\S]{0,160}preserve\s+user\s+bytes/i);
    assertNoFixtureLeakage(markdown);
  } finally {
    removeRecoveryWorkspace(workspace);
  }
});

test('P2-M5-HISTORY-006 compatible prior history classifies only with affirmative current evidence', () => {
  const previous = [
    Object.freeze({ category: 'product', kind: 'missing-validation', scope: 'module-auth', verification_id: 'verify-auth', acceptance_id: 'accept-auth', risk_id: 'risk-auth', rule_id: 'must-verify' }),
    Object.freeze({ category: 'product', kind: 'missing-validation', scope: 'module-billing', verification_id: 'verify-billing', acceptance_id: 'accept-billing', risk_id: 'risk-billing', rule_id: 'must-verify' }),
    Object.freeze({ category: 'product', kind: 'missing-validation', scope: 'module-legacy', verification_id: 'verify-legacy', acceptance_id: 'accept-legacy', risk_id: 'risk-legacy', rule_id: 'must-verify' }),
  ];
  const persistentCurrent = { ...previous[0], observed: 'different prose', run_id: 'm5-run-002', path: 'tmp/path' };
  const newCurrent = Object.freeze({ category: 'product', kind: 'regression', scope: 'module-new', verification_id: 'verify-new', acceptance_id: 'accept-new', risk_id: 'risk-new', rule_id: 'must-verify', summary: 'new' });
  const resolvedIdentity = stableFindingIdentity(previous[1]);
  const nlaIdentity = stableFindingIdentity(previous[2]);
  const persistentIdentity = stableFindingIdentity(previous[0]);
  const newIdentity = stableFindingIdentity(newCurrent);
  const priorRun = { run_id: 'm5-history-run-compatible', stable_project_identity: 'project-a', target_scope_identity: 'scope-a', contract_schema: 'm5' };
  const completedPriorRun = { ...priorRun, completed: true };
  const currentRun = { run_id: 'm5-run-002', stable_project_identity: 'project-a', target_scope_identity: 'scope-a', contract_schema: 'm5', compatible_prior_history_run_id: 'm5-history-run-compatible', parent_run_id: 'm5-run-001', history_comparison_ready: true };
  const classified = classifyHistory({ previousFindings: previous, currentFindings: [persistentCurrent, newCurrent], currentEvidence: [{ finding_identity: persistentIdentity, status: 'FAIL', objective: true, applicable: true }, { finding_identity: newIdentity, status: 'FAIL', objective: true, applicable: true }, { finding_identity: resolvedIdentity, status: 'PASS', applicable: true }], currentInventory: [{ finding_identity: nlaIdentity, applicable: false, affirmative: true }], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const absenceOnly = classifyHistory({ previousFindings: [previous[1]], currentFindings: [], currentEvidence: [], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const unrelatedEvidence = classifyHistory({ previousFindings: [previous[0]], currentFindings: [persistentCurrent], currentEvidence: [{ finding_identity: resolvedIdentity, status: 'PASS', applicable: true }], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const missingCompatibility = classifyHistory({ previousFindings: [previous[0]], currentFindings: [persistentCurrent], currentEvidence: [{ finding_identity: persistentIdentity, status: 'FAIL', objective: true }], currentInventory: [] });
  const incompatibleWithCurrentFinding = classifyHistory({ previousFindings: [previous[0]], currentFindings: [persistentCurrent], currentEvidence: [{ finding_identity: persistentIdentity, status: 'FAIL', objective: true, applicable: true }], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: { ...completedPriorRun, completed: false }, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const duplicateFindings = classifyHistory({ previousFindings: [previous[0], previous[0]], currentFindings: [], currentEvidence: [], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const duplicateEvidence = classifyHistory({ previousFindings: [previous[0]], currentFindings: [persistentCurrent], currentEvidence: [{ finding_identity: persistentIdentity, status: 'FAIL', objective: true, applicable: true }, { finding_identity: persistentIdentity, status: 'PASS', applicable: true }], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const malformedFinding = classifyHistory({ previousFindings: [{ ...previous[0], rule_id: '' }], currentFindings: [], currentEvidence: [], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const malformedEmbeddedHistory = classifyHistory({ previousFindings: [previous[0]], currentFindings: [], currentEvidence: [], currentInventory: [], compatiblePriorHistoryRunId: 'm5-history-run-compatible', priorRun: completedPriorRun, currentRun: { ...currentRun, compatible_prior_history_run_id: 42 }, resumeLineageRunIds: ['m5-run-001', 'm5-run-002'] });
  const stableWithProseChanged = stableFindingIdentity(previous[0]);
  const stableWithoutRuntimeFields = stableFindingIdentity(persistentCurrent);
  const markdown = productM5Markdown();

  assert.equal(stableWithProseChanged, stableWithoutRuntimeFields);
  assert.equal(classified.ok, true);
  assert.deepEqual(classified.classifications.map((entry) => entry.class).sort(), ['NEW', 'NO_LONGER_APPLICABLE', 'PERSISTENT', 'RESOLVED']);
  assert.equal(absenceOnly.ok, false);
  assert.match(absenceOnly.diagnostics.join('\n'), /missing compatible current evidence/i);
  assert.equal(unrelatedEvidence.ok, false);
  assert.match(unrelatedEvidence.diagnostics.join('\n'), /affirmative current objective finding evidence|missing compatible current evidence/i);
  assert.equal(missingCompatibility.ok, false);
  assert.match(missingCompatibility.diagnostics.join('\n'), /compatible prior-history run/i);
  assert.equal(incompatibleWithCurrentFinding.ok, false);
  assert.deepEqual(incompatibleWithCurrentFinding.classifications, []);
  assert.match(incompatibleWithCurrentFinding.diagnostics.join('\n'), /completed prior-history run/i);
  assert.equal(duplicateFindings.ok, false);
  assert.match(duplicateFindings.diagnostics.join('\n'), /duplicate stable finding identity/i);
  assert.equal(duplicateEvidence.ok, false);
  assert.match(duplicateEvidence.diagnostics.join('\n'), /duplicate|conflicting evidence/i);
  assert.equal(malformedFinding.ok, false);
  assert.match(malformedFinding.diagnostics.join('\n'), /stable finding identity field rule_id is required/i);
  assert.equal(malformedEmbeddedHistory.ok, false);
  assert.match(malformedEmbeddedHistory.diagnostics.join('\n'), /compatible prior-history run reference must be a non-empty string/i);
  assert.throws(() => stableFindingIdentity({ ...previous[0], rule_id: '' }), /stable finding identity field rule_id is required/i);
  assert.match(markdown, /explicit\s+compatible\s+previous-run\s+reference[\s\S]{0,180}separate\s+from\s+resume\s+lineage/i);
  assert.match(markdown, /completed\s+compatible\s+prior\s+run\s+plus\s+current\s+run\s+marked\s+`?history_comparison_ready`?[\s\S]{0,180}same\s+stable\s+project\s+identity[\s\S]{0,120}target\s+scope[\s\S]{0,120}schema/i);
  assert.match(markdown, /history_comparison_ready[\s\S]{0,180}invalid\s+compatibility[\s\S]{0,120}no\s+classifications/i);
  assert.match(markdown, /stable\s+finding\s+identity[\s\S]{0,180}canonical\s+SHA-256[\s\S]{0,220}category[\s\S]{0,80}kind[\s\S]{0,120}module\/flow\s+scope[\s\S]{0,120}verification/i);
  assert.match(markdown, /excluding[\s\S]{0,160}observed\s+prose[\s\S]{0,120}timestamps[\s\S]{0,120}run\s+IDs[\s\S]{0,120}paths[\s\S]{0,120}summaries/i);
  assert.match(markdown, /`?NEW`?[\s\S]{0,80}`?PERSISTENT`?[\s\S]{0,80}`?RESOLVED`?[\s\S]{0,80}`?NO_LONGER_APPLICABLE`?/i);
  assert.match(markdown, /RESOLVED[\s\S]{0,180}affirmative\s+current\s+`?PASS`?\s+evidence[\s\S]{0,180}absence\s+alone\s+never\s+resolves/i);
  assert.match(markdown, /NO_LONGER_APPLICABLE[\s\S]{0,180}affirmative\s+current\s+inventory[\s\S]{0,120}plan[\s\S]{0,120}evidence[\s\S]{0,120}scope\s+no\s+longer\s+applies/i);
  assert.match(markdown, /incompatible[\s\S]{0,80}missing\s+current\s+evidence[\s\S]{0,160}refuses\s+classification/i);
  assert.match(markdown, /NEW[\s\S]{0,120}PERSISTENT[\s\S]{0,220}affirmative\s+current\s+objective\s+finding\s+evidence/i);
  assertNoFixtureLeakage(markdown);
});

test('P2-M5-CURRENT-007 current objective failure takes precedence over prior PASS/history', () => {
  const current = reconcileCurrentStatus({ currentEvidence: [{ evidence_id: 'm5-current-fail-evidence', status: 'FAIL', objective: true }], priorHistory: [{ status: 'PASS', run_id: 'm5-history-run-compatible' }] });
  const blocked = reconcileCurrentStatus({ currentEvidence: [{ status: 'BLOCKED', objective: true }], priorHistory: [{ status: 'PASS' }] });
  const markdown = productM5Markdown();

  assert.equal(current.overallStatus, 'FAIL');
  assert.equal(current.priorHistoryUsedAsComparisonOnly, true);
  assert.equal(current.evidenceAuthorityContainsHistory, false);
  assert.equal(blocked.overallStatus, 'BLOCKED');
  assert.match(markdown, /prior\s+`?PASS`?[\s\S]{0,120}history[\s\S]{0,180}comparison\s+context\s+only/i);
  assert.match(markdown, /current\s+objective\s+`?FAIL`?[\s\S]{0,160}project\s+`?FAIL`?/i);
  assert.match(markdown, /history\s+never\s+enters\s+Evidence\s+authority[\s\S]{0,180}overrides\s+four-status\s+reconciliation/i);
  assert.match(markdown, /exact\s+delivery[\s\S]{0,160}current\s+evidence/i);
  assertNoFixtureLeakage(markdown);
});
