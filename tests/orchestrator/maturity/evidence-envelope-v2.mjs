import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalizeJson, sha256CanonicalJson } from './case-manifest.mjs';
import { verifyArtifactInventory } from './artifact-store.mjs';
import { parseJsonlStrict } from '../../functional-validation/harness.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';
import { aggregateRunTelemetryV2, collectChildSessionTelemetryV2, collectEmitTimingV2, collectParentSessionTelemetryV2, RUN_TELEMETRY_V2_SCHEMA_VERSION } from './collect-run-telemetry-v2.mjs';
import { buildScoreInputFactsV2, SCORE_INPUT_FACTS_V2_SCHEMA_VERSION } from './score-input-facts-v2.mjs';
import { ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION, ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION, PROBE_V2_SCHEMA_VERSION, RUNTIME_PIN_V2_SCHEMA_VERSION, hashArtifactRootPathV2, validateAttemptAuthorizationV2, validateProbeV2, validateRuntimePinV2 } from './runtime-pin-v2.mjs';
import { lookupParentExportRunProfile, validateParentExportProbeBindings } from './parent-export-run-profiles.mjs';
import { validateCredentialReadinessAttestationV3 } from './credential-readiness-v3.mjs';

export const EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION = 'qa-cr-evidence-envelope-v2';

const REQUIRED_PATHS = [
  'probe.json', 'attempt-authorization.json', 'runtime-pin.json', 'inputs/prompt.txt', 'inputs/provenance.json', 'parent-events.jsonl',
  'parent-export.json', 'parent-export-observation.json', 'run-observation.json', 'telemetry.json', 'score-input-facts.json',
];
const REQUIRED_V3_PATHS = [...REQUIRED_PATHS, 'credential-readiness.json'];
const SAFE_CODE_RE = /^[a-z][a-z0-9_:-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;
const SIGNAL_RE = /^[A-Z][A-Z0-9_-]{0,31}$/;
const IDENTITY_KEYS = [
  'artifactRootPathSha256', 'attempt', 'authorizationSha256', 'candidateDiffSha256', 'caseId', 'caseSha256', 'expectedExecutableSha256', 'expectedRuntimeVersion',
  'fixtureTreeSha256', 'manifestSha256', 'modelId', 'probeId', 'probeSha256', 'providerId', 'promptSha256', 'qaAgentSha256', 'qaCrAgentSha256', 'qaSkillTreeSha256', 'retryPolicy', 'runId', 'scopeSha256',
];
const CONTROLLED_REPLAY_CODES = new Set([
  'authorization_malformed', 'authorization_mismatch', 'child_inventory_mismatch', 'child_observation_malformed', 'child_pair_mismatch', 'envelope_authorization_invalid',
  'envelope_inventory_path_invalid', 'envelope_malformed', 'envelope_missing', 'envelope_probe_invalid', 'envelope_runtime_invalid', 'envelope_schema_invalid', 'envelope_schema_mismatch',
  'envelope_seal_invalid', 'envelope_seal_mismatch', 'envelope_sources_invalid', 'envelope_stable_invalid', 'envelope_volatile_invalid', 'facts_blocked', 'facts_drift', 'facts_malformed',
  'facts_schema_mismatch', 'identity_mismatch', 'inventory_hash_mismatch', 'inventory_missing', 'inventory_non_file', 'parent_export_observation_malformed', 'probe_mismatch', 'prompt_mismatch',
  'provenance_malformed', 'provenance_mismatch', 'readiness_malformed', 'readiness_mismatch', 'replay_failed', 'run_observation_malformed', 'runtime_pin_malformed', 'runtime_pin_mismatch', 'telemetry_drift', 'telemetry_malformed', 'telemetry_schema_mismatch', 'v3_probe_binding_mismatch',
]);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function readJsonSafe(filePath) {
  try { return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) }; } catch { return { ok: false, value: null }; }
}

