import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import path, { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { sha256CanonicalJson } from './case-manifest.mjs';
import { createImmutableRunStore, createRedactor } from './artifact-store.mjs';
import {
  buildResolverEnvV3,
  checkCpaCredentialReadinessV3,
  CREDENTIAL_READINESS_ATTESTATION_V3_ID,
  CREDENTIAL_READINESS_V3_ERROR_CODES,
  READINESS_MAX_BODY_BYTES,
  READINESS_TIMEOUT_MS,
  REQUIRED_MODEL_ID,
  resolveSelectedCpaConfigV3,
  validateCredentialReadinessAttestationV3,
} from './credential-readiness-v3.mjs';
import { EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION, replaySealedRunV2 } from './evidence-envelope-v2.mjs';
import { buildPrimaryRunIdentityV2, executePrimaryRunV2 } from './primary-run-harness-v2.mjs';
import { executePhaseB2ParentExportV3, executePhaseB2ParentExportV3Simulation, PHASE_B2_PARENT_EXPORT_V3_AUTHORIZATION_PATH, PHASE_B2_PARENT_EXPORT_V3_AUTHORIZATION_SHA256, preparePhaseB2ParentExportV3AuthorizationContext, preflightPhaseB2ParentExportV3AuthorizationConsumption } from './real-smoke-runner-v3.mjs';
import {
  ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION,
  validateAttemptAuthorizationV2,
  hashArtifactRootPathV2,
  RUNTIME_PIN_V2_SCHEMA_VERSION,
} from './runtime-pin-v2.mjs';
import {
  lookupParentExportRunProfile,
  PARENT_EXPORT_RUN_PROFILES,
  PHASE_B2_PARENT_EXPORT_V3_PROBE_SHA256,
  validateParentExportProbeBindings,
  validateExactParentExportProbe,
} from './parent-export-run-profiles.mjs';

const ROOT = resolve('.');
const V2_PATH = resolve('benchmarks/qa-cr-maturity/probes/b2-parent-export-v2.json');
const V3_PATH = resolve('benchmarks/qa-cr-maturity/probes/b2-parent-export-v3.json');
const FIXTURE_DIR = resolve('tests/orchestrator/maturity/fixtures/opencode-1.18.19');
const PARENT_SESSION_ID = 'ses_01K4A7Z7P3V4P6M9Q8R2S1T0U';
const CHILD_SESSION_ID = 'ses_01K4A7ZB8N2D5F7H9J1K3M5P7R';
const RUNTIME_VERSION = '1.18.19';

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'phase-b2-v3-'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function makeManifest() {
  return {
    schemaVersion: 'qa-cr-maturity-manifest-v1',
    manifestId: 'qa-cr-phase-a-seed-v1',
    manifestKind: 'seed',
    scoringEligible: false,
    scopeContract: { version: 'qa-cr-maturity-scope-v1', path: 'scope.md' },
    target: { agent: 'qa-cr', agentPath: 'qa-skill/agents/qa-cr.md', baseCommit: '801cd123afcf569d6564fc6c57128ad96f7af97e' },
    runPolicy: { primaryAttempt: 1, retryPolicy: 'none', retainPrimaryEvidence: true },
    holdoutPolicy: { requiredForGraduation: false, minimumRatio: 0.2, enforcedForThisSeed: false },
    cases: Array.from({ length: 5 }, (_, index) => ({
      id: index === 0 ? 'seed-defect-auth-guard-small' : `case-${index + 1}`,
      title: `Case ${index + 1}`,
      caseKind: 'control',
      controlType: 'clean',
      partition: 'development',
      evaluationMode: 'autonomous',
      scoringEligible: false,
      complexity: { tier: 'small', facts: ['f1'], rationale: 'r1' },
      categories: ['CR-C1'],
      severity: 'low',
      oracle: { authority: 'a', summary: 'b', sourceRef: 'src/ref.md' },
      expectedDisposition: { status: 'OK', gate: 'continue', rationale: 'r', primaryFindingId: `finding-${index + 1}` },
      provenance: { sourceType: 'synthetic', sourceRef: 'cases/ref.md', license: 'MIT', commitIdentity: null, treeIdentity: null },
    })),
  };
}

function runtimePinPass(runSpec) {
  return {
    schemaVersion: RUNTIME_PIN_V2_SCHEMA_VERSION,
    basename: 'opencode.exe',
    pathSha256: sha256('path'),
    bytes: 10,
    sha256Before: runSpec.expectedExecutableSha256,
    sha256After: runSpec.expectedExecutableSha256,
    observedVersion: RUNTIME_VERSION,
    expectedVersion: RUNTIME_VERSION,
    expectedSha256: runSpec.expectedExecutableSha256,
    eligibilityStatus: 'ELIGIBLE',
    issueCodes: [],
  };
}

function safeObservation(runSpec) {
  return {
    terminal: { exitCode: 0, signal: null, errorCode: null, timedOut: false },
    command: 'SECRET-COMMAND',
    manifestSha256: runSpec.manifestSha256,
    scopeSha256: runSpec.scopeSha256,
    caseSha256: runSpec.caseSha256,
    promptSha256: runSpec.promptSha256,
    qaSkillTreeSha256Before: runSpec.qaSkillTreeSha256,
    qaSkillTreeSha256After: runSpec.qaSkillTreeSha256,
    qaAgentSha256Before: runSpec.qaAgentSha256,
    qaAgentSha256After: runSpec.qaAgentSha256,
    qaCrAgentSha256Before: runSpec.qaCrAgentSha256,
    qaCrAgentSha256After: runSpec.qaCrAgentSha256,
    fixtureTreeSha256Before: runSpec.fixtureTreeSha256,
    fixtureTreeSha256After: runSpec.fixtureTreeSha256,
    candidateDiffSha256Before: runSpec.candidateDiffSha256,
    candidateDiffSha256After: runSpec.candidateDiffSha256,
    productCompositeSha256Before: sha256CanonicalJson({ fixtureTreeSha256: runSpec.fixtureTreeSha256, candidateDiffSha256: runSpec.candidateDiffSha256 }),
    productCompositeSha256After: sha256CanonicalJson({ fixtureTreeSha256: runSpec.fixtureTreeSha256, candidateDiffSha256: runSpec.candidateDiffSha256 }),
    executableSha256Before: runSpec.expectedExecutableSha256,
    executableSha256After: runSpec.expectedExecutableSha256,
    parentRunCount: 1,
    parentExportCount: 1,
    childExportCount: 1,
    sameEnvironment: true,
    sameWorkingDirectory: true,
    envIdentitySha256: sha256('env'),
    cwdIdentitySha256: sha256('cwd'),
    runtimeCleanupStatus: 'SUCCESS',
    runtimeCleanupSucceeded: true,
  };
}

function buildAttestation(selectedConfig, checkedAt = '2026-09-04T12:00:00.000Z') {
  const profile = {
    schemaVersion: 'qa-cr-resolved-cpa-config-profile-v1',
    source: 'opencode-debug-config-pure',
    selection: '$schema+provider.cpa',
    providerId: 'cpa',
    providerNpm: selectedConfig.provider.cpa.npm,
    modelId: 'gpt-5.5',
    credentialPresent: true,
    providerEndpointOriginPathSha256: 'e'.repeat(64),
  };
  return {
    schemaVersion: 'qa-cr-credential-readiness-attestation-v1',
    attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
    configProfile: profile,
    configProfileSha256: sha256CanonicalJson(profile),
    check: { method: 'GET', pathSuffix: '/models', httpStatus: 200, authenticated: true, modelCount: 2, requiredModelId: 'gpt-5.5', requiredModelAvailable: true },
    checkedAt,
  };
}

function buildRunSpecV3({ artifactRoot, attestation = buildAttestation({ $schema: 'https://schemas.example/opencode-config.json', provider: { cpa: { npm: '@selected/cpa', name: 'CPA', options: { apiKey: 'SECRET-KEY', baseURL: 'https://api.cpa.example/v1/' } } } }) } = {}) {
  const probe = loadJson(V3_PATH);
  const manifest = makeManifest();
  const caseValue = manifest.cases[0];
  const artifactRootPathSha256 = hashArtifactRootPathV2(path.resolve(artifactRoot));
  const promptText = 'prompt ok';
  const runSpec = {
    manifest,
    manifestSha256: sha256CanonicalJson(manifest),
    probe,
    caseId: caseValue.id,
    caseSha256: sha256CanonicalJson(caseValue),
    scopeSha256: sha256CanonicalJson({ version: manifest.scopeContract.version, path: manifest.scopeContract.path }),
    promptText,
    promptSha256: sha256(promptText),
    qaSkillTreeSha256: sha256('qa-skill'),
    qaAgentSha256: sha256CanonicalJson({ agent: 'qa' }),
    qaCrAgentSha256: sha256CanonicalJson({ agent: 'qa-cr' }),
    providerId: 'cpa',
    modelId: 'cpa/gpt-5.5',
    expectedRuntimeVersion: RUNTIME_VERSION,
    expectedExecutableSha256: sha256('exe-bytes'),
    artifactRootPathSha256,
    fixtureTreeSha256: sha256('fixture'),
    candidateDiffSha256: sha256('diff'),
    credentialReadiness: attestation,
  };
  runSpec.authorization = {
    schemaVersion: ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION,
    authorizationId: 'qa-cr-b2-parent-export-v3-attempt-1',
    probeId: probe.probeID,
    probeSha256: sha256CanonicalJson(probe),
    attempt: 1,
    maxAttempts: 1,
    retryPolicy: 'none',
    status: 'AUTHORIZED',
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
    artifactRootPathSha256,
    configProfileSchemaVersion: attestation.configProfile.schemaVersion,
    configResolutionMethod: attestation.configProfile.source,
    configSelection: attestation.configProfile.selection,
    resolvedConfigProfileSha256: attestation.configProfileSha256,
    providerEndpointOriginPathSha256: attestation.configProfile.providerEndpointOriginPathSha256,
    readinessAttestationSchemaVersion: attestation.schemaVersion,
    readinessAttestationId: attestation.attestationId,
    readinessMethod: attestation.check.method,
    readinessPathSuffix: attestation.check.pathSuffix,
    readinessRequiredStatus: attestation.check.httpStatus,
    readinessRequiredModelId: attestation.check.requiredModelId,
    readinessMaxAgeMs: 60000,
  };
  return runSpec;
}

async function happyRunnerFixture(runSpec) {
  return {
    parentJsonl: readFileSync(resolve(FIXTURE_DIR, 'parent-events.jsonl'), 'utf8'),
    parentExport: { sessionId: PARENT_SESSION_ID, exportStatus: 'OK', exportErrorCode: null, exportText: readFileSync(resolve(FIXTURE_DIR, 'parent-export.json'), 'utf8') },
    childExports: [{ sessionId: CHILD_SESSION_ID, exportStatus: 'OK', exportErrorCode: null, exportText: readFileSync(resolve(FIXTURE_DIR, 'child-export.json'), 'utf8') }],
    observation: safeObservation(runSpec),
    runtimePin: runtimePinPass(runSpec),
  };
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function makeAuthorizationFileV3({ root, context, overrides = {} }) {
  const authorizationPath = path.join(root, 'authorization-v3.json');
  writeJson(authorizationPath, {
    schemaVersion: ATTEMPT_AUTHORIZATION_V3_SCHEMA_VERSION,
    authorizationId: 'qa-cr-b2-parent-export-v3-attempt-1',
    probeId: context.probe.probeID,
    probeSha256: context.probeSha256,
    attempt: 1,
    maxAttempts: 1,
    retryPolicy: 'none',
    status: 'AUTHORIZED',
    manifestSha256: context.manifestSha256,
    scopeSha256: context.scopeSha256,
    caseId: context.caseId,
    caseSha256: context.caseSha256,
    fixtureTreeSha256: context.fixtureTreeSha256,
    candidateDiffSha256: context.candidateDiffSha256,
    promptSha256: context.promptSha256,
    qaSkillTreeSha256: context.qaSkillTreeSha256,
    qaAgentSha256: context.qaAgentSha256,
    qaCrAgentSha256: context.qaCrAgentSha256,
    providerId: context.providerId,
    modelId: context.modelId,
    expectedRuntimeVersion: context.expectedRuntimeVersion,
    expectedExecutableSha256: context.expectedExecutableSha256,
    artifactRootPathSha256: context.artifactRootPathSha256,
    configProfileSchemaVersion: context.credentialReadiness.configProfile.schemaVersion,
    configResolutionMethod: context.credentialReadiness.configProfile.source,
    configSelection: context.credentialReadiness.configProfile.selection,
    resolvedConfigProfileSha256: context.credentialReadiness.configProfileSha256,
    providerEndpointOriginPathSha256: context.credentialReadiness.configProfile.providerEndpointOriginPathSha256,
    readinessAttestationSchemaVersion: context.credentialReadiness.schemaVersion,
    readinessAttestationId: context.credentialReadiness.attestationId,
    readinessMethod: context.credentialReadiness.check.method,
    readinessPathSuffix: context.credentialReadiness.check.pathSuffix,
    readinessRequiredStatus: context.credentialReadiness.check.httpStatus,
    readinessRequiredModelId: context.credentialReadiness.check.requiredModelId,
    readinessMaxAgeMs: 60000,
    ...overrides,
  });
  return authorizationPath;
}

function makeSpawnResult(stdout, overrides = {}) {
  return {
    stdout,
    stderr: '',
    status: 0,
    signal: null,
    error: null,
    ...overrides,
  };
}

function makeConfig(baseURL = 'https://api.cpa.example/v1/') {
  return JSON.stringify({
    $schema: 'https://schemas.example/opencode-config.json',
    plugins: { keep: false },
    provider: {
      cpa: {
        name: 'CPA',
        npm: '@selected/cpa',
        models: ['gpt-5.5'],
        endpoint: 'https://shadow.cpa.example/v1',
        options: {
          baseURL,
          apiKey: 'SECRET-KEY',
          access: 'SECRET-ACCESS',
          refresh: 'SECRET-REFRESH',
          headersURL: 'https://headers.cpa.example/internal',
          cachePath: 'C:\\host-path-sentinel\\cache.json',
          nested: { token: 'SECRET-TOKEN', credential: 'SECRET-CREDENTIAL' },
        },
        authorization: 'SECRET-AUTHZ',
        authBlob: { token: 'BLOB-TOKEN' },
      },
      anthropic: { options: { apiKey: 'LEAK-ANTHROPIC' } },
      openai: { options: { apiKey: 'LEAK-OPENAI' } },
    },
    unrelated: true,
  });
}

function makeResponse({ status = 200, contentType = 'application/json', body = '{}' } = {}) {
  return {
    status,
    headers: { get(name) { return name.toLowerCase() === 'content-type' ? contentType : null; } },
    body: Readable.from([body]),
  };
}

test('exact V2/V3 profile lookup and canonical probe validation stay locked', () => {
  assert.deepEqual(Object.keys(PARENT_EXPORT_RUN_PROFILES), ['qa-cr-b2-parent-export-v2', 'qa-cr-b2-parent-export-v3']);
  const v2 = lookupParentExportRunProfile('qa-cr-b2-parent-export-v2');
  const v3 = lookupParentExportRunProfile('qa-cr-b2-parent-export-v3');
  assert.equal(v2.canonicalProbeSha256, '778b077745b5e5b8b0dfdb911d37feead47f6505f3eaa1709e0833118cd72d25');
  assert.equal(v3.canonicalProbeSha256, sha256CanonicalJson(loadJson(V3_PATH)));
  assert.equal(PHASE_B2_PARENT_EXPORT_V3_PROBE_SHA256, sha256CanonicalJson(loadJson(V3_PATH)));
  assert.equal(lookupParentExportRunProfile('qa-cr-b2-parent-export-v9'), null);
  assert.equal(validateExactParentExportProbe(loadJson(V2_PATH)).ok, true);
  assert.equal(validateExactParentExportProbe(loadJson(V3_PATH)).ok, true);
  const drift = loadJson(V3_PATH);
  drift.runtime.modelID = 'gpt-5.4';
  const nested = validateExactParentExportProbe(drift);
  assert.equal(nested.ok, false);
  assert.equal(nested.code, 'parent_export_probe_sha256_mismatch');
  assert.equal(JSON.stringify(loadJson(V3_PATH)).includes('C:\\host-path-sentinel'), false);
});

test('V3 probe binding validation requires exact canonical values for every supplied binding surface', () => {
  const probe = loadJson(V3_PATH);
  const bindings = probe.authorization;
  assert.equal(validateExactParentExportProbe(probe).ok, true);
  for (const candidate of [
    { probe: { ...probe, authorization: { ...probe.authorization, expectedExecutableSha256: 'f'.repeat(64) } } },
    { authorization: { probeId: probe.probeID, expectedExecutableSha256: bindings.expectedExecutableSha256, artifactRootPathSha256: 'f'.repeat(64) } },
    { identity: { probeId: probe.probeID, expectedExecutableSha256: 'f'.repeat(64), artifactRootPathSha256: bindings.artifactRootPathSha256 } },
    { runtimePin: { expectedSha256: bindings.expectedExecutableSha256, sha256Before: bindings.expectedExecutableSha256, sha256After: 'f'.repeat(64) }, probeId: probe.probeID },
    { probeId: probe.probeID, expectedExecutableSha256: bindings.expectedExecutableSha256, artifactRootPathSha256: 'f'.repeat(64) },
  ]) {
    assert.equal(validateParentExportProbeBindings(candidate).ok, false);
  }
  assert.equal(validateParentExportProbeBindings({ probeId: 'qa-cr-b2-parent-export-v2', expectedExecutableSha256: 'f'.repeat(64), artifactRootPathSha256: 'e'.repeat(64) }).ok, true);
});

test('buildResolverEnvV3 keeps only launch and config-location keys', () => {
  const env = buildResolverEnvV3({
    PATH: 'p',
    APPDATA: 'a',
    XDG_CONFIG_HOME: 'x',
    OPENCODE_CONFIG_CONTENT: 'SECRET-CONFIG',
    OPENCODE_AUTH_CONTENT: 'SECRET-AUTH',
    CPA_API_KEY: 'SECRET-CPA',
    OPENAI_API_KEY: 'SECRET-OPENAI',
    RANDOM_THING: 'drop-me',
  });
  assert.deepEqual(env, { PATH: 'p', APPDATA: 'a', XDG_CONFIG_HOME: 'x' });
});

test('resolver uses exact command/options/env and returns projected safe config only', async () => {
  let seen = null;
  const result = await resolveSelectedCpaConfigV3({
    opencodeExecutable: 'opencode',
    cwd: ROOT,
    baseEnv: { PATH: 'p', USERPROFILE: 'u', OPENCODE_CONFIG_CONTENT: 'SECRET-CONFIG', CPA_API_KEY: 'SECRET-CPA' },
    spawnDebug: async (...args) => {
      seen = args;
      return makeSpawnResult(makeConfig('https://API.CPA.EXAMPLE:443/v1/'));
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, ['opencode', ['debug', 'config', '--pure'], { cwd: ROOT, env: { PATH: 'p', USERPROFILE: 'u' }, shell: false, timeout: 10000, maxBuffer: 8388608, encoding: 'utf8' }]);
  assert.deepEqual(Object.keys(result.selectedConfig).sort(), ['$schema', 'provider']);
  assert.deepEqual(Object.keys(result.selectedConfig.provider), ['cpa']);
  assert.deepEqual(Object.keys(result.selectedConfig.provider.cpa).sort(), ['npm', 'options']);
  assert.deepEqual(Object.keys(result.selectedConfig.provider.cpa.options).sort(), ['apiKey', 'baseURL']);
  assert.equal('plugins' in result.selectedConfig, false);
  assert.equal('anthropic' in result.selectedConfig.provider, false);
  assert.equal('openai' in result.selectedConfig.provider, false);
  assert.equal('unrelated' in result.selectedConfig, false);
  assert.equal('name' in result.selectedConfig.provider.cpa, false);
  assert.equal('models' in result.selectedConfig.provider.cpa, false);
  assert.equal('endpoint' in result.selectedConfig.provider.cpa, false);
  assert.equal('authorization' in result.selectedConfig.provider.cpa, false);
  assert.equal('authBlob' in result.selectedConfig.provider.cpa, false);
  assert.equal('access' in result.selectedConfig.provider.cpa.options, false);
  assert.equal('refresh' in result.selectedConfig.provider.cpa.options, false);
  assert.equal('headersURL' in result.selectedConfig.provider.cpa.options, false);
  assert.equal('cachePath' in result.selectedConfig.provider.cpa.options, false);
  assert.equal('nested' in result.selectedConfig.provider.cpa.options, false);
  assert.equal(result.configProfile.providerEndpointOriginPathSha256.length, 64);
  assert.equal(result.configProfile.providerNpm, '@selected/cpa');
  assert.equal(result.selectedConfig.provider.cpa.options.apiKey, 'SECRET-KEY');
  assert.equal(result.selectedConfig.provider.cpa.npm, '@selected/cpa');
  assert.equal(result.selectedConfig.provider.cpa.options.baseURL, 'https://api.cpa.example/v1');
  for (const expected of [
    result.selectedConfig.$schema,
    'SECRET-ACCESS',
    'SECRET-AUTHZ',
    'SECRET-CREDENTIAL',
    'SECRET-KEY',
    'SECRET-REFRESH',
    'SECRET-TOKEN',
    'https://API.CPA.EXAMPLE:443/v1/',
    'https://headers.cpa.example/internal',
    'C:\\host-path-sentinel\\cache.json',
    result.selectedConfigContent,
  ]) {
    assert.equal(result.sensitiveValues.includes(expected), true);
  }
  assert.equal(result.sensitiveValues.includes('@selected/cpa'), false);
  assert.equal(result.sensitiveValues.some((value) => /https:\/\/api\.cpa\.example(?::443)?$/.test(value)), true);
  assert.equal(result.sensitiveValues.some((value) => /https:\/\/api\.cpa\.example(?::443)?\/v1$/.test(value)), true);
  assert.equal(result.sensitiveValues.some((value) => /https:\/\/api\.cpa\.example(?::443)?\/v1\/models$/.test(value)), true);
  const safeSerialized = JSON.stringify({ configProfile: result.configProfile });
  assert.equal(safeSerialized.includes('SECRET-KEY'), false);
  assert.equal(safeSerialized.includes('SECRET-ACCESS'), false);
  assert.equal(safeSerialized.includes('C:\\host-path-sentinel'), false);
});

test('stripped unsupported resolved CPA fields do not affect selected config content or profile sha, but npm/baseURL changes do', async () => {
  const base = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig()) });
  const strippedDrift = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(JSON.stringify({
    $schema: 'https://schemas.example/opencode-config.json',
    provider: { cpa: { name: 'DIFFERENT', models: ['x'], endpoint: 'https://other.example/v2', authorization: 'OTHER-AUTH', npm: '@selected/cpa', options: { baseURL: 'https://api.cpa.example/v1/', apiKey: 'SECRET-KEY', cachePath: 'C:\\\\other-host\\\\cache.json', randomURL: 'https://random.example' } } },
  })) });
  const npmDrift = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(JSON.stringify({ $schema: 'https://schemas.example/opencode-config.json', provider: { cpa: { npm: '@other/cpa', options: { baseURL: 'https://api.cpa.example/v1/', apiKey: 'SECRET-KEY' } } } })) });
  const urlDrift = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(JSON.stringify({ $schema: 'https://schemas.example/opencode-config.json', provider: { cpa: { npm: '@selected/cpa', options: { baseURL: 'https://api.cpa.example/v2/', apiKey: 'SECRET-KEY' } } } })) });
  assert.equal(base.selectedConfigContent, strippedDrift.selectedConfigContent);
  assert.equal(base.configProfileSha256, strippedDrift.configProfileSha256);
  assert.notEqual(base.selectedConfigContent, npmDrift.selectedConfigContent);
  assert.notEqual(base.configProfileSha256, npmDrift.configProfileSha256);
  assert.notEqual(base.selectedConfigContent, urlDrift.selectedConfigContent);
  assert.notEqual(base.configProfileSha256, urlDrift.configProfileSha256);
});

