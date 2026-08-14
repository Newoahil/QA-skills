import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const fixtureOnlyRecoveryTerms = Object.freeze([
  'm5-session-alpha',
  'm5-run-001',
  'm5-run-002',
  'm5-run-003',
  'm5-history-run-compatible',
  'm5-history-run-incompatible',
  'M5-AUTH-MODULE',
  'M5-BILLING-MODULE',
  'M5-DEPENDENT-FLOW',
  'm5-evidence-original.json',
  'm5-checkpoint-001',
  'm5-manifest-001',
  'm5-current-fail-evidence',
]);

const canonicalStatuses = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const historyClasses = Object.freeze(['NEW', 'PERSISTENT', 'RESOLVED', 'NO_LONGER_APPLICABLE']);

export function createRecoveryWorkspace(prefix = 'qa-skill-m5-recovery-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const isolatedWorkspace = path.join(root, 'isolated-workspace');
  const originalTarget = path.join(root, 'original-target');
  const hostStorage = path.join(root, 'host-storage');
  mkdirSync(isolatedWorkspace, { recursive: true });
  mkdirSync(originalTarget, { recursive: true });
  mkdirSync(hostStorage, { recursive: true });
  return deepFreeze({ root, isolatedWorkspace, originalTarget, hostStorage });
}

export function removeRecoveryWorkspace(workspace) {
  if (workspace?.root) rmSync(workspace.root, { recursive: true, force: true });
}

export function writeWorkspaceFile(workspaceRoot, relativePath, content) {
  const safePath = resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf: true });
  if (!safePath.ok) throw new Error(`unsafe workspace write rejected: ${safePath.reason}`);
  mkdirSync(path.dirname(safePath.absolutePath), { recursive: true });
  writeFileSync(safePath.absolutePath, String(content));
  return safePath.absolutePath;
}

function writeAtomicWorkspaceFile(workspaceRoot, relativePath, content) {
  const safePath = resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf: true });
  if (!safePath.ok) throw new Error(`unsafe atomic workspace write rejected: ${safePath.reason}`);
  mkdirSync(path.dirname(safePath.absolutePath), { recursive: true });
  const temporarySuffix = `${process.pid}.${randomUUID()}.tmp`;
  const temporaryPath = `${safePath.absolutePath}.${temporarySuffix}`;
  const temporaryRelativePath = `${safePath.relativePath}.${temporarySuffix}`;
  const payload = String(content);
  try {
    writeWorkspaceFile(workspaceRoot, temporaryRelativePath, payload);
    const temporary = fileRecord(workspaceRoot, temporaryRelativePath);
    if (!temporary.ok || temporary.sha256 !== hashText(payload) || temporary.bytes !== Buffer.byteLength(payload, 'utf8')) {
      throw new Error('atomic write verification failed');
    }
    renameSync(temporaryPath, safePath.absolutePath);
    const final = fileRecord(workspaceRoot, safePath.relativePath);
    if (!final.ok || final.sha256 !== temporary.sha256 || final.bytes !== temporary.bytes) {
      throw new Error('atomic rename verification failed');
    }
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  return safePath.absolutePath;
}

export function hashText(content) {
  return createHash('sha256').update(String(content), 'utf8').digest('hex');
}

export function fileRecord(workspaceRoot, relativePath, provenance = {}) {
  const safePath = resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf: false });
  if (!safePath.ok) return deepFreeze({ ok: false, diagnostics: [safePath.reason] });
  if (safePath.kind !== 'file') return deepFreeze({ ok: false, diagnostics: [`${safePath.relativePath} must be a regular file`] });
  let content;
  try {
    content = readFileSync(safePath.absolutePath);
  } catch (error) {
    return deepFreeze({ ok: false, diagnostics: [`${safePath.relativePath} read failed: ${error.message}`] });
  }
  return deepFreeze({
    ok: true,
    path: safePath.relativePath,
    sha256: hashBuffer(content),
    bytes: content.byteLength,
    provenance: { ...provenance },
  });
}

export function createInitialRun({ qaSessionId = 'm5-session-alpha', runId = 'm5-run-001' } = {}) {
  return deepFreeze({ qa_session_id: qaSessionId, run_id: runId, parent_run_id: null, compatible_prior_history_run_id: null });
}

export function createResumeRun(previousRun, { runId, compatiblePriorHistoryRunId = null } = {}) {
  if (!validRun(previousRun)) throw new Error('previous run identity is malformed');
  return deepFreeze({
    qa_session_id: previousRun.qa_session_id,
    run_id: runId,
    parent_run_id: previousRun.run_id,
    compatible_prior_history_run_id: compatiblePriorHistoryRunId,
  });
}