function childIndexes(inventory, prefix) {
  const matcher = new RegExp(`^${prefix}(\\d{3})\\.json$`);
  const indexes = [];
  let invalid = false;
  for (const entry of inventory) {
    const itemPath = String(entry?.path ?? '');
    const match = itemPath.match(matcher);
    if (match) indexes.push(match[1]);
    else if (itemPath.startsWith(prefix)) invalid = true;
  }
  return { indexes: indexes.sort(), invalid };
}

function sha256Utf8(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function validateSourcePointer(pointer, inventory, expectedPath) {
  return exactKeys(pointer, ['path', 'sha256'])
    && pointer.path === expectedPath
    && typeof pointer.sha256 === 'string' && SHA256_RE.test(pointer.sha256)
    && inventory.some((entry) => entry.path === pointer.path && entry.sha256 === pointer.sha256);
}

function validateIdentity(identity) {
  const profile = lookupParentExportRunProfile(identity?.probeId);
  if (!profile) return false;
  const bound = {
    probeSha256: identity?.probeSha256,
    authorizationSha256: identity?.authorizationSha256,
    manifestSha256: identity?.manifestSha256,
    scopeSha256: identity?.scopeSha256,
    caseSha256: identity?.caseSha256,
    fixtureTreeSha256: identity?.fixtureTreeSha256,
    candidateDiffSha256: identity?.candidateDiffSha256,
    promptSha256: identity?.promptSha256,
    qaSkillTreeSha256: identity?.qaSkillTreeSha256,
    qaAgentSha256: identity?.qaAgentSha256,
    qaCrAgentSha256: identity?.qaCrAgentSha256,
    providerId: identity?.providerId,
    modelId: identity?.modelId,
    expectedRuntimeVersion: identity?.expectedRuntimeVersion,
    expectedExecutableSha256: identity?.expectedExecutableSha256,
    artifactRootPathSha256: identity?.artifactRootPathSha256,
    attempt: identity?.attempt,
    retryPolicy: identity?.retryPolicy,
  };
  const runIdRe = new RegExp(`^${profile.runPrefix}[a-f0-9]{24}$`);
  const expectedRunId = runIdRe.test(identity?.runId ?? '')
    ? `${profile.runPrefix}${String(identity?.authorizationSha256 ?? '').slice(0, 24)}`
    : null;
  return exactKeys(identity, IDENTITY_KEYS)
    && identity.probeId === profile.probeId
    && identity.caseId === profile.caseId
    && identity.providerId === profile.providerId
    && identity.modelId === profile.modelId
    && identity.expectedRuntimeVersion === profile.directExecutableVersion
    && identity.attempt === profile.attempt
    && identity.retryPolicy === profile.retryPolicy
    && runIdRe.test(identity.runId)
    && identity.runId === expectedRunId
    && ['probeSha256', 'authorizationSha256', 'manifestSha256', 'scopeSha256', 'caseSha256', 'fixtureTreeSha256', 'candidateDiffSha256', 'promptSha256', 'qaSkillTreeSha256', 'qaAgentSha256', 'qaCrAgentSha256', 'expectedExecutableSha256', 'artifactRootPathSha256'].every((key) => typeof identity[key] === 'string' && SHA256_RE.test(identity[key]));
}

function parseIsoInstant(value) {
  if (typeof value !== 'string') return null;
  try {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) return null;
    return instant;
  } catch {
    return null;
  }
}

function validateRuntimeShape(runtime) {
  return exactKeys(runtime, ['basename', 'bytes', 'eligibilityStatus', 'expectedSha256', 'expectedVersion', 'issueCodes', 'observedVersion', 'pathSha256', 'schemaVersion', 'sha256After', 'sha256Before'])
    && runtime.schemaVersion === RUNTIME_PIN_V2_SCHEMA_VERSION;
}

