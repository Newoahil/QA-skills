import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { createImmutableRunStore, createRedactor } from './artifact-store.mjs';
import { canonicalizeJson, sha256CanonicalJson, validateQaCrMaturityManifest } from './case-manifest.mjs';
import { parseJsonlStrict } from '../../functional-validation/harness.mjs';
import { aggregateRunTelemetryV2, collectChildSessionTelemetryV2, collectEmitTimingV2, collectParentSessionTelemetryV2 } from './collect-run-telemetry-v2.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';
import { buildEvidenceEnvelopeV2, replaySealedRunV2 } from './evidence-envelope-v2.mjs';
import { buildScoreInputFactsV2 } from './score-input-facts-v2.mjs';
import { hashArtifactRootPathV2, sha256CanonicalValueV2, validateAttemptAuthorizationV2, validateProbeV2, validateRuntimePinV2 } from './runtime-pin-v2.mjs';
import { lookupParentExportRunProfile, validateParentExportProbeBindings } from './parent-export-run-profiles.mjs';
import { validateCredentialReadinessAttestationV3, validateNoPersistedSecretsOrPathsV3 } from './credential-readiness-v3.mjs';

export const PRIMARY_RUN_IDENTITY_V2_KEYS = [
  'artifactRootPathSha256', 'attempt', 'authorizationSha256', 'candidateDiffSha256', 'caseId', 'caseSha256', 'expectedExecutableSha256', 'expectedRuntimeVersion',
  'fixtureTreeSha256', 'manifestSha256', 'modelId', 'probeId', 'probeSha256', 'providerId', 'promptSha256', 'qaAgentSha256', 'qaCrAgentSha256', 'qaSkillTreeSha256', 'retryPolicy', 'runId', 'scopeSha256',
];

const SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;
const SAFE_CODE_RE = /^[a-z][a-z0-9_:-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SIGNAL_RE = /^[A-Z][A-Z0-9_-]{0,31}$/;
function profileForProbeId(probeId) {
  return lookupParentExportRunProfile(probeId);
}

function runIdRegexForProfile(profile) {
  return new RegExp(`^${profile.runPrefix}[a-f0-9]{24}$`);
}

function buildAuthorizationContext(runSpec, rootHash, probeSha256) {
  const base = {
    probeId: runSpec.probe.probeID,
    probeSha256,
    manifestSha256: runSpec.manifestSha256,
    scopeSha256: runSpec.scopeSha256,
    caseId: runSpec.caseId,
    caseSha256: runSpec.caseSha256,
    fixtureTreeSha256: runSpec.fixtureTreeSha256,
    candidateDiffSha256: runSpec.candidateDiffSha256,
    promptSha256: runSpec.promptSha256,
    qaSkillTreeSha256: runSpec.qaSkillTreeSha256,
    qaAgentSha256: runSpec.qaAgentSha256,
    qaCrAgentSha256: runSpec.qaCrAgentSha256,
    providerId: runSpec.providerId,
    modelId: runSpec.modelId,
    expectedRuntimeVersion: runSpec.expectedRuntimeVersion,
    expectedExecutableSha256: runSpec.expectedExecutableSha256,
    artifactRootPathSha256: rootHash,
  };
  if (!runSpec.credentialReadiness) return base;
  return {
    ...base,
    configProfileSchemaVersion: runSpec.credentialReadiness.configProfile.schemaVersion,
    configResolutionMethod: runSpec.credentialReadiness.configProfile.source,
    configSelection: runSpec.credentialReadiness.configProfile.selection,
    resolvedConfigProfileSha256: runSpec.credentialReadiness.configProfileSha256,
    providerEndpointOriginPathSha256: runSpec.credentialReadiness.configProfile.providerEndpointOriginPathSha256,
    readinessAttestationSchemaVersion: runSpec.credentialReadiness.schemaVersion,
    readinessAttestationId: runSpec.credentialReadiness.attestationId,
    readinessMethod: runSpec.credentialReadiness.check.method,
    readinessPathSuffix: runSpec.credentialReadiness.check.pathSuffix,
    readinessRequiredStatus: runSpec.credentialReadiness.check.httpStatus,
    readinessRequiredModelId: runSpec.credentialReadiness.check.requiredModelId,
    readinessMaxAgeMs: 60000,
  };
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value), Buffer.isBuffer(value) ? undefined : 'utf8').digest('hex');
}