export function validateRunLineage(runs, { compatiblePriorHistoryRunId = null } = {}) {
  const diagnostics = [];
  if (!Array.isArray(runs) || runs.length === 0) diagnostics.push('run lineage must be a non-empty array');
  const records = Array.isArray(runs) ? runs : [];
  const runIds = new Set();
  const sessionId = records[0]?.qa_session_id;
  records.forEach((run, index) => {
    if (!validRun(run)) diagnostics.push(`run ${index + 1} has malformed identity`);
    if (run?.qa_session_id !== sessionId) diagnostics.push(`run ${index + 1} crosses qa_session_id`);
    if (run?.run_id === run?.parent_run_id) diagnostics.push(`run ${index + 1} uses self parent_run_id`);
    if (runIds.has(run?.run_id)) diagnostics.push(`run ${index + 1} repeats run_id`);
    if (index === 0 && run?.parent_run_id) diagnostics.push('first run must not have parent_run_id');
    if (index > 0 && run?.parent_run_id !== records[index - 1]?.run_id) diagnostics.push(`run ${index + 1} parent_run_id must be the immediate prior same-session run`);
    if (run?.compatible_prior_history_run_id !== null && run?.compatible_prior_history_run_id !== undefined && !nonEmptyString(run.compatible_prior_history_run_id)) diagnostics.push('compatible prior-history reference must be a non-empty string');
    runIds.add(run?.run_id);
  });
  if (compatiblePriorHistoryRunId !== null && compatiblePriorHistoryRunId !== undefined && !nonEmptyString(compatiblePriorHistoryRunId)) diagnostics.push('compatible prior-history reference must be a non-empty string');
  const embeddedHistoryIds = records.map((run) => run?.compatible_prior_history_run_id).filter(nonEmptyString);
  const historyIds = [...new Set([compatiblePriorHistoryRunId, ...embeddedHistoryIds].filter(nonEmptyString))];
  for (const historyId of historyIds) {
    if (records.some((run) => run?.parent_run_id === historyId)) diagnostics.push('parent_run_id must not be reused as compatible prior-history reference');
    if (records.some((run) => run?.run_id === historyId)) diagnostics.push('compatible prior-history reference must be separate from resume lineage');
  }
  if (historyIds.length > 1) diagnostics.push('compatible prior-history reference must be consistent across run lineage');
  return deepFreeze({ ok: diagnostics.length === 0, diagnostics, lineage: records.map((run) => run?.run_id).filter(Boolean), compatible_prior_history_run_id: historyIds[0] ?? null });
}

export function decideRecoveryStorage({ runId, projectLocalIgnoredOrExcluded, repositoryRoot } = {}) {
  if (!nonEmptyString(runId)) return deepFreeze({ ok: false, status: 'BLOCKED', diagnostics: ['run_id is required'] });
  if (projectLocalIgnoredOrExcluded === true) {
    return deepFreeze({ ok: true, kind: 'project-local', reference: `.qa/runs/${runId}/`, writesRepositoryQa: false });
  }
  return deepFreeze({ ok: true, kind: 'host-owned-external', reference: `host-owned-external://qa-runs/${runId}/`, writesRepositoryQa: false, repositoryQaExists: repositoryRoot ? existsSync(path.join(repositoryRoot, '.qa')) : false });
}

export function createCheckpointRecord(input = {}) {
  const {
    storageRoot,
    schemaVersion = 1,
    checkpointId = 'm5-checkpoint-001',
    qaSessionId = 'm5-session-alpha',
    runId = 'm5-run-002',
    parentRunId = 'm5-run-001',
    phase = 'execute',
    pendingWork = ['rerun affected modules'],
    targetFingerprint,
    scopeFingerprint,
    moduleFingerprints,
    dependencyClosureFingerprints,
    completedResults,
    repairRoundBudget = { maxRounds: 3, usedRounds: 1 },
    noProgressFingerprints = { normalizedDiff: 'diff-a', evidence: 'ev-a', failure: 'fail-a' },
  } = input;
  if (!nonEmptyString(storageRoot)) throw new Error('storageRoot is required');
  mkdirSync(storageRoot, { recursive: true });
  const evidencePath = 'evidence/m5-evidence-original.json';
  const evidenceContent = JSON.stringify({ status: 'FAIL', observed: 'original failure' }, null, 2);
  writeWorkspaceFile(storageRoot, evidencePath, `${evidenceContent}\n`);
  const evidence = fileRecord(storageRoot, evidencePath, { source_run_id: runId, result_id: 'result-auth', evidence_id: 'm5-current-fail-evidence' });
  const resultRecords = completedResults ?? [deepFreeze({
    module_id: 'M5-AUTH-MODULE',
    result_id: 'result-auth',
    task_id: 'task-auth',
    verification_ids: ['verify-auth'],
    snapshot_fingerprint: hashText('auth-module-snapshot'),
    workspace_reference: `host-owned-external://${runId}/workspace`,
    status: 'FAIL',
    evidence: [evidence],
  })];
  const checkpointPayload = {
    schema_version: schemaVersion,
    checkpoint_id: checkpointId,
    originating: { qa_session_id: qaSessionId, run_id: runId, parent_run_id: parentRunId },
    phase,
    pending_work: pendingWork,
    target_fingerprint: targetFingerprint ?? hashText('target-snapshot'),
    scope_fingerprint: scopeFingerprint ?? hashText('scope-snapshot'),
    module_fingerprints: moduleFingerprints ?? { 'M5-AUTH-MODULE': hashText('auth-module') },
    dependency_closure_fingerprints: dependencyClosureFingerprints ?? { 'M5-AUTH-MODULE': hashText('auth-module|shared-session') },
    completed_results: resultRecords,
    storage_reference: `host-owned-external://${runId}/`,
    repair_round_budget: repairRoundBudget,
    no_progress_fingerprints: noProgressFingerprints,
  };
  const checkpointRelativePath = 'run-state/checkpoint.json';
  writeAtomicWorkspaceFile(storageRoot, checkpointRelativePath, `${JSON.stringify(checkpointPayload, null, 2)}\n`);
  const checkpointFile = fileRecord(storageRoot, checkpointRelativePath, { source_run_id: runId, checkpoint_id: checkpointId });
  const manifestPayload = {
    manifest_id: 'm5-manifest-001',
    schema_version: 1,
    checkpoint: checkpointFile,
    artifacts: [evidence],
  };
  const manifestRelativePath = 'run-state/manifest.json';
  writeAtomicWorkspaceFile(storageRoot, manifestRelativePath, `${JSON.stringify(manifestPayload, null, 2)}\n`);
  const manifestFile = fileRecord(storageRoot, manifestRelativePath, { source_run_id: runId, manifest_id: manifestPayload.manifest_id });
  return deepFreeze({ storageRoot, checkpoint: checkpointFile, manifest: manifestFile, evidence, checkpointPayload, manifestPayload });
}

