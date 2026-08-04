import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const fixtureOnlyRepairTerms = Object.freeze([
  'AC-USER-RESET',
  'RISK-AUTH-RESET',
  'V-AUTH-RESET-001',
  'snap-repair-001',
  'generated-validation-001',
  'generated-validation-artifact-001',
  'generated-validation-circular',
  'generated-validation-missing-metadata',
  'generated-validation-missing-artifact',
  'generated-validation-mismatched-artifact',
  'generated-validation-same-actor',
  'auth-record-001',
  'original-failure-evidence-001',
  'task-auth-reset',
  'isolated-workspace://generated',
  'isolated-workspace://trace',
  'evidence/generated-validation-001.json',
  'evidence/original-failure-evidence-001.json',
  'tmp/generated-validation/reset-token.generated.test.mjs',
  'tmp/generated-validation/circular.generated.test.mjs',
  'repair/repair-round-1/minimal.diff.json',
  'src/reset-token.mjs',
]);

export const existingAcceptanceIds = Object.freeze(['AC-USER-RESET', 'AC-SESSION-EXPIRY']);
export const existingRiskIds = Object.freeze(['RISK-AUTH-RESET', 'RISK-SESSION-EXPIRY']);
export const existingVerificationIds = Object.freeze(['V-AUTH-RESET-001', 'V-SESSION-EXPIRY-001']);
export const repairSnapshotFingerprint = 'snap-repair-001';

export function selectProjectMode({ authorizationRecord } = {}) {
  const validRecord = authorizationRecord
    && typeof authorizationRecord === 'object'
    && authorizationRecord.source === 'user'
    && authorizationRecord.explicit === true
    && authorizationRecord.selectedMode === 'PROJECT_FIX_AND_RERUN'
    && (nonEmptyString(authorizationRecord.requestText) || nonEmptyString(authorizationRecord.requestReference))
    && nonEmptyString(authorizationRecord.recordId)
    && nonEmptyString(authorizationRecord.timestamp);

  return Object.freeze({
    mode: validRecord ? 'PROJECT_FIX_AND_RERUN' : 'PROJECT_QA_ONLY',
    repairMayStart: Boolean(validRecord),
    authorizationBoundary: validRecord ? 'recorded-user-authorization' : 'not-authorized',
    authorizationRecord: validRecord ? deepFreeze({ ...authorizationRecord }) : null,
    diagnostics: Object.freeze(validRecord ? [] : ['missing explicit recorded user authorization']),
  });
}

export function createRepairWorkspace(prefix = 'qa-skill-m4-repair-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const isolatedWorkspace = path.join(root, 'isolated-workspace');
  const originalTarget = path.join(root, 'original-target');
  mkdirSync(isolatedWorkspace, { recursive: true });
  mkdirSync(originalTarget, { recursive: true });
  return Object.freeze({ root, isolatedWorkspace, originalTarget });
}

export function removeRepairWorkspace(workspace) {
  if (workspace?.root) rmSync(workspace.root, { recursive: true, force: true });
}

export function writeWorkspaceFile(workspaceRoot, relativePath, content) {
  const safePath = resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf: true });
  if (!safePath.ok) throw new Error(`unsafe workspace write rejected: ${safePath.reason}`);
  mkdirSync(path.dirname(safePath.absolutePath), { recursive: true });
  const parentRelativePath = path.dirname(safePath.relativePath);
  const parentCheck = parentRelativePath === '.'
    ? resolveWorkspaceRoot(workspaceRoot)
    : resolveWorkspacePath({ workspaceRoot, relativePath: parentRelativePath, allowMissingLeaf: false });
  if (!parentCheck.ok) throw new Error(`unsafe workspace write parent rejected: ${parentCheck.reason}`);
  writeFileSync(safePath.absolutePath, String(content));
  return safePath.absolutePath;
}

export function hashText(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function hashBuffer(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fileMetadata(workspaceRoot, relativePath) {
  const safePath = resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf: false });
  if (!safePath.ok) return Object.freeze({ ok: false, diagnostics: Object.freeze([safePath.reason]) });
  const content = readFileSync(safePath.absolutePath);
  return Object.freeze({
    ok: true,
    relativePath: safePath.relativePath,
    sha256: hashBuffer(content),
    bytes: content.byteLength,
  });
}