test('resolver rejects npm surrounding whitespace', async () => {
  const result = await resolveSelectedCpaConfigV3({
    opencodeExecutable: 'opencode',
    cwd: ROOT,
    baseEnv: {},
    spawnDebug: async () => makeSpawnResult(JSON.stringify({
      $schema: 'https://schemas.example/opencode-config.json',
      provider: { cpa: { npm: ' @selected/cpa ', options: { baseURL: 'https://api.cpa.example/v1/', apiKey: 'SECRET-KEY' } } },
    })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID);
});

test('resolver failures are controlled and leak no raw sentinel', async () => {
  const sentinel = 'RAW-SENTINEL';
  const scenarios = [
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.EXIT_NONZERO, spawnDebug: async () => makeSpawnResult(sentinel, { status: 2 }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.SPAWN_ERROR, spawnDebug: async () => { throw new Error(sentinel); } },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.SIGNAL, spawnDebug: async () => makeSpawnResult(sentinel, { signal: 'SIGTERM' }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.TIMEOUT, spawnDebug: async () => makeSpawnResult(sentinel, { error: { code: 'ETIMEDOUT' } }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.STDERR_NOT_EMPTY, spawnDebug: async () => makeSpawnResult(sentinel, { stderr: sentinel }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.JSON_INVALID, spawnDebug: async () => makeSpawnResult('{"ok":true}\n{"tail":1}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID, spawnDebug: async () => makeSpawnResult('{"provider":{"cpa":{"options":{"baseURL":"https://a.example/v1"}}}}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID, spawnDebug: async () => makeSpawnResult('{"$schema":"x","provider":{"cpa":{}}}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID, spawnDebug: async () => makeSpawnResult('{"$schema":"x","provider":{"cpa":{"options":{"baseURL":"https://a.example/v1","apiKey":"k"}}}}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID, spawnDebug: async () => makeSpawnResult('{"$schema":"x","provider":{"cpa":{"npm":"https://pkg.example/cpa","options":{"baseURL":"https://a.example/v1","apiKey":"k"}}}}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID, spawnDebug: async () => makeSpawnResult('{"$schema":"x","provider":{"cpa":{"npm":"C:\\\\host-path-sentinel\\\\pkg","options":{"baseURL":"https://a.example/v1","apiKey":"k"}}}}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID, spawnDebug: async () => makeSpawnResult('{"$schema":"x","provider":{"cpa":{"npm":"pkg:npm/cpa","options":{"baseURL":"https://a.example/v1","apiKey":"k"}}}}') },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.BASE_URL_INVALID, spawnDebug: async () => makeSpawnResult(makeConfig('ftp://a.example/v1')) },
  ];
  for (const scenario of scenarios) {
    const result = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: scenario.spawnDebug });
    assert.equal(result.ok, false);
    assert.equal(result.code, scenario.expected);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
  }
});

test('base URL validation rejects userinfo/query/fragment/repeated separators and endpoint hash is deterministic and nonsecret', async () => {
  const badUrls = ['https://user:pass@a.example/v1', 'https://a.example/v1?x=1', 'https://a.example/v1#frag', 'https://a.example/v1//'];
  for (const baseURL of badUrls) {
    const result = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig(baseURL)) });
    assert.equal(result.ok, false);
    assert.equal(result.code, CREDENTIAL_READINESS_V3_ERROR_CODES.BASE_URL_INVALID);
  }
  const a = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig('https://API.CPA.EXAMPLE/v1/')) });
  const b = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig('https://api.cpa.example:443/v1/')) });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.configProfile.providerEndpointOriginPathSha256, b.configProfile.providerEndpointOriginPathSha256);
  assert.equal(a.selectedConfig.provider.cpa.options.baseURL, b.selectedConfig.provider.cpa.options.baseURL);
  assert.equal(a.configProfile.providerEndpointOriginPathSha256.includes('api.cpa.example'), false);
  assert.equal(JSON.stringify(a.configProfile).includes('SECRET-KEY'), false);
});