export function validateCheckpointRecord(reference = {}) {
  const diagnostics = [];
  const checkpointValidation = validateJsonArtifact(reference.storageRoot, reference.checkpoint, 'checkpoint');
  const manifestValidation = validateJsonArtifact(reference.storageRoot, reference.manifest, 'manifest');
  diagnostics.push(...checkpointValidation.diagnostics, ...manifestValidation.diagnostics);
  const checkpoint = checkpointValidation.json;
  const manifest = manifestValidation.json;
  if (checkpoint && checkpoint.schema_version !== 1) diagnostics.push('unsupported checkpoint schema version');
  if (checkpoint && !nonEmptyString(checkpoint.checkpoint_id)) diagnostics.push('checkpoint ID is required');
  if (checkpoint && (!checkpoint.originating || !nonEmptyString(checkpoint.originating.qa_session_id) || !nonEmptyString(checkpoint.originating.run_id))) diagnostics.push('originating session/run is required');
  if (checkpoint && !nonEmptyString(checkpoint.phase)) diagnostics.push('phase is required');
  if (checkpoint && !Array.isArray(checkpoint.pending_work)) diagnostics.push('pending work is required');
  for (const field of ['target_fingerprint', 'scope_fingerprint', 'storage_reference']) {
    if (checkpoint && !nonEmptyString(checkpoint[field])) diagnostics.push(`${field} is required`);
  }
  if (checkpoint && (!checkpoint.module_fingerprints || Object.keys(checkpoint.module_fingerprints).length === 0)) diagnostics.push('per-module fingerprints are required');
  if (checkpoint && (!checkpoint.dependency_closure_fingerprints || Object.keys(checkpoint.dependency_closure_fingerprints).length === 0)) diagnostics.push('dependency-closure fingerprints are required');
  if (checkpoint && (!checkpoint.repair_round_budget || !Number.isInteger(checkpoint.repair_round_budget.maxRounds))) diagnostics.push('repair round budget is required');
  if (checkpoint && !checkpoint.no_progress_fingerprints) diagnostics.push('no-progress fingerprints are required');
  if (checkpoint) validateCompletedResults(reference.storageRoot, checkpoint.completed_results, diagnostics);
  validateManifestCheckpoint(reference.storageRoot, manifest, reference.checkpoint, diagnostics);
  if (manifest && manifest.schema_version !== 1) diagnostics.push('manifest schema version is unsupported');
  if (manifest && !nonEmptyString(manifest.manifest_id)) diagnostics.push('manifest ID is required');
  if (manifest && (!manifest.checkpoint || typeof manifest.checkpoint !== 'object')) diagnostics.push('manifest checkpoint record is required');
  if (manifest && !Array.isArray(manifest.artifacts)) {
    diagnostics.push('manifest artifact references are required');
  } else if (manifest) {
    validateManifestArtifacts(reference.storageRoot, manifest.artifacts, checkpoint?.completed_results, diagnostics);
  }
  validateRepairBudget(checkpoint?.repair_round_budget, diagnostics);
  validateNoProgressFingerprints(checkpoint?.no_progress_fingerprints, diagnostics);
  return deepFreeze({ ok: diagnostics.length === 0, status: diagnostics.length === 0 ? 'PASS' : 'BLOCKED', diagnostics });
}

