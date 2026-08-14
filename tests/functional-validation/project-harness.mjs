import { createHash } from 'node:crypto';
import path from 'node:path';

const canonicalStatuses = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const sharedResourceKinds = Object.freeze(['database', 'port', 'file', 'credential', 'fixture', 'environment', 'cache', 'service', 'external-system']);

export function buildProjectExecutionContracts({ tasks, snapshotFingerprint }) {
  const coordinator = Object.freeze({
    role: 'Project QA Coordinator',
    readOnly: true,
    canDelegate: true,
    allowedWriteTools: Object.freeze([]),
    route: Object.freeze(['project-qa-plan', 'project-qa-execute', 'project-qa-conclude']),
    snapshotFingerprint,
  });

  const moduleTasks = tasks.map((task) => Object.freeze({
    role: 'Module QA Agent',
    readOnly: true,
    canDelegate: false,
    allowedWriteTools: Object.freeze([]),
    moduleId: task.moduleId,
    taskId: task.taskId,
    allowedPaths: Object.freeze([...task.allowedPaths]),
    risks: Object.freeze([...task.risks]),
    verificationIds: Object.freeze([...task.verificationIds]),
    plannedTools: Object.freeze([...task.plannedTools]),
    declaredResources: Object.freeze([...task.declaredResources]),
    snapshotFingerprint: task.snapshotFingerprint,
    isolationWorkspaceReference: task.isolationWorkspaceReference,
  }));

  return Object.freeze({ coordinator, moduleTasks: Object.freeze(moduleTasks) });
}

export function validateModuleScopeAccess(task, requestedPath, { workspaceRoot, resolver } = {}) {
  const requested = normalizeTargetRelativePath(requestedPath);
  const canonicalScope = requested.ok ? validateCanonicalScope({ task, requestedPath: requested.path, workspaceRoot, resolver }) : Object.freeze({ ok: false, reason: requested.reason });
  const allowed = requested.ok && canonicalScope.ok;
  if (allowed) return Object.freeze({ allowed: true, evidence: null });

  return Object.freeze({
    allowed: false,
    evidence: Object.freeze({
      status: 'BLOCKED',
      type: 'infrastructure',
      moduleId: task.moduleId,
      taskId: task.taskId,
      observation: `Out-of-scope path rejected: ${requestedPath}`,
      requestedPath,
      reason: requested.ok ? canonicalScope.reason : requested.reason,
      snapshotFingerprint: task.snapshotFingerprint,
    }),
  });
}

function normalizeTargetRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return Object.freeze({ ok: false, reason: 'empty path' });
  if (filePath.includes('\0')) return Object.freeze({ ok: false, reason: 'NUL byte in path' });

  const slashPath = filePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || /^[A-Za-z]:/.test(slashPath)) {
    return Object.freeze({ ok: false, reason: 'absolute or drive-qualified path' });
  }

  const segments = slashPath.split('/');
  if (segments.some((segment) => segment === '..')) return Object.freeze({ ok: false, reason: 'traversal segment' });

  const normalizedSegments = segments.filter((segment) => segment.length > 0 && segment !== '.');
  if (normalizedSegments.length === 0) return Object.freeze({ ok: false, reason: 'empty normalized path' });

  return Object.freeze({ ok: true, path: normalizedSegments.join('/') });
}

function pathAllowedByEntry({ allowedPath, requestedPath }) {
  const directoryEntry = /[\\/]$/.test(allowedPath);
  const allowed = normalizeTargetRelativePath(allowedPath);
  if (!allowed.ok) return false;

  if (directoryEntry) return requestedPath === allowed.path || requestedPath.startsWith(`${allowed.path}/`);
  return requestedPath === allowed.path;
}