test('artifact-store redaction keeps safe providerNpm persisted while redacting raw path and URL secrets', async () => {
  const artifactRoot = tempRoot();
  try {
    const resolved = await resolveSelectedCpaConfigV3({
      opencodeExecutable: 'opencode',
      cwd: ROOT,
      baseEnv: {},
      spawnDebug: async () => makeSpawnResult(JSON.stringify({
        $schema: 'https://schemas.example/opencode-config.json',
        provider: {
          cpa: {
            npm: '@selected/cpa',
            options: {
              baseURL: 'https://API.CPA.EXAMPLE:443/v1/',
              apiKey: 'SECRET-KEY',
              cachePath: 'C:\\raw-secret-path\\cache.json',
            },
            headersURL: 'https://headers.cpa.example/internal',
            mirror: 'https://raw.example/nonstandard',
          },
        },
      })),
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.sensitiveValues.includes('@selected/cpa'), false);
    assert.equal(resolved.sensitiveValues.includes('C:\\raw-secret-path\\cache.json'), true);
    assert.equal(resolved.sensitiveValues.includes('https://raw.example/nonstandard'), true);

    const redactor = createRedactor({ sensitiveValues: resolved.sensitiveValues });
    assert.doesNotThrow(() => redactor.scan(Buffer.from(`${JSON.stringify({ configProfile: resolved.configProfile })}\n`, 'utf8')));
    assert.throws(() => redactor.scan(Buffer.from('echo C:\\raw-secret-path\\cache.json https://raw.example/nonstandard', 'utf8')), /secret_persisted/);

    const store = createImmutableRunStore({ artifactRoot, runId: 'unit-redaction-v3', redactor });
    let callbackReached = false;
    assert.doesNotThrow(() => {
      store.writeJson('credential-readiness.json', {
        schemaVersion: 'qa-cr-credential-readiness-attestation-v1',
        attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
        configProfile: resolved.configProfile,
        configProfileSha256: resolved.configProfileSha256,
        check: { method: 'GET', pathSuffix: '/models', httpStatus: 200, authenticated: true, modelCount: 2, requiredModelId: 'gpt-5.5', requiredModelAvailable: true },
        checkedAt: '2026-09-04T12:00:00.000Z',
      }, 'credential-readiness');
      store.writeJson('resolved-config-profile.json', resolved.configProfile, 'config-profile');
      store.writeText('runner-boundary.txt', 'echo C:\\raw-secret-path\\cache.json https://raw.example/nonstandard', 'boundary');
      callbackReached = true;
    });
    assert.equal(callbackReached, true);
    const persistedProfile = readFileSync(path.join(store.runDirectory, 'resolved-config-profile.json'), 'utf8');
    const persistedBoundary = readFileSync(path.join(store.runDirectory, 'runner-boundary.txt'), 'utf8');
    assert.match(persistedProfile, /"providerNpm": "@selected\/cpa"/);
    assert.equal(persistedBoundary.includes('C:\\raw-secret-path\\cache.json'), false);
    assert.equal(persistedBoundary.includes('https://raw.example/nonstandard'), false);
    assert.match(persistedBoundary, /\[REDACTED_SECRET\]/);
    store.markSealed();
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('equivalent accepted URL spellings canonicalize to identical selected config, profile sha, and launch inputs', async () => {
  const cases = [
    { npm: '@selected/cpa', baseURL: 'https://API.CPA.EXAMPLE/v1/' },
    { npm: '@selected/cpa', baseURL: 'https://api.cpa.example:443/v1' },
    { npm: '@selected/cpa', baseURL: 'https://api.cpa.example:443/v1/' },
  ];
  const results = [];
  for (const entry of cases) {
    results.push(await resolveSelectedCpaConfigV3({
      opencodeExecutable: 'opencode',
      cwd: ROOT,
      baseEnv: {},
      spawnDebug: async () => makeSpawnResult(JSON.stringify({
        $schema: 'https://schemas.example/opencode-config.json',
        provider: { cpa: { npm: entry.npm, options: { baseURL: entry.baseURL, apiKey: 'SECRET-KEY' } } },
      })),
    }));
  }
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.equal(result.selectedConfig.provider.cpa.npm, '@selected/cpa');
    assert.equal(result.selectedConfig.provider.cpa.options.baseURL, 'https://api.cpa.example/v1');
  }
  assert.equal(results[0].selectedConfigContent, results[1].selectedConfigContent);
  assert.equal(results[1].selectedConfigContent, results[2].selectedConfigContent);
  assert.equal(results[0].configProfileSha256, results[1].configProfileSha256);
  assert.equal(results[1].configProfileSha256, results[2].configProfileSha256);
});

test('profile-hash equality implies exact selectedConfig npm/baseURL equality in canonical table cases; path changes alter hash/content', async () => {
  const table = [
    { name: 'canonical', npm: '@selected/cpa', baseURL: 'https://api.cpa.example/v1', ok: true },
    { name: 'equivalent-spelling', npm: '@selected/cpa', baseURL: 'https://API.CPA.EXAMPLE:443/v1/', ok: true },
    { name: 'different-path', npm: '@selected/cpa', baseURL: 'https://api.cpa.example/v2/', ok: true },
    { name: 'repeated-separator', npm: '@selected/cpa', baseURL: 'https://api.cpa.example/v1//', ok: false },
  ];
  const accepted = [];
  for (const row of table) {
    const result = await resolveSelectedCpaConfigV3({
      opencodeExecutable: 'opencode',
      cwd: ROOT,
      baseEnv: {},
      spawnDebug: async () => makeSpawnResult(JSON.stringify({
        $schema: 'https://schemas.example/opencode-config.json',
        provider: { cpa: { npm: row.npm, options: { baseURL: row.baseURL, apiKey: 'SECRET-KEY' } } },
      })),
    });
    assert.equal(result.ok, row.ok);
    if (row.ok) accepted.push({ row, result });
    else assert.equal(result.code, CREDENTIAL_READINESS_V3_ERROR_CODES.BASE_URL_INVALID);
  }
  for (let i = 0; i < accepted.length; i += 1) {
    for (let j = i + 1; j < accepted.length; j += 1) {
      const left = accepted[i].result;
      const right = accepted[j].result;
      if (left.configProfileSha256 === right.configProfileSha256) {
        assert.equal(left.selectedConfig.provider.cpa.npm, right.selectedConfig.provider.cpa.npm);
        assert.equal(left.selectedConfig.provider.cpa.options.baseURL, right.selectedConfig.provider.cpa.options.baseURL);
        assert.equal(left.selectedConfigContent, right.selectedConfigContent);
      }
    }
  }
  assert.notEqual(accepted[0].result.configProfileSha256, accepted[2].result.configProfileSha256);
  assert.notEqual(accepted[0].result.selectedConfigContent, accepted[2].result.selectedConfigContent);
});

test('recursive persisted-value guard rejects nested URLs and absolute host paths', () => {
  for (const injected of [
    { nestedRepositoryURL: 'https://github.com/example/repo' },
    { nested: { deeper: [{ sourceURL: 'https://github.com/example/repo/blob/main/file.ts' }] } },
    { nested: { deeper: ['C:\\host-path-sentinel\\secret.json'] } },
    { nested: { deeper: ['\\\\unc-host\\share\\secret.json'] } },
    { nested: { deeper: ['/var/tmp/secret.json'] } },
  ]) {
    const badProfile = {
      schemaVersion: 'qa-cr-resolved-cpa-config-profile-v1',
      source: 'opencode-debug-config-pure',
      selection: '$schema+provider.cpa',
      providerId: 'cpa',
      providerNpm: '@selected/cpa',
      modelId: 'gpt-5.5',
      credentialPresent: true,
      providerEndpointOriginPathSha256: 'e'.repeat(64),
      ...injected,
    };
    const badAttestation = {
      schemaVersion: 'qa-cr-credential-readiness-attestation-v1',
      attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
      configProfile: badProfile,
      configProfileSha256: sha256CanonicalJson(badProfile),
      check: {
        method: 'GET',
        pathSuffix: '/models',
        httpStatus: 200,
        authenticated: true,
        modelCount: 1,
        requiredModelId: 'gpt-5.5',
        requiredModelAvailable: true,
      },
      checkedAt: '2026-09-04T12:00:00.000Z',
    };
    assert.equal(validateCredentialReadinessAttestationV3(badAttestation, {
      profileSha256: badAttestation.configProfileSha256,
      now: new Date('2026-09-04T12:00:30.000Z'),
    }).ok, false);
  }
  const allowedProfile = {
    schemaVersion: 'qa-cr-resolved-cpa-config-profile-v1',
    source: 'opencode-debug-config-pure',
    selection: '$schema+provider.cpa',
    providerId: 'cpa',
    providerNpm: '@selected/cpa',
    modelId: 'gpt-5.5',
    credentialPresent: true,
    providerEndpointOriginPathSha256: 'e'.repeat(64),
  };
  assert.equal(validateCredentialReadinessAttestationV3({
    schemaVersion: 'qa-cr-credential-readiness-attestation-v1',
    attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
    configProfile: allowedProfile,
    configProfileSha256: sha256CanonicalJson(allowedProfile),
    check: {
      method: 'GET',
      pathSuffix: '/models',
      httpStatus: 200,
      authenticated: true,
      modelCount: 1,
      requiredModelId: 'gpt-5.5',
      requiredModelAvailable: true,
    },
    checkedAt: '2026-09-04T12:00:00.000Z',
  }, {
    profileSha256: sha256CanonicalJson(allowedProfile),
    now: new Date('2026-09-04T12:00:30.000Z'),
  }).ok, true);
});

test('readiness passes exact safe attestation and excludes model list/key/baseURL from serialization', async () => {
  const resolved = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig()) });
  const seen = [];
  const now = new Date('2026-09-04T12:00:00.000Z');
  const result = await checkCpaCredentialReadinessV3({
    selectedConfig: resolved.selectedConfig,
    now,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }, { id: REQUIRED_MODEL_ID }] }) });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen[0].options.redirect, 'error');
  assert.equal(typeof seen[0].options.signal.aborted, 'boolean');
  assert.equal(seen[0].options.headers.accept, 'application/json');
  assert.equal(seen[0].options.headers.authorization, 'Bearer SECRET-KEY');
  assert.equal(seen[0].url.endsWith('/v1/models'), true);
  assert.deepEqual(result.attestation, {
    schemaVersion: 'qa-cr-credential-readiness-attestation-v1',
    attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
    configProfileSha256: result.attestation.configProfileSha256,
    configProfile: result.attestation.configProfile,
    check: {
      method: 'GET',
      pathSuffix: '/models',
      httpStatus: 200,
      authenticated: true,
      modelCount: 2,
      requiredModelId: 'gpt-5.5',
      requiredModelAvailable: true,
    },
    checkedAt: '2026-09-04T12:00:00.000Z',
  });
  const serialized = JSON.stringify(result.attestation);
  assert.equal(serialized.includes('SECRET-KEY'), false);
  assert.equal(serialized.includes('api.cpa.example'), false);
  assert.equal(serialized.includes('/v1/'), false);
  assert.equal(serialized.includes('C:\\host-path-sentinel'), false);
  assert.equal(serialized.includes('gpt-4.1'), false);
  assert.equal(validateCredentialReadinessAttestationV3(result.attestation, { profileSha256: result.attestation.configProfileSha256, now }).ok, true);
  const tampered = JSON.parse(serialized);
  tampered.check.requiredModelAvailable = false;
  assert.equal(validateCredentialReadinessAttestationV3(tampered, { profileSha256: result.attestation.configProfileSha256, now }).ok, false);
  assert.equal(validateCredentialReadinessAttestationV3(result.attestation, { profileSha256: result.attestation.configProfileSha256, now: new Date('2026-09-04T12:01:01.000Z') }).code, CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_EXPIRED);
  assert.equal(validateCredentialReadinessAttestationV3(result.attestation, { profileSha256: result.attestation.configProfileSha256, now: 'not-a-date' }).code, CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID);
});