export function evaluateEvidenceReuse({ current, prior, storageRoot } = {}) {
  const diagnostics = [];
  if (!nonEmptyString(storageRoot)) diagnostics.push('storage/artifact root is required for unchanged evidence reuse');
  const requiredPairs = [
    ['target_scope_identity', 'target scope identity'],
    ['module_fingerprint', 'module fingerprint'],
    ['dependency_closure_fingerprint', 'dependency-closure fingerprint'],
    ['module_id', 'module identity'],
    ['task_id', 'task identity'],
    ['verification_id', 'verification identity'],
    ['snapshot_fingerprint', 'snapshot/workspace identity'],
    ['workspace_reference', 'snapshot/workspace identity'],
  ];
  for (const [field, label] of requiredPairs) {
    if (!nonEmptyString(current?.[field]) || current?.[field] !== prior?.[field]) diagnostics.push(`reused evidence requires exact ${label}`);
  }
  for (const field of ['path', 'sha256', 'bytes']) {
    if (prior?.evidence?.[field] !== current?.evidence?.[field]) diagnostics.push(`reused evidence requires original evidence ${field}`);
  }
  for (const field of ['source_run_id', 'result_id', 'evidence_id']) {
    if (!nonEmptyString(prior?.evidence?.provenance?.[field]) || prior?.evidence?.provenance?.[field] !== current?.evidence?.provenance?.[field]) diagnostics.push(`source run/result/evidence provenance ${field} is required and must match exactly`);
  }
  if (nonEmptyString(storageRoot)) {
    const validation = validateArtifactMetadata(storageRoot, prior?.evidence, 'reused original evidence');
    diagnostics.push(...validation.diagnostics);
  }
  return deepFreeze({ reusable: diagnostics.length === 0, supportsCurrentCoverage: diagnostics.length === 0, carriedForwardEvidence: diagnostics.length === 0 ? { ...prior.evidence, carried_forward: true, current_applicability_validated: true, provenance: prior.evidence.provenance } : null, diagnostics });
}

export function computeStaleInvalidation({ modules = {}, dependencyEdges = [], changedModules = [], priorReuseTuples = {}, repairState = {} } = {}) {
  const invalidated = new Set(changedModules);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of dependencyEdges) {
      if (invalidated.has(from) && !invalidated.has(to)) {
        invalidated.add(to);
        changed = true;
      }
    }
  }
  const reusable = Object.keys(modules).filter((moduleId) => !invalidated.has(moduleId) && priorReuseTuples[moduleId]?.exact === true);
  const historicalOnly = Object.keys(modules).filter((moduleId) => invalidated.has(moduleId));
  return deepFreeze({ invalidated: [...invalidated].sort(), reusable: reusable.sort(), historicalOnly: historicalOnly.sort(), repairState: { ...repairState } });
}

export function fingerprintTree(root) {
  const manifest = buildTreeManifest(root);
  if (!manifest.ok) return hashText(`blocked:${manifest.diagnostics.join('|')}`);
  return manifest.rootFingerprint;
}

export function targetBaseline(root) {
  const manifest = buildTreeManifest(root);
  return deepFreeze({ rootFingerprint: manifest.rootFingerprint, files: manifest.files, diagnostics: manifest.diagnostics });
}

export function detectConflictStop({ originalTargetRoot, repairStartBaseline } = {}) {
  const conflictingPaths = [];
  const currentManifest = buildTreeManifest(originalTargetRoot);
  const baselineFiles = repairStartBaseline?.files ?? {};
  const currentFiles = currentManifest.files ?? {};
  const diagnostics = [...(repairStartBaseline?.diagnostics ?? []), ...(currentManifest.diagnostics ?? [])];
  for (const relativePath of [...new Set([...Object.keys(baselineFiles), ...Object.keys(currentFiles)])].sort()) {
    const expected = baselineFiles[relativePath];
    const current = currentFiles[relativePath];
    if (!expected || !current || current.sha256 !== expected.sha256 || current.bytes !== expected.bytes) {
      conflictingPaths.push(deepFreeze({ path: relativePath, expected: expected ? { sha256: expected.sha256, bytes: expected.bytes } : { missing: true }, current: current ? { sha256: current.sha256, bytes: current.bytes } : { missing: true } }));
    }
  }
  return deepFreeze({ ok: conflictingPaths.length === 0 && diagnostics.length === 0, status: conflictingPaths.length === 0 && diagnostics.length === 0 ? 'OPEN' : 'BLOCKED', conflictingPaths, diagnostics, actions: [] });
}

export function stableFindingIdentity(finding = {}) {
  const fields = ['category', 'kind', 'scope', 'verification_id', 'acceptance_id', 'risk_id', 'rule_id'];
  const sequence = fields.map((field) => {
    if (!nonEmptyString(finding?.[field])) throw new Error(`stable finding identity field ${field} is required`);
    return [field, finding[field]];
  });
  return hashText(JSON.stringify(sequence));
}