export function buildEvidenceEnvelopeV2({ identity, probe, authorization, runtimePin, inventory, telemetryArtifact, factsArtifact, capturedAt, sealedAt }) {
  const stable = {
    identity,
    probe: { probeId: probe.probeID ?? probe.probeId, probeSha256: sha256CanonicalJson(probe) },
    authorization: { authorizationId: authorization.authorizationId, authorizationSha256: sha256CanonicalJson(authorization) },
    runtime: runtimePin,
    sources: {
      inventory,
      telemetry: { path: telemetryArtifact.path, sha256: telemetryArtifact.sha256 },
      facts: { path: factsArtifact.path, sha256: factsArtifact.sha256 },
    },
  };
  return {
    schemaVersion: EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION,
    stable,
    volatile: { capturedAt, sealedAt },
    seal: { sha256: sha256CanonicalJson(stable) },
  };
}

export function validateEvidenceEnvelopeV2(envelope) {
  if (!exactKeys(envelope, ['schemaVersion', 'seal', 'stable', 'volatile'])) throw new Error('envelope_schema_invalid');
  if (envelope.schemaVersion !== EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION) throw new Error('envelope_schema_mismatch');
  if (!exactKeys(envelope.seal, ['sha256']) || typeof envelope.seal.sha256 !== 'string' || !SHA256_RE.test(envelope.seal.sha256)) throw new Error('envelope_seal_invalid');
  if (!exactKeys(envelope.stable, ['authorization', 'identity', 'probe', 'runtime', 'sources'])) throw new Error('envelope_stable_invalid');
  if (!validateIdentity(envelope.stable.identity)) throw new Error('identity_mismatch');
  const profile = lookupParentExportRunProfile(envelope.stable.identity.probeId);
  if (!profile) throw new Error('identity_mismatch');
  if (!exactKeys(envelope.stable.probe, ['probeId', 'probeSha256']) || envelope.stable.probe.probeId !== profile.probeId || !SHA256_RE.test(envelope.stable.probe.probeSha256)) throw new Error('envelope_probe_invalid');
  if (!exactKeys(envelope.stable.authorization, ['authorizationId', 'authorizationSha256']) || envelope.stable.authorization.authorizationId !== profile.authorizationId || !SHA256_RE.test(envelope.stable.authorization.authorizationSha256)) throw new Error('envelope_authorization_invalid');
  if (!validateRuntimeShape(envelope.stable.runtime)) throw new Error('envelope_runtime_invalid');
  if (!exactKeys(envelope.stable.sources, ['facts', 'inventory', 'telemetry']) || !Array.isArray(envelope.stable.sources.inventory)) throw new Error('envelope_sources_invalid');
  const capturedAt = parseIsoInstant(envelope.volatile?.capturedAt);
  const sealedAt = parseIsoInstant(envelope.volatile?.sealedAt);
  if (!exactKeys(envelope.volatile, ['capturedAt', 'sealedAt']) || !capturedAt || !sealedAt || capturedAt.getTime() > sealedAt.getTime()) throw new Error('envelope_volatile_invalid');
  for (const entry of envelope.stable.sources.inventory) {
    const segments = String(entry?.path ?? '').replace(/\\/g, '/').split('/');
    if (path.isAbsolute(String(entry?.path ?? '')) || /^[A-Za-z]:/.test(String(entry?.path ?? '')) || segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('envelope_inventory_path_invalid');
  }
  if (!validateSourcePointer(envelope.stable.sources.telemetry, envelope.stable.sources.inventory, 'telemetry.json')) throw new Error('envelope_sources_invalid');
  if (!validateSourcePointer(envelope.stable.sources.facts, envelope.stable.sources.inventory, 'score-input-facts.json')) throw new Error('envelope_sources_invalid');
  if (sha256CanonicalJson(envelope.stable) !== envelope.seal.sha256) throw new Error('envelope_seal_mismatch');
  return envelope;
}

function safeReplayFailure(code, facts = null) {
  return { authorityStatus: 'NON_AUTHORITATIVE', replayStatus: 'BLOCKED', facts, diagnostics: [CONTROLLED_REPLAY_CODES.has(code) ? code : 'replay_failed'] };
}

function parseExportObservation(filePath) {
  const parsed = readJsonSafe(filePath);
  if (!parsed.ok) return { ok: false, value: { sessionId: null, status: 'MALFORMED', errorCode: 'export_observation_invalid' } };
  const value = parsed.value;
  const ok = exactKeys(value, ['errorCode', 'sessionId', 'status'])
    && (value.sessionId === null || (typeof value.sessionId === 'string' && SESSION_ID_RE.test(value.sessionId)))
    && ['OK', 'FAILED', 'MISSING', 'MALFORMED'].includes(value.status)
    && (value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_CODE_RE.test(value.errorCode)));
  return { ok, value: ok ? value : { sessionId: null, status: 'MALFORMED', errorCode: 'export_observation_invalid' } };
}