export function validateGeneratedTest(candidate = {}) {
  const diagnostics = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return failGenerated(['generated test candidate must be an object']);
  }

  const linkedIds = Array.isArray(candidate.linkedIds) ? candidate.linkedIds : [];
  const acceptanceIds = linkedIds.filter((id) => existingAcceptanceIds.includes(id));
  const riskIds = linkedIds.filter((id) => existingRiskIds.includes(id));
  const verificationIds = linkedIds.filter((id) => existingVerificationIds.includes(id));
  const allIdsKnown = linkedIds.length > 0 && linkedIds.every((id) => [...existingAcceptanceIds, ...existingRiskIds, ...existingVerificationIds].includes(id));
  if (!allIdsKnown || acceptanceIds.length === 0 || riskIds.length === 0 || verificationIds.length === 0) {
    diagnostics.push('generated test must link to at least one pre-existing acceptance ID, risk ID, and verification ID');
  }

  const asset = candidate.generatedAsset;
  const assetPath = asset && resolveWorkspacePath({ workspaceRoot: asset.workspaceRoot, relativePath: asset.relativePath, allowMissingLeaf: false });
  if (!assetPath?.ok) diagnostics.push(`generated asset path invalid: ${assetPath?.reason || 'missing generated asset metadata'}`);
  if (!isGeneratedValidationDescendant(assetPath?.relativePath)) diagnostics.push('generated asset path must be under tmp/generated-validation/');
  const assetMetadata = assetPath?.ok ? fileMetadata(asset.workspaceRoot, asset.relativePath) : null;
  if (!assetMetadata?.ok) diagnostics.push('generated asset metadata/path/hash/bytes must be readable inside isolation workspace');
  if (!nonEmptyString(asset?.snapshotFingerprint)) diagnostics.push('generated asset must record snapshot fingerprint');
  if (!nonEmptyString(asset?.workspaceReference)) diagnostics.push('generated asset must record isolation workspace reference');
  if (!nonEmptyString(asset?.sha256)) diagnostics.push('generated asset SHA-256 is required');
  if (!Number.isInteger(asset?.bytes) || asset.bytes < 0) diagnostics.push('generated asset byte count is required');
  if (assetMetadata?.ok && asset.sha256 !== assetMetadata.sha256) diagnostics.push('generated asset hash mismatch');
  if (assetMetadata?.ok && asset.bytes !== assetMetadata.bytes) diagnostics.push('generated asset byte count mismatch');

  const writer = candidate.writer;
  if (!writer || typeof writer !== 'object' || !['host-main-agent', 'host-implementation-agent'].includes(writer.actor) || writer.operation !== 'create-generated-validation-asset') {
    diagnostics.push('generated asset writer must be a host writer creating generated validation only');
  }

  const validation = candidate.independentValidation;
  if (!validation || typeof validation !== 'object') {
    diagnostics.push('independent QA validation record is required');
  } else {
    if (!nonEmptyString(validation.actor)) diagnostics.push('independent QA actor is required');
    if (!['Module QA Agent', 'Independent QA Agent'].includes(validation.role)) diagnostics.push('independent QA validation role must be recognized');
    if (validation.actor === writer?.actor) diagnostics.push('independent QA actor must differ from writer actor');
    if (validation.readOnly !== true) diagnostics.push('independent QA validation must be read-only');
    if (validation.accepted !== true) diagnostics.push('independent QA validation must explicitly accept the generated test');
    if (!nonEmptyString(validation.evidenceId)) diagnostics.push('independent QA validation evidence ID is required');
    if (validation.snapshotFingerprint !== asset?.snapshotFingerprint) diagnostics.push('independent QA validation snapshot must match generated asset');
    if (validation.workspaceReference !== asset?.workspaceReference) diagnostics.push('independent QA validation workspace must match generated asset');
    validateEvidenceArtifact(validation.evidenceArtifact, diagnostics);
    for (const [field, label] of [
      ['meaningfulBehavior', 'meaningful behavior'],
      ['deterministicOracle', 'deterministic oracle'],
      ['noVacuity', 'no vacuity'],
      ['noCircularSelfProof', 'no circular self-proof'],
      ['noWeakMatching', 'no weak matching'],
      ['noSkipDeletionWeakeningInversion', 'no skip/deletion/weakening/inversion'],
    ]) {
      if (validation[field] !== true) diagnostics.push(`independent QA validation missing ${label}`);
    }
  }

  const content = assetMetadata?.ok ? readFileSync(assetPath.absolutePath, 'utf8') : String(candidate.content || '');
  if (!/assert\.(?:equal|deepEqual|match|ok|throws)\s*\(/.test(content)) diagnostics.push('generated test lacks behaviorally meaningful assertion');
  if (!/expected[A-Za-z0-9_]*\s*=|EXPECTED_|Object\.freeze/.test(content)) diagnostics.push('generated test lacks deterministic oracle');
  if (/readFileSync\([^)]*import\.meta\.url|generated\s+test\s+validates\s+itself/i.test(content)) diagnostics.push('generated test attempts circular self-proof');
  if (/includes\([^)]*(?:PASS|ok|success)|toString\(\)\.includes|assert\.ok\(true\)|\.skip\s*\(/i.test(content)) diagnostics.push('generated test uses weak matching, skip, or vacuous assertion');

  const accepted = diagnostics.length === 0;
  return Object.freeze({
    accepted,
    supportsPass: accepted,
    independentQaValidated: accepted,
    asset: assetMetadata?.ok ? deepFreeze({ ...assetMetadata, workspaceReference: asset.workspaceReference, snapshotFingerprint: asset.snapshotFingerprint }) : null,
    diagnostics: Object.freeze(diagnostics),
  });
}

function failGenerated(diagnostics) {
  return Object.freeze({ accepted: false, supportsPass: false, independentQaValidated: false, asset: null, diagnostics: Object.freeze(diagnostics) });
}

function validateEvidenceArtifact(artifact, diagnostics) {
  if (!artifact || typeof artifact !== 'object') {
    diagnostics.push('independent QA validation evidence artifact is required');
    return;
  }
  if (!nonEmptyString(artifact.path)) diagnostics.push('independent QA validation evidence artifact path is required');
  if (!nonEmptyString(artifact.sha256)) diagnostics.push('independent QA validation evidence artifact hash is required');
  if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) diagnostics.push('independent QA validation evidence artifact byte count is required');
  const artifactPath = resolveWorkspacePath({ workspaceRoot: artifact.workspaceRoot, relativePath: artifact.path, allowMissingLeaf: false });
  if (!artifactPath.ok) {
    diagnostics.push(`independent QA validation evidence artifact path invalid: ${artifactPath.reason}`);
    return;
  }
  const content = readFileSync(artifactPath.absolutePath);
  if (artifact.sha256 !== hashBuffer(content)) diagnostics.push('independent QA validation evidence artifact hash mismatch');
  if (artifact.bytes !== content.byteLength) diagnostics.push('independent QA validation evidence artifact byte count mismatch');
}