function validateCanonicalScope({ task, requestedPath, workspaceRoot, resolver }) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) return Object.freeze({ ok: false, reason: 'missing workspace root' });
  if (typeof resolver !== 'function') return Object.freeze({ ok: false, reason: 'missing canonical path resolver' });

  const canonicalWorkspace = canonicalRealpath(resolver, workspaceRoot);
  if (!canonicalWorkspace.ok) return Object.freeze({ ok: false, reason: 'canonical workspace root unavailable' });

  const requestedAbsolute = path.resolve(workspaceRoot, requestedPath);
  if (!isInsidePath(requestedAbsolute, canonicalWorkspace.path)) return Object.freeze({ ok: false, reason: 'requested path outside isolation workspace' });

  const canonicalRequested = canonicalRealpath(resolver, requestedAbsolute);
  if (!canonicalRequested.ok) return Object.freeze({ ok: false, reason: 'canonical path unavailable' });
  if (!isInsidePath(canonicalRequested.path, canonicalWorkspace.path)) return Object.freeze({ ok: false, reason: 'canonical path outside isolation workspace' });

  for (const allowedPath of task.allowedPaths) {
    if (!pathAllowedByEntry({ allowedPath, requestedPath })) continue;

    const allowed = normalizeTargetRelativePath(allowedPath);
    if (!allowed.ok) return Object.freeze({ ok: false, reason: 'invalid allowed path' });

    const allowedAbsolute = path.resolve(workspaceRoot, allowed.path);
    if (!isInsidePath(allowedAbsolute, canonicalWorkspace.path)) return Object.freeze({ ok: false, reason: 'allowed path outside isolation workspace' });

    const canonicalAllowed = canonicalRealpath(resolver, allowedAbsolute);
    if (!canonicalAllowed.ok) return Object.freeze({ ok: false, reason: 'canonical allowed path unavailable' });
    if (!isInsidePath(canonicalAllowed.path, canonicalWorkspace.path)) return Object.freeze({ ok: false, reason: 'canonical allowed path outside isolation workspace' });
    if (isInsidePath(canonicalRequested.path, canonicalAllowed.path)) return Object.freeze({ ok: true });
  }

  return Object.freeze({ ok: false, reason: 'not in module allowlist' });
}

function canonicalRealpath(resolver, targetPath) {
  try {
    return Object.freeze({ ok: true, path: path.resolve(resolver(targetPath)) });
  } catch {
    return Object.freeze({ ok: false });
  }
}