function controlledCode(code, fallback) {
  return typeof code === 'string' && SAFE_CODE_RE.test(code) ? code : fallback;
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function normalizeHash(value) {
  return isSha256(value) ? value : null;
}

function normalizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeSignal(value) {
  return typeof value === 'string' && SIGNAL_RE.test(value) ? value : null;
}

function normalizeRunnerErrorCode(value) {
  return value === 'runner_throw' ? value : null;
}

function buildIdentityBoundFields(spec) {
  return {
    probeSha256: sha256CanonicalJson(spec.probe),
    authorizationSha256: sha256CanonicalJson(spec.authorization),
    manifestSha256: spec.manifestSha256,
    scopeSha256: spec.scopeSha256,
    caseSha256: spec.caseSha256,
    fixtureTreeSha256: spec.fixtureTreeSha256,
    candidateDiffSha256: spec.candidateDiffSha256,
    promptSha256: spec.promptSha256,
    qaSkillTreeSha256: spec.qaSkillTreeSha256,
    qaAgentSha256: spec.qaAgentSha256,
    qaCrAgentSha256: spec.qaCrAgentSha256,
    providerId: spec.providerId,
    modelId: spec.modelId,
    expectedRuntimeVersion: spec.expectedRuntimeVersion,
    expectedExecutableSha256: spec.expectedExecutableSha256,
    artifactRootPathSha256: spec.artifactRootPathSha256,
    attempt: 1,
    retryPolicy: 'none',
  };
}

function ensureArtifactRoot(artifactRoot) {
  try {
    if (typeof artifactRoot !== 'string' || !path.isAbsolute(artifactRoot)) throw new Error('artifact_root_invalid');
    const lst = lstatSync(artifactRoot);
    if (lst.isSymbolicLink()) throw new Error('artifact_root_invalid');
    if (!statSync(artifactRoot).isDirectory()) throw new Error('artifact_root_invalid');
  } catch (error) {
    if (error?.message === 'artifact_root_invalid') throw error;
    throw new Error('artifact_root_invalid');
  }
}

function ensureCase(manifest, caseId) {
  return Array.isArray(manifest?.cases) ? manifest.cases.find((entry) => entry?.id === caseId) ?? null : null;
}

function productCompositeSha256(spec) {
  return sha256CanonicalValueV2({ fixtureTreeSha256: spec.fixtureTreeSha256, candidateDiffSha256: spec.candidateDiffSha256 });
}

export function buildPrimaryRunIdentityV2(spec) {
  const profile = profileForProbeId(spec?.probe?.probeID);
  if (!profile) throw new Error('invalid_probe_profile');
  const bound = buildIdentityBoundFields(spec);
  const suffix = bound.authorizationSha256.slice(0, 24);
  return {
    ...bound,
    probeId: spec.probe.probeID,
    caseId: spec.caseId,
    runId: `${profile.runPrefix}${suffix}`,
  };
}

function safeText(text) {
  return typeof text === 'string' ? text : '';
}

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function passthroughStoreRedactor(baseRedactor) {
  return Object.freeze({
    redactText(value) {
      return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
    },
    redactJson(value) {
      return value;
    },
    scan(bytes) {
      return baseRedactor.scan(bytes);
    },
  });
}

function writeRedactedText(store, redactor, relativePath, text, kind) {
  return store.writeText(relativePath, redactor.redactText(text), kind);
}

function writeRedactedJsonl(store, redactor, relativePath, text, kind) {
  const lines = safeText(text).split(/\r?\n/);
  const redacted = lines.map((line) => {
    if (line.length === 0) return line;
    try {
      return JSON.stringify(redactor.redactJson(JSON.parse(line)));
    } catch {
      return redactor.redactText(line);
    }
  }).join('\n');
  return store.writeText(relativePath, redacted, kind);
}

function writeRedactedJson(store, redactor, relativePath, value, kind) {
  return store.writeJson(relativePath, redactor.redactJson(value), kind);
}

export function sanitizeObservationV2(observation) {
  const source = observation && typeof observation === 'object' ? observation : {};
  const terminal = source.terminal && typeof source.terminal === 'object' && !Array.isArray(source.terminal) ? source.terminal : {};
  const terminalKeys = Object.keys(terminal).sort();
  const exactTerminalKeys = JSON.stringify(terminalKeys) === JSON.stringify(['errorCode', 'exitCode', 'signal', 'timedOut']);
  const normalizedSignal = normalizeSignal(terminal.signal);
  const normalizedErrorCode = terminal.errorCode == null ? null : (typeof terminal.errorCode === 'string' && SAFE_CODE_RE.test(terminal.errorCode) ? terminal.errorCode : 'terminal_error_uncontrolled');
  const signalInvalid = terminal.signal != null && normalizedSignal == null;
  const exitCode = Number.isInteger(terminal.exitCode) ? terminal.exitCode : null;
  const timedOut = terminal.timedOut === true;
  const terminalShapeValid = exactTerminalKeys
    && (terminal.exitCode === null || Number.isInteger(terminal.exitCode))
    && (terminal.signal === null || normalizedSignal != null)
    && typeof terminal.timedOut === 'boolean'
    && (terminal.errorCode === null || SAFE_CODE_RE.test(terminal.errorCode));
  const successTuple = exitCode === 0 && normalizedSignal === null && (normalizedErrorCode ?? (signalInvalid ? 'terminal_error_uncontrolled' : null)) === null && timedOut === false;
  const failureTuple = exitCode === null && (normalizedSignal !== null || normalizedErrorCode !== null || timedOut === true);
  return {
    terminal: {
      exitCode,
      signal: normalizedSignal,
      errorCode: normalizedErrorCode ?? (signalInvalid ? 'terminal_error_uncontrolled' : null),
      timedOut,
    },
    terminalContractStatus: terminalShapeValid && (successTuple || failureTuple || (exitCode !== null && exitCode !== 0)) ? 'VALID' : 'INVALID',
    commandHash: typeof source.command === 'string' ? sha256(source.command) : normalizeHash(source.commandHash),
    runnerErrorCode: normalizeRunnerErrorCode(source.runnerErrorCode),
    postflightIssueCodes: [...new Set((Array.isArray(source.postflightIssueCodes) ? source.postflightIssueCodes : []).map((code) => controlledCode(code, null)).filter(Boolean))].sort(),
    runtimeCleanupStatus: source.runtimeCleanupStatus === 'SUCCESS' || source.runtimeCleanupStatus === 'FAILED' ? source.runtimeCleanupStatus : 'FAILED',
    runtimeCleanupSucceeded: typeof source.runtimeCleanupSucceeded === 'boolean' ? source.runtimeCleanupSucceeded : false,
    observed: {
      manifestSha256: normalizeHash(source.manifestSha256),
      scopeSha256: normalizeHash(source.scopeSha256),
      caseSha256: normalizeHash(source.caseSha256),
      promptSha256: normalizeHash(source.promptSha256),
      qaSkillTreeSha256Before: normalizeHash(source.qaSkillTreeSha256Before),
      qaSkillTreeSha256After: normalizeHash(source.qaSkillTreeSha256After),
      qaAgentSha256Before: normalizeHash(source.qaAgentSha256Before),
      qaAgentSha256After: normalizeHash(source.qaAgentSha256After),
      qaCrAgentSha256Before: normalizeHash(source.qaCrAgentSha256Before),
      qaCrAgentSha256After: normalizeHash(source.qaCrAgentSha256After),
      fixtureTreeSha256Before: normalizeHash(source.fixtureTreeSha256Before),
      fixtureTreeSha256After: normalizeHash(source.fixtureTreeSha256After),
      candidateDiffSha256Before: normalizeHash(source.candidateDiffSha256Before),
      candidateDiffSha256After: normalizeHash(source.candidateDiffSha256After),
      productCompositeSha256Before: normalizeHash(source.productCompositeSha256Before),
      productCompositeSha256After: normalizeHash(source.productCompositeSha256After),
      executableSha256Before: normalizeHash(source.executableSha256Before),
      executableSha256After: normalizeHash(source.executableSha256After),
      parentRunCount: normalizeCount(source.parentRunCount),
      parentExportCount: normalizeCount(source.parentExportCount),
      childExportCount: normalizeCount(source.childExportCount),
      sameEnvironment: typeof source.sameEnvironment === 'boolean' ? source.sameEnvironment : null,
      sameWorkingDirectory: typeof source.sameWorkingDirectory === 'boolean' ? source.sameWorkingDirectory : null,
      envIdentitySha256: normalizeHash(source.envIdentitySha256),
      cwdIdentitySha256: normalizeHash(source.cwdIdentitySha256),
    },
  };
}

export function validateRunObservationV2(observation) {
  const ok = exactKeys(observation, ['commandHash', 'observed', 'postflightIssueCodes', 'runnerErrorCode', 'runtimeCleanupStatus', 'runtimeCleanupSucceeded', 'terminal', 'terminalContractStatus'])
    && exactKeys(observation.terminal, ['errorCode', 'exitCode', 'signal', 'timedOut'])
    && exactKeys(observation.observed, [
      'candidateDiffSha256After', 'candidateDiffSha256Before', 'caseSha256', 'childExportCount', 'cwdIdentitySha256', 'envIdentitySha256', 'executableSha256After', 'executableSha256Before',
      'fixtureTreeSha256After', 'fixtureTreeSha256Before', 'manifestSha256', 'parentExportCount', 'parentRunCount', 'productCompositeSha256After', 'productCompositeSha256Before', 'promptSha256',
      'qaSkillTreeSha256After', 'qaSkillTreeSha256Before',
      'qaAgentSha256After', 'qaAgentSha256Before', 'qaCrAgentSha256After', 'qaCrAgentSha256Before', 'sameEnvironment', 'sameWorkingDirectory', 'scopeSha256',
    ])
    && (observation.terminalContractStatus === 'VALID' || observation.terminalContractStatus === 'INVALID')
    && Array.isArray(observation.postflightIssueCodes)
    && observation.postflightIssueCodes.every((code) => typeof code === 'string' && SAFE_CODE_RE.test(code))
    && (observation.runnerErrorCode === null || observation.runnerErrorCode === 'runner_throw')
    && (observation.runtimeCleanupStatus === 'SUCCESS' || observation.runtimeCleanupStatus === 'FAILED')
    && typeof observation.runtimeCleanupSucceeded === 'boolean'
    && (observation.terminal.exitCode === null || Number.isInteger(observation.terminal.exitCode))
    && (observation.terminal.signal === null || (typeof observation.terminal.signal === 'string' && SIGNAL_RE.test(observation.terminal.signal)))
    && typeof observation.terminal.timedOut === 'boolean'
    && (observation.terminal.errorCode === null || SAFE_CODE_RE.test(observation.terminal.errorCode))
    && (observation.commandHash === null || (typeof observation.commandHash === 'string' && SHA256_RE.test(observation.commandHash)))
    && Object.entries(observation.observed).every(([key, value]) => (
      key === 'sameEnvironment' || key === 'sameWorkingDirectory'
    ) ? (value === null || typeof value === 'boolean') : (
      key === 'parentRunCount' || key === 'parentExportCount' || key === 'childExportCount'
    ) ? (value === null || (Number.isInteger(value) && value >= 0)) : (value === null || (typeof value === 'string' && SHA256_RE.test(value))));
  return ok;
}

function parsePersistedJson(filePath) {
  try { return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) }; } catch { return { ok: false, value: null }; }
}