export function evaluateRepairCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return Object.freeze({ accepted: false, supportsPass: false, forbidden: Object.freeze(['malformed repair candidate']), diagnostics: Object.freeze(['repair candidate must be an object']) });
  }
  const text = `${candidate.diff || ''}\n${candidate.testContent || ''}`;
  const forbidden = [
    [/delete\s+failing\s+test|rm\s+.+\.test|removed?\s+test/i, 'test deletion'],
    [/\.skip\s*\(|skip\s+failing/i, 'test skip'],
    [/assert\.ok\(true\)|expected\s*=\s*actual|assertion\s+weak/i, 'assertion weakening'],
    [/notEqual\s*\(|invert(?:ed)?\s+assertion/i, 'assertion inversion'],
  ].filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return Object.freeze({ accepted: forbidden.length === 0, supportsPass: forbidden.length === 0, forbidden: Object.freeze(forbidden), diagnostics: Object.freeze([]) });
}

export function createRepairRoundRecord(input = {}) {
  const {
    workspaceRoot,
    workspaceReference,
    snapshotFingerprint,
    authorizationRecord,
    roundNumber,
    changedPath,
    beforeContent,
    beforeSha256,
    afterContent,
    originalFailureEvidence,
  } = input;
  if (!Number.isInteger(roundNumber) || roundNumber < 1) throw new Error('repair round number must be a positive integer');
  if (!nonEmptyString(workspaceReference)) throw new Error('repair workspace reference is required');
  if (!nonEmptyString(snapshotFingerprint)) throw new Error('repair snapshot fingerprint is required');
  if (typeof afterContent !== 'string') throw new Error('repair after content is required');
  const authorization = selectProjectMode({ authorizationRecord });
  if (authorization.mode !== 'PROJECT_FIX_AND_RERUN') throw new Error('valid recorded repair authorization is required');
  const changed = normalizeTargetRelativePath(changedPath);
  if (!changed.ok) throw new Error(`unsafe repair changed path rejected: ${changed.reason}`);
  if (!originalFailureEvidence || typeof originalFailureEvidence !== 'object' || !nonEmptyString(originalFailureEvidence.evidenceId) || originalFailureEvidence.status !== 'FAIL' || !nonEmptyString(originalFailureEvidence.taskId) || !nonEmptyString(originalFailureEvidence.verificationId) || originalFailureEvidence.snapshotFingerprint !== snapshotFingerprint || originalFailureEvidence.workspaceReference !== workspaceReference) {
    throw new Error('original failure evidence record with stable evidenceId, FAIL status, task ID, verification ID, workspace, and snapshot is required');
  }
  validateEvidenceArtifact(originalFailureEvidence.artifact, []);
  const originalArtifactDiagnostics = [];
  validateEvidenceArtifact(originalFailureEvidence.artifact, originalArtifactDiagnostics);
  if (originalArtifactDiagnostics.length > 0) {
    throw new Error(`original failure evidence artifact invalid: ${originalArtifactDiagnostics.join('; ')}`);
  }

  const originalPayload = JSON.stringify(originalFailureEvidence);
  const originalEvidence = deepFreeze({
    ...originalFailureEvidence,
    recordSha256: hashText(originalPayload),
    recordBytes: Buffer.byteLength(originalPayload, 'utf8'),
  });

  const beforePath = resolveWorkspacePath({ workspaceRoot, relativePath: changed.path, allowMissingLeaf: false });
  if (!beforePath.ok) throw new Error(`repair changed file must already exist: ${beforePath.reason}`);
  const before = fileMetadata(workspaceRoot, changed.path);
  if (typeof beforeContent !== 'string' && !nonEmptyString(beforeSha256)) throw new Error('before content or before SHA-256 authority is required');
  if (typeof beforeContent === 'string' && readFileSync(beforePath.absolutePath, 'utf8') !== beforeContent) throw new Error('expected before content does not match existing changed file');
  if (nonEmptyString(beforeSha256) && before.sha256 !== beforeSha256) throw new Error('expected before hash does not match existing changed file');
  writeWorkspaceFile(workspaceRoot, changed.path, afterContent);
  const after = fileMetadata(workspaceRoot, changed.path);
  const diffPayload = JSON.stringify({ path: changed.path, before, after });
  const baseId = `repair-round-${roundNumber}`;
  const diffRelativePath = `repair/${baseId}/minimal.diff.json`;
  writeWorkspaceFile(workspaceRoot, diffRelativePath, diffPayload);
  const diffMetadata = fileMetadata(workspaceRoot, diffRelativePath);
  const diffArtifact = deepFreeze({
    diffId: `${baseId}-minimal-diff`,
    path: diffRelativePath,
    sha256: diffMetadata.sha256,
    bytes: diffMetadata.bytes,
    before,
    after,
  });

  return deepFreeze({
    repairRoundId: baseId,
    originalFailureEvidenceId: originalEvidence.evidenceId,
    originalFailureEvidence: originalEvidence,
    rootCauseHypothesisId: `${baseId}-root-cause-hypothesis`,
    diffId: diffArtifact.diffId,
    originalRerunEvidenceId: `${baseId}-original-rerun`,
    moduleRegressionEvidenceId: `${baseId}-module-regression`,
    freshEvidenceId: `${baseId}-fresh-evidence`,
    rootCauseHypothesis: 'Boundary condition violates accepted behavior under existing verification ID.',
    changedTargetRelativePaths: [changed.path],
    minimalDiffArtifact: diffArtifact,
    authorizationRecord: authorization.authorizationRecord,
    workspaceReference,
    snapshotFingerprint,
    rerunOrder: ['original-failure-first', 'affected-module-regression', 'project-regression-if-needed'],
  });
}

export function enforceRepairRoundLimit(roundRecords, requestedRound) {
  const diagnostics = [];
  if (!Array.isArray(roundRecords)) diagnostics.push('round records must be an array');
  if (!Number.isInteger(requestedRound) || requestedRound < 1) diagnostics.push('requested repair round must be a positive integer');
  const records = Array.isArray(roundRecords) ? roundRecords : [];
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') diagnostics.push(`round record ${index + 1} must be an object`);
    if (!nonEmptyString(record?.repairRoundId)) diagnostics.push(`round record ${index + 1} missing repairRoundId`);
    if (!['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW'].includes(record?.status)) diagnostics.push(`round record ${index + 1} missing canonical status`);
  });
  if (Number.isInteger(requestedRound) && requestedRound !== records.length + 1) diagnostics.push('requested repair round must be sequential');
  if (requestedRound > 4) diagnostics.push('requested repair round exceeds supported loop-control check');
  if (requestedRound === 4 && records.length !== 3) diagnostics.push('fourth repair round check requires three visible attempts');
  if (requestedRound > 3) diagnostics.push('fourth repair round refused after max three rounds');
  const validFourth = Array.isArray(roundRecords) && requestedRound === 4 && records.length === 3 && diagnostics.length === 1 && diagnostics[0] === 'fourth repair round refused after max three rounds';
  const allowed = diagnostics.length === 0 && requestedRound <= 3;
  return Object.freeze({
    allowed,
    loopControlStatus: allowed ? 'OPEN' : (validFourth ? 'NEEDS_HUMAN_REVIEW' : 'BLOCKED'),
    overallStatus: records.some((record) => record?.status === 'FAIL') ? 'FAIL' : 'NEEDS_HUMAN_REVIEW',
    visibleAttemptCount: records.length,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function detectNoProgress(roundRecords) {
  if (!Array.isArray(roundRecords)) {
    return Object.freeze({ stop: true, loopControlStatus: 'BLOCKED', humanGate: '', diagnostics: Object.freeze(['round records must be an array']) });
  }
  for (let index = 0; index < roundRecords.length; index += 1) {
    if (!roundRecords[index] || typeof roundRecords[index] !== 'object') {
      return Object.freeze({ stop: true, loopControlStatus: 'BLOCKED', humanGate: '', diagnostics: Object.freeze([`round record ${index + 1} must be an object`]) });
    }
  }
  for (let index = 1; index < roundRecords.length; index += 1) {
    const previous = roundRecords[index - 1];
    const current = roundRecords[index];
    for (const field of ['normalizedDiffFingerprint', 'evidenceFingerprint', 'failureFingerprint']) {
      if (nonEmptyString(previous?.[field]) && previous[field] === current?.[field]) {
        return Object.freeze({ stop: true, loopControlStatus: 'NEEDS_HUMAN_REVIEW', repeatedField: field, humanGate: 'Human Gate: repeated normalized diff/evidence/failure fingerprint with no progress', diagnostics: Object.freeze([]) });
      }
    }
  }
  return Object.freeze({ stop: false, loopControlStatus: 'OPEN', humanGate: '', diagnostics: Object.freeze([]) });
}

export function cleanupGeneratedValidationAssets(workspaceRoot, relativePaths) {
  const diagnostics = [];
  if (!Array.isArray(relativePaths)) {
    return Object.freeze({ ok: false, status: 'BLOCKED', diagnostics: Object.freeze(['cleanup paths must be an array']), removed: Object.freeze([]) });
  }

  const normalizedPaths = [];
  for (const relativePath of relativePaths) {
    const normalized = normalizeTargetRelativePath(relativePath);
    if (!normalized.ok) {
      diagnostics.push(`${relativePath}: ${normalized.reason}`);
      continue;
    }
    if (!isGeneratedValidationRootOrDescendant(normalized.path)) {
      diagnostics.push(`${relativePath}: cleanup path must be tmp/generated-validation or its descendants`);
      continue;
    }
    normalizedPaths.push(normalized.path);
  }
  if (diagnostics.length > 0) return Object.freeze({ ok: false, status: 'BLOCKED', diagnostics: Object.freeze(diagnostics), removed: Object.freeze([]) });

  const safePaths = [];
  for (const relativePath of collapseCleanupPaths(normalizedPaths)) {
    const safePath = resolveCleanupPath({ workspaceRoot, relativePath });
    if (!safePath.ok) {
      diagnostics.push(`${relativePath}: ${safePath.reason}`);
      continue;
    }
    safePaths.push(safePath);
  }
  if (diagnostics.length > 0) return Object.freeze({ ok: false, status: 'BLOCKED', diagnostics: Object.freeze(diagnostics), removed: Object.freeze([]) });

  const removed = [];
  for (const safePath of safePaths) {
    try {
      const stats = lstatSync(safePath.absolutePath);
      rmSync(safePath.absolutePath, { recursive: true, force: false });
      removed.push(safePath.relativePath);
      removeEmptyParents({ workspaceRoot, startDirectory: path.dirname(safePath.absolutePath) });
    } catch (error) {
      diagnostics.push(`${safePath.relativePath}: ${error.message}`);
    }
  }

  const residue = generatedValidationResidue(workspaceRoot);
  diagnostics.push(...residue.map((entry) => `generated validation residue remains: ${entry}`));
  return Object.freeze({ ok: diagnostics.length === 0, status: diagnostics.length === 0 ? 'PASS' : 'BLOCKED', diagnostics: Object.freeze(diagnostics), removed: Object.freeze(removed) });
}

export function listFiles(root) {
  if (!existsSync(root)) return Object.freeze([]);
  const entries = [];
  const pending = [''];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) pending.push(relativePath);
      if (entry.isFile()) entries.push(relativePath.split(path.sep).join('/'));
      if (entry.isSymbolicLink()) entries.push(`${relativePath.split(path.sep).join('/')} <symlink>`);
    }
  }
  return Object.freeze(entries.sort());
}