export function classifyHistory({ previousFindings = [], currentFindings = [], currentEvidence = [], currentInventory = [], compatiblePriorHistoryRunId, priorRun, currentRun, resumeLineageRunIds = [] } = {}) {
  const diagnostics = [];
  diagnostics.push(...validateHistoryCompatibility({ compatiblePriorHistoryRunId, priorRun, currentRun, resumeLineageRunIds }));
  if (diagnostics.length > 0) return deepFreeze({ ok: false, classifications: [], diagnostics });
  if (!Array.isArray(currentEvidence) || currentEvidence.length === 0) diagnostics.push('current evidence is required for history classification');
  const previousIdentityRows = collectFindingIdentities(previousFindings, 'previous finding', diagnostics);
  const currentIdentityRows = collectFindingIdentities(currentFindings, 'current finding', diagnostics);
  const evidenceByIdentity = collectEvidenceByIdentity(currentEvidence, diagnostics);
  const currentByIdentity = new Map(currentIdentityRows.map((row) => [row.identity, row.finding]));
  const inventoryByIdentity = collectInventoryByIdentity(currentInventory, diagnostics);
  const classifications = [];
  for (const { identity } of previousIdentityRows) {
    if (currentByIdentity.has(identity)) {
      const evidence = evidenceByIdentity.get(identity);
      if (evidence?.status === 'FAIL' && evidence?.objective === true && evidence?.applicable === true) {
        classifications.push({ identity, class: 'PERSISTENT' });
      } else {
        diagnostics.push(`affirmative current objective finding evidence is required for persistent finding ${identity}`);
      }
      continue;
    }
    const evidence = evidenceByIdentity.get(identity);
    const inventory = inventoryByIdentity.get(identity);
    if (evidence?.status === 'PASS' && evidence?.applicable === true) {
      classifications.push({ identity, class: 'RESOLVED' });
    } else if (inventory?.applicable === false && inventory?.affirmative === true) {
      classifications.push({ identity, class: 'NO_LONGER_APPLICABLE' });
    } else {
      diagnostics.push(`missing compatible current evidence for prior finding ${identity}`);
    }
  }
  const previousIdentities = new Set(previousIdentityRows.map((row) => row.identity));
  for (const { identity } of currentIdentityRows) {
    if (!previousIdentities.has(identity)) {
      const evidence = evidenceByIdentity.get(identity);
      if (evidence?.status === 'FAIL' && evidence?.objective === true && evidence?.applicable === true) {
        classifications.push({ identity, class: 'NEW' });
      } else {
        diagnostics.push(`affirmative current objective finding evidence is required for new finding ${identity}`);
      }
    }
  }
  const invalidClass = classifications.find((entry) => !historyClasses.includes(entry.class));
  if (invalidClass) diagnostics.push(`invalid history class ${invalidClass.class}`);
  return deepFreeze({ ok: diagnostics.length === 0, classifications, diagnostics });
}

export function reconcileCurrentStatus({ currentEvidence = [], priorHistory = [] } = {}) {
  const objectiveBlocker = currentEvidence.find((entry) => entry.status === 'BLOCKED');
  const currentFail = currentEvidence.find((entry) => entry.status === 'FAIL' && entry.objective === true);
  const currentHuman = currentEvidence.find((entry) => entry.status === 'NEEDS_HUMAN_REVIEW');
  const allPass = currentEvidence.length > 0 && currentEvidence.every((entry) => entry.status === 'PASS');
  const overallStatus = objectiveBlocker ? 'BLOCKED' : (currentFail ? 'FAIL' : (currentHuman ? 'NEEDS_HUMAN_REVIEW' : (allPass ? 'PASS' : 'BLOCKED')));
  return deepFreeze({ overallStatus, priorHistoryUsedAsComparisonOnly: Array.isArray(priorHistory), evidenceAuthorityContainsHistory: false });
}

function validateCompletedResults(storageRoot, completedResults, diagnostics) {
  if (!Array.isArray(completedResults) || completedResults.length === 0) {
    diagnostics.push('completed task/result/evidence references are required');
    return;
  }
  for (const result of completedResults) {
    if (!nonEmptyString(result?.module_id)) diagnostics.push('completed result module_id is required');
    if (!nonEmptyString(result?.result_id)) diagnostics.push('completed result result_id is required');
    if (!nonEmptyString(result?.task_id)) diagnostics.push('completed result task_id is required');
    if (!Array.isArray(result?.verification_ids) || result.verification_ids.length === 0 || result.verification_ids.some((verificationId) => !nonEmptyString(verificationId))) diagnostics.push('completed result verification_ids are required');
    if (!nonEmptyString(result?.snapshot_fingerprint)) diagnostics.push('completed result snapshot_fingerprint is required');
    if (!nonEmptyString(result?.workspace_reference)) diagnostics.push('completed result workspace_reference is required');
    if (!canonicalStatuses.includes(result?.status)) diagnostics.push('completed result status is not canonical');
    if (!Array.isArray(result?.evidence) || result.evidence.length === 0) diagnostics.push('completed result evidence refs are required');
    for (const evidence of result?.evidence || []) {
      const validation = validateArtifactMetadata(storageRoot, evidence, 'completed evidence');
      diagnostics.push(...validation.diagnostics);
      for (const field of ['source_run_id', 'result_id', 'evidence_id']) {
        if (!nonEmptyString(evidence?.provenance?.[field])) diagnostics.push(`completed evidence provenance ${field} is required`);
      }
      if (nonEmptyString(evidence?.provenance?.result_id) && evidence.provenance.result_id !== result?.result_id) diagnostics.push('completed evidence provenance result_id must match owning completed result');
    }
  }
}

function validateManifestCheckpoint(storageRoot, manifest, checkpointReference, diagnostics) {
  if (!manifest || !checkpointReference) return;
  for (const field of ['path', 'sha256', 'bytes']) {
    if (manifest.checkpoint?.[field] !== checkpointReference[field]) diagnostics.push(`manifest checkpoint ${field} mismatch`);
  }
  for (const field of ['source_run_id', 'checkpoint_id']) {
    if (!nonEmptyString(manifest.checkpoint?.provenance?.[field]) || manifest.checkpoint?.provenance?.[field] !== checkpointReference.provenance?.[field]) diagnostics.push(`manifest checkpoint provenance ${field} mismatch`);
  }
  diagnostics.push(...validateArtifactMetadata(storageRoot, manifest.checkpoint, 'manifest checkpoint').diagnostics);
}

