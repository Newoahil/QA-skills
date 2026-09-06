import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sha256CanonicalJson } from './case-manifest.mjs';
import { lookupParentExportRunProfile, validateExactParentExportProbe, validateParentExportProbeBindings } from './parent-export-run-profiles.mjs';
import { CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION, READINESS_MAX_AGE_MS, READINESS_METHOD, READINESS_PATH_SUFFIX, READINESS_REQUIRED_STATUS, REQUIRED_MODEL_ID, RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION } from './credential-readiness-v3.mjs';

export const RUNTIME_PIN_V2_SCHEMA_VERSION = 'qa-cr-runtime-pin-v1';
export const ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION = 'qa-cr-real-attempt-authorization-v1';
export const ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION = 'qa-cr-real-attempt-authorization-v2';
export const PROBE_V2_SCHEMA_VERSION = 'qa-cr-b2-probe-v2';
export const ATTEMPT_AUTHORIZATION_V2_KEYS = Object.freeze([
  'schemaVersion', 'authorizationId', 'probeId', 'probeSha256', 'attempt', 'maxAttempts', 'retryPolicy', 'status',
  'manifestSha256', 'scopeSha256', 'caseId', 'caseSha256', 'fixtureTreeSha256', 'candidateDiffSha256', 'promptSha256',
  'qaSkillTreeSha256', 'qaAgentSha256', 'qaCrAgentSha256', 'providerId', 'modelId', 'expectedRuntimeVersion',
  'expectedExecutableSha256', 'artifactRootPathSha256',
]);
export const ATTEMPT_AUTHORIZATION_V3_KEYS = Object.freeze([
  ...ATTEMPT_AUTHORIZATION_V2_KEYS,
  'configProfileSchemaVersion', 'configResolutionMethod', 'configSelection', 'resolvedConfigProfileSha256', 'providerEndpointOriginPathSha256',
  'readinessAttestationSchemaVersion', 'readinessAttestationId', 'readinessMethod', 'readinessPathSuffix', 'readinessRequiredStatus', 'readinessRequiredModelId', 'readinessMaxAgeMs',
]);

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_CODE_RE = /^[a-z][a-z0-9_:-]{0,63}$/;
const VERSION = '1.18.19';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256CanonicalValueV2(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function cleanCode(code) {
  return typeof code === 'string' && SAFE_CODE_RE.test(code) ? code : null;
}

function inspectExecutablePath(executablePath) {
  const issues = [];
  if (typeof executablePath !== 'string' || executablePath.length === 0 || !path.isAbsolute(executablePath)) issues.push('executable_path_not_absolute');
  if (issues.length) return { ok: false, basename: null, bytes: null, sha256: null, issues };
  try {
    const lst = lstatSync(executablePath);
    if (lst.isSymbolicLink()) issues.push('executable_path_symlink');
    const st = statSync(executablePath);
    if (!st.isFile()) issues.push('executable_path_not_regular_file');
    const bytes = readFileSync(executablePath);
    return { ok: issues.length === 0, basename: path.basename(executablePath), bytes: st.size, sha256: sha256Bytes(bytes), issues };
  } catch {
    issues.push('executable_path_unreadable');
    return { ok: false, basename: path.basename(executablePath), bytes: null, sha256: null, issues };
  }
}

function defaultSpawnVersion(executablePath) {
  try {
    const result = spawnSync(executablePath, ['--version'], { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8' });
    if (result.error) return { ok: false, code: result.error.code === 'ETIMEDOUT' ? 'version_spawn_timeout' : 'version_spawn_failed' };
    if (result.status !== 0) return { ok: false, code: 'version_nonzero_exit' };
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    if (stderr.length > 0) return { ok: false, code: 'version_stderr_not_empty' };
    if (stdout !== VERSION) return { ok: false, code: stdout.length === 0 ? 'version_output_missing' : 'version_output_malformed' };
    return { ok: true, observedVersion: stdout };
  } catch {
    return { ok: false, code: 'version_spawn_failed' };
  }
}

export function validateProbeV2(probe, context = {}) {
  const validated = validateExactParentExportProbe(probe);
  const profile = validated.ok ? validated.profile : lookupParentExportRunProfile(probe?.probeID ?? probe?.probeId);
  const ok = validated.ok
    && context.manifestId === probe?.manifestID
    && context.scopeId === probe?.scopeID
    && context.expectedRuntimeVersion === probe?.runtime?.directExecutableVersion
    && context.providerId === probe?.runtime?.providerID
    && context.modelId === `${probe?.runtime?.providerID}/${probe?.runtime?.modelID}`
    && context.modelId === profile?.modelId
    && context.agentParent === probe?.runtime?.parentAgent
    && context.agentChild === probe?.runtime?.childAgent;
  return {
    schemaVersion: profile?.probeSchemaId ?? PROBE_V2_SCHEMA_VERSION,
    probeId: probe?.probeID ?? null,
    probeSha256: ok ? sha256CanonicalJson(probe) : null,
    probeStatus: ok ? 'VALID' : 'INVALID',
    issueCodes: ok ? [] : ['probe_contract_mismatch'],
  };
}

export function validateRuntimePinV2(runtimePin, context = {}) {
  const ok = exactKeys(runtimePin, ['basename', 'bytes', 'eligibilityStatus', 'expectedSha256', 'expectedVersion', 'issueCodes', 'observedVersion', 'pathSha256', 'schemaVersion', 'sha256After', 'sha256Before'])
    && runtimePin.schemaVersion === RUNTIME_PIN_V2_SCHEMA_VERSION
    && (runtimePin.basename === null || typeof runtimePin.basename === 'string')
    && (runtimePin.pathSha256 === null || SHA256_RE.test(runtimePin.pathSha256))
    && (runtimePin.bytes === null || (Number.isInteger(runtimePin.bytes) && runtimePin.bytes > 0))
    && (runtimePin.sha256Before === null || SHA256_RE.test(runtimePin.sha256Before))
    && (runtimePin.sha256After === null || SHA256_RE.test(runtimePin.sha256After))
    && runtimePin.expectedVersion === VERSION
    && runtimePin.expectedSha256 === context.expectedExecutableSha256
    && SHA256_RE.test(runtimePin.expectedSha256)
    && (runtimePin.observedVersion === null || runtimePin.observedVersion === VERSION)
    && (runtimePin.eligibilityStatus === 'ELIGIBLE' || runtimePin.eligibilityStatus === 'INELIGIBLE')
    && Array.isArray(runtimePin.issueCodes)
    && runtimePin.issueCodes.every((code) => typeof code === 'string' && SAFE_CODE_RE.test(code));
  const eligible = ok
    && runtimePin.eligibilityStatus === 'ELIGIBLE'
    && typeof runtimePin.basename === 'string' && runtimePin.basename.length > 0
    && typeof runtimePin.pathSha256 === 'string' && SHA256_RE.test(runtimePin.pathSha256)
    && Number.isInteger(runtimePin.bytes) && runtimePin.bytes > 0
    && runtimePin.observedVersion === VERSION
    && runtimePin.expectedVersion === VERSION
    && runtimePin.sha256Before === context.expectedExecutableSha256
    && runtimePin.sha256After === context.expectedExecutableSha256
    && runtimePin.issueCodes.length === 0;
  return {
    schemaVersion: RUNTIME_PIN_V2_SCHEMA_VERSION,
    validationStatus: ok ? 'VALID' : 'INVALID',
    eligibilityStatus: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
    issueCodes: ok ? (eligible ? [] : [...new Set(runtimePin.issueCodes)].sort()) : ['runtime_pin_invalid'],
  };
}

export function hashArtifactRootPathV2(absolutePath) {
  if (typeof absolutePath !== 'string' || absolutePath.length === 0 || !path.isAbsolute(absolutePath)) throw new Error('artifact_root_path_invalid');
  return sha256Bytes(path.normalize(absolutePath).toLowerCase());
}

export function inspectRuntimePinV2({ executablePath, expectedVersion = VERSION, expectedSha256, spawnVersion = defaultSpawnVersion, readExecutableBytes = readFileSync }) {
  const pathInfo = inspectExecutablePath(executablePath);
  const issues = [...pathInfo.issues];
  let sha256Before = pathInfo.sha256;
  if (pathInfo.ok && typeof readExecutableBytes === 'function') {
    try {
      sha256Before = sha256Bytes(readExecutableBytes(executablePath));
    } catch {
      issues.push('executable_bytes_unreadable');
      sha256Before = null;
    }
  }
  if (expectedVersion !== VERSION) issues.push('expected_version_invalid');
  if (typeof expectedSha256 !== 'string' || !SHA256_RE.test(expectedSha256)) issues.push('expected_sha256_invalid');
  const versionResult = issues.length === 0 ? spawnVersion(executablePath) : { ok: false, code: 'version_not_attempted' };
  const observedVersion = versionResult?.ok ? versionResult.observedVersion : null;
  if (!versionResult?.ok && versionResult?.code && versionResult.code !== 'version_not_attempted') issues.push(versionResult.code);
  if (observedVersion != null && observedVersion !== expectedVersion) issues.push('version_mismatch');
  if (sha256Before != null && expectedSha256 && sha256Before !== expectedSha256) issues.push('sha256_mismatch');
  const eligible = issues.length === 0;
  return {
    schemaVersion: RUNTIME_PIN_V2_SCHEMA_VERSION,
    basename: pathInfo.basename,
    pathSha256: pathInfo.ok ? hashArtifactRootPathV2(executablePath) : null,
    bytes: pathInfo.bytes,
    sha256Before,
    sha256After: null,
    observedVersion,
    expectedVersion,
    expectedSha256,
    eligibilityStatus: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
    issueCodes: [...new Set(issues.map(cleanCode).filter(Boolean))].sort(),
  };
}

export function finalizeRuntimePinV2({ preflight, executablePath, readExecutableBytes = readFileSync }) {
  const issues = [...new Set(Array.isArray(preflight?.issueCodes) ? preflight.issueCodes.map(cleanCode).filter(Boolean) : [])];
  const pathInfo = inspectExecutablePath(executablePath);
  issues.push(...pathInfo.issues);
  let sha256After = null;
  try {
    sha256After = sha256Bytes(readExecutableBytes(executablePath));
  } catch {
    issues.push('executable_bytes_unreadable_after');
  }
  if (!preflight?.basename || !pathInfo.basename) issues.push('executable_basename_missing_after');
  else if (preflight.basename !== pathInfo.basename) issues.push('executable_basename_drift');
  if (!Number.isInteger(preflight?.bytes) || !Number.isInteger(pathInfo.bytes)) issues.push('executable_bytes_missing_after');
  else if (preflight.bytes !== pathInfo.bytes) issues.push('executable_bytes_drift');
  if (typeof preflight?.pathSha256 === 'string' && pathInfo.ok) {
    const currentPathSha256 = hashArtifactRootPathV2(executablePath);
    if (currentPathSha256 !== preflight.pathSha256) issues.push('executable_path_drift');
  } else {
    issues.push('executable_path_missing_after');
  }
  if (preflight?.pathSha256 != null && !pathInfo.ok) issues.push('executable_missing_after');
  if (preflight?.sha256Before && sha256After && preflight.sha256Before !== sha256After) issues.push('executable_sha256_drift');
  if (preflight?.expectedSha256 && sha256After && preflight.expectedSha256 !== sha256After) issues.push('sha256_mismatch_after');
  return {
    ...preflight,
    schemaVersion: RUNTIME_PIN_V2_SCHEMA_VERSION,
    sha256After,
    eligibilityStatus: issues.length === 0 ? 'ELIGIBLE' : 'INELIGIBLE',
    issueCodes: [...new Set(issues)].sort(),
  };
}

export function validateAttemptAuthorizationV2(authorization, context) {
  const shape = validateAttemptAuthorizationV2Shape(authorization);
  const bindingValidation = validateParentExportProbeBindings({ authorization, expectedExecutableSha256: context?.expectedExecutableSha256, artifactRootPathSha256: context?.artifactRootPathSha256 });
  const ok = shape.validationStatus === 'VALID'
    && bindingValidation.ok
    && authorization.probeId === context?.probeId
    && authorization.probeSha256 === context?.probeSha256
    && authorization.manifestSha256 === context?.manifestSha256
    && authorization.scopeSha256 === context?.scopeSha256
    && authorization.caseId === context?.caseId
    && authorization.caseSha256 === context?.caseSha256
    && authorization.fixtureTreeSha256 === context?.fixtureTreeSha256
    && authorization.candidateDiffSha256 === context?.candidateDiffSha256
    && authorization.promptSha256 === context?.promptSha256
    && authorization.qaSkillTreeSha256 === context?.qaSkillTreeSha256
    && authorization.qaAgentSha256 === context?.qaAgentSha256
    && authorization.qaCrAgentSha256 === context?.qaCrAgentSha256
    && authorization.providerId === context?.providerId
    && authorization.modelId === context?.modelId
    && authorization.expectedRuntimeVersion === context?.expectedRuntimeVersion
    && authorization.expectedExecutableSha256 === context?.expectedExecutableSha256
    && authorization.artifactRootPathSha256 === context?.artifactRootPathSha256
    && (authorization.schemaVersion !== ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION || (
      authorization.configProfileSchemaVersion === context?.configProfileSchemaVersion
      && authorization.configResolutionMethod === context?.configResolutionMethod
      && authorization.configSelection === context?.configSelection
      && authorization.resolvedConfigProfileSha256 === context?.resolvedConfigProfileSha256
      && authorization.providerEndpointOriginPathSha256 === context?.providerEndpointOriginPathSha256
      && authorization.readinessAttestationSchemaVersion === context?.readinessAttestationSchemaVersion
      && authorization.readinessAttestationId === context?.readinessAttestationId
      && authorization.readinessMethod === context?.readinessMethod
      && authorization.readinessPathSuffix === context?.readinessPathSuffix
      && authorization.readinessRequiredStatus === context?.readinessRequiredStatus
      && authorization.readinessRequiredModelId === context?.readinessRequiredModelId
      && authorization.readinessMaxAgeMs === context?.readinessMaxAgeMs
    ));
  return {
    schemaVersion: authorization?.schemaVersion === ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION ? ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION : ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION,
    validationStatus: ok ? 'AUTHORIZED' : 'REJECTED',
    issueCodes: ok ? [] : ['authorization_context_mismatch'],
  };
}

export function validateAttemptAuthorizationV2Shape(authorization) {
  const profile = lookupParentExportRunProfile(authorization?.probeId);
  if (!profile) {
    return {
      schemaVersion: authorization?.schemaVersion === ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION ? ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION : ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION,
      validationStatus: 'INVALID',
      issueCodes: ['authorization_shape_invalid'],
    };
  }
  const hashFields = [
    'probeSha256', 'manifestSha256', 'scopeSha256', 'caseSha256', 'fixtureTreeSha256', 'candidateDiffSha256', 'promptSha256',
    'qaSkillTreeSha256', 'qaAgentSha256', 'qaCrAgentSha256', 'expectedExecutableSha256', 'artifactRootPathSha256',
  ];
  const v3 = profile.probeId === 'qa-cr-b2-parent-export-v3';
  const bindingValidation = validateParentExportProbeBindings({ authorization });
  const ok = exactKeys(authorization, v3 ? ATTEMPT_AUTHORIZATION_V3_KEYS : ATTEMPT_AUTHORIZATION_V2_KEYS)
    && authorization.schemaVersion === (v3 ? ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION : ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION)
    && authorization.authorizationId === profile.authorizationId
    && typeof authorization.probeId === 'string' && authorization.probeId.length > 0
    && typeof authorization.caseId === 'string' && authorization.caseId === profile.caseId
    && authorization.attempt === profile.attempt
    && authorization.maxAttempts === profile.maxAttempts
    && authorization.retryPolicy === profile.retryPolicy
    && authorization.status === 'AUTHORIZED'
    && authorization.providerId === profile.providerId
    && authorization.modelId === profile.modelId
    && authorization.expectedRuntimeVersion === VERSION
    && hashFields.every((field) => typeof authorization[field] === 'string' && SHA256_RE.test(authorization[field]))
    && bindingValidation.ok
    && (!v3 || (
      authorization.configProfileSchemaVersion === RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION
      && authorization.configResolutionMethod === 'opencode-debug-config-pure'
      && authorization.configSelection === '$schema+provider.cpa'
      && typeof authorization.resolvedConfigProfileSha256 === 'string' && SHA256_RE.test(authorization.resolvedConfigProfileSha256)
      && typeof authorization.providerEndpointOriginPathSha256 === 'string' && SHA256_RE.test(authorization.providerEndpointOriginPathSha256)
      && authorization.readinessAttestationSchemaVersion === CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION
      && authorization.readinessAttestationId === profile.readinessPolicy?.attestationId
      && authorization.readinessMethod === READINESS_METHOD
      && authorization.readinessPathSuffix === READINESS_PATH_SUFFIX
      && authorization.readinessRequiredStatus === READINESS_REQUIRED_STATUS
      && authorization.readinessRequiredModelId === REQUIRED_MODEL_ID
      && authorization.readinessMaxAgeMs === READINESS_MAX_AGE_MS
    ));
  return {
    schemaVersion: v3 ? ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION : ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION,
    validationStatus: ok ? 'VALID' : 'INVALID',
    issueCodes: ok ? [] : ['authorization_shape_invalid'],
  };
}
