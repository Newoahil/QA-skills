import { sha256CanonicalJson } from './case-manifest.mjs';

import {
  CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION,
  CREDENTIAL_READINESS_ATTESTATION_V3_ID,
  READINESS_MAX_AGE_MS,
  READINESS_MAX_BODY_BYTES,
  READINESS_METHOD,
  READINESS_PATH_SUFFIX,
  READINESS_REQUIRED_STATUS,
  READINESS_TIMEOUT_MS,
  RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION,
  REQUIRED_MODEL_ID,
} from './credential-readiness-v3.mjs';

const V2_PROBE_PATH = 'benchmarks/qa-cr-maturity/probes/b2-parent-export-v2.json';
const V3_PROBE_PATH = 'benchmarks/qa-cr-maturity/probes/b2-parent-export-v3.json';
const V2_CANONICAL_PROBE_SHA256 = '778b077745b5e5b8b0dfdb911d37feead47f6505f3eaa1709e0833118cd72d25';
export const PHASE_B2_PARENT_EXPORT_V3_PROBE_SHA256 = '49a9c6859936fc08c858db1e55ac224be27c474707c054df781fded85d1d8cef';
export const PARENT_EXPORT_PROBE_BINDING_MISMATCH = 'parent_export_probe_binding_mismatch';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

const historicalV2 = {
  schemaVersion: 'qa-cr-parent-export-run-profile-v1',
  profileId: 'qa-cr-b2-parent-export-v2',
  probeSchemaId: 'qa-cr-b2-probe-v2',
  probeId: 'qa-cr-b2-parent-export-v2',
  probeVersion: '2.0.0',
  phase: 'V2-A',
  authorizationSchemaId: 'qa-cr-real-attempt-authorization-v1',
  authorizationId: 'qa-cr-b2-parent-export-v2-attempt-1',
  runPrefix: 'qa-cr-b2-parent-export-v2-a1-',
  providerId: 'cpa',
  modelId: 'cpa/gpt-5.5',
  directExecutableVersion: '1.18.19',
  parentAgent: 'qa',
  childAgent: 'qa-cr',
  caseId: 'seed-defect-auth-guard-small',
  attempt: 1,
  maxAttempts: 1,
  retryPolicy: 'none',
  manifestId: 'qa-cr-phase-a-seed-v1',
  manifestSchemaId: 'qa-cr-maturity-manifest-v1',
  scopeId: 'qa-cr-maturity-scope-v1',
  scoreInputFactsSchemaId: 'qa-cr-score-input-facts-v2',
  telemetrySchemaId: 'qa-cr-run-telemetry-v2',
  evidenceEnvelopeSchemaId: 'qa-cr-evidence-envelope-v2',
  runtimePinSchemaId: 'qa-cr-runtime-pin-v1',
  configProfileSchemaId: null,
  credentialReadinessSchemaId: null,
  probePath: V2_PROBE_PATH,
  readinessPolicy: null,
  canonicalProbeSha256: V2_CANONICAL_PROBE_SHA256,
};

const plannedV3 = {
  schemaVersion: 'qa-cr-parent-export-run-profile-v1',
  profileId: 'qa-cr-b2-parent-export-v3',
  probeSchemaId: 'qa-cr-b2-probe-v3',
  probeId: 'qa-cr-b2-parent-export-v3',
  probeVersion: '3.0.0',
  phase: 'V3-A',
  authorizationSchemaId: 'qa-cr-real-attempt-authorization-v2',
  authorizationId: 'qa-cr-b2-parent-export-v3-attempt-1',
  runPrefix: 'qa-cr-b2-parent-export-v3-a1-',
  providerId: 'cpa',
  modelId: 'cpa/gpt-5.5',
  directExecutableVersion: '1.18.19',
  parentAgent: 'qa',
  childAgent: 'qa-cr',
  caseId: 'seed-defect-auth-guard-small',
  attempt: 1,
  maxAttempts: 1,
  retryPolicy: 'none',
  manifestId: 'qa-cr-phase-a-seed-v1',
  manifestSchemaId: 'qa-cr-maturity-manifest-v1',
  scopeId: 'qa-cr-maturity-scope-v1',
  scoreInputFactsSchemaId: 'qa-cr-score-input-facts-v2',
  telemetrySchemaId: 'qa-cr-run-telemetry-v2',
  evidenceEnvelopeSchemaId: 'qa-cr-evidence-envelope-v2',
  runtimePinSchemaId: 'qa-cr-runtime-pin-v1',
  configProfileSchemaId: RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION,
  credentialReadinessSchemaId: CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION,
  probePath: V3_PROBE_PATH,
  readinessPolicy: {
    schemaVersion: CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION,
    attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
    method: READINESS_METHOD,
    pathSuffix: READINESS_PATH_SUFFIX,
    requiredStatus: READINESS_REQUIRED_STATUS,
    requiredModelId: REQUIRED_MODEL_ID,
    maxAgeMs: READINESS_MAX_AGE_MS,
    redirect: 'error',
    timeoutMs: READINESS_TIMEOUT_MS,
    maxBodyBytes: READINESS_MAX_BODY_BYTES,
  },
  probeBindings: {
    expectedExecutableSha256: '426d31cbb676795183f2b1eb852eef1c83ab37566ac987eeb60e67932aaa71b8',
    artifactRootPathSha256: 'd330e546c23907485eb1e47b4b2a27223bf8400421992e9c2336ab9c29ed2a0f',
  },
  canonicalProbeSha256: PHASE_B2_PARENT_EXPORT_V3_PROBE_SHA256,
};