function parseExportJson(filePath, expectedStatus) {
  if (!existsSync(filePath)) return { status: 'MISSING', json: null };
  const text = readFileSync(filePath, 'utf8');
  try {
    return { status: expectedStatus === 'MISSING' ? 'MISSING' : 'OK', json: JSON.parse(text) };
  } catch {
    return { status: 'MALFORMED', json: null };
  }
}

function validateStoredObservation(observation) {
  return exactKeys(observation, ['commandHash', 'observed', 'postflightIssueCodes', 'runnerErrorCode', 'runtimeCleanupStatus', 'runtimeCleanupSucceeded', 'terminal', 'terminalContractStatus'])
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
    && (observation.commandHash === null || (typeof observation.commandHash === 'string' && SHA256_RE.test(observation.commandHash)))
    && (observation.runnerErrorCode === null || observation.runnerErrorCode === 'runner_throw')
    && (observation.runtimeCleanupStatus === 'SUCCESS' || observation.runtimeCleanupStatus === 'FAILED')
    && typeof observation.runtimeCleanupSucceeded === 'boolean'
    && (observation.terminal.exitCode === null || Number.isInteger(observation.terminal.exitCode))
    && (observation.terminal.signal === null || (typeof observation.terminal.signal === 'string' && SIGNAL_RE.test(observation.terminal.signal)))
    && typeof observation.terminal.timedOut === 'boolean'
    && (observation.terminal.errorCode === null || (typeof observation.terminal.errorCode === 'string' && SAFE_CODE_RE.test(observation.terminal.errorCode)))
    && Object.entries(observation.observed).every(([key, value]) => (
      key === 'sameEnvironment' || key === 'sameWorkingDirectory'
    ) ? (value === null || typeof value === 'boolean') : (
      key === 'parentRunCount' || key === 'parentExportCount' || key === 'childExportCount'
    ) ? (value === null || (Number.isInteger(value) && value >= 0)) : (value === null || (typeof value === 'string' && SHA256_RE.test(value))));
}