export function fingerprintTree(root) {
  if (!existsSync(root)) return hashText('missing');
  const entries = listFiles(root);
  const payload = entries.map((entryPath) => {
    const symlink = entryPath.endsWith(' <symlink>');
    const relativePath = symlink ? entryPath.replace(/ <symlink>$/, '') : entryPath;
    const absolutePath = path.join(root, relativePath);
    if (symlink) {
      let target = '';
      try { target = readlinkSync(absolutePath); } catch { target = 'unreadable'; }
      return `${relativePath}:symlink:${target}`;
    }
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) return `${relativePath}:directory`;
    const content = readFileSync(absolutePath);
    return `${relativePath}:file:${stats.size}:${hashBuffer(content)}`;
  }).join('\n');
  return hashText(payload);
}

export function validateForbiddenActions(actions, { workspaceRoot, mode = 'PROJECT_QA_ONLY', authorizationRecord, repairWritePlan = [] } = {}) {
  const diagnostics = [];
  if (!Array.isArray(actions)) {
    return Object.freeze({ ok: false, forbiddenActions: Object.freeze([]), diagnostics: Object.freeze(['actions must be an array']) });
  }
  const forbiddenActions = [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      forbiddenActions.push(action);
      diagnostics.push('malformed action record');
      continue;
    }
    const commandText = `${action.tool || ''} ${action.command || ''} ${action.intent || ''}`;
    const gitPolicy = evaluateGitCommand(String(action.command || ''));
    const mutableGit = gitPolicy.forbidden;
    const forbiddenCommand = hasForbiddenCommand(commandText);
    const toolName = String(action.tool || '').toLowerCase();
    const writeAction = action.mutates === true || ['apply_patch', 'write', 'edit'].includes(toolName) || /\b(?:write|edit|modify|delete|patch)\b/i.test(String(action.intent || ''));
    let unsafeWrite = false;
    if (writeAction) {
      const hostWriter = ['host-main-agent', 'host-implementation-agent'].includes(action.actor);
      const scopedPath = action.relativePath && resolveWorkspacePath({ workspaceRoot, relativePath: action.relativePath, allowMissingLeaf: true });
      const scoped = scopedPath?.ok;
      const normalizedActionPath = normalizeTargetRelativePath(action.relativePath);
      const generatedOnly = isGeneratedValidationDescendant(normalizedActionPath.path);
      const targetExists = scoped && existsSync(scopedPath.absolutePath);
      const authorizedRepair = mode === 'PROJECT_FIX_AND_RERUN' && selectProjectMode({ authorizationRecord }).mode === 'PROJECT_FIX_AND_RERUN';
      const qaOnlyAllowed = mode === 'PROJECT_QA_ONLY' && generatedOnly && action.operation === 'create-generated-validation-asset' && !targetExists;
      const repairAllowed = authorizedRepair && isPlannedRepairWrite(normalizedActionPath.path, repairWritePlan);
      unsafeWrite = !hostWriter || !scoped || (!qaOnlyAllowed && !repairAllowed);
    }
    if (mutableGit || forbiddenCommand || unsafeWrite) forbiddenActions.push(action);
  }
  return Object.freeze({ ok: forbiddenActions.length === 0 && diagnostics.length === 0, forbiddenActions: Object.freeze(forbiddenActions), diagnostics: Object.freeze(diagnostics) });
}