export function exportObservation(sessionId, status, errorCode = null) {
  const safeStatus = ['OK', 'FAILED', 'MISSING', 'MALFORMED'].includes(status) ? status : 'MALFORMED';
  const safeErrorCode = errorCode == null ? null : controlledCode(errorCode, 'export_observation_invalid');
  return {
    sessionId: typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId) ? sessionId : null,
    status: safeStatus,
    errorCode: safeStatus === 'OK' && safeErrorCode === 'export_observation_invalid' && errorCode == null ? null : safeErrorCode,
  };
}

function validateRunSpecV2(runSpec, artifactRoot) {
  const profile = profileForProbeId(runSpec?.probe?.probeID);
  if (!profile) return false;
  const expectedKeys = profile.probeId === 'qa-cr-b2-parent-export-v3'
    ? [
      'artifactRootPathSha256', 'authorization', 'candidateDiffSha256', 'caseId', 'credentialReadiness', 'expectedExecutableSha256', 'expectedRuntimeVersion', 'fixtureTreeSha256',
      'manifest', 'manifestSha256', 'caseSha256', 'modelId', 'promptSha256', 'promptText', 'probe', 'providerId', 'qaAgentSha256', 'qaCrAgentSha256', 'qaSkillTreeSha256', 'scopeSha256',
    ]
    : [
      'artifactRootPathSha256', 'authorization', 'candidateDiffSha256', 'caseId', 'expectedExecutableSha256', 'expectedRuntimeVersion', 'fixtureTreeSha256',
      'manifest', 'manifestSha256', 'caseSha256', 'modelId', 'promptSha256', 'promptText', 'probe', 'providerId', 'qaAgentSha256', 'qaCrAgentSha256', 'qaSkillTreeSha256', 'scopeSha256',
    ];
  if (!exactKeys(runSpec, expectedKeys)) return false;
  if (!runSpec.probe || typeof runSpec.probe !== 'object' || Array.isArray(runSpec.probe)) return false;
  if (!runSpec.authorization || typeof runSpec.authorization !== 'object' || Array.isArray(runSpec.authorization)) return false;
  const caseValue = ensureCase(runSpec.manifest, runSpec.caseId);
  const hashes = [runSpec.scopeSha256, runSpec.promptSha256, runSpec.qaSkillTreeSha256, runSpec.qaAgentSha256, runSpec.qaCrAgentSha256, runSpec.fixtureTreeSha256, runSpec.candidateDiffSha256, runSpec.expectedExecutableSha256, runSpec.artifactRootPathSha256, runSpec.manifestSha256, runSpec.caseSha256];
  return hashes.every((value) => typeof value === 'string' && SHA256_RE.test(value))
    && runSpec.probe?.probeID === profile.probeId
    && runSpec.caseId === profile.caseId
    && !!caseValue
    && runSpec.manifestSha256 === sha256CanonicalJson(runSpec.manifest)
    && runSpec.caseSha256 === sha256CanonicalJson(caseValue)
    && runIdRegexForProfile(profile).test(buildPrimaryRunIdentityV2(runSpec).runId)
    && runSpec.providerId === profile.providerId
    && runSpec.modelId === profile.modelId
    && runSpec.expectedRuntimeVersion === profile.directExecutableVersion
    && sha256(runSpec.promptText) === runSpec.promptSha256
    && (profile.probeId !== 'qa-cr-b2-parent-export-v3' || !!runSpec.credentialReadiness)
    && validateParentExportProbeBindings({ probe: runSpec.probe, authorization: runSpec.authorization, expectedExecutableSha256: runSpec.expectedExecutableSha256, artifactRootPathSha256: runSpec.artifactRootPathSha256 }).ok;
}