export function replaySealedRunV2({ runDirectory }) {
  try {
    const envelopePath = path.join(runDirectory, 'envelope.json');
    if (!existsSync(envelopePath)) return safeReplayFailure('envelope_missing');
    const envParsed = readJsonSafe(envelopePath);
    if (!envParsed.ok) return safeReplayFailure('envelope_malformed');
    const rawProfile = lookupParentExportRunProfile(envParsed.value?.stable?.identity?.probeId);
    if (rawProfile?.probeId === 'qa-cr-b2-parent-export-v3' && !validateParentExportProbeBindings({ identity: envParsed.value?.stable?.identity }).ok) return safeReplayFailure('v3_probe_binding_mismatch');
    const envelope = validateEvidenceEnvelopeV2(envParsed.value);
    const profile = lookupParentExportRunProfile(envelope.stable.identity.probeId);
    if (!profile) return safeReplayFailure('identity_mismatch');
    const resolvedRunDirectory = path.resolve(runDirectory);
    if (path.basename(resolvedRunDirectory) !== envelope.stable.identity.runId) return safeReplayFailure('identity_mismatch');
    if (hashArtifactRootPathV2(path.dirname(resolvedRunDirectory)) !== envelope.stable.identity.artifactRootPathSha256) return safeReplayFailure('identity_mismatch');
    verifyArtifactInventory({ runDirectory, inventory: envelope.stable.sources.inventory });
    for (const rel of (profile.probeId === 'qa-cr-b2-parent-export-v3' ? REQUIRED_V3_PATHS : REQUIRED_PATHS)) if (!envelope.stable.sources.inventory.some((entry) => entry.path === rel)) return safeReplayFailure('inventory_missing');
    const rawEntries = childIndexes(envelope.stable.sources.inventory, 'child-exports/');
    const obsEntries = childIndexes(envelope.stable.sources.inventory, 'child-export-observations/');
    const rawIdx = rawEntries.indexes;
    const obsIdx = obsEntries.indexes;
    if (rawEntries.invalid || obsEntries.invalid) return safeReplayFailure('child_inventory_mismatch');
    if (canonicalizeJson(rawIdx) !== canonicalizeJson(obsIdx)) return safeReplayFailure('child_pair_mismatch');
    if (!rawIdx.every((index) => /^\d{3}$/.test(index)) || !obsIdx.every((index) => /^\d{3}$/.test(index))) return safeReplayFailure('child_inventory_mismatch');
    const parentJsonlBytes = readFileSync(path.join(runDirectory, 'parent-events.jsonl'));
    const parentExportObs = parseExportObservation(path.join(runDirectory, 'parent-export-observation.json'));
    if (!parentExportObs.ok) return safeReplayFailure('parent_export_observation_malformed');
    const parentExport = parseExportJson(path.join(runDirectory, 'parent-export.json'), parentExportObs.value.status);
    const childObservations = obsIdx.map((index) => parseExportObservation(path.join(runDirectory, `child-export-observations/${index}.json`)));
    if (childObservations.some((entry) => !entry.ok)) return safeReplayFailure('child_observation_malformed');
    const childExports = rawIdx.map((index, i) => ({ ...parseExportJson(path.join(runDirectory, `child-exports/${index}.json`), childObservations[i]?.value?.status), observation: childObservations[i].value }));
    const runtimePinParsed = readJsonSafe(path.join(runDirectory, 'runtime-pin.json'));
    const probeParsed = readJsonSafe(path.join(runDirectory, 'probe.json'));
    const authParsed = readJsonSafe(path.join(runDirectory, 'attempt-authorization.json'));
    const readinessParsed = profile.probeId === 'qa-cr-b2-parent-export-v3' ? readJsonSafe(path.join(runDirectory, 'credential-readiness.json')) : null;
    const provenanceParsed = readJsonSafe(path.join(runDirectory, 'inputs/provenance.json'));
    const observationParsed = readJsonSafe(path.join(runDirectory, 'run-observation.json'));
    const promptText = readFileSync(path.join(runDirectory, 'inputs/prompt.txt'), 'utf8');
    if (!runtimePinParsed.ok) return safeReplayFailure('runtime_pin_malformed');
    if (!probeParsed.ok) return safeReplayFailure('probe_mismatch');
    if (!authParsed.ok) return safeReplayFailure('authorization_malformed');
    if (profile.probeId === 'qa-cr-b2-parent-export-v3' && !readinessParsed?.ok) return safeReplayFailure('readiness_malformed');
    if (!provenanceParsed.ok) return safeReplayFailure('provenance_malformed');
    if (!observationParsed.ok || !validateStoredObservation(observationParsed.value)) return safeReplayFailure('run_observation_malformed');
    if (!exactKeys(provenanceParsed.value, ['caseSha256', 'identity', 'manifestSha256']) || !validateIdentity(provenanceParsed.value.identity) || provenanceParsed.value.manifestSha256 !== provenanceParsed.value.identity.manifestSha256 || provenanceParsed.value.caseSha256 !== provenanceParsed.value.identity.caseSha256) return safeReplayFailure('provenance_mismatch');
    if (canonicalizeJson(provenanceParsed.value.identity) !== canonicalizeJson(envelope.stable.identity)) return safeReplayFailure('identity_mismatch');
    if (sha256Utf8(promptText) !== envelope.stable.identity.promptSha256) return safeReplayFailure('prompt_mismatch');
    if (profile.probeId === 'qa-cr-b2-parent-export-v3' && !validateParentExportProbeBindings({ identity: envelope.stable.identity }).ok) return safeReplayFailure('v3_probe_binding_mismatch');
    if (sha256CanonicalJson(probeParsed.value) !== envelope.stable.probe.probeSha256 || envelope.stable.probe.probeSha256 !== envelope.stable.identity.probeSha256) return safeReplayFailure('probe_mismatch');
    if (profile.probeId === 'qa-cr-b2-parent-export-v3' && !validateParentExportProbeBindings({ probe: probeParsed.value }).ok) return safeReplayFailure('v3_probe_binding_mismatch');
    if (sha256CanonicalJson(authParsed.value) !== envelope.stable.authorization.authorizationSha256 || envelope.stable.authorization.authorizationSha256 !== envelope.stable.identity.authorizationSha256) return safeReplayFailure('authorization_mismatch');
    if (profile.probeId === 'qa-cr-b2-parent-export-v3' && !validateParentExportProbeBindings({ authorization: authParsed.value }).ok) return safeReplayFailure('v3_probe_binding_mismatch');
    const parentParsed = parseJsonlStrict(parentJsonlBytes);
    const parent = collectParentSessionTelemetryV2({
      events: parentParsed.events,
      exportJson: parentExport.json,
      exportStatus: parentExportObs.value.status,
      exportErrorCode: parentExportObs.value.errorCode ?? undefined,
      expectedSessionId: parentExportObs.value.sessionId,
      expectedRuntimeVersion: envelope.stable.identity.expectedRuntimeVersion,
      expectedProviderId: envelope.stable.identity.providerId,
      expectedModelId: envelope.stable.identity.modelId.split('/').slice(1).join('/'),
      expectedAgent: profile.parentAgent,
      expectedMode: profile.parentAgent,
      jsonlSourceArtifact: envelope.stable.sources.inventory.find((entry) => entry.path === 'parent-events.jsonl') ?? null,
      exportSourceArtifact: envelope.stable.sources.inventory.find((entry) => entry.path === 'parent-export.json') ?? null,
    });
    const expectedChildSessionIds = extractQaCrChildSessionIds(parentParsed.events);
    if (rawIdx.length !== expectedChildSessionIds.length || obsIdx.length !== expectedChildSessionIds.length) return safeReplayFailure('child_inventory_mismatch');
    const children = childExports.map((entry, index) => collectChildSessionTelemetryV2({
      exportJson: entry.json,
      exportStatus: entry.observation.status,
      exportErrorCode: entry.observation.errorCode ?? undefined,
      expectedSessionId: expectedChildSessionIds[index] ?? null,
      expectedParentSessionId: parent.sessionId,
      expectedRuntimeVersion: envelope.stable.identity.expectedRuntimeVersion,
      expectedProviderId: envelope.stable.identity.providerId,
      expectedModelId: envelope.stable.identity.modelId.split('/').slice(1).join('/'),
      expectedAgent: profile.childAgent,
      expectedMode: profile.childAgent,
      sourceArtifact: envelope.stable.sources.inventory.find((item) => item.path === `child-exports/${rawIdx[index]}.json`) ?? null,
    }));
    const probeValidation = validateProbeV2(probeParsed.value, {
      manifestId: profile.manifestId,
      scopeId: profile.scopeId,
      expectedRuntimeVersion: envelope.stable.identity.expectedRuntimeVersion,
      providerId: envelope.stable.identity.providerId,
      modelId: envelope.stable.identity.modelId,
      agentParent: profile.parentAgent,
      agentChild: profile.childAgent,
    });
    if (probeValidation.probeStatus !== 'VALID' || (profile.probeId === 'qa-cr-b2-parent-export-v2' && probeParsed.value.schemaID !== PROBE_V2_SCHEMA_VERSION) || envelope.stable.probe.probeId !== probeParsed.value.probeID) return safeReplayFailure('probe_mismatch');
    const readinessAuthorizationContext = profile.probeId === 'qa-cr-b2-parent-export-v3'
      ? (() => {
        const readinessValidation = validateCredentialReadinessAttestationV3(readinessParsed.value, {
          profileSha256: readinessParsed.value?.configProfileSha256,
          now: envelope.volatile.capturedAt,
          maxAgeMs: profile.readinessPolicy.maxAgeMs,
        });
        if (!readinessValidation.ok) throw new Error('readiness_mismatch');
        return {
          configProfileSchemaVersion: readinessParsed.value.configProfile.schemaVersion,
          configResolutionMethod: readinessParsed.value.configProfile.source,
          configSelection: readinessParsed.value.configProfile.selection,
          resolvedConfigProfileSha256: readinessParsed.value.configProfileSha256,
          providerEndpointOriginPathSha256: readinessParsed.value.configProfile.providerEndpointOriginPathSha256,
          readinessAttestationSchemaVersion: readinessParsed.value.schemaVersion,
          readinessAttestationId: readinessParsed.value.attestationId,
          readinessMethod: readinessParsed.value.check.method,
          readinessPathSuffix: readinessParsed.value.check.pathSuffix,
          readinessRequiredStatus: readinessParsed.value.check.httpStatus,
          readinessRequiredModelId: readinessParsed.value.check.requiredModelId,
          readinessMaxAgeMs: profile.readinessPolicy.maxAgeMs,
        };
      })()
      : {};
    const authorizationValidation = validateAttemptAuthorizationV2(authParsed.value, {
      probeId: probeParsed.value.probeID,
      probeSha256: envelope.stable.probe.probeSha256,
      manifestSha256: envelope.stable.identity.manifestSha256,
      scopeSha256: envelope.stable.identity.scopeSha256,
      caseId: envelope.stable.identity.caseId,
      caseSha256: envelope.stable.identity.caseSha256,
      fixtureTreeSha256: envelope.stable.identity.fixtureTreeSha256,
      candidateDiffSha256: envelope.stable.identity.candidateDiffSha256,
      promptSha256: envelope.stable.identity.promptSha256,
      qaSkillTreeSha256: envelope.stable.identity.qaSkillTreeSha256,
      qaAgentSha256: envelope.stable.identity.qaAgentSha256,
      qaCrAgentSha256: envelope.stable.identity.qaCrAgentSha256,
      providerId: envelope.stable.identity.providerId,
      modelId: envelope.stable.identity.modelId,
      expectedRuntimeVersion: envelope.stable.identity.expectedRuntimeVersion,
      expectedExecutableSha256: envelope.stable.identity.expectedExecutableSha256,
      artifactRootPathSha256: envelope.stable.identity.artifactRootPathSha256,
      ...readinessAuthorizationContext,
    });
    if (authorizationValidation.validationStatus !== 'AUTHORIZED' || authParsed.value.schemaVersion !== (profile.probeId === 'qa-cr-b2-parent-export-v3' ? ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION : ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION)) return safeReplayFailure('authorization_mismatch');
    const runtimePinValidation = validateRuntimePinV2(runtimePinParsed.value, { expectedExecutableSha256: envelope.stable.identity.expectedExecutableSha256 });
    if (profile.probeId === 'qa-cr-b2-parent-export-v3' && !validateParentExportProbeBindings({ runtimePin: runtimePinParsed.value, identity: envelope.stable.identity, authorization: authParsed.value, probe: probeParsed.value }).ok) return safeReplayFailure('v3_probe_binding_mismatch');
    if (runtimePinValidation.validationStatus !== 'VALID' || runtimePinParsed.value.schemaVersion !== RUNTIME_PIN_V2_SCHEMA_VERSION || canonicalizeJson(runtimePinParsed.value) !== canonicalizeJson(envelope.stable.runtime) || runtimePinParsed.value.expectedSha256 !== envelope.stable.identity.expectedExecutableSha256 || runtimePinParsed.value.sha256Before !== envelope.stable.runtime.sha256Before || runtimePinParsed.value.sha256After !== envelope.stable.runtime.sha256After) return safeReplayFailure('runtime_pin_mismatch');
    const telemetry = { schemaVersion: RUN_TELEMETRY_V2_SCHEMA_VERSION, parent, children, aggregate: aggregateRunTelemetryV2({ parent, children, expectedChildSessionIds }), emitTiming: collectEmitTimingV2(parentParsed.events) };
    const facts = buildScoreInputFactsV2({
      identity: provenanceParsed.value.identity,
      probe: probeValidation,
      authorization: authorizationValidation,
      runtimePin: { ...runtimePinParsed.value, validationStatus: runtimePinValidation.validationStatus },
      parentEvents: parentParsed.events,
      jsonlErrors: parentParsed.errors,
      telemetry,
      observation: observationParsed.value,
      childArtifacts: [
        ...rawIdx.map((index, i) => ({ kind: 'raw', index, sessionId: expectedChildSessionIds[i] ?? null })),
        ...obsIdx.map((index, i) => ({ kind: 'observation', index, sessionId: childObservations[i]?.value?.sessionId ?? null })),
      ],
      parentExportObservation: parentExportObs.value,
      childExportObservations: childObservations.map((entry) => entry.value),
      runnerErrorCode: observationParsed.value.runnerErrorCode ?? null,
    });
    const storedTelemetry = readJsonSafe(path.join(runDirectory, 'telemetry.json'));
    const storedFacts = readJsonSafe(path.join(runDirectory, 'score-input-facts.json'));
    if (!storedTelemetry.ok) return safeReplayFailure('telemetry_malformed', facts);
    if (!storedFacts.ok) return safeReplayFailure('facts_malformed', facts);
    if (!exactKeys(storedTelemetry.value, ['aggregate', 'children', 'emitTiming', 'parent', 'schemaVersion'])) return safeReplayFailure('telemetry_schema_mismatch', facts);
    if (storedTelemetry.value.schemaVersion !== RUN_TELEMETRY_V2_SCHEMA_VERSION) return safeReplayFailure('telemetry_schema_mismatch', facts);
    if (storedFacts.value?.schemaVersion !== SCORE_INPUT_FACTS_V2_SCHEMA_VERSION) return safeReplayFailure('facts_schema_mismatch', facts);
    if (canonicalizeJson(storedTelemetry.value) !== canonicalizeJson(telemetry)) return safeReplayFailure('telemetry_drift', facts);
    if (canonicalizeJson(storedFacts.value) !== canonicalizeJson(facts)) return safeReplayFailure('facts_drift', facts);
    return facts.sourceAuthorityStatus === 'AUTHORITATIVE'
      ? { authorityStatus: 'AUTHORITATIVE', replayStatus: 'OK', facts, diagnostics: [] }
      : { authorityStatus: 'NON_AUTHORITATIVE', replayStatus: 'BLOCKED', facts, diagnostics: ['facts_blocked'] };
  } catch (error) {
    return safeReplayFailure(CONTROLLED_REPLAY_CODES.has(error?.message) ? error.message : 'replay_failed');
  }
}