test('readiness rejects redirect timeout oversize malformed non-json non200 duplicate invalid empty and missing required model', async () => {
  const resolved = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig()) });
  const scenarios = [
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.REDIRECT, fetchImpl: async () => ({ status: 302, headers: { get: () => 'application/json' }, body: Readable.from(['{}']) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.REDIRECT, fetchImpl: async () => ({ redirected: true, status: 200, headers: { get: () => 'application/json' }, body: Readable.from(['{}']) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.READINESS_TIMEOUT, fetchImpl: async (_url, options) => ({ status: 200, headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null }, body: { async *[Symbol.asyncIterator]() { await new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { const error = new Error('timeout'); error.name = 'AbortError'; reject(error); }, { once: true }); }); } } }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE, fetchImpl: async () => makeResponse({ body: 'x'.repeat(READINESS_MAX_BODY_BYTES + 1) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE, fetchImpl: async () => ({ status: 200, headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : name.toLowerCase() === 'content-length' ? String(READINESS_MAX_BODY_BYTES + 1) : null }, body: Readable.from(['{}']) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_INVALID, fetchImpl: async () => makeResponse({ body: '{' }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.CONTENT_TYPE, fetchImpl: async () => makeResponse({ contentType: 'text/plain' }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.HTTP_STATUS, fetchImpl: async () => makeResponse({ status: 401 }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID, fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: REQUIRED_MODEL_ID }, { id: REQUIRED_MODEL_ID }] }) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID, fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: '' }] }) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID, fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [] }) }) },
    { expected: CREDENTIAL_READINESS_V3_ERROR_CODES.REQUIRED_MODEL_MISSING, fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }] }) }) },
  ];
  for (const scenario of scenarios) {
    const result = await checkCpaCredentialReadinessV3({ selectedConfig: resolved.selectedConfig, fetchImpl: scenario.fetchImpl, now: new Date('2026-09-04T12:00:00.000Z') });
    assert.equal(result.ok, false);
    assert.equal(result.code, scenario.expected);
  }
  assert.equal(READINESS_TIMEOUT_MS, 15000);
});