function resolveWorkspacePath({ workspaceRoot, relativePath, allowMissingLeaf }) {
  const normalized = normalizeTargetRelativePath(relativePath);
  if (!normalized.ok) return normalized;
  if (!nonEmptyString(workspaceRoot)) return Object.freeze({ ok: false, reason: 'missing workspace root' });
  let canonicalWorkspace;
  const lexicalWorkspace = path.resolve(workspaceRoot);
  try {
    canonicalWorkspace = realpathSync(workspaceRoot);
  } catch {
    return Object.freeze({ ok: false, reason: 'canonical workspace root unavailable' });
  }
  const absolutePath = path.resolve(workspaceRoot, normalized.path);
  if (!isInsidePath(absolutePath, lexicalWorkspace)) return Object.freeze({ ok: false, reason: 'path escapes workspace' });
  if (!isInsidePath(absolutePath, canonicalWorkspace)) return Object.freeze({ ok: false, reason: 'path escapes workspace' });
  const nearest = nearestExistingPath(absolutePath);
  if (!nearest) return Object.freeze({ ok: false, reason: 'no existing parent for workspace path' });
  let canonicalNearest;
  try {
    canonicalNearest = realpathSync(nearest);
  } catch {
    return Object.freeze({ ok: false, reason: 'canonical nearest parent unavailable' });
  }
  if (!isInsidePath(canonicalNearest, canonicalWorkspace)) return Object.freeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
  if (!allowMissingLeaf && !existsSync(absolutePath)) return Object.freeze({ ok: false, reason: 'path does not exist' });
  if (!allowMissingLeaf) {
    let canonicalTarget;
    try {
      canonicalTarget = realpathSync(absolutePath);
    } catch {
      return Object.freeze({ ok: false, reason: 'canonical target unavailable' });
    }
    if (!isInsidePath(canonicalTarget, canonicalWorkspace)) return Object.freeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
  }
  return Object.freeze({ ok: true, relativePath: normalized.path, absolutePath, workspaceRoot: canonicalWorkspace });
}