export async function executePrimaryRunV2({ artifactRoot, runSpec, sensitiveValues = [], runner, now = new Date() }) {
  ensureArtifactRoot(artifactRoot);
  if (!validateRunSpecV2(runSpec, artifactRoot)) throw new Error('invalid_run_spec');
  const profile = profileForProbeId(runSpec.probe.probeID);
  const manifestValidation = validateQaCrMaturityManifest(runSpec.manifest);
  if (!manifestValidation.ok) throw new Error('invalid_manifest');
  const probeValidation = validateProbeV2(runSpec.probe, {
    manifestId: runSpec.manifest.manifestId,
    scopeId: runSpec.manifest.scopeContract.version,
    expectedRuntimeVersion: runSpec.expectedRuntimeVersion,
    providerId: runSpec.providerId,
    modelId: runSpec.modelId,
    agentParent: profile.parentAgent,
    agentChild: profile.childAgent,
  });
  if (probeValidation.probeStatus !== 'VALID') throw new Error('probe_invalid');
  const caseValue = ensureCase(runSpec.manifest, runSpec.caseId);
  if (!caseValue) throw new Error('case_missing');
  const caseSha256 = sha256CanonicalJson(caseValue);
  const manifestSha256 = manifestValidation.manifestHash;
  if (runSpec.manifestSha256 !== manifestSha256 || runSpec.caseSha256 !== caseSha256) throw new Error('run_spec_hash_mismatch');
  const rootHash = hashArtifactRootPathV2(path.resolve(artifactRoot));
  if (rootHash !== runSpec.artifactRootPathSha256) throw new Error('artifact_root_hash_mismatch');
  if (profile.probeId === 'qa-cr-b2-parent-export-v3') {
    if (!validateNoPersistedSecretsOrPathsV3(runSpec.probe).ok) throw new Error('probe_binding_invalid');
    const readinessValidation = validateCredentialReadinessAttestationV3(runSpec.credentialReadiness, {
      profileSha256: runSpec.credentialReadiness?.configProfileSha256,
      now,
      maxAgeMs: profile.readinessPolicy.maxAgeMs,
    });
    if (!readinessValidation.ok) throw new Error('credential_readiness_invalid');
    if (!validateParentExportProbeBindings({ probe: runSpec.probe, authorization: runSpec.authorization, expectedExecutableSha256: runSpec.expectedExecutableSha256, artifactRootPathSha256: runSpec.artifactRootPathSha256 }).ok) throw new Error('probe_binding_invalid');
  }
  const identity = buildPrimaryRunIdentityV2({ ...runSpec, artifactRootPathSha256: rootHash });
  if (profile.probeId === 'qa-cr-b2-parent-export-v3' && !validateParentExportProbeBindings({ probe: runSpec.probe, authorization: runSpec.authorization, identity, expectedExecutableSha256: runSpec.expectedExecutableSha256, artifactRootPathSha256: rootHash }).ok) throw new Error('probe_binding_invalid');
  const authorizationValidation = validateAttemptAuthorizationV2(runSpec.authorization, buildAuthorizationContext({ ...runSpec, manifestSha256, caseSha256 }, rootHash, sha256CanonicalJson(runSpec.probe)));
  if (authorizationValidation.validationStatus !== 'AUTHORIZED') throw new Error('authorization_invalid');
  const redactor = createRedactor({ sensitiveValues });
  const store = createImmutableRunStore({ artifactRoot, runId: identity.runId, redactor: passthroughStoreRedactor(redactor) });
  store.writeJson('probe.json', runSpec.probe, 'probe');
  store.writeJson('attempt-authorization.json', runSpec.authorization, 'authorization');
  if (profile.probeId === 'qa-cr-b2-parent-export-v3') store.writeJson('credential-readiness.json', runSpec.credentialReadiness, 'credential-readiness');
  writeRedactedText(store, redactor, 'inputs/prompt.txt', runSpec.promptText, 'prompt');
  store.writeJson('inputs/provenance.json', { identity, manifestSha256, caseSha256 }, 'provenance');

  let result = null;
  let runnerErrorCode = null;
  try {
    result = await runner();
  } catch (error) {
    runnerErrorCode = 'runner_throw';
    result = error?.partialResult && typeof error.partialResult === 'object' ? error.partialResult : {};
  }

  const parentJsonlText = safeText(result?.parentJsonl);
  const parentExportObs = exportObservation(result?.parentExport?.sessionId ?? null, result?.parentExport?.exportStatus ?? 'MISSING', result?.parentExport?.exportErrorCode ?? null);
  const childExports = Array.isArray(result?.childExports) ? result.childExports : [];
  const runtimePinCandidate = result?.runtimePin && typeof result.runtimePin === 'object' ? result.runtimePin : {
    schemaVersion: 'qa-cr-runtime-pin-v1', basename: null, pathSha256: null, bytes: null, sha256Before: null, sha256After: null,
    observedVersion: null, expectedVersion: runSpec.expectedRuntimeVersion, expectedSha256: runSpec.expectedExecutableSha256, eligibilityStatus: 'INELIGIBLE', issueCodes: ['runtime_pin_missing'],
  };
  const runtimePinValidation = validateRuntimePinV2(runtimePinCandidate, { expectedExecutableSha256: runSpec.expectedExecutableSha256 });
  const runtimePin = runtimePinValidation.validationStatus === 'VALID'
    ? { ...runtimePinCandidate }
    : {
      schemaVersion: 'qa-cr-runtime-pin-v1', basename: null, pathSha256: null, bytes: null, sha256Before: null, sha256After: null,
      observedVersion: null, expectedVersion: runSpec.expectedRuntimeVersion, expectedSha256: runSpec.expectedExecutableSha256, eligibilityStatus: 'INELIGIBLE', issueCodes: ['runtime_pin_invalid'],
    };
  const observation = sanitizeObservationV2(result?.observation);

  store.writeJson('runtime-pin.json', runtimePin, 'runtime-pin');
  writeRedactedJsonl(store, redactor, 'parent-events.jsonl', parentJsonlText, 'parent-jsonl');
  writeRedactedText(store, redactor, 'parent-export.json', safeText(result?.parentExport?.exportText), 'parent-export');
  writeRedactedJson(store, redactor, 'parent-export-observation.json', parentExportObs, 'parent-export-observation');
  childExports.forEach((entry, index) => {
    const id = String(index).padStart(3, '0');
    writeRedactedText(store, redactor, `child-exports/${id}.json`, safeText(entry?.exportText), 'child-export');
    writeRedactedJson(store, redactor, `child-export-observations/${id}.json`, exportObservation(entry?.sessionId ?? null, entry?.exportStatus ?? 'MISSING', entry?.exportErrorCode ?? null), 'child-export-observation');
  });
  writeRedactedJson(store, redactor, 'run-observation.json', { ...observation, runnerErrorCode: normalizeRunnerErrorCode(runnerErrorCode) ?? observation.runnerErrorCode }, 'run-observation');

  const parsedParent = parseJsonlStrict(Buffer.from(readFileSync(path.join(store.runDirectory, 'parent-events.jsonl'))));
  const persistedParentExport = parsePersistedJson(path.join(store.runDirectory, 'parent-export.json'));
  const parent = collectParentSessionTelemetryV2({
    events: parsedParent.events,
    exportJson: persistedParentExport.ok ? persistedParentExport.value : null,
    exportStatus: parentExportObs.status === 'MISSING' ? 'MISSING' : persistedParentExport.ok ? parentExportObs.status : 'MALFORMED',
    exportErrorCode: parentExportObs.errorCode ?? undefined,
    expectedSessionId: result?.parentExport?.sessionId ?? null,
    expectedRuntimeVersion: runSpec.expectedRuntimeVersion,
    expectedProviderId: runSpec.providerId,
    expectedModelId: runSpec.modelId.split('/').slice(1).join('/'),
    expectedAgent: 'qa',
    expectedMode: 'qa',
    jsonlSourceArtifact: store.inventory().find((entry) => entry.path === 'parent-events.jsonl') ?? null,
    exportSourceArtifact: store.inventory().find((entry) => entry.path === 'parent-export.json') ?? null,
  });
  const childObservations = childExports.map((entry) => exportObservation(entry?.sessionId ?? null, entry?.exportStatus ?? 'MISSING', entry?.exportErrorCode ?? null));
  const expectedChildSessionIds = extractQaCrChildSessionIds(parsedParent.events);
  const children = childExports.map((entry, index) => {
    const parsed = parsePersistedJson(path.join(store.runDirectory, `child-exports/${String(index).padStart(3, '0')}.json`));
    const observed = childObservations[index];
    return collectChildSessionTelemetryV2({
      exportJson: parsed.ok ? parsed.value : null,
      exportStatus: observed.status === 'MISSING' ? 'MISSING' : parsed.ok ? observed.status : 'MALFORMED',
      exportErrorCode: observed.errorCode ?? undefined,
      expectedSessionId: expectedChildSessionIds[index] ?? observed.sessionId,
      expectedParentSessionId: parent.sessionId,
      expectedRuntimeVersion: runSpec.expectedRuntimeVersion,
      expectedProviderId: runSpec.providerId,
      expectedModelId: runSpec.modelId.split('/').slice(1).join('/'),
      expectedAgent: 'qa-cr',
      expectedMode: 'qa-cr',
      sourceArtifact: store.inventory().find((item) => item.path === `child-exports/${String(index).padStart(3, '0')}.json`) ?? null,
    });
  });
  const telemetry = { schemaVersion: 'qa-cr-run-telemetry-v2', parent, children, aggregate: aggregateRunTelemetryV2({ parent, children, expectedChildSessionIds }), emitTiming: collectEmitTimingV2(parsedParent.events) };
  writeRedactedJson(store, redactor, 'telemetry.json', telemetry, 'telemetry');
  const facts = buildScoreInputFactsV2({
    identity,
    probe: probeValidation,
    authorization: authorizationValidation,
    runtimePin: { ...runtimePin, validationStatus: runtimePinValidation.validationStatus },
    parentEvents: parsedParent.events,
    jsonlErrors: parsedParent.errors,
    telemetry,
    observation,
    childArtifacts: [
      ...childExports.map((entry, index) => ({ kind: 'raw', index, sessionId: expectedChildSessionIds[index] ?? null })),
      ...childExports.map((entry, index) => ({ kind: 'observation', index, sessionId: entry?.sessionId ?? null })),
    ],
    parentExportObservation: parentExportObs,
    childExportObservations: childObservations,
    runnerErrorCode,
  });
  writeRedactedJson(store, redactor, 'score-input-facts.json', facts, 'score-input-facts');
  const inventory = store.inventory();
  const envelope = buildEvidenceEnvelopeV2({
    identity,
    probe: runSpec.probe,
    authorization: runSpec.authorization,
    runtimePin,
    inventory,
    telemetryArtifact: inventory.find((entry) => entry.path === 'telemetry.json'),
    factsArtifact: inventory.find((entry) => entry.path === 'score-input-facts.json'),
    capturedAt: new Date(now).toISOString(),
    sealedAt: new Date(now).toISOString(),
  });
  store.writeEnvelope(envelope);
  store.markSealed();
  const replay = replaySealedRunV2({ runDirectory: store.runDirectory });
  return {
    runDirectory: store.runDirectory,
    envelope,
    facts,
    telemetry,
    replay,
    safeDiagnostics: uniqueSafeDiagnostics([runnerErrorCode, ...facts.sourceAuthorityIssueCodes]),
  };
}

function uniqueSafeDiagnostics(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && SAFE_CODE_RE.test(value)))].sort();
}