test('v3 authorization fails closed on noncanonical bindings and unknown profile', () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const runSpec = buildRunSpecV3({ artifactRoot });
    const ok = validateAttemptAuthorizationV2(runSpec.authorization, {
      probeId: runSpec.probe.probeID,
      probeSha256: runSpec.authorization.probeSha256,
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
      artifactRootPathSha256: runSpec.artifactRootPathSha256,
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
    });
    assert.equal(ok.validationStatus, 'REJECTED');
    assert.equal(validateAttemptAuthorizationV2({ ...runSpec.authorization, extra: true }, {}).validationStatus, 'REJECTED');
    assert.equal(validateAttemptAuthorizationV2({ ...runSpec.authorization, probeId: 'qa-cr-b2-parent-export-v9' }, {}).validationStatus, 'REJECTED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v3 temp-root runSpec rejects before store creation and before runner', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const now = new Date('2026-09-04T12:00:30.000Z');
    const runSpec = buildRunSpecV3({ artifactRoot, attestation: buildAttestation({ $schema: 'https://schemas.example/opencode-config.json', provider: { cpa: { npm: '@selected/cpa', name: 'CPA', options: { apiKey: 'SECRET-KEY', baseURL: 'https://api.cpa.example/v1/' } } } }, '2026-09-04T12:00:00.000Z') });
    const identity = buildPrimaryRunIdentityV2(runSpec);
    assert.equal(identity.runId, `qa-cr-b2-parent-export-v3-a1-${identity.authorizationSha256.slice(0, 24)}`);
    let called = false;
    await assert.rejects(() => executePrimaryRunV2({ artifactRoot, runSpec, now, runner: async () => { called = true; return happyRunnerFixture(runSpec); } }), /probe_binding_invalid|invalid_run_spec/);
    assert.equal(called, false);
    assert.equal(readdirSync(artifactRoot).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy V3 replay binding mismatch fails before full envelope processing', async () => {
  const root = tempRoot();
  try {
    const runDirectory = path.join(root, 'qa-cr-b2-parent-export-v3-a1-deadbeefdeadbeefdeadbeef');
    mkdirSync(runDirectory, { recursive: true });
    const legacyEnvelope = {
      schemaVersion: EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION,
      stable: {
        identity: {
          artifactRootPathSha256: 'f'.repeat(64),
          attempt: 1,
          authorizationSha256: 'a'.repeat(64),
          candidateDiffSha256: 'b'.repeat(64),
          caseId: 'seed-defect-auth-guard-small',
          caseSha256: 'c'.repeat(64),
          expectedExecutableSha256: 'd'.repeat(64),
          expectedRuntimeVersion: '1.18.19',
          fixtureTreeSha256: 'e'.repeat(64),
          manifestSha256: 'f'.repeat(64),
          modelId: 'cpa/gpt-5.5',
          probeId: 'qa-cr-b2-parent-export-v3',
          probeSha256: PHASE_B2_PARENT_EXPORT_V3_PROBE_SHA256,
          providerId: 'cpa',
          promptSha256: '1'.repeat(64),
          qaAgentSha256: '2'.repeat(64),
          qaCrAgentSha256: '3'.repeat(64),
          qaSkillTreeSha256: '4'.repeat(64),
          retryPolicy: 'none',
          runId: 'qa-cr-b2-parent-export-v3-a1-deadbeefdeadbeefdeadbeef',
          scopeSha256: '5'.repeat(64),
        },
      },
    };
    writeFileSync(path.join(runDirectory, 'envelope.json'), `${JSON.stringify(legacyEnvelope, null, 2)}\n`, 'utf8');
    assert.deepEqual(replaySealedRunV2({ runDirectory }).diagnostics, ['v3_probe_binding_mismatch']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public V3 hold is unconditional and exports held authorization markers', async () => {
  let spawnDebugCalls = 0;
  let fetchCalls = 0;
  assert.equal(PHASE_B2_PARENT_EXPORT_V3_AUTHORIZATION_PATH, 'benchmarks/qa-cr-maturity/authorizations/b2-parent-export-v3-attempt-1.json');
  assert.equal(PHASE_B2_PARENT_EXPORT_V3_AUTHORIZATION_SHA256, null);
  await assert.rejects(() => executePhaseB2ParentExportV3({
    opencodeExecutable: process.execPath,
    authorizationPath: 'C:\\sentinel\\auth.json',
    artifactRoot: 'C:\\sentinel\\artifacts',
    spawnDebug: async () => { spawnDebugCalls += 1; return makeSpawnResult(makeConfig()); },
    fetchImpl: async () => { fetchCalls += 1; return makeResponse({ body: '{}' }); },
  }), { code: 'b2_v3_authorization_hold' });
  assert.equal(spawnDebugCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('prepare helper fails closed on canonical real-binding mismatch before temp version debug or fetch', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    let versionCalls = 0;
    let debugCalls = 0;
    let fetchCalls = 0;
    await assert.rejects(() => preparePhaseB2ParentExportV3AuthorizationContext({
      opencodeExecutable: process.execPath,
      artifactRoot,
      now: new Date('2026-09-04T12:00:30.000Z'),
      baseEnv: { PATH: process.env.PATH, USERPROFILE: 'C:\\host-path-sentinel', APPDATA: '\\\\unc-host\\cfg', CPA_API_KEY: 'NOPE' },
      spawnVersion: () => { versionCalls += 1; return { ok: true, observedVersion: RUNTIME_VERSION }; },
      spawnDebug: async () => { debugCalls += 1; return makeSpawnResult(makeConfig('https://api.cpa.example/v1/')); },
      fetchImpl: async () => { fetchCalls += 1; return makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }, { id: REQUIRED_MODEL_ID }] }) }); },
    }), { code: 'probe_binding_invalid' });
    assert.equal(versionCalls, 0);
    assert.equal(debugCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(readdirSync(artifactRoot).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('authorization consumption preflight rejects occupied auth-keyed run directory without mutation', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const runSpec = buildRunSpecV3({ artifactRoot });
    const authorization = {
      ...runSpec.authorization,
      expectedExecutableSha256: '426d31cbb676795183f2b1eb852eef1c83ab37566ac987eeb60e67932aaa71b8',
      artifactRootPathSha256: 'd330e546c23907485eb1e47b4b2a27223bf8400421992e9c2336ab9c29ed2a0f',
    };
    const authSha = sha256CanonicalJson(authorization);
    const runId = `qa-cr-b2-parent-export-v3-a1-${authSha.slice(0, 24)}`;
    const runDirectory = path.join(artifactRoot, runId);
    mkdirSync(runDirectory, { recursive: true });
    writeFileSync(path.join(runDirectory, 'sentinel.txt'), 'keep', 'utf8');
    assert.throws(() => preflightPhaseB2ParentExportV3AuthorizationConsumption({ authorization, artifactRoot }), { code: 'existing_run_directory' });
    assert.equal(readFileSync(path.join(runDirectory, 'sentinel.txt'), 'utf8'), 'keep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core source orders authorization-consumption preflight before executable and temp work', () => {
  const text = readFileSync(resolve('tests/orchestrator/maturity/real-smoke-runner-v3.mjs'), 'utf8');
  const preflightIndex = text.indexOf('const authorizationPreflight = preflightPhaseB2ParentExportV3AuthorizationConsumption');
  const executableIndex = text.indexOf('const { command: executablePath, invocation } = validateAbsoluteExecutable(opencodeExecutable);');
  const bindingIndex = text.indexOf('validateFixedRealBindingsOrThrow', preflightIndex);
  const tempIndex = text.indexOf("const tempRoot = mkdtempSync(path.join(tmpdir(), 'phase-b2-parent-export-v3-'));", preflightIndex);
  assert.ok(preflightIndex >= 0);
  assert.ok(executableIndex > preflightIndex);
  assert.ok(bindingIndex > preflightIndex);
  assert.ok(tempIndex > preflightIndex);
});

test('readiness timestamps after delayed response when no clock is injected', async () => {
  const resolved = await resolveSelectedCpaConfigV3({ opencodeExecutable: 'opencode', cwd: ROOT, baseEnv: {}, spawnDebug: async () => makeSpawnResult(makeConfig()) });
  let bodyDeliveredAt = null;
  const result = await checkCpaCredentialReadinessV3({
    selectedConfig: resolved.selectedConfig,
    fetchImpl: async () => ({
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      body: Readable.from((async function* delayedBody() {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        bodyDeliveredAt = Date.now();
        yield JSON.stringify({ data: [{ id: REQUIRED_MODEL_ID }] });
      })()),
    }),
  });
  assert.equal(result.ok, true);
  assert.ok(bodyDeliveredAt != null);
  assert.ok(Date.parse(result.attestation.checkedAt) >= bodyDeliveredAt);
});

test('V3 simulation is transient non-evidence, uses isolated OPENCODE_CONFIG_CONTENT only, and returns safe observations', async () => {
  const calls = [];
  const result = await executePhaseB2ParentExportV3Simulation({
    opencodeExecutable: process.execPath,
    now: new Date('2026-09-04T12:00:30.000Z'),
    baseEnv: { PATH: process.env.PATH, APPDATA: 'C:\\host-path-sentinel', CPA_API_KEY: 'ENV-SECRET', OPENCODE_AUTH_CONTENT: '{"cpa":{"key":"bad"}}', OPENAI_API_KEY: 'OPENAI' },
    spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
    spawnDebug: async () => makeSpawnResult(makeConfig()),
    fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }, { id: REQUIRED_MODEL_ID }] }) }),
    directSpawn(command, args, options) {
      calls.push({ kind: 'spawn', command, args, cwd: options.cwd, env: options.env });
      return { status: 0, signal: null, stdout: readFileSync(resolve(FIXTURE_DIR, 'parent-events.jsonl'), 'utf8'), stderr: 'RAW-OUTPUT-SENTINEL https://api.cpa.example/v1/ C:\\host-path-sentinel', error: null };
    },
    exportSession({ sessionId, projectRoot, env }) {
      calls.push({ kind: 'export', sessionId, cwd: projectRoot, env });
      return { status: 0, signal: null, stdout: readFileSync(resolve(FIXTURE_DIR, sessionId === PARENT_SESSION_ID ? 'parent-export.json' : 'child-export.json'), 'utf8'), stderr: '', error: null };
    },
  });
  assert.equal(result.executionClass, 'SIMULATION');
  assert.equal(result.evidenceEligible, false);
  assert.equal(result.persisted, false);
  assert.equal(result.runtimeStateRemoved, true);
  assert.equal(typeof result.simulationId, 'string');
  assert.equal(result.simulationId.startsWith('qa-cr-b2-parent-export-v3-simulation-'), true);
  assert.equal('runDirectory' in result, false);
  assert.equal('envelope' in result, false);
  assert.equal('facts' in result, false);
  assert.equal('replay' in result, false);
  assert.equal('probeId' in result, false);
  assert.equal(calls.filter((entry) => entry.kind === 'spawn').length, 1);
  assert.deepEqual(calls.filter((entry) => entry.kind === 'export').map((entry) => entry.sessionId), [PARENT_SESSION_ID, CHILD_SESSION_ID]);
  const spawnCall = calls.find((entry) => entry.kind === 'spawn');
  const parsedConfig = JSON.parse(spawnCall.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(Object.keys(parsedConfig).sort(), ['$schema', 'provider']);
  assert.deepEqual(Object.keys(parsedConfig.provider), ['cpa']);
  assert.deepEqual(Object.keys(parsedConfig.provider.cpa).sort(), ['npm', 'options']);
  assert.deepEqual(Object.keys(parsedConfig.provider.cpa.options).sort(), ['apiKey', 'baseURL']);
  assert.equal('OPENCODE_AUTH_CONTENT' in spawnCall.env, false);
  assert.equal('CPA_API_KEY' in spawnCall.env, false);
  assert.equal('OPENAI_API_KEY' in spawnCall.env, false);
  assert.equal(spawnCall.cwd, calls.find((entry) => entry.kind === 'export' && entry.sessionId === PARENT_SESSION_ID).cwd);
  assert.equal(spawnCall.env.OPENCODE_CONFIG_CONTENT.includes('SECRET-KEY'), true);
  assert.equal(existsSync(path.join(path.dirname(spawnCall.cwd), 'isolated-opencode', 'config.json')), false);
  assert.deepEqual(result.observations.childExportStatuses, ['OK']);
  assert.equal(result.observations.parentRunCount, 1);
  assert.equal(result.observations.parentExportCount, 1);
  assert.equal(result.observations.childExportCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /RAW-OUTPUT-SENTINEL|SECRET-KEY|SECRET-ACCESS|SECRET-REFRESH|SECRET-TOKEN|SECRET-CREDENTIAL|C:\\host-path-sentinel|api\.cpa\.example/i);
});