function evaluateGitCommand(command) {
  if (!/\bgit\b/i.test(command)) return Object.freeze({ git: false, forbidden: false });
  if (/[;&|`<>\n\r]/.test(command)) return Object.freeze({ git: true, forbidden: true });
  const tokens = command.trim().split(/\s+/);
  const gitIndex = tokens.findIndex((token) => token === 'git' || /(?:^|[\\/])git(?:\.exe)?$/i.test(token));
  if (gitIndex < 0) return Object.freeze({ git: true, forbidden: true });
  const args = tokens.slice(gitIndex + 1);
  if (args.length === 0) return Object.freeze({ git: true, forbidden: true });
  if (args[0]?.startsWith('-')) return Object.freeze({ git: true, forbidden: true });
  const allowed = ['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files'];
  return Object.freeze({ git: true, forbidden: !allowed.includes(args[0]) });
}

function hasForbiddenCommand(commandText) {
  const text = String(commandText || '');
  return /[<>`|;&\n\r]/.test(text)
    || /\b(?:Out-File|Set-Content|Add-Content|Tee-Object)\b/i.test(text)
    || /https?:\/\//i.test(text)
    || /\b(?:curl(?:\.exe)?|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(text)
    || /\bgh\s+pr\b/i.test(text)
    || /\brelease\s+approval\b/i.test(text)
    || /\bnpm\s+(?:install|i|ci|update)\b/i.test(text)
    || /\bpnpm\s+(?:install|i|add|update)\b/i.test(text)
    || /\byarn\s+(?:add|install|upgrade)\b/i.test(text)
    || /\b(?:pip|python\s+-m\s+pip|python3\s+-m\s+pip)\s+install\b/i.test(text)
    || /\bpoetry\s+(?:add|install|update)\b/i.test(text)
    || /\buv\s+(?:add|sync|pip\s+install)\b/i.test(text)
    || /\bcargo\s+(?:add|install|update)\b/i.test(text)
    || /\bgo\s+(?:get|install)\b/i.test(text)
    || /\bdotnet\s+(?:add\s+package|restore)\b/i.test(text)
    || /\bdocker\s+(?:pull|push|run|build)\b/i.test(text)
    || /\bkubectl\b/i.test(text)
    || /\bRemove-Item\b(?=.*\s-Recurse\b)/i.test(text)
    || /\brm\s+-rf\b/i.test(text)
    || /\b(?:rmdir|del|format|drop|truncate)\b/i.test(text)
    || /\bproduction\b/i.test(text);
}

function isPlannedRepairWrite(relativePath, repairWritePlan) {
  if (!nonEmptyString(relativePath) || isForbiddenRepairSurface(relativePath) || !Array.isArray(repairWritePlan)) return false;
  return repairWritePlan.some((entry) => {
    if (!entry || typeof entry !== 'object' || !['product-source', 'product-test'].includes(entry.kind)) return false;
    const normalized = normalizeTargetRelativePath(entry.relativePath);
    return normalized.ok && normalized.path === relativePath && !isForbiddenRepairSurface(normalized.path);
  });
}

function isForbiddenRepairSurface(relativePath) {
  const lower = String(relativePath || '').toLowerCase();
  const basename = path.posix.basename(lower);
  if (lower.startsWith('.opencode/') || lower.startsWith('docs/') || lower.startsWith('config/') || lower.includes('/config/')) return true;
  return ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json', 'requirements.txt', 'poetry.lock', 'pyproject.toml', 'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.gitignore', '.gitattributes', 'tsconfig.json', 'vite.config.js', 'vite.config.ts', 'webpack.config.js', 'rollup.config.js', 'eslint.config.js', '.env', '.env.local'].includes(basename)
    || /(?:^|\/)(?:[^/]*config[^/]*\.(?:js|cjs|mjs|ts|json|yaml|yml|toml)|\.[^/]*rc(?:\..*)?)$/i.test(lower);
}

function resolveCleanupPath({ workspaceRoot, relativePath }) {
  const normalized = normalizeTargetRelativePath(relativePath);
  if (!normalized.ok) return normalized;
  const root = resolveWorkspaceRoot(workspaceRoot);
  if (!root.ok) return root;
  const absolutePath = path.resolve(workspaceRoot, normalized.path);
  if (!isInsidePath(absolutePath, root.lexicalWorkspace)) return Object.freeze({ ok: false, reason: 'path escapes workspace' });
  let stats;
  try {
    stats = lstatSync(absolutePath);
  } catch {
    return Object.freeze({ ok: false, reason: 'path does not exist' });
  }
  const nearestParent = path.dirname(absolutePath);
  let canonicalParent;
  try {
    canonicalParent = realpathSync(nearestParent);
  } catch {
    return Object.freeze({ ok: false, reason: 'canonical parent unavailable' });
  }
  if (!isInsidePath(canonicalParent, root.workspaceRoot)) return Object.freeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
  if (!stats.isSymbolicLink()) {
    let canonicalTarget;
    try {
      canonicalTarget = realpathSync(absolutePath);
    } catch {
      return Object.freeze({ ok: false, reason: 'canonical target unavailable' });
    }
    if (!isInsidePath(canonicalTarget, root.workspaceRoot)) return Object.freeze({ ok: false, reason: 'symlink/junction/realpath escape outside workspace' });
  }
  return Object.freeze({ ok: true, relativePath: normalized.path, absolutePath, workspaceRoot: root.workspaceRoot });
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!nonEmptyString(workspaceRoot)) return Object.freeze({ ok: false, reason: 'missing workspace root' });
  try {
    return Object.freeze({ ok: true, workspaceRoot: realpathSync(workspaceRoot), lexicalWorkspace: path.resolve(workspaceRoot) });
  } catch {
    return Object.freeze({ ok: false, reason: 'canonical workspace root unavailable' });
  }
}

function normalizeTargetRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return Object.freeze({ ok: false, reason: 'empty path' });
  if (filePath.includes('\0')) return Object.freeze({ ok: false, reason: 'NUL byte in path' });
  const slashPath = filePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || /^[A-Za-z]:/.test(slashPath)) return Object.freeze({ ok: false, reason: 'absolute, drive-qualified, or UNC path' });
  const segments = slashPath.split('/');
  if (segments.some((segment) => segment === '..')) return Object.freeze({ ok: false, reason: 'traversal segment' });
  const normalizedSegments = segments.filter((segment) => segment.length > 0 && segment !== '.');
  if (normalizedSegments.length === 0) return Object.freeze({ ok: false, reason: 'empty normalized path' });
  return Object.freeze({ ok: true, path: normalizedSegments.join('/') });
}