export const PARENT_EXPORT_RUN_PROFILES = deepFreeze({
  'qa-cr-b2-parent-export-v2': historicalV2,
  'qa-cr-b2-parent-export-v3': plannedV3,
});

export function lookupParentExportRunProfile(probeId) {
  return PARENT_EXPORT_RUN_PROFILES[probeId] ?? null;
}

export function validateParentExportProbeBindings({ probeId, probe, authorization, identity, runtimePin, expectedExecutableSha256, artifactRootPathSha256 } = {}) {
  const profile = lookupParentExportRunProfile(probeId ?? probe?.probeID ?? probe?.probeId ?? authorization?.probeId ?? identity?.probeId);
  if (!profile?.probeBindings) return { ok: true, profile };
  const { expectedExecutableSha256: expectedExecutable, artifactRootPathSha256: expectedRoot } = profile.probeBindings;
  const matches = [
    [probe?.authorization?.expectedExecutableSha256, expectedExecutable],
    [probe?.authorization?.artifactRootPathSha256, expectedRoot],
    [authorization?.expectedExecutableSha256, expectedExecutable],
    [authorization?.artifactRootPathSha256, expectedRoot],
    [identity?.expectedExecutableSha256, expectedExecutable],
    [identity?.artifactRootPathSha256, expectedRoot],
    [expectedExecutableSha256, expectedExecutable],
    [artifactRootPathSha256, expectedRoot],
    [runtimePin?.expectedSha256, expectedExecutable],
    [runtimePin?.sha256Before, expectedExecutable],
    [runtimePin?.sha256After, expectedExecutable],
  ];
  for (const [observed, expected] of matches) {
    if (observed != null && observed !== expected) return { ok: false, code: PARENT_EXPORT_PROBE_BINDING_MISMATCH, profile };
  }
  return { ok: true, profile };
}

export function validateExactParentExportProbe(probe) {
  const probeId = probe?.probeID ?? probe?.probeId;
  const profile = lookupParentExportRunProfile(probeId);
  if (!profile) return { ok: false, code: 'parent_export_probe_unknown' };
  if (probe == null || typeof probe !== 'object' || Array.isArray(probe)) return { ok: false, code: 'parent_export_probe_sha256_mismatch' };
  if (sha256CanonicalJson(probe) !== profile.canonicalProbeSha256) return { ok: false, code: 'parent_export_probe_sha256_mismatch' };
  if ((probe.schemaID ?? probe.schemaId) !== profile.probeSchemaId || probe.version !== profile.probeVersion || probe.phase !== profile.phase) return { ok: false, code: 'parent_export_probe_identity_mismatch' };
  if (probe.manifestID !== profile.manifestId || probe.manifestSchemaID !== profile.manifestSchemaId || probe.scopeID !== profile.scopeId) return { ok: false, code: 'parent_export_probe_context_mismatch' };
  if (probe.scoreInputFactsSchemaID !== profile.scoreInputFactsSchemaId || probe.telemetrySchemaID !== profile.telemetrySchemaId || probe.evidenceEnvelopeSchemaID !== profile.evidenceEnvelopeSchemaId || probe.runtimePinSchemaID !== profile.runtimePinSchemaId || probe.attemptAuthorizationSchemaID !== profile.authorizationSchemaId) return { ok: false, code: 'parent_export_probe_schema_mismatch' };
  if (probe.runtime?.providerID !== profile.providerId || `${profile.providerId}/${probe.runtime?.modelID}` !== profile.modelId || probe.runtime?.directExecutableVersion !== profile.directExecutableVersion || probe.runtime?.parentAgent !== profile.parentAgent || probe.runtime?.childAgent !== profile.childAgent) return { ok: false, code: 'parent_export_probe_runtime_mismatch' };
  const bindingValidation = validateParentExportProbeBindings({ probeId, probe });
  if (!bindingValidation.ok) return bindingValidation;
  return { ok: true, profile };
}