function validateManifestArtifacts(storageRoot, artifacts, completedResults, diagnostics) {
  const artifactKeys = new Map();
  for (const artifact of artifacts) {
    diagnostics.push(...validateArtifactMetadata(storageRoot, artifact, 'manifest artifact').diagnostics);
    const key = evidenceIdentityKey(artifact);
    if (!key) {
      diagnostics.push('manifest artifact identity is required');
      continue;
    }
    if (artifactKeys.has(key)) diagnostics.push(`duplicate manifest artifact identity ${key}`);
    artifactKeys.set(key, artifact);
  }
  const requiredKeys = new Map();
  for (const result of completedResults || []) {
    for (const evidence of result?.evidence || []) {
      const key = evidenceIdentityKey(evidence);
      if (!key) {
        diagnostics.push('completed evidence identity is required for manifest coverage');
        continue;
      }
      requiredKeys.set(key, evidence);
    }
  }
  for (const [key, evidence] of requiredKeys) {
    const artifact = artifactKeys.get(key);
    if (!artifact) {
      diagnostics.push(`manifest artifacts must cover completed evidence ${key}`);
    } else if (artifact.path !== evidence.path || artifact.sha256 !== evidence.sha256 || artifact.bytes !== evidence.bytes) {
      diagnostics.push(`manifest artifact diverges from completed evidence ${key}`);
    }
  }
}

function evidenceIdentityKey(evidence) {
  const sourceRunId = evidence?.provenance?.source_run_id;
  const resultId = evidence?.provenance?.result_id;
  const evidenceId = evidence?.provenance?.evidence_id;
  if (!nonEmptyString(sourceRunId) || !nonEmptyString(resultId) || !nonEmptyString(evidenceId)) return '';
  return `${sourceRunId}\0${resultId}\0${evidenceId}`;
}

function validateRepairBudget(repairRoundBudget, diagnostics) {
  if (!repairRoundBudget || typeof repairRoundBudget !== 'object') {
    diagnostics.push('repair round budget is required');
    return;
  }
  if (repairRoundBudget.maxRounds !== 3) diagnostics.push('repair round budget maxRounds must equal 3');
  if (!Number.isInteger(repairRoundBudget.usedRounds) || repairRoundBudget.usedRounds < 0 || repairRoundBudget.usedRounds > 3) diagnostics.push('repair round budget usedRounds must be an integer from 0 to 3');
}

function validateNoProgressFingerprints(noProgressFingerprints, diagnostics) {
  if (!noProgressFingerprints || typeof noProgressFingerprints !== 'object') {
    diagnostics.push('no-progress fingerprints are required');
    return;
  }
  for (const field of ['normalizedDiff', 'evidence', 'failure']) {
    if (!nonEmptyString(noProgressFingerprints[field])) diagnostics.push(`no-progress fingerprint ${field} is required`);
  }
}

function validateJsonArtifact(storageRoot, artifact, label) {
  const validation = validateArtifactMetadata(storageRoot, artifact, label);
  const safePath = artifact?.path && resolveWorkspacePath({ workspaceRoot: storageRoot, relativePath: artifact.path, allowMissingLeaf: false });
  if (!safePath?.ok) return deepFreeze({ json: null, diagnostics: validation.diagnostics });
  if (safePath.kind !== 'file') return deepFreeze({ json: null, diagnostics: validation.diagnostics });
  try {
    return deepFreeze({ json: JSON.parse(readFileSync(path.join(storageRoot, artifact.path), 'utf8')), diagnostics: validation.diagnostics });
  } catch (error) {
    return deepFreeze({ json: null, diagnostics: [...validation.diagnostics, `${label} JSON corrupt or truncated: ${error.message}`] });
  }
}

function validateArtifactMetadata(storageRoot, artifact, label) {
  const diagnostics = [];
  if (!artifact || typeof artifact !== 'object') return deepFreeze({ diagnostics: [`${label} reference is required`] });
  if (!nonEmptyString(artifact.path)) diagnostics.push(`${label} path is required`);
  if (!nonEmptyString(artifact.sha256)) diagnostics.push(`${label} SHA-256 is required`);
  if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) diagnostics.push(`${label} byte count is required`);
  const safePath = resolveWorkspacePath({ workspaceRoot: storageRoot, relativePath: artifact.path, allowMissingLeaf: false });
  if (!safePath.ok) {
    diagnostics.push(`${label} reference mismatch or missing: ${safePath.reason}`);
    return deepFreeze({ diagnostics });
  }
  if (safePath.kind !== 'file') {
    diagnostics.push(`${label} must be a regular file, not ${safePath.kind}`);
    return deepFreeze({ diagnostics });
  }
  let content;
  try {
    content = readFileSync(safePath.absolutePath);
  } catch (error) {
    diagnostics.push(`${label} read failed: ${error.message}`);
    return deepFreeze({ diagnostics });
  }
  if (hashBuffer(content) !== artifact.sha256) diagnostics.push(`${label} hash mismatch`);
  if (content.byteLength !== artifact.bytes) diagnostics.push(`${label} byte count mismatch`);
  return deepFreeze({ diagnostics });
}

function listFiles(root) {
  return buildTreeManifest(root).entries;
}