function isGeneratedValidationRootOrDescendant(relativePath) {
  return relativePath === 'tmp/generated-validation' || isGeneratedValidationDescendant(relativePath);
}

function isGeneratedValidationDescendant(relativePath) {
  return nonEmptyString(relativePath) && relativePath.startsWith('tmp/generated-validation/') && relativePath.length > 'tmp/generated-validation/'.length;
}

function collapseCleanupPaths(relativePaths) {
  const unique = [...new Set(relativePaths)].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
  const selected = [];
  for (const relativePath of unique) {
    if (!selected.some((ancestor) => relativePath === ancestor || relativePath.startsWith(`${ancestor}/`))) selected.push(relativePath);
  }
  return selected;
}

function generatedValidationResidue(workspaceRoot) {
  const root = resolveCleanupPath({ workspaceRoot, relativePath: 'tmp/generated-validation' });
  if (!root.ok) {
    return root.reason === 'path does not exist'
      ? []
      : [`unsafe generated-validation root: ${root.reason}`];
  }
  const stats = lstatSync(root.absolutePath);
  const rootType = stats.isSymbolicLink() ? 'symlink' : (stats.isDirectory() ? 'directory' : 'file');
  if (stats.isDirectory() && readdirSync(root.absolutePath).length === 0) return [];
  const entries = stats.isDirectory()
    ? listFiles(root.absolutePath).map((entry) => `tmp/generated-validation/${entry}`)
    : [];
  return [`tmp/generated-validation <${rootType}>`, ...entries];
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

function removeEmptyParents({ workspaceRoot, startDirectory }) {
  const canonicalWorkspace = realpathSync(workspaceRoot);
  let current = startDirectory;
  while (isInsidePath(current, canonicalWorkspace) && path.resolve(current) !== path.resolve(canonicalWorkspace)) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

function isInsidePath(candidatePath, parentPath) {
  const candidate = path.resolve(candidatePath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, candidate);
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