test('V3 simulation rejects evidence-oriented inputs before parent spawn', async () => {
  for (const extra of [
    { authorizationPath: 'C:\\auth.json' },
    { artifactRoot: 'C:\\artifacts' },
    { executePrimary: async () => ({}) },
  ]) {
    let spawnCalls = 0;
    await assert.rejects(() => executePhaseB2ParentExportV3Simulation({
      opencodeExecutable: process.execPath,
      now: new Date('2026-09-04T12:00:30.000Z'),
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      spawnDebug: async () => makeSpawnResult(makeConfig()),
      fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }, { id: REQUIRED_MODEL_ID }] }) }),
      directSpawn() { spawnCalls += 1; return { status: 0, stdout: '', stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
      ...extra,
    }), { code: 'b2_v3_simulation_evidence_forbidden' });
    assert.equal(spawnCalls, 0);
  }
});

test('V3 simulation rejects non-absolute authorization paths before parent spawn', async () => {
  await assert.rejects(() => executePhaseB2ParentExportV3Simulation({
    opencodeExecutable: process.execPath,
    authorizationPath: 'relative-auth.json',
    now: new Date('2026-09-04T12:00:30.000Z'),
    spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
    spawnDebug: async () => makeSpawnResult(makeConfig()),
    fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }, { id: REQUIRED_MODEL_ID }] }) }),
    directSpawn() { throw new Error('must not spawn'); },
    exportSession() { throw new Error('must not export'); },
  }), { code: 'b2_v3_simulation_evidence_forbidden' });
});

test('simulation safe result never reflects raw output sentinels', async () => {
  const result = await executePhaseB2ParentExportV3Simulation({
    opencodeExecutable: process.execPath,
    now: new Date('2026-09-04T12:00:30.000Z'),
    spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
    spawnDebug: async () => makeSpawnResult(makeConfig()),
    fetchImpl: async () => makeResponse({ body: JSON.stringify({ data: [{ id: 'x' }, { id: REQUIRED_MODEL_ID }] }) }),
    directSpawn() {
      return { status: 0, signal: null, stdout: readFileSync(resolve(FIXTURE_DIR, 'parent-events.jsonl'), 'utf8'), stderr: 'RAW-OUTPUT-SENTINEL https://api.cpa.example/v1/ C:\\host-path-sentinel', error: null };
    },
    exportSession({ sessionId }) {
      return { status: 0, signal: null, stdout: readFileSync(resolve(FIXTURE_DIR, sessionId === PARENT_SESSION_ID ? 'parent-export.json' : 'child-export.json'), 'utf8'), stderr: '', error: null };
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /RAW-OUTPUT-SENTINEL|api\.cpa\.example|C:\\host-path-sentinel/i);
});