function buildTreeManifest(root) {
  const diagnostics = [];
  const files = {};
  const entries = [];
  const rootCheck = resolveWorkspaceRoot(root);
  if (!rootCheck.ok) return deepFreeze({ ok: false, rootFingerprint: hashText('missing'), files, entries, diagnostics: [rootCheck.reason] });
  const pending = [''];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    let directoryEntries;
    try {
      directoryEntries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(`${relativeDirectory || '.'}: directory read failed: ${error.message}`);
      continue;
    }
    for (const entry of directoryEntries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const slashRelativePath = relativePath.split(path.sep).join('/');
      const absolutePath = path.join(root, relativePath);
      const safePath = resolveWorkspacePath({ workspaceRoot: root, relativePath: slashRelativePath, allowMissingLeaf: false });
      if (!safePath.ok) {
        diagnostics.push(`${slashRelativePath}: ${safePath.reason}`);
        continue;
      }
      let stats;
      try {
        stats = lstatSync(absolutePath);
      } catch (error) {
        diagnostics.push(`${slashRelativePath}: lstat failed: ${error.message}`);
        continue;
      }
      if (stats.isSymbolicLink()) {
        diagnostics.push(`${slashRelativePath}: symlink/junction/realpath escape or special file`);
      } else if (stats.isDirectory()) {
        pending.push(relativePath);
      } else if (stats.isFile()) {
        let content;
        try {
          content = readFileSync(absolutePath);
        } catch (error) {
          diagnostics.push(`${slashRelativePath}: read failed: ${error.message}`);
          continue;
        }
        entries.push(slashRelativePath);
        files[slashRelativePath] = { ok: true, path: slashRelativePath, sha256: hashBuffer(content), bytes: content.byteLength };
      } else {
        diagnostics.push(`${slashRelativePath}: special file is not allowed`);
      }
    }
  }
  entries.sort();
  const rootFingerprint = hashText(entries.map((entry) => `${entry}:${files[entry].bytes}:${files[entry].sha256}`).join('\n'));
  return deepFreeze({ ok: diagnostics.length === 0, rootFingerprint, files, entries, diagnostics });
}

function resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf }) {
  const normalized = normalizeTargetRelativePath(relativePath);
  if (!normalized.ok) return normalized;
  if (!nonEmptyString(workspaceRoot)) return deepFreeze({ ok: false, reason: 'missing workspace root' });
  const root = resolveWorkspaceRoot(workspaceRoot);
  if (!root.ok) return root;
  const absolutePath = path.resolve(workspaceRoot, normalized.path);
  if (!isInsidePath(absolutePath, root.lexicalRoot)) return deepFreeze({ ok: false, reason: 'path escapes workspace' });
  const existingPath = allowMissingLeaf ? nearestExistingPath(path.dirname(absolutePath)) : absolutePath;
  if (!existingPath || !existsSync(existingPath)) return deepFreeze({ ok: false, reason: 'path does not exist' });
  let canonicalExisting;
  try {
    canonicalExisting = realpathSync(existingPath);
  } catch {
    return deepFreeze({ ok: false, reason: 'canonical existing path unavailable' });
  }
  if (!isInsidePath(canonicalExisting, root.canonicalRoot)) return deepFreeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
  if (!allowMissingLeaf) {
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      return deepFreeze({ ok: false, reason: `lstat failed: ${error.message}` });
    }
    if (stats.isSymbolicLink()) return deepFreeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
    let canonicalLeaf;
    try {
      canonicalLeaf = realpathSync(absolutePath);
    } catch {
      return deepFreeze({ ok: false, reason: 'canonical existing leaf unavailable' });
    }
    if (!isInsidePath(canonicalLeaf, root.canonicalRoot)) return deepFreeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
    if (!stats.isFile() && !stats.isDirectory()) return deepFreeze({ ok: false, reason: 'special file is not allowed' });
    return deepFreeze({ ok: true, relativePath: normalized.path, absolutePath, kind: stats.isFile() ? 'file' : 'directory' });
  }
  if (existsSync(absolutePath)) {
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      return deepFreeze({ ok: false, reason: `lstat failed: ${error.message}` });
    }
    if (stats.isSymbolicLink()) return deepFreeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
    let canonicalLeaf;
    try {
      canonicalLeaf = realpathSync(absolutePath);
    } catch {
      return deepFreeze({ ok: false, reason: 'canonical existing leaf unavailable' });
    }
    if (!isInsidePath(canonicalLeaf, root.canonicalRoot)) return deepFreeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
    if (stats.isDirectory()) return deepFreeze({ ok: false, reason: 'existing leaf is a directory' });
    if (!stats.isFile()) return deepFreeze({ ok: false, reason: 'special file is not allowed' });
    return deepFreeze({ ok: true, relativePath: normalized.path, absolutePath, kind: 'file' });
  }
  return deepFreeze({ ok: true, relativePath: normalized.path, absolutePath, kind: 'missing-leaf' });
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!nonEmptyString(workspaceRoot)) return deepFreeze({ ok: false, reason: 'missing workspace root' });
  try {
    return deepFreeze({ ok: true, canonicalRoot: realpathSync(workspaceRoot), lexicalRoot: path.resolve(workspaceRoot) });
  } catch {
    return deepFreeze({ ok: false, reason: 'canonical workspace root unavailable' });
  }
}