function isInsidePath(candidatePath, parentPath) {
  const candidate = path.resolve(candidatePath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function materializeModuleResult(result) {
  const evidence = result.evidence.map((entry) => Object.freeze({ ...entry }));
  return Object.freeze({
    moduleId: result.moduleId,
    resultId: result.resultId,
    taskId: result.taskId,
    status: result.status,
    snapshotFingerprint: result.snapshotFingerprint,
    isolationWorkspaceReference: result.isolationWorkspaceReference,
    verificationIds: Object.freeze([...result.verificationIds]),
    evidence: Object.freeze(evidence),
    findings: Object.freeze([...result.findings]),
    humanGates: Object.freeze([...result.humanGates]),
    artifact: result.artifact,
  });
}

function resourceKind(resource) {
  return String(resource).split(':')[0];
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

export function scheduleModuleTasks(tasks) {
  const parallelEligible = [];
  const serialGroups = [];
  const usedSerialTaskIds = new Set();

  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex];
      const right = tasks[rightIndex];
      const sharedResources = left.declaredResources.filter((resource) => right.declaredResources.includes(resource));
      const needsSerial = sharedResources.some((resource) => sharedResourceKinds.includes(resourceKind(resource)));
      const isolationEvidence = Boolean(left.isolationEvidence && right.isolationEvidence);
      if (needsSerial && !isolationEvidence) {
        serialGroups.push(Object.freeze({ taskIds: Object.freeze([left.taskId, right.taskId]), sharedResources: Object.freeze(sharedResources) }));
        usedSerialTaskIds.add(left.taskId);
        usedSerialTaskIds.add(right.taskId);
      }
    }
  }

  for (const task of tasks) {
    const disjoint = tasks
      .filter((candidate) => candidate.taskId !== task.taskId)
      .every((candidate) => !intersects(task.declaredResources, candidate.declaredResources));
    if (disjoint && !usedSerialTaskIds.has(task.taskId)) parallelEligible.push(task.taskId);
  }

  return Object.freeze({ parallelEligible: Object.freeze(parallelEligible), serialGroups: Object.freeze(serialGroups) });
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function flattenEvidence(moduleResults) {
  return moduleResults.flatMap((result) => result.evidence || []);
}

function coverageComplete(moduleResults, requiredCoverage, diagnostics) {
  const resultModules = new Set(moduleResults.map((result) => result.moduleId));
  const evidenceByModule = new Map(moduleResults.map((result) => [
    result.moduleId,
    new Set((result.evidence || []).map((entry) => entry.verificationId)),
  ]));
  const resultVerificationIds = new Set(flattenEvidence(moduleResults).map((entry) => entry.verificationId));
  const modulesComplete = requiredCoverage.importantModules.every((moduleId) => {
    const hasModule = resultModules.has(moduleId);
    if (!hasModule) diagnostics.push(`missing important module result: ${moduleId}`);

    const expectedVerificationIds = requiredCoverage.moduleEvidence?.[moduleId] || [];
    const moduleEvidence = evidenceByModule.get(moduleId) || new Set();
    const missingVerificationIds = expectedVerificationIds.filter((verificationId) => !moduleEvidence.has(verificationId));
    if (missingVerificationIds.length > 0) diagnostics.push(`missing module evidence for ${moduleId}: ${missingVerificationIds.join(', ')}`);

    return hasModule && missingVerificationIds.length === 0;
  });
  const verificationsComplete = requiredCoverage.mustVerify.every((verificationId) => {
    const complete = resultVerificationIds.has(verificationId);
    if (!complete) diagnostics.push(`missing Must Verify evidence: ${verificationId}`);
    return complete;
  });
  const flowsComplete = requiredCoverage.keyFlows.every((flowId) => {
    const requiredVerificationIds = requiredCoverage.keyFlowEvidence[flowId] || [];
    const missingVerificationIds = requiredVerificationIds.filter((verificationId) => !resultVerificationIds.has(verificationId));
    if (missingVerificationIds.length > 0) diagnostics.push(`missing key-flow evidence for ${flowId}: ${missingVerificationIds.join(', ')}`);
    return missingVerificationIds.length === 0;
  });
  return modulesComplete && verificationsComplete && flowsComplete;
}

function validateResultIntegrity({ moduleResults, currentSnapshotFingerprint, diagnostics }) {
  if (!currentSnapshotFingerprint) diagnostics.push('missing current snapshot fingerprint');

  for (const result of moduleResults) {
    if (result.snapshotFingerprint !== currentSnapshotFingerprint) {
      diagnostics.push(`module result snapshot fingerprint mismatch for ${result.moduleId}`);
    }
    if (!result.isolationWorkspaceReference || result.isolationWorkspaceReference === 'N/A') {
      diagnostics.push(`missing isolation workspace reference for ${result.moduleId}`);
    }

    for (const evidence of result.evidence || []) {
      if (evidence.snapshotFingerprint !== currentSnapshotFingerprint) {
        diagnostics.push(`evidence snapshot fingerprint mismatch for ${result.moduleId}/${evidence.verificationId}`);
      }
      if (evidence.isolationWorkspaceReference !== result.isolationWorkspaceReference || !evidence.isolationWorkspaceReference || evidence.isolationWorkspaceReference === 'N/A') {
        diagnostics.push(`evidence isolation workspace mismatch for ${result.moduleId}/${evidence.verificationId}`);
      }
      if (evidence.moduleId !== result.moduleId) {
        diagnostics.push(`evidence module mismatch for ${result.moduleId}/${evidence.verificationId}`);
      }
      if (evidence.taskId !== result.taskId) {
        diagnostics.push(`evidence task ID mismatch for ${result.moduleId}/${evidence.verificationId}`);
      }
      if (!result.verificationIds.includes(evidence.verificationId)) {
        diagnostics.push(`evidence verification mismatch for ${result.moduleId}/${evidence.verificationId}`);
      }
      if (!evidence.artifact?.path || !evidence.artifact?.sha256 || !Number.isInteger(evidence.artifact?.bytes) || evidence.artifact.bytes < 0) {
        diagnostics.push(`missing artifact reference for ${result.moduleId}/${evidence.verificationId}`);
      }
    }

    const derivedStatus = deriveModuleStatus(result);
    if (derivedStatus !== result.status) {
      diagnostics.push(`module status mismatch for ${result.moduleId}: declared ${result.status}, derived ${derivedStatus}`);
    }
  }
}

function deriveModuleStatus(result) {
  const evidence = result.evidence || [];
  const findings = result.findings || [];
  const humanGates = result.humanGates || [];

  if (evidence.some((entry) => entry.status === 'BLOCKED') || findings.some((finding) => finding.status === 'BLOCKED')) return 'BLOCKED';
  if (evidence.some((entry) => entry.status === 'FAIL') || findings.some((finding) => finding.status === 'FAIL' || finding.type === 'product')) return 'FAIL';
  if (evidence.some((entry) => entry.status === 'NEEDS_HUMAN_REVIEW') || humanGates.some((gate) => gate.critical !== false)) return 'NEEDS_HUMAN_REVIEW';
  if (evidence.length > 0 && evidence.every((entry) => entry.status === 'PASS')) return 'PASS';
  return 'BLOCKED';
}

function validateTaskTraceability({ moduleResults, requiredCoverage, diagnostics }) {
  const taskIds = requiredCoverage.taskIds || {};
  for (const result of moduleResults) {
    const expectedTaskId = taskIds[result.moduleId];
    if (!expectedTaskId) {
      diagnostics.push(`missing expected task ID for ${result.moduleId}`);
    } else if (result.taskId !== expectedTaskId) {
      diagnostics.push(`task ID mismatch for ${result.moduleId}: expected ${expectedTaskId}, got ${result.taskId || 'missing'}`);
    }
  }
}

function validateTargetIntegrity({ targetIntegrity, diagnostics }) {
  if (!targetIntegrity) {
    diagnostics.push('missing target postflight integrity input');
    return;
  }
  if (targetIntegrity.ok !== true) {
    const integrityDiagnostics = Array.isArray(targetIntegrity.diagnostics) ? targetIntegrity.diagnostics : [];
    diagnostics.push(...(integrityDiagnostics.length > 0 ? integrityDiagnostics : ['target postflight integrity failed']));
  }
}

function validateAuthorityIntegrity({ authorityIntegrity, diagnostics }) {
  if (!authorityIntegrity) {
    diagnostics.push('missing authority integrity input');
    return;
  }
  if (authorityIntegrity.ok !== true) {
    diagnostics.push(...(authorityIntegrity.diagnostics || ['authority integrity failed']));
  }
}

export function reconcileProjectStatus({ moduleResults, requiredCoverage, currentSnapshotFingerprint, authorityIntegrity, targetIntegrity }) {
  const diagnostics = [];
  const findings = Object.freeze(moduleResults.flatMap((result) => result.findings || []));
  const humanGates = Object.freeze(moduleResults.flatMap((result) => result.humanGates || []));
  validateAuthorityIntegrity({ authorityIntegrity, diagnostics });
  validateTargetIntegrity({ targetIntegrity, diagnostics });
  validateTaskTraceability({ moduleResults, requiredCoverage, diagnostics });
  validateResultIntegrity({ moduleResults, currentSnapshotFingerprint, diagnostics });
  const complete = coverageComplete(moduleResults, requiredCoverage, diagnostics);
  const hasBlocker = authorityIntegrity?.ok !== true || targetIntegrity?.ok !== true || diagnostics.length > 0 || moduleResults.some((result) => result.status === 'BLOCKED') || findings.some((finding) => finding.status === 'BLOCKED');
  const hasProductFailure = moduleResults.some((result) => result.status === 'FAIL') || findings.some((finding) => finding.status === 'FAIL' || finding.type === 'product');
  const hasCriticalHumanGate = humanGates.some((gate) => gate.critical !== false) || moduleResults.some((result) => result.status === 'NEEDS_HUMAN_REVIEW');

  let overallStatus;
  if (hasBlocker) overallStatus = 'BLOCKED';
  else if (hasProductFailure) overallStatus = 'FAIL';
  else if (hasCriticalHumanGate) overallStatus = 'NEEDS_HUMAN_REVIEW';
  else overallStatus = complete ? 'PASS' : 'BLOCKED';

  return Object.freeze({
    overallStatus,
    canonical: canonicalStatuses.includes(overallStatus),
    coverageComplete: complete,
    authorityIntegrity,
    diagnostics: Object.freeze(diagnostics),
    findings,
    humanGates,
    evidence: Object.freeze(flattenEvidence(moduleResults)),
  });
}

export function corruptAuthorityIntegrity(moduleResult) {
  return Object.freeze({
    ok: false,
    status: 'BLOCKED',
    diagnostics: Object.freeze([`artifact hash mismatch for ${moduleResult.resultId}`]),
    expectedSha256: moduleResult.artifact.sha256,
    actualSha256: sha256Text(`${moduleResult.artifact.sha256}:corrupted`),
  });
}

export function validateExactDelivery(input = {}) {
  const validInputObject = input !== null && typeof input === 'object' && !Array.isArray(input);
  const { completedPayload, reportArtifact, manifest } = validInputObject ? input : {};
  const diagnostics = [];
  if (!validInputObject) diagnostics.push('delivery input must be an object');
  const hasPayload = typeof completedPayload === 'string';
  const hasReportArtifact = reportArtifact && typeof reportArtifact === 'object';
  const hasManifest = manifest && typeof manifest === 'object';
  const deliveredSha256 = hasPayload ? sha256Text(completedPayload) : null;
  const deliveredBytes = hasPayload ? Buffer.byteLength(completedPayload, 'utf8') : null;

  if (!hasPayload) diagnostics.push('completedPayload must be a string');
  if (!hasReportArtifact) diagnostics.push('reportArtifact must be an object');
  if (!hasManifest) diagnostics.push('manifest must be an object');
  validateHashMetadata('reportArtifact.sha256', hasReportArtifact ? reportArtifact.sha256 : undefined, diagnostics);
  validateByteMetadata('reportArtifact.bytes', hasReportArtifact ? reportArtifact.bytes : undefined, diagnostics);
  validateHashMetadata('manifest.reportSha256', hasManifest ? manifest.reportSha256 : undefined, diagnostics);
  validateByteMetadata('manifest.reportBytes', hasManifest ? manifest.reportBytes : undefined, diagnostics);

  const reportMatches = hasPayload && reportArtifact?.sha256 === deliveredSha256 && reportArtifact?.bytes === deliveredBytes;
  const manifestMatches = hasPayload && manifest?.reportSha256 === deliveredSha256 && manifest?.reportBytes === deliveredBytes;
  const ok = reportMatches && manifestMatches;

  return Object.freeze({
    ok,
    deliveredSha256,
    deliveredBytes,
    reportMatches,
    manifestMatches,
    diagnostics: Object.freeze(ok ? [] : [
      ...diagnostics,
      reportMatches ? null : 'report artifact differs from completed payload',
      manifestMatches ? null : 'manifest differs from completed payload',
    ].filter(Boolean)),
  });
}

function validateHashMetadata(field, value, diagnostics) {
  if (typeof value !== 'string' || value.length === 0) diagnostics.push(`${field} must be a non-empty string`);
}

function validateByteMetadata(field, value, diagnostics) {
  if (!Number.isInteger(value) || value < 0) diagnostics.push(`${field} must be a nonnegative integer`);
}