function validateHistoryCompatibility({ compatiblePriorHistoryRunId, priorRun, currentRun, resumeLineageRunIds }) {
  const diagnostics = [];
  if (!nonEmptyString(compatiblePriorHistoryRunId)) diagnostics.push('explicit compatible prior-history run reference is required');
  if (Array.isArray(resumeLineageRunIds) && resumeLineageRunIds.includes(compatiblePriorHistoryRunId)) diagnostics.push('compatible prior-history run must not overlap resume lineage');
  if (!priorRun || typeof priorRun !== 'object' || !currentRun || typeof currentRun !== 'object') {
    diagnostics.push('compatible prior/current run records are required');
    return diagnostics;
  }
  if (!nonEmptyString(priorRun.run_id) || !nonEmptyString(currentRun.run_id)) diagnostics.push('compatible prior/current run records require run_id');
  if (currentRun.compatible_prior_history_run_id !== null && currentRun.compatible_prior_history_run_id !== undefined && !nonEmptyString(currentRun.compatible_prior_history_run_id)) diagnostics.push('compatible prior-history run reference must be a non-empty string');
  if (priorRun.run_id !== compatiblePriorHistoryRunId || currentRun.compatible_prior_history_run_id !== compatiblePriorHistoryRunId) diagnostics.push('compatible prior-history run reference must match prior and current run records');
  if (priorRun.completed !== true) diagnostics.push('compatible completed prior-history run is required');
  if (currentRun.history_comparison_ready !== true) diagnostics.push('current run history_comparison_ready must be true before comparison');
  if (currentRun.parent_run_id === compatiblePriorHistoryRunId) diagnostics.push('compatible prior-history run must not be parent lineage');
  for (const field of ['stable_project_identity', 'target_scope_identity', 'contract_schema']) {
    if (!nonEmptyString(priorRun[field]) || priorRun[field] !== currentRun[field]) diagnostics.push(`compatible prior/current run records require same ${field}`);
  }
  return diagnostics;
}

function collectFindingIdentities(findings, label, diagnostics) {
  if (!Array.isArray(findings)) {
    diagnostics.push(`${label}s must be an array`);
    return [];
  }
  const seen = new Set();
  const rows = [];
  for (const finding of findings) {
    try {
      const identity = stableFindingIdentity(finding);
      if (seen.has(identity)) diagnostics.push(`duplicate stable finding identity ${identity}`);
      seen.add(identity);
      rows.push({ identity, finding });
    } catch (error) {
      diagnostics.push(error.message);
    }
  }
  return rows;
}

function collectEvidenceByIdentity(evidenceRows, diagnostics) {
  if (!Array.isArray(evidenceRows)) {
    diagnostics.push('current evidence must be an array');
    return new Map();
  }
  const evidenceByIdentity = new Map();
  for (const evidence of evidenceRows) {
    if (!nonEmptyString(evidence?.finding_identity)) {
      diagnostics.push('current evidence finding_identity is required');
      continue;
    }
    if (evidenceByIdentity.has(evidence.finding_identity)) {
      diagnostics.push(`duplicate or conflicting evidence identity ${evidence.finding_identity}`);
      continue;
    }
    evidenceByIdentity.set(evidence.finding_identity, evidence);
  }
  return evidenceByIdentity;
}

function collectInventoryByIdentity(inventoryRows, diagnostics) {
  if (!Array.isArray(inventoryRows)) {
    diagnostics.push('current inventory must be an array');
    return new Map();
  }
  const inventoryByIdentity = new Map();
  for (const inventory of inventoryRows) {
    if (!nonEmptyString(inventory?.finding_identity)) {
      diagnostics.push('current inventory finding_identity is required');
      continue;
    }
    if (inventoryByIdentity.has(inventory.finding_identity)) diagnostics.push(`duplicate current inventory identity ${inventory.finding_identity}`);
    inventoryByIdentity.set(inventory.finding_identity, inventory);
  }
  return inventoryByIdentity;
}

function nearestExistingPath(absolutePath) {
  let current = absolutePath;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function normalizeTargetRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return deepFreeze({ ok: false, reason: 'empty path' });
  if (filePath.includes('\0')) return deepFreeze({ ok: false, reason: 'NUL byte in path' });
  const slashPath = filePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || /^[A-Za-z]:/.test(slashPath)) return deepFreeze({ ok: false, reason: 'absolute, drive-qualified, or UNC path' });
  const segments = slashPath.split('/');
  if (segments.some((segment) => segment === '..')) return deepFreeze({ ok: false, reason: 'traversal segment' });
  const normalizedSegments = segments.filter((segment) => segment.length > 0 && segment !== '.');
  if (normalizedSegments.length === 0) return deepFreeze({ ok: false, reason: 'empty normalized path' });
  return deepFreeze({ ok: true, path: normalizedSegments.join('/') });
}

function validRun(run) {
  return run && typeof run === 'object' && nonEmptyString(run.qa_session_id) && nonEmptyString(run.run_id) && (run.parent_run_id === null || run.parent_run_id === undefined || nonEmptyString(run.parent_run_id));
}

function hashBuffer(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isInsidePath(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
