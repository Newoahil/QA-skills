import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  RUN_TELEMETRY_V2_SCHEMA_VERSION,
  aggregateRunTelemetryV2,
  collectChildSessionTelemetryV2,
  collectEmitTimingV2,
  collectParentSessionTelemetryV2,
} from './collect-run-telemetry-v2.mjs';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION, replaySealedRunV2, validateEvidenceEnvelopeV2 } from './evidence-envelope-v2.mjs';
import { buildPrimaryRunIdentityV2, executePrimaryRunV2 } from './primary-run-harness-v2.mjs';
import { executePhaseB2ParentExportV2, executePhaseB2ParentExportV2Simulation, PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_PATH, PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_SHA256, PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES, preparePhaseB2ParentExportV2AuthorizationContext, validatePhaseB2ParentExportV2ActivationAuthorization } from './real-smoke-runner-v2.mjs';
import { SCORE_INPUT_FACTS_V2_SCHEMA_VERSION } from './score-input-facts-v2.mjs';
import { ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION, RUNTIME_PIN_V2_SCHEMA_VERSION, finalizeRuntimePinV2, hashArtifactRootPathV2, inspectRuntimePinV2, sha256CanonicalValueV2, validateAttemptAuthorizationV2, validateProbeV2, validateRuntimePinV2 } from './runtime-pin-v2.mjs';
import { sha256CanonicalJson } from './case-manifest.mjs';

const FIXTURE_DIR = resolve('tests/orchestrator/maturity/fixtures/opencode-1.18.19');
const PARENT_SESSION_ID = 'ses_01K4A7Z7P3V4P6M9Q8R2S1T0U';
const CHILD_SESSION_ID = 'ses_01K4A7ZB8N2D5F7H9J1K3M5P7R';
const RUNTIME_VERSION = '1.18.19';

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'phase-b2-v2-'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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

async function loadProbe() {
  return JSON.parse(await readFile(resolve('benchmarks/qa-cr-maturity/probes/b2-parent-export-v2.json'), 'utf8'));
}

function buildRunSpec({ probe, artifactRoot, promptText = 'prompt ok', modelId = 'cpa/gpt-5.5', fixtureTreeSha256 = sha256('fixture'), candidateDiffSha256 = sha256('diff'), qaSkillTreeSha256 = sha256('qa-skill') } = {}) {
  const manifest = makeManifest();
  const caseValue = manifest.cases[0];
  const artifactRootPathSha256 = hashArtifactRootPathV2(path.resolve(artifactRoot));
  const expectedExecutableSha256 = sha256('exe-bytes');
  const manifestSha256 = sha256CanonicalJson(manifest);
  const caseSha256 = sha256CanonicalJson(caseValue);
  const scopeSha256 = sha256CanonicalJson({ version: manifest.scopeContract.version, path: manifest.scopeContract.path });
  const promptSha256 = sha256(promptText);
  const qaAgentSha256 = sha256CanonicalJson({ agent: 'qa' });
  const qaCrAgentSha256 = sha256CanonicalJson({ agent: 'qa-cr' });
  return {
    manifest,
    manifestSha256,
    probe,
    authorization: {
      schemaVersion: ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION,
      authorizationId: 'qa-cr-b2-parent-export-v2-attempt-1',
      probeId: probe.probeID,
      probeSha256: sha256CanonicalJson(probe),
      attempt: 1,
      maxAttempts: 1,
      retryPolicy: 'none',
      status: 'AUTHORIZED',
      manifestSha256,
      scopeSha256,
      caseId: caseValue.id,
      caseSha256,
      fixtureTreeSha256,
      candidateDiffSha256,
      promptSha256,
      qaSkillTreeSha256,
      qaAgentSha256,
      qaCrAgentSha256,
      providerId: 'cpa',
      modelId,
      expectedRuntimeVersion: RUNTIME_VERSION,
      expectedExecutableSha256,
      artifactRootPathSha256,
    },
    caseId: caseValue.id,
    caseSha256,
    scopeSha256,
    promptText,
    promptSha256,
    qaSkillTreeSha256,
    qaAgentSha256,
    qaCrAgentSha256,
    providerId: 'cpa',
    modelId,
    expectedRuntimeVersion: RUNTIME_VERSION,
    expectedExecutableSha256,
    artifactRootPathSha256,
    fixtureTreeSha256,
    candidateDiffSha256,
  };
}

function safeObservation(runSpec, overrides = {}) {
  const productCompositeSha256 = sha256CanonicalValueV2({ fixtureTreeSha256: runSpec.fixtureTreeSha256, candidateDiffSha256: runSpec.candidateDiffSha256 });
  return {
    terminal: { exitCode: 0, signal: null, errorCode: null, timedOut: false },
    command: 'SECRET-COMMAND',
    manifestSha256: sha256CanonicalJson(runSpec.manifest),
    scopeSha256: runSpec.scopeSha256,
    caseSha256: sha256CanonicalJson(runSpec.manifest.cases[0]),
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
    productCompositeSha256Before: productCompositeSha256,
    productCompositeSha256After: productCompositeSha256,
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
    ...overrides,
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

function childExportFixture() {
  return JSON.stringify({
    info: { id: CHILD_SESSION_ID, projectID: 'pro_fixture', directory: '[redacted]', title: 'child', parentID: PARENT_SESSION_ID, version: RUNTIME_VERSION, time: { created: 1725404401000, updated: 1725404402000 } },
    messages: [
      { info: { id: 'child-user', role: 'user', sessionID: CHILD_SESSION_ID, time: { created: 1725404401000 }, agent: 'qa-cr', model: { providerID: 'cpa', modelID: 'gpt-5.5' } }, parts: [{ type: 'text', text: 'prompt' }] },
      { info: { id: 'child-msg', role: 'assistant', sessionID: CHILD_SESSION_ID, parentID: 'child-user', time: { created: 1725404401000, completed: 1725404402000 }, modelID: 'gpt-5.5', providerID: 'cpa', mode: 'qa-cr', agent: 'qa-cr', path: { cwd: '[redacted]', root: '[redacted]' }, cost: 0.22, tokens: { input: 80, output: 30, reasoning: 12, cache: { read: 4, write: 2 } } }, parts: [{ type: 'step-finish', id: 'child-step', sessionID: CHILD_SESSION_ID, messageID: 'child-msg', reason: 'stop', tokens: { input: 80, output: 30, reasoning: 12, cache: { read: 4, write: 2 } }, cost: 0.22 }] },
    ],
  });
}

function parentJsonlWithChildOutputSessionId(sessionId = CHILD_SESSION_ID) {
  return JSON.stringify({
    type: 'tool_use',
    sessionID: PARENT_SESSION_ID,
    part: {
      tool: 'task',
      state: {
        status: 'completed',
        input: { subagent_type: 'qa-cr' },
        metadata: {},
        output: `<task_metadata>session_id: ${sessionId}</task_metadata>`,
      },
    },
  }) + '\n' + readFileSync(resolve(FIXTURE_DIR, 'parent-events.jsonl'), 'utf8').trim().split(/\r?\n/).slice(1).join('\n');
}

async function happyRunnerFixture(runSpec) {
  const { parentExport } = await loadFixtures();
  return {
    parentJsonl: await readFile(resolve(FIXTURE_DIR, 'parent-events.jsonl'), 'utf8'),
    parentExport: { sessionId: PARENT_SESSION_ID, exportStatus: 'OK', exportErrorCode: null, exportText: JSON.stringify(parentExport) },
    childExports: [{ sessionId: CHILD_SESSION_ID, exportStatus: 'OK', exportErrorCode: null, exportText: childExportFixture() }],
    observation: safeObservation(runSpec),
    runtimePin: runtimePinPass(runSpec),
  };
}

async function loadFixtures() {
  const [parentJsonlText, parentExportText, childExportText] = await Promise.all([
    readFile(resolve(FIXTURE_DIR, 'parent-events.jsonl'), 'utf8'),
    readFile(resolve(FIXTURE_DIR, 'parent-export.json'), 'utf8'),
    readFile(resolve(FIXTURE_DIR, 'child-export.json'), 'utf8'),
  ]);
  return {
    parentEvents: parentJsonlText.trim().split(/\r?\n/).map((line) => JSON.parse(line)),
    parentExport: JSON.parse(parentExportText),
    childExport: JSON.parse(childExportText),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function refreshInventory(runDirectory, inventory) {
  return inventory.map((entry) => {
    const bytes = readFileSync(path.join(runDirectory, entry.path));
    return { ...entry, sha256: sha256(bytes), bytes: bytes.length };
  });
}

function assertAuthoritativeV2RealGate(result, artifactRoot) {
  const message = JSON.stringify(result.safeDiagnostics);
  assert.equal(result.facts.sourceAuthorityStatus, 'AUTHORITATIVE', message);
  assert.equal(result.facts.observationStatus, 'COMPLETE', message);
  assert.equal(result.facts.telemetry.parentStatus, 'COMPLETE', message);
  assert.deepEqual(result.facts.telemetry.childStatuses, ['COMPLETE'], message);
  assert.equal(result.facts.telemetry.aggregateStatus, 'COMPLETE', message);
  assert.equal(result.facts.telemetry.emitTimingStatus, 'COMPLETE', message);
  assert.equal(result.facts.telemetry.emitTimingDiagnosticOnly, true, message);
  assert.equal(result.facts.childTopology.observedChildSessionIds.length, 1, message);
  assert.equal(result.telemetry.children.length, 1, message);
  assert.equal(result.telemetry.children[0].sessionId, result.facts.childTopology.observedChildSessionIds[0], message);
  assert.equal(result.facts.childTopology.parentLinkageStatus, 'MATCH', message);
  assert.deepEqual(result.facts.childTopology.issueCodes, [], message);
  assert.deepEqual(result.facts.sourceAuthorityIssueCodes, [], message);
  assert.equal(result.facts.primaryDisposition.classificationKind, 'usable', message);
  assert.equal(result.facts.primaryDisposition.substantiveEvidence, true, message);
  assert.equal(result.facts.runtimePin.eligibilityStatus, 'ELIGIBLE', message);
  assert.equal(result.facts.runtimePin.hashStatus, 'MATCH', message);
  assert.equal(Object.values(result.facts.provenance).every((value) => value === 'MATCH'), true, message);
  assert.equal(Object.values(result.facts.mutations).every((value) => value === 'UNCHANGED'), true, message);
  assert.equal(result.facts.terminal.status, 'SUCCESS', message);
  assert.equal(result.facts.parse.parentJsonlStatus, 'PARSED', message);
  assert.equal(result.facts.parse.parentExportStatus, 'OK', message);
  assert.deepEqual(result.facts.parse.childExportStatuses, ['OK'], message);
  assert.equal(result.facts.exportObservations.parent.status, 'OK', message);
  assert.deepEqual(result.facts.exportObservations.children.map((entry) => entry.status), ['OK'], message);
  assert.equal(result.replay.authorityStatus, 'AUTHORITATIVE', message);
  assert.equal(result.replay.replayStatus, 'OK', message);
  assert.deepEqual(result.safeDiagnostics, [], message);
  assert.equal(path.dirname(result.runDirectory), path.resolve(artifactRoot), message);
  assert.equal(existsSync(path.join(result.runDirectory, 'parent-export.json')), true, message);
  assert.equal(existsSync(path.join(result.runDirectory, 'child-exports', '000.json')), true, message);
  assert.equal(existsSync(path.join(result.runDirectory, 'child-export-observations', '000.json')), true, message);
  assert.equal(result.runtimeStateRemoved, true, message);
}

function makeProviderConfigV2(root, secret = 'provider-secret-value') {
  const providerConfigPath = path.join(root, 'provider-config.json');
  writeFileSync(providerConfigPath, `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { cpa: { npm: '@fake/cpa', name: 'CPA', options: { apiKey: secret } } } }, null, 2)}\n`, 'utf8');
  return providerConfigPath;
}

function stepTokens() {
  return { input: 5, output: 4, reasoning: 0, cache: { read: 0, write: 0 } };
}

function parentTextEventV2({ parentSessionId = PARENT_SESSION_ID, messageId = 'msg-parent', partId = 'text-parent', text = 'done' } = {}) {
  return {
    type: 'text',
    timestamp: 3,
    sessionID: parentSessionId,
    part: { type: 'text', id: partId, sessionID: parentSessionId, messageID: messageId, text, time: { start: 2, end: 3 } },
  };
}

function parentReasoningEventV2({ parentSessionId = PARENT_SESSION_ID, messageId = 'msg-parent', partId = 'reasoning-parent', text = 'thinking' } = {}) {
  return {
    type: 'reasoning',
    timestamp: 4,
    sessionID: parentSessionId,
    part: { type: 'reasoning', id: partId, sessionID: parentSessionId, messageID: messageId, text, time: { start: 3, end: 4 } },
  };
}

function parentErrorEventV2({ parentSessionId = PARENT_SESSION_ID, timestamp = 5, error = { message: 'boom' }, part } = {}) {
  return { type: 'error', timestamp, sessionID: parentSessionId, error, ...(part === undefined ? {} : { part }) };
}

function parentTaskEventV2({ parentSessionId = PARENT_SESSION_ID, childSessionId = CHILD_SESSION_ID, subagentType = 'qa-cr', outputAgent = subagentType } = {}) {
  return JSON.stringify({
    type: 'tool_use',
    timestamp: 1,
    sessionID: parentSessionId,
    part: {
      type: 'tool',
      id: 'tool-task',
      callID: 'call-task',
      sessionID: parentSessionId,
      messageID: 'msg-parent',
      tool: 'task',
      state: {
        status: 'completed',
        input: { subagent_type: subagentType },
        metadata: childSessionId ? { sessionId: childSessionId } : {},
        output: `<task_result>QA_EVIDENCE_RESULT\nagent: ${outputAgent}\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- first attempt direct evidence\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>`,
        title: 'qa-cr task',
        time: { start: 1, end: 2 },
      },
    },
  });
}

function parentStepFinishV2({ parentSessionId = PARENT_SESSION_ID, messageId = 'msg-parent', partId = 'step-parent' } = {}) {
  return JSON.stringify({
    type: 'step_finish',
    sessionID: parentSessionId,
    timestamp: 1,
    part: { type: 'step-finish', id: partId, sessionID: parentSessionId, messageID: messageId, reason: 'stop', tokens: stepTokens(), cost: 0.3 },
  });
}

function validParentJsonlV2({ parentSessionId = PARENT_SESSION_ID, childSessionIds = [CHILD_SESSION_ID], extraTaskTypes = [] } = {}) {
  return [
    ...childSessionIds.map((childSessionId) => parentTaskEventV2({ parentSessionId, childSessionId })),
    ...extraTaskTypes.map((subagentType, index) => parentTaskEventV2({ parentSessionId, childSessionId: `ses_extra_${index}`, subagentType, outputAgent: subagentType })),
    parentStepFinishV2({ parentSessionId }),
  ].join('\n');
}

function validParentExportV2(parentSessionId = PARENT_SESSION_ID) {
  return JSON.stringify({
    info: { id: parentSessionId, projectID: 'pro_fixture', directory: '[redacted]', title: 'parent', version: RUNTIME_VERSION, time: { created: 1, updated: 2 } },
    messages: [
      { info: { id: 'user-parent', role: 'user', sessionID: parentSessionId, time: { created: 1 }, agent: 'qa', model: { providerID: 'cpa', modelID: 'gpt-5.5' } }, parts: [{ type: 'text', text: 'prompt' }] },
      { info: { id: 'msg-parent', role: 'assistant', sessionID: parentSessionId, parentID: 'user-parent', time: { created: 1, completed: 2 }, modelID: 'gpt-5.5', providerID: 'cpa', mode: 'qa', agent: 'qa', path: { cwd: '[redacted]', root: '[redacted]' }, cost: 0.3, tokens: stepTokens() }, parts: [{ type: 'step-finish', id: 'step-parent', sessionID: parentSessionId, messageID: 'msg-parent', reason: 'stop', tokens: stepTokens(), cost: 0.3 }] },
    ],
  });
}

function validChildExportV2(sessionId = CHILD_SESSION_ID, parentSessionId = PARENT_SESSION_ID) {
  return JSON.stringify({
    info: { id: sessionId, projectID: 'pro_fixture', directory: '[redacted]', title: 'child', parentID: parentSessionId, version: RUNTIME_VERSION, time: { created: 1, updated: 2 } },
    messages: [
      { info: { id: `user-${sessionId}`, role: 'user', sessionID: sessionId, time: { created: 1 }, agent: 'qa-cr', model: { providerID: 'cpa', modelID: 'gpt-5.5' } }, parts: [{ type: 'text', text: 'prompt' }] },
      { info: { id: `msg-${sessionId}`, role: 'assistant', sessionID: sessionId, parentID: `user-${sessionId}`, time: { created: 1, completed: 2 }, modelID: 'gpt-5.5', providerID: 'cpa', mode: 'qa-cr', agent: 'qa-cr', path: { cwd: '[redacted]', root: '[redacted]' }, cost: 0.2, tokens: stepTokens() }, parts: [{ type: 'step-finish', id: `step-${sessionId}`, sessionID: sessionId, messageID: `msg-${sessionId}`, reason: 'stop', tokens: stepTokens(), cost: 0.2 }] },
    ],
  });
}

async function makeAuthorizationFileV2({ root, context, overrides = {}, fileName = 'authorization.json' }) {
  const authPath = path.join(root, fileName);
  const authorization = {
    schemaVersion: ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION,
    authorizationId: 'qa-cr-b2-parent-export-v2-attempt-1',
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
    ...overrides,
  };
  writeFileSync(authPath, `${JSON.stringify(authorization, null, 2)}\n`, 'utf8');
  return authPath;
}

async function invokeProcessAdapterV2({
  parentResult = { status: 0, signal: null, stdout: validParentJsonlV2(), stderr: '', error: null },
  exportResults = new Map([[PARENT_SESSION_ID, { status: 0, stdout: validParentExportV2(), stderr: '', error: null }], [CHILD_SESSION_ID, { status: 0, stdout: validChildExportV2(), stderr: '', error: null }]]),
  authorizationOverrides = {},
  spawnVersion = () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
  readExecutableBytes = readFileSync,
  mutateDuringParent = null,
  baseEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, CPA_API_KEY: 'env-secret', OPENCODE_AUTH_CONTENT: JSON.stringify({ token: 'auth-secret' }), HOME: path.join(tmpdir(), 'host-home-v2'), APPDATA: path.join(tmpdir(), 'host-appdata-v2'), XDG_CONFIG_HOME: path.join(tmpdir(), 'host-xdg-v2') },
  extraOptions = {},
} = {}) {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const providerConfigPath = makeProviderConfigV2(root);
    const context = preparePhaseB2ParentExportV2AuthorizationContext({
      opencodeExecutable: process.execPath,
      artifactRoot,
      spawnVersion,
      readExecutableBytes,
    });
    const authorizationPath = await makeAuthorizationFileV2({ root, context, overrides: authorizationOverrides });
    const calls = [];
    const result = await executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion,
      readExecutableBytes,
      baseEnv,
      directSpawn(command, args, options) {
        calls.push({ kind: 'spawn', command, args, cwd: options.cwd, env: options.env });
        if (typeof mutateDuringParent === 'function') mutateDuringParent(options.cwd);
        return parentResult;
      },
      exportSession({ sessionId, projectRoot, env, invocation }) {
        calls.push({ kind: 'export', sessionId, cwd: projectRoot, env, invocation });
        const hit = exportResults.get(sessionId);
        if (hit instanceof Error) throw hit;
        return hit ?? { status: 1, stdout: '', stderr: '', error: null };
      },
      ...extraOptions,
    });
    return { root, artifactRoot, providerConfigPath, authorizationPath, calls, result };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test('exports the expected public API constant', () => {
  assert.equal(RUN_TELEMETRY_V2_SCHEMA_VERSION, 'qa-cr-run-telemetry-v2');
});

test('fixture native shapes remain pinned', async () => {
  const { parentEvents, parentExport, childExport } = await loadFixtures();
  for (const event of parentEvents) {
    if (event.part?.type === 'step-start' || event.part?.type === 'step-finish') {
      assert.equal('time' in event.part, false);
      assert.equal('startedAt' in event.part, false);
      assert.equal('finishedAt' in event.part, false);
      assert.equal('startTimeMs' in event.part, false);
      assert.equal('endTimeMs' in event.part, false);
    }
    if (event.type === 'tool_use') assert.equal(event.part.type, 'tool');
  }
  for (const message of [...parentExport.messages, ...childExport.messages]) {
    assert.equal('role' in message, false);
    if (message.info.role === 'user') assert.equal('completed' in (message.info.time ?? {}), false);
  }
  assert.equal(parentExport.info.version, RUNTIME_VERSION);
  assert.equal(childExport.info.version, RUNTIME_VERSION);
  assert.equal('parentID' in parentExport.info, false);
  assert.equal(childExport.info.parentID, PARENT_SESSION_ID);
});

test('happy parent and child telemetry are COMPLETE and aggregate uses min max window', async () => {
  const { parentEvents, parentExport, childExport } = await loadFixtures();
  const parent = collectParentSessionTelemetryV2({
    events: parentEvents,
    exportJson: parentExport,
    exportStatus: 'OK',
    expectedSessionId: PARENT_SESSION_ID,
    expectedRuntimeVersion: RUNTIME_VERSION,
  });
  const child = collectChildSessionTelemetryV2({
    exportJson: childExport,
    exportStatus: 'OK',
    expectedSessionId: CHILD_SESSION_ID,
    expectedParentSessionId: PARENT_SESSION_ID,
    expectedRuntimeVersion: RUNTIME_VERSION,
  });
  const aggregate = aggregateRunTelemetryV2({ parent, children: [child], expectedChildSessionIds: [CHILD_SESSION_ID] });

  assert.equal(parent.accountingStatus, 'COMPLETE');
  assert.equal(child.accountingStatus, 'COMPLETE');
  assert.deepEqual(parent.usage.complete, {
    input: 220, output: 95, reasoning: 25, cacheRead: 11, cacheWrite: 7, derivedTotal: 358,
  });
  assert.equal(parent.cost.complete, 0.3);
  assert.equal(parent.counts.stepFinishParts, 2);
  assert.equal(parent.messageTiming.latencyMs, 4686);
  assert.deepEqual(child.usage.complete, {
    input: 80, output: 30, reasoning: 12, cacheRead: 4, cacheWrite: 2, derivedTotal: 128,
  });
  assert.equal(child.cost.complete, 0.22);
  assert.equal(aggregate.accountingStatus, 'COMPLETE');
  assert.equal(aggregate.messageTiming.startMs, 1725404400512);
  assert.equal(aggregate.messageTiming.endMs, 1725404405198);
  assert.equal(aggregate.messageTiming.latencyMs, 4686);
});

test('emit timestamp changes only affect diagnostic emit timing', async () => {
  const { parentEvents, parentExport } = await loadFixtures();
  const parentA = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: parentExport, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  const mutatedEvents = clone(parentEvents);
  mutatedEvents[0].timestamp += 999999;
  mutatedEvents[3].timestamp += 999999;
  const parentB = collectParentSessionTelemetryV2({ events: mutatedEvents, exportJson: parentExport, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  const emitA = collectEmitTimingV2(parentEvents);
  const emitB = collectEmitTimingV2(mutatedEvents);
  assert.notDeepEqual(emitA, emitB);
  assert.deepEqual(parentA.usage, parentB.usage);
  assert.deepEqual(parentA.cost, parentB.cost);
  assert.deepEqual(parentA.messageTiming, parentB.messageTiming);
});

test('emit schema accepts exact native text reasoning and error shapes', () => {
  const result = collectEmitTimingV2([
    JSON.parse(parentStepFinishV2()),
    parentTextEventV2({ text: '' }),
    parentReasoningEventV2({ text: '' }),
    parentErrorEventV2(),
  ]);
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.sourceAuthorityBlock, false);
});

test('emit schema rejects aliases message events and malformed native shapes', () => {
  const cases = [
    [{ type: 'message_start', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'text', id: 'x', sessionID: PARENT_SESSION_ID, messageID: 'm', text: 'x', time: { start: 0, end: 1 } } }, /emit_event_type_invalid/],
    [{ type: 'step-finish', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'step-finish', id: 'x', sessionID: PARENT_SESSION_ID, messageID: 'm', reason: 'stop', tokens: stepTokens(), cost: 1 } }, /emit_event_type_invalid/],
    [{ type: 'step_start', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'step-finish', id: 'x', sessionID: PARENT_SESSION_ID, messageID: 'm' } }, /emit_part_type_mismatch/],
    [{ type: 'step_start', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'step-start', id: '', sessionID: PARENT_SESSION_ID, messageID: 'm' } }, /emit_part_identity_invalid/],
    [{ type: 'step_finish', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'step-finish', id: 'x', sessionID: PARENT_SESSION_ID, messageID: 'm', tokens: stepTokens(), cost: 1 } }, /emit_step_finish_reason_invalid/],
    [{ type: 'tool_use', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'tool', id: 't', callID: 'c', sessionID: PARENT_SESSION_ID, messageID: 'm', tool: 'task', state: { status: 'completed', input: {}, metadata: null, output: '', title: '', time: { start: 2, end: 1 } } } }, /emit_tool_metadata_invalid|emit_tool_completed_shape_invalid|emit_tool_time_invalid/],
    [{ type: 'tool_use', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'tool', id: 't', callID: 'c', sessionID: PARENT_SESSION_ID, messageID: 'm', tool: 'task', state: { status: 'error', input: {}, error: '', time: { start: 0, end: 1 } } } }, /emit_tool_error_invalid/],
    [{ type: 'text', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'text', id: 't', sessionID: PARENT_SESSION_ID, messageID: 'm', text: null, time: { start: 0, end: 1 } } }, /emit_text_invalid/],
    [{ type: 'reasoning', timestamp: 1, sessionID: PARENT_SESSION_ID, part: { type: 'reasoning', id: 'r', sessionID: PARENT_SESSION_ID, messageID: 'm', text: 'ok', time: { start: 2, end: 1 } } }, /emit_reasoning_time_invalid/],
    [parentErrorEventV2({ error: null, part: { type: 'error', text: 'fake' } }), /emit_error_invalid/],
  ];
  for (const [event, pattern] of cases) {
    const result = collectEmitTimingV2([event]);
    assert.notEqual(result.status, 'COMPLETE');
    assert.equal(result.sourceAuthorityBlock, true);
    assert.match(JSON.stringify(result.issueCodes), pattern);
  }
});

test('missing step_finish reason blocks parent raw export and child export completion', async () => {
  const { parentEvents, parentExport, childExport } = await loadFixtures();
  const rawMissingReason = clone(parentEvents);
  delete rawMissingReason[2].part.reason;
  const rawMissingReasonResult = collectParentSessionTelemetryV2({ events: rawMissingReason, exportJson: parentExport, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.notEqual(rawMissingReasonResult.accountingStatus, 'COMPLETE');
  assert.match(JSON.stringify(rawMissingReasonResult.issueCodes), /step_reason_invalid|raw_export_step_value_mismatch/);

  const exportMissingReason = clone(parentExport);
  delete exportMissingReason.messages[1].parts[2].reason;
  const exportMissingReasonResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: exportMissingReason, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.notEqual(exportMissingReasonResult.accountingStatus, 'COMPLETE');
  assert.match(JSON.stringify(exportMissingReasonResult.issueCodes), /step_reason_invalid/);

  const childMissingReason = clone(childExport);
  delete childMissingReason.messages[1].parts[0].reason;
  const childMissingReasonResult = collectChildSessionTelemetryV2({ exportJson: childMissingReason, exportStatus: 'OK', expectedSessionId: CHILD_SESSION_ID, expectedParentSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.notEqual(childMissingReasonResult.accountingStatus, 'COMPLETE');
  assert.match(JSON.stringify(childMissingReasonResult.issueCodes), /step_reason_invalid/);
});

test('raw export mismatches fail closed', async () => {
  const { parentEvents, parentExport } = await loadFixtures();
  const cases = [
    () => { const x = clone(parentExport); x.messages[1].parts[2].id = 'other'; return { events: parentEvents, exportJson: x }; },
    () => { const x = clone(parentExport); x.messages[1].parts[2].tokens.output = 54; return { events: parentEvents, exportJson: x }; },
    () => { const x = clone(parentExport); x.messages[1].parts[2].cost = 0.19; return { events: parentEvents, exportJson: x }; },
    () => { const x = clone(parentExport); x.messages[1].parts[2].reason = 'other'; return { events: parentEvents, exportJson: x }; },
    () => { const x = clone(parentExport); x.messages[1].parts.splice(2, 1); return { events: parentEvents, exportJson: x }; },
  ];
  for (const build of cases) {
    const result = collectParentSessionTelemetryV2({
      ...build(),
      exportStatus: 'OK',
      expectedSessionId: PARENT_SESSION_ID,
      expectedRuntimeVersion: RUNTIME_VERSION,
    });
    assert.equal(result.reconciliation.rawJsonl, 'MISMATCH');
    assert.equal(result.accountingStatus, 'INVALID');
  }
});

test('duplicate step key and internal export mismatches fail closed', async () => {
  const { parentEvents, parentExport } = await loadFixtures();
  const dupEvents = clone(parentEvents);
  dupEvents.push(clone(parentEvents[3]));
  const duplicate = collectParentSessionTelemetryV2({ events: dupEvents, exportJson: parentExport, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(duplicate.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(duplicate.issueCodes), /duplicate_step_key/);

  const costMismatch = clone(parentExport);
  costMismatch.messages[1].info.cost = 0.29;
  assert.equal(collectParentSessionTelemetryV2({ events: parentEvents, exportJson: costMismatch, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const latestTokenMismatch = clone(parentExport);
  latestTokenMismatch.messages[1].info.tokens.output = 54;
  assert.equal(collectParentSessionTelemetryV2({ events: parentEvents, exportJson: latestTokenMismatch, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const parentIdPresent = clone(parentExport);
  parentIdPresent.info.parentID = 'unexpected';
  assert.equal(collectParentSessionTelemetryV2({ events: parentEvents, exportJson: parentIdPresent, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const badSession = clone(parentExport);
  badSession.info.id = 'other';
  assert.equal(collectParentSessionTelemetryV2({ events: parentEvents, exportJson: badSession, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const badVersion = clone(parentExport);
  badVersion.info.version = '0.0.0';
  assert.equal(collectParentSessionTelemetryV2({ events: parentEvents, exportJson: badVersion, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const incompleteTime = clone(parentExport);
  delete incompleteTime.messages[1].info.time.completed;
  const incomplete = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: incompleteTime, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(incomplete.messageTimingStatus, 'INVALID');
  assert.equal(incomplete.accountingStatus, 'INVALID');
});

test('child export linkage mismatches fail closed', async () => {
  const { childExport } = await loadFixtures();
  const badLinkage = clone(childExport);
  badLinkage.info.parentID = 'ses_other';
  const result = collectChildSessionTelemetryV2({ exportJson: badLinkage, exportStatus: 'OK', expectedSessionId: CHILD_SESSION_ID, expectedParentSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(result.accountingStatus, 'INVALID');
});

test('complete emit timestamps cannot make missing export or missing assistant completion complete', async () => {
  const { parentEvents, parentExport } = await loadFixtures();
  const emit = collectEmitTimingV2(parentEvents);
  assert.equal(emit.status, 'COMPLETE');
  const missingExport = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: null, exportStatus: 'MISSING', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.notEqual(missingExport.accountingStatus, 'COMPLETE');
  const incompleteTime = clone(parentExport);
  delete incompleteTime.messages[1].info.time.completed;
  const result = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: incompleteTime, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.notEqual(result.accountingStatus, 'COMPLETE');
});

test('malformed status and raw error strings remain controlled and secret safe', () => {
  const result = collectChildSessionTelemetryV2({
    exportJson: null,
    exportStatus: 'boom',
    exportErrorCode: 'raw stack trace secret',
    expectedSessionId: CHILD_SESSION_ID,
    expectedParentSessionId: PARENT_SESSION_ID,
    expectedRuntimeVersion: RUNTIME_VERSION,
  });
  assert.equal(result.accountingStatus, 'UNAVAILABLE');
  assert.match(JSON.stringify(result.issueCodes), /export_status_invalid/);
  assert.match(JSON.stringify(result.issueCodes), /export_error_code_invalid/);
  assert.doesNotMatch(JSON.stringify(result), /raw stack trace secret/);
  assert.doesNotMatch(JSON.stringify(result), /boom/);
});

test('controlled export availability and required non-empty identities fail closed', async () => {
  const { parentEvents, parentExport, childExport } = await loadFixtures();

  const okNull = collectParentSessionTelemetryV2({
    events: parentEvents,
    exportJson: null,
    exportStatus: 'OK',
    expectedSessionId: PARENT_SESSION_ID,
    expectedRuntimeVersion: RUNTIME_VERSION,
  });
  assert.notEqual(okNull.accountingStatus, 'COMPLETE');
  assert.match(JSON.stringify(okNull.issueCodes), /missing_export/);

  const missingStatus = collectChildSessionTelemetryV2({
    exportJson: childExport,
    expectedSessionId: CHILD_SESSION_ID,
    expectedParentSessionId: PARENT_SESSION_ID,
    expectedRuntimeVersion: RUNTIME_VERSION,
  });
  assert.equal(missingStatus.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(missingStatus.issueCodes), /export_status_missing/);

  const emptyTopId = clone(childExport);
  emptyTopId.info.id = '';
  assert.equal(collectChildSessionTelemetryV2({ exportJson: emptyTopId, exportStatus: 'OK', expectedSessionId: CHILD_SESSION_ID, expectedParentSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const emptyTopVersion = clone(childExport);
  emptyTopVersion.info.version = '';
  assert.equal(collectChildSessionTelemetryV2({ exportJson: emptyTopVersion, exportStatus: 'OK', expectedSessionId: CHILD_SESSION_ID, expectedParentSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION }).accountingStatus, 'INVALID');

  const emptyMessageId = clone(parentExport);
  emptyMessageId.messages[1].info.id = '';
  const emptyMessageResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: emptyMessageId, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(emptyMessageResult.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(emptyMessageResult.issueCodes), /assistant_message_identity_invalid/);

  const emptyMessageSessionId = clone(parentExport);
  emptyMessageSessionId.messages[1].info.sessionID = '';
  const emptySessionResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: emptyMessageSessionId, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(emptySessionResult.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(emptySessionResult.issueCodes), /assistant_message_identity_invalid/);

  const invalidReason = clone(parentExport);
  invalidReason.messages[1].parts[2].reason = '';
  const invalidReasonResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: invalidReason, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(invalidReasonResult.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(invalidReasonResult.issueCodes), /step_reason_invalid/);
});

test('assistant message reconciliation uses full exported ID set and requires steps', async () => {
  const { parentEvents, parentExport } = await loadFixtures();

  const extraAssistantNoStep = clone(parentExport);
  extraAssistantNoStep.messages.push({
    info: {
      id: 'msg_extra',
      role: 'assistant',
      sessionID: PARENT_SESSION_ID,
      time: { created: 1725404405200, completed: 1725404405201 },
      tokens: { input: 95, output: 55, reasoning: 10, cache: { read: 6, write: 4 }, total: 170 },
      cost: 0.3,
    },
    parts: [],
  });
  const extraAssistantResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: extraAssistantNoStep, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(extraAssistantResult.reconciliation.rawJsonl, 'MISMATCH');
  assert.equal(extraAssistantResult.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(extraAssistantResult.issueCodes), /assistant_message_missing_step_finish/);
  assert.match(JSON.stringify(extraAssistantResult.issueCodes), /raw_export_message_set_mismatch/);

  const duplicateAssistantId = clone(parentExport);
  duplicateAssistantId.messages.push(clone(duplicateAssistantId.messages[1]));
  const duplicateAssistantResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: duplicateAssistantId, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(duplicateAssistantResult.reconciliation.rawJsonl, 'MISMATCH');
  assert.equal(duplicateAssistantResult.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(duplicateAssistantResult.issueCodes), /duplicate_assistant_message_id/);
  assert.match(JSON.stringify(duplicateAssistantResult.issueCodes), /raw_export_message_set_mismatch/);

  const missingExportAssistant = clone(parentExport);
  missingExportAssistant.messages = missingExportAssistant.messages.filter((message) => message.info.id !== parentExport.messages[1].info.id);
  const missingExportAssistantResult = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: missingExportAssistant, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  assert.equal(missingExportAssistantResult.reconciliation.rawJsonl, 'MISMATCH');
  assert.equal(missingExportAssistantResult.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(missingExportAssistantResult.issueCodes), /raw_export_message_set_mismatch/);
});

test('aggregate fails closed on extra anonymous and duplicate expected child inputs', async () => {
  const { parentEvents, parentExport, childExport } = await loadFixtures();
  const parent = collectParentSessionTelemetryV2({ events: parentEvents, exportJson: parentExport, exportStatus: 'OK', expectedSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });
  const child = collectChildSessionTelemetryV2({ exportJson: childExport, exportStatus: 'OK', expectedSessionId: CHILD_SESSION_ID, expectedParentSessionId: PARENT_SESSION_ID, expectedRuntimeVersion: RUNTIME_VERSION });

  const unexpectedChild = { ...child, sessionId: 'ses_unexpected' };
  const withUnexpected = aggregateRunTelemetryV2({ parent, children: [child, unexpectedChild], expectedChildSessionIds: [CHILD_SESSION_ID] });
  assert.equal(withUnexpected.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(withUnexpected.issueCodes), /unexpected_child_session/);

  const anonymousChild = { ...child, sessionId: null };
  const withAnonymous = aggregateRunTelemetryV2({ parent, children: [child, anonymousChild], expectedChildSessionIds: [CHILD_SESSION_ID] });
  assert.equal(withAnonymous.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(withAnonymous.issueCodes), /anonymous_child_session/);

  const duplicateExpected = aggregateRunTelemetryV2({ parent, children: [child], expectedChildSessionIds: [CHILD_SESSION_ID, CHILD_SESSION_ID] });
  assert.equal(duplicateExpected.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(duplicateExpected.issueCodes), /duplicate_expected_child_session_id/);
});

test('runtime pin exact version/hash pass and controlled failures', async () => {
  const root = tempRoot();
  try {
    const exe = path.join(root, 'fake.exe');
    writeFileSync(exe, '1234');
    const expectedSha256 = sha256('1234');
    const preflight = inspectRuntimePinV2({ executablePath: exe, expectedSha256, spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
    assert.equal(preflight.eligibilityStatus, 'ELIGIBLE');
    const finalized = finalizeRuntimePinV2({ preflight, executablePath: exe, readExecutableBytes: readFileSync });
    assert.equal(finalized.eligibilityStatus, 'ELIGIBLE');
    assert.equal(finalized.sha256After, expectedSha256);

    const badVersion = inspectRuntimePinV2({ executablePath: exe, expectedSha256, spawnVersion: () => ({ ok: true, observedVersion: '0.0.0' }), readExecutableBytes: readFileSync });
    assert.match(JSON.stringify(badVersion.issueCodes), /version_mismatch/);

    const badHash = inspectRuntimePinV2({ executablePath: exe, expectedSha256: sha256('other'), spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
    assert.match(JSON.stringify(badHash.issueCodes), /sha256_mismatch/);

    const drift = finalizeRuntimePinV2({ preflight, executablePath: exe, readExecutableBytes: () => Buffer.from('drift') });
    assert.match(JSON.stringify(drift.issueCodes), /executable_sha256_drift/);

    const link = path.join(root, 'fake-link.exe');
    try {
      symlinkSync(exe, link);
      const linked = inspectRuntimePinV2({ executablePath: link, expectedSha256, spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
      assert.equal(linked.eligibilityStatus, 'INELIGIBLE');
      assert.match(JSON.stringify(linked.issueCodes), /symlink|not_direct/);
    } catch (error) {
      assert.equal(error.code, 'EPERM');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime pin invalid relative path and noisy version output are ineligible without throw', async () => {
  const relative = inspectRuntimePinV2({ executablePath: 'relative.exe', expectedSha256: 'a'.repeat(64) });
  assert.equal(relative.eligibilityStatus, 'INELIGIBLE');
  assert.equal(relative.pathSha256, null);
  assert.match(JSON.stringify(relative.issueCodes), /executable_path_not_absolute/);
  const root = tempRoot();
  try {
    const exe = path.join(root, 'fake.exe');
    writeFileSync(exe, '1234');
    const noisy = inspectRuntimePinV2({ executablePath: exe, expectedSha256: sha256('1234'), spawnVersion: () => ({ ok: false, code: 'version_output_malformed' }), readExecutableBytes: readFileSync });
    assert.equal(noisy.eligibilityStatus, 'INELIGIBLE');
    assert.match(JSON.stringify(noisy.issueCodes), /version_output_malformed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('eligible-shaped runtime pin rejects null structural fields and non-empty issue codes', () => {
  const expectedExecutableSha256 = sha256('exe-bytes');
  const base = runtimePinPass({ expectedExecutableSha256 });
  assert.equal(validateRuntimePinV2(base, { expectedExecutableSha256 }).eligibilityStatus, 'ELIGIBLE');
  for (const mutated of [
    { ...base, basename: null },
    { ...base, pathSha256: null },
    { ...base, bytes: null },
    { ...base, issueCodes: ['runtime_pin_invalid'] },
  ]) {
    assert.equal(validateRuntimePinV2(mutated, { expectedExecutableSha256 }).eligibilityStatus, 'INELIGIBLE');
  }
});

test('probe nested contract mutations and run spec prompt-model mismatches fail before runner', async () => {
  const probe = await loadProbe();
  const manifest = makeManifest();
  const valid = validateProbeV2(probe, {
    manifestId: manifest.manifestId,
    scopeId: manifest.scopeContract.version,
    expectedRuntimeVersion: RUNTIME_VERSION,
    providerId: 'cpa',
    modelId: 'cpa/gpt-5.5',
    agentParent: 'qa',
    agentChild: 'qa-cr',
  });
  assert.equal(valid.probeStatus, 'VALID');
  for (const mutated of [
    { ...probe, fixture: { ...probe.fixture, childExports: [] } },
    { ...probe, sourceProvenance: { ...probe.sourceProvenance, officialTag: 'v1.18.18' } },
    { ...probe, constraints: { ...probe.constraints, qaPromptUnchanged: false } },
    { ...probe, forbiddenClaims: [...probe.forbiddenClaims, 'extra-claim'] },
  ]) {
    assert.equal(validateProbeV2(mutated, { manifestId: manifest.manifestId, scopeId: manifest.scopeContract.version, expectedRuntimeVersion: RUNTIME_VERSION, providerId: 'cpa', modelId: 'cpa/gpt-5.5', agentParent: 'qa', agentChild: 'qa-cr' }).probeStatus, 'INVALID');
  }
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const runSpec = buildRunSpec({ probe, artifactRoot });
    let called = false;
    await assert.rejects(() => executePrimaryRunV2({ artifactRoot, runSpec: { ...runSpec, promptSha256: sha256('wrong') }, runner: async () => { called = true; return {}; } }));
    await assert.rejects(() => executePrimaryRunV2({ artifactRoot, runSpec: { ...runSpec, modelId: 'cpa/gpt-5.4', authorization: { ...runSpec.authorization, modelId: 'cpa/gpt-5.4' } }, runner: async () => { called = true; return {}; } }));
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('authorization exact-key and context binding fail closed', async () => {
  const root = tempRoot();
  mkdirSync(path.join(root, 'artifacts'));
  const context = preparePhaseB2ParentExportV2AuthorizationContext({ opencodeExecutable: process.execPath, artifactRoot: path.join(root, 'artifacts'), spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
  const auth = JSON.parse(JSON.stringify({
    schemaVersion: ATTEMPT_AUTHORIZATION_V2_SCHEMA_VERSION,
    authorizationId: 'qa-cr-b2-parent-export-v2-attempt-1',
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
  }));
  const ok = validateAttemptAuthorizationV2(auth, context);
  assert.equal(ok.validationStatus, 'AUTHORIZED');
  const bad = validateAttemptAuthorizationV2({ ...auth, extra: true }, context);
  assert.equal(bad.validationStatus, 'REJECTED');
  for (const [key, value] of Object.entries({
    probeId: 'qa-cr-b2-parent-export-v2-other',
    probeSha256: 'f'.repeat(64),
    manifestSha256: 'f'.repeat(64),
    scopeSha256: 'f'.repeat(64),
    caseId: 'case-2',
    caseSha256: 'f'.repeat(64),
    fixtureTreeSha256: 'f'.repeat(64),
    candidateDiffSha256: 'f'.repeat(64),
    promptSha256: 'f'.repeat(64),
    qaSkillTreeSha256: 'f'.repeat(64),
    qaAgentSha256: 'f'.repeat(64),
    qaCrAgentSha256: 'f'.repeat(64),
    providerId: 'other',
    modelId: 'cpa/gpt-5.4',
    expectedRuntimeVersion: '0.0.0',
    expectedExecutableSha256: 'f'.repeat(64),
    artifactRootPathSha256: 'f'.repeat(64),
  })) {
    assert.equal(validateAttemptAuthorizationV2({ ...auth, [key]: value }, context).validationStatus, 'REJECTED', key);
  }
  rmSync(root, { recursive: true, force: true });
});

test('run identity is authorization-hash keyed and stable for same authorization', async () => {
  const root = tempRoot();
  try {
    mkdirSync(path.join(root, 'artifacts'));
    const probe = await loadProbe();
    const base = buildRunSpec({ probe, artifactRoot: path.join(root, 'artifacts') });
    const manifestSha256 = sha256CanonicalJson(base.manifest);
    const caseSha256 = sha256CanonicalJson(base.manifest.cases[0]);
    const a = buildPrimaryRunIdentityV2({ ...base, manifestSha256, caseSha256 });
    const b = buildPrimaryRunIdentityV2({ ...base, manifestSha256, caseSha256 });
    assert.equal(a.runId, b.runId);
    assert.equal(a.runId, `qa-cr-b2-parent-export-v2-a1-${a.authorizationSha256.slice(0, 24)}`);
    const changed = buildPrimaryRunIdentityV2({ ...base, manifestSha256, caseSha256, fixtureTreeSha256: sha256('other') });
    assert.equal(a.authorizationSha256, changed.authorizationSha256);
    assert.equal(a.runId, changed.runId);
    assert.notEqual(a.fixtureTreeSha256, changed.fixtureTreeSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('happy harness seals authoritative complete facts and replay is pure and stable', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    let runtimeCalled = 0;
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec), sensitiveValues: ['SECRET-COMMAND', 'SENTINEL-SECRET'] });
    assert.equal(result.envelope.schemaVersion, EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION);
    assert.equal(result.facts.schemaVersion, SCORE_INPUT_FACTS_V2_SCHEMA_VERSION);
    assert.equal(result.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
    assert.equal(result.facts.observationStatus, 'COMPLETE');
    assert.equal(result.replay.replayStatus, 'OK');
    assert.deepEqual(result.telemetry, JSON.parse(readFileSync(path.join(result.runDirectory, 'telemetry.json'), 'utf8')));
    assert.deepEqual(result.facts, JSON.parse(readFileSync(path.join(result.runDirectory, 'score-input-facts.json'), 'utf8')));
    assert.ok(readFileSync(path.join(result.runDirectory, 'parent-export.json'), 'utf8').includes(PARENT_SESSION_ID));
    const replay = replaySealedRunV2({ runDirectory: result.runDirectory, inspectRuntime: () => { runtimeCalled += 1; } });
    assert.equal(replay.replayStatus, 'OK');
    assert.equal(runtimeCalled, 0);
    assert.equal(result.telemetry.aggregate.counts.stepFinishParts, result.telemetry.parent.counts.stepFinishParts + result.telemetry.children[0].counts.stepFinishParts);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing malformed failed and terminal error paths still seal blocked replayable attempts', async () => {
  const root = tempRoot();
  try {
    const probe = await loadProbe();
    for (const mode of ['missing-parent-export', 'malformed-parent-export', 'child-mismatch', 'terminal-failure', 'runner-throw']) {
      const artifactRoot = path.join(root, mode);
      mkdirSync(artifactRoot);
      const runSpec = buildRunSpec({ probe, artifactRoot, promptText: mode });
      const out = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => {
        if (mode === 'runner-throw') throw new Error('boom');
        const base = await happyRunnerFixture(runSpec);
        if (mode === 'missing-parent-export') base.parentExport = { sessionId: PARENT_SESSION_ID, exportStatus: 'MISSING', exportErrorCode: 'missing_export', exportText: '' };
        if (mode === 'malformed-parent-export') base.parentExport.exportText = '{';
        if (mode === 'child-mismatch') base.childExports[0].sessionId = 'ses_other';
        if (mode === 'terminal-failure') base.observation = safeObservation(runSpec, { terminal: { exitCode: 9, signal: null, errorCode: null, timedOut: false } });
        return base;
      } });
      assert.equal(out.envelope.schemaVersion, EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION);
      assert.equal(out.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
      assert.equal(out.replay.replayStatus, 'BLOCKED');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing runtime observations and arbitrary validators cannot yield authoritative facts', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const out = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => ({
      ...(await happyRunnerFixture(runSpec)),
      runtimePin: { bogus: true, eligibilityStatus: 'ELIGIBLE' },
      observation: safeObservation(runSpec, { executableSha256Before: null, executableSha256After: null, envIdentitySha256: null, cwdIdentitySha256: null, commandHash: null, parentRunCount: null }),
    }) });
    assert.equal(out.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(out.facts.sourceAuthorityIssueCodes), /runtime_pin_ineligible|executablebefore_unavailable|envidentity_unavailable|cwdidentity_unavailable|commandhash_unavailable|parentruncount_unavailable/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing cleanup evidence fails closed even when the rest of the observation is successful', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const observation = safeObservation(runSpec);
    delete observation.runtimeCleanupStatus;
    delete observation.runtimeCleanupSucceeded;
    const out = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => ({ ...(await happyRunnerFixture(runSpec)), observation }) });
    assert.equal(out.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(out.facts.sourceAuthorityIssueCodes), /runtime_cleanup_failed|runtime_cleanup_unsuccessful/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hash-count-environment mismatches and missing command hash block authority', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const out = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => ({
      ...(await happyRunnerFixture(runSpec)),
      observation: safeObservation(runSpec, {
        command: null,
        fixtureTreeSha256Before: sha256('other-fixture'),
        candidateDiffSha256After: sha256('other-diff'),
        productCompositeSha256Before: sha256('other-product'),
        parentExportCount: 2,
        childExportCount: 0,
        sameEnvironment: false,
        sameWorkingDirectory: false,
      }),
    }) });
    assert.equal(out.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(out.facts.sourceAuthorityIssueCodes), /commandhash_unavailable|fixturetreebefore_mismatch|candidatediffafter_mismatch|productcompositebefore_mismatch|parentexportcount_mismatch|childexportcount_mismatch|sameenvironment_mismatch|sameworkingdirectory_mismatch/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parent task requires exactly one corresponding export and one count evidence', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const out = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => ({
      ...(await happyRunnerFixture(runSpec)),
      childExports: [],
      observation: safeObservation(runSpec, { childExportCount: 0 }),
    }) });
    assert.equal(out.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(out.facts.sourceAuthorityIssueCodes), /missing_child_export|childexportcount_mismatch/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parent-derived expected child ids block zero supplied exports extra exports and allow output fallback', async () => {
  const root = tempRoot();
  try {
    const probe = await loadProbe();
    const baseRoot = path.join(root, 'artifacts-a');
    mkdirSync(baseRoot);
    const runSpec = buildRunSpec({ probe, artifactRoot: baseRoot });
    const zero = await executePrimaryRunV2({ artifactRoot: baseRoot, runSpec, runner: async () => ({ ...(await happyRunnerFixture(runSpec)), childExports: [] }) });
    assert.equal(zero.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(zero.facts.sourceAuthorityIssueCodes), /missing_child_export/);

    const extraRoot = path.join(root, 'artifacts-b');
    mkdirSync(extraRoot);
    const extraSpec = buildRunSpec({ probe, artifactRoot: extraRoot, promptText: 'extra' });
    const extra = await executePrimaryRunV2({ artifactRoot: extraRoot, runSpec: extraSpec, runner: async () => ({ ...(await happyRunnerFixture(extraSpec)), childExports: [{ sessionId: CHILD_SESSION_ID, exportStatus: 'OK', exportErrorCode: null, exportText: childExportFixture() }, { sessionId: 'ses_EXTRA123', exportStatus: 'OK', exportErrorCode: null, exportText: childExportFixture() }] }) });
    assert.equal(extra.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(extra.facts.sourceAuthorityIssueCodes), /extra_child_export|child_session_mismatch/);

    const fallbackRoot = path.join(root, 'artifacts-c');
    mkdirSync(fallbackRoot);
    const fallbackSpec = buildRunSpec({ probe, artifactRoot: fallbackRoot, promptText: 'fallback' });
    const fallback = await executePrimaryRunV2({ artifactRoot: fallbackRoot, runSpec: fallbackSpec, runner: async () => ({ ...(await happyRunnerFixture(fallbackSpec)), parentJsonl: parentJsonlWithChildOutputSessionId() }) });
    assert.equal(fallback.telemetry.aggregate.accountingStatus, 'COMPLETE');
    assert.deepEqual(fallback.facts.childTopology.observedChildSessionIds, [CHILD_SESSION_ID]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('existing occupied run id prevents runner call', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const identity = buildPrimaryRunIdentityV2({ ...runSpec, manifestSha256: sha256CanonicalJson(runSpec.manifest), caseSha256: sha256CanonicalJson(runSpec.manifest.cases[0]) });
    mkdirSync(path.join(artifactRoot, identity.runId));
    let called = false;
    await assert.rejects(() => executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => { called = true; return {}; } }));
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tamper and missing retained artifacts are detected distinctly', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    writeFileSync(path.join(result.runDirectory, 'parent-export.json'), '{}');
    assert.match(JSON.stringify(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics), /inventory_hash_mismatch|parent_export/);
    mkdirSync(path.join(root, 'artifacts-2'));
    const result2Spec = buildRunSpec({ probe, artifactRoot: path.join(root, 'artifacts-2'), promptText: 'b' });
    const result2 = await executePrimaryRunV2({ artifactRoot: path.join(root, 'artifacts-2'), runSpec: result2Spec, runner: async () => happyRunnerFixture(result2Spec) });
    rmSync(path.join(result2.runDirectory, 'runtime-pin.json'));
    assert.match(JSON.stringify(replaySealedRunV2({ runDirectory: result2.runDirectory }).diagnostics), /inventory_missing|runtime_pin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redaction sentinel is absent from retained artifacts and safe diagnostics', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot, promptText: 'SENTINEL-SECRET prompt' });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, sensitiveValues: ['SENTINEL-SECRET'], runner: async () => {
      const base = await happyRunnerFixture(runSpec);
      base.parentExport.exportErrorCode = 'SENTINEL-SECRET';
      base.childExports[0].exportText = base.childExports[0].exportText.replace('child-msg', 'SENTINEL-SECRET');
      return base;
    } });
    const files = [
      'probe.json', 'attempt-authorization.json', 'runtime-pin.json', 'inputs/prompt.txt', 'inputs/provenance.json', 'parent-events.jsonl', 'parent-export.json', 'parent-export-observation.json', 'run-observation.json', 'telemetry.json', 'score-input-facts.json', 'envelope.json', 'child-exports/000.json', 'child-export-observations/000.json',
    ];
    for (const rel of files) assert.doesNotMatch(readFileSync(path.join(result.runDirectory, rel), 'utf8'), /SENTINEL-SECRET/);
    assert.doesNotMatch(JSON.stringify(result.safeDiagnostics), /SENTINEL-SECRET/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unlisted key-aware secrets and token-like text are redacted from every persisted artifact', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot, promptText: 'apiKey: TOP-TOKEN-777777' });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => ({
      ...(await happyRunnerFixture(runSpec)),
      parentExport: { sessionId: PARENT_SESSION_ID, exportStatus: 'OK', exportErrorCode: null, exportText: JSON.stringify({ apiKey: 'TOP-TOKEN-777777', nested: { Authorization: 'Bearer TOP-TOKEN-777777' } }) },
      observation: safeObservation(runSpec, { command: 'Bearer TOP-TOKEN-777777', terminal: { exitCode: 0, signal: null, errorCode: null, timedOut: false } }),
    }), sensitiveValues: ['KNOWN-SECRET'] });
    for (const rel of result.envelope.stable.sources.inventory.map((entry) => entry.path).concat('envelope.json')) {
      const text = readFileSync(path.join(result.runDirectory, rel), 'utf8');
      assert.doesNotMatch(text, /TOP-TOKEN-777777|Bearer TOP-TOKEN-777777/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('arbitrary export and terminal error text never appears in artifacts or diagnostics', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot, promptText: 'secretless' });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, sensitiveValues: ['LEAK-ME'], runner: async () => ({
      ...(await happyRunnerFixture(runSpec)),
      parentExport: { sessionId: 'not a session', exportStatus: 'BAD', exportErrorCode: 'LEAK-ME stack', exportText: JSON.stringify((await loadFixtures()).parentExport) },
      observation: safeObservation(runSpec, { terminal: { exitCode: 1, signal: null, errorCode: 'LEAK-ME panic', timedOut: false } }),
    }) });
    for (const rel of ['parent-export-observation.json', 'run-observation.json', 'score-input-facts.json', 'telemetry.json', 'envelope.json']) {
      assert.doesNotMatch(readFileSync(path.join(result.runDirectory, rel), 'utf8'), /LEAK-ME|BAD|not a session/);
    }
    assert.match(readFileSync(path.join(result.runDirectory, 'parent-export-observation.json'), 'utf8'), /export_observation_invalid/);
    assert.match(readFileSync(path.join(result.runDirectory, 'run-observation.json'), 'utf8'), /terminal_error_uncontrolled/);
    assert.doesNotMatch(JSON.stringify(result.safeDiagnostics), /LEAK-ME|BAD|not a session/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('arbitrary hash signal error and runner strings are nulled or controlled and replay remains blocked not malformed', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot, promptText: 'runner-throw-null-exit' });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => {
      throw Object.assign(new Error('boom'), { code: 'RAW-RUNNER-STACK' });
    } });
    const observation = JSON.parse(readFileSync(path.join(result.runDirectory, 'run-observation.json'), 'utf8'));
    assert.equal(observation.runnerErrorCode, 'runner_throw');
    assert.equal(observation.terminal.exitCode, null);
    assert.equal(result.replay.replayStatus, 'BLOCKED');
    assert.doesNotMatch(JSON.stringify(result.replay.diagnostics), /run_observation_malformed|RAW-RUNNER-STACK/);

    const forgedObservation = {
      ...observation,
      commandHash: 'UPPERCASE-NOT-HASH',
      runnerErrorCode: 'runner_panic_raw',
      terminal: { exitCode: null, signal: 'segfault now', errorCode: 'raw stack trace', timedOut: false },
      observed: { ...observation.observed, parentRunCount: -1, envIdentitySha256: 'NOT-A-HASH' },
    };
    const envelopePath = path.join(result.runDirectory, 'envelope.json');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
    writeFileSync(path.join(result.runDirectory, 'run-observation.json'), JSON.stringify(forgedObservation, null, 2));
    envelope.stable.sources.inventory = refreshInventory(result.runDirectory, envelope.stable.sources.inventory);
    envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
    const replay = replaySealedRunV2({ runDirectory: result.runDirectory });
    assert.equal(replay.replayStatus, 'BLOCKED');
    assert.deepEqual(replay.diagnostics, ['run_observation_malformed']);

    const controlledRoot = path.join(root, 'controlled-artifacts');
    mkdirSync(controlledRoot);
    const controlledSpec = buildRunSpec({ probe, artifactRoot: controlledRoot, promptText: 'controlled-values' });
    const controlled = await executePrimaryRunV2({ artifactRoot: controlledRoot, runSpec: controlledSpec, runner: async () => ({
      ...(await happyRunnerFixture(controlledSpec)),
      observation: safeObservation(controlledSpec, {
        command: null,
        commandHash: 'bad',
        envIdentitySha256: 'bad',
        cwdIdentitySha256: 'bad',
        parentRunCount: -1,
        terminal: { exitCode: null, signal: 'segfault now', errorCode: 'raw stack trace', timedOut: false },
      }),
    }) });
    const controlledObservation = JSON.parse(readFileSync(path.join(controlled.runDirectory, 'run-observation.json'), 'utf8'));
    assert.equal(controlledObservation.commandHash, null);
    assert.equal(controlledObservation.observed.envIdentitySha256, null);
    assert.equal(controlledObservation.observed.cwdIdentitySha256, null);
    assert.equal(controlledObservation.observed.parentRunCount, null);
    assert.equal(controlledObservation.terminal.signal, null);
    assert.equal(controlledObservation.terminal.errorCode, 'terminal_error_uncontrolled');
    assert.doesNotMatch(JSON.stringify(controlledObservation), /segfault now|raw stack trace|bad/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 replay rejects v1 envelope without changing v1 behavior', async () => {
  const root = tempRoot();
  try {
    writeFileSync(path.join(root, 'envelope.json'), JSON.stringify({ schemaVersion: 'qa-cr-evidence-envelope-v1', stable: {}, volatile: {}, seal: { sha256: '0'.repeat(64) } }));
    assert.equal(replaySealedRunV2({ runDirectory: root }).replayStatus, 'BLOCKED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay rejects forged stored probe authorization and runtime even with recomputed inventory and seal', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    const envelopePath = path.join(result.runDirectory, 'envelope.json');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
    writeFileSync(path.join(result.runDirectory, 'probe.json'), JSON.stringify({ ...probe, public: false }, null, 2));
    writeFileSync(path.join(result.runDirectory, 'attempt-authorization.json'), JSON.stringify({ ...runSpec.authorization, status: 'REJECTED' }, null, 2));
    writeFileSync(path.join(result.runDirectory, 'runtime-pin.json'), JSON.stringify({ ...runtimePinPass(runSpec), expectedSha256: 'f'.repeat(64) }, null, 2));
    const inventory = envelope.stable.sources.inventory.map((entry) => {
      const filePath = path.join(result.runDirectory, entry.path);
      const bytes = readFileSync(filePath);
      return { ...entry, sha256: sha256(bytes), bytes: bytes.length };
    });
    envelope.stable.sources.inventory = inventory;
    envelope.stable.probe.probeSha256 = sha256CanonicalJson(JSON.parse(readFileSync(path.join(result.runDirectory, 'probe.json'), 'utf8')));
    envelope.stable.authorization.authorizationSha256 = sha256CanonicalJson(JSON.parse(readFileSync(path.join(result.runDirectory, 'attempt-authorization.json'), 'utf8')));
    envelope.stable.runtime.expectedSha256 = 'f'.repeat(64);
    envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
    assert.match(JSON.stringify(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics), /probe_mismatch|authorization_mismatch|runtime_pin_mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay rejects resealed identity provenance prompt and observation tampering with controlled diagnostics', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    const envelopePath = path.join(result.runDirectory, 'envelope.json');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
    const provenancePath = path.join(result.runDirectory, 'inputs/provenance.json');
    const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
    provenance.identity = { ...provenance.identity, extra: true };
    writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
    writeFileSync(path.join(result.runDirectory, 'inputs/prompt.txt'), 'forged prompt');
    const observation = JSON.parse(readFileSync(path.join(result.runDirectory, 'run-observation.json'), 'utf8'));
    observation.observed.extra = true;
    writeFileSync(path.join(result.runDirectory, 'run-observation.json'), JSON.stringify(observation, null, 2));
    envelope.stable.sources.inventory = envelope.stable.sources.inventory.map((entry) => {
      const filePath = path.join(result.runDirectory, entry.path);
      const bytes = readFileSync(filePath);
      return { ...entry, sha256: sha256(bytes), bytes: bytes.length };
    });
    envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
    assert.match(JSON.stringify(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics), /identity_mismatch|prompt_mismatch|run_observation_malformed|provenance_mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay rejects forged canonical identity mismatches wrong run-directory binding and artifact-root hash mismatch', async () => {
  const root = tempRoot();
  try {
    const probe = await loadProbe();
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    const envelopePath = path.join(result.runDirectory, 'envelope.json');
    const provenancePath = path.join(result.runDirectory, 'inputs/provenance.json');
    const originalEnvelope = readFileSync(envelopePath, 'utf8');
    const originalProvenance = readFileSync(provenancePath, 'utf8');

    for (const mutate of [
      (identity) => ({ ...identity, runId: 'qa-cr-b2-parent-export-v2-a1-ffffffffffffffffffffffff' }),
      (identity) => ({ ...identity, probeId: 'qa-cr-b2-parent-export-v2-forged' }),
      (identity) => ({ ...identity, caseId: 'case-a' }),
      (identity) => ({ ...identity, artifactRootPathSha256: 'f'.repeat(64) }),
    ]) {
      writeFileSync(envelopePath, originalEnvelope);
      writeFileSync(provenancePath, originalProvenance);
      const envelope = JSON.parse(originalEnvelope);
      const provenance = JSON.parse(originalProvenance);
      envelope.stable.identity = mutate(envelope.stable.identity);
      provenance.identity = mutate(provenance.identity);
      writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
      envelope.stable.sources.inventory = refreshInventory(result.runDirectory, envelope.stable.sources.inventory);
      envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
      writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
      assert.deepEqual(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics, ['identity_mismatch']);
    }

    writeFileSync(envelopePath, originalEnvelope);
    writeFileSync(provenancePath, originalProvenance);
    const renamedRunDirectory = path.join(artifactRoot, `${path.basename(result.runDirectory)}-forged`);
    rmSync(renamedRunDirectory, { recursive: true, force: true });
    mkdirSync(renamedRunDirectory);
    for (const rel of result.envelope.stable.sources.inventory.map((entry) => entry.path).concat('envelope.json')) {
      const source = path.join(result.runDirectory, rel);
      const dest = path.join(renamedRunDirectory, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(source));
    }
    assert.deepEqual(replaySealedRunV2({ runDirectory: renamedRunDirectory }).diagnostics, ['identity_mismatch']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay rejects nested child artifact paths and invalid volatile chronology', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    const envelopePath = path.join(result.runDirectory, 'envelope.json');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
    const nestedChildPath = path.join(result.runDirectory, 'child-exports', 'nested', '000.json');
    mkdirSync(path.dirname(nestedChildPath), { recursive: true });
    writeFileSync(nestedChildPath, readFileSync(path.join(result.runDirectory, 'child-exports', '000.json')));
    envelope.stable.sources.inventory.push({ ...envelope.stable.sources.inventory.find((entry) => entry.path === 'child-exports/000.json'), path: 'child-exports/nested/000.json' });
    envelope.stable.sources.inventory = refreshInventory(result.runDirectory, envelope.stable.sources.inventory);
    envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
    assert.deepEqual(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics, ['child_inventory_mismatch']);

    envelope.volatile = { capturedAt: '2026-01-01T00:00:02.000Z', sealedAt: '2026-01-01T00:00:01.000Z' };
    envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
    assert.deepEqual(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics, ['envelope_volatile_invalid']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay preserves blocked zero-child facts when retained inventory exactly matches parent-derived child count', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot, promptText: 'zero-child-blocked' });
    const parentJsonl = [JSON.stringify(parentErrorEventV2()), parentStepFinishV2()].join('\n');
    const result = await executePrimaryRunV2({
      artifactRoot,
      runSpec,
      runner: async () => ({
        ...(await happyRunnerFixture(runSpec)),
        parentJsonl,
        childExports: [],
        observation: safeObservation(runSpec, {
          terminal: { exitCode: 9, signal: null, errorCode: null, timedOut: false },
          parentExportCount: 1,
          childExportCount: 0,
        }),
      }),
    });

    assert.equal(result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.equal(result.replay.replayStatus, 'BLOCKED');
    const storedFacts = JSON.parse(readFileSync(path.join(result.runDirectory, 'score-input-facts.json'), 'utf8'));
    const inventoryPaths = result.envelope.stable.sources.inventory.map((entry) => entry.path);
    assert.equal(inventoryPaths.some((entry) => entry.startsWith('child-exports/')), false);
    assert.equal(inventoryPaths.some((entry) => entry.startsWith('child-export-observations/')), false);

    const replay = replaySealedRunV2({ runDirectory: result.runDirectory });
    assert.equal(replay.authorityStatus, 'NON_AUTHORITATIVE');
    assert.equal(replay.replayStatus, 'BLOCKED');
    assert.deepEqual(replay.diagnostics, ['facts_blocked']);
    assert.deepEqual(replay.facts, storedFacts);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay still reports child inventory mismatch when parent observed child files are missing', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot, promptText: 'missing-child-artifacts' });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    const envelopePath = path.join(result.runDirectory, 'envelope.json');
    const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
    rmSync(path.join(result.runDirectory, 'child-exports', '000.json'));
    rmSync(path.join(result.runDirectory, 'child-export-observations', '000.json'));
    envelope.stable.sources.inventory = envelope.stable.sources.inventory.filter((entry) => !['child-exports/000.json', 'child-export-observations/000.json'].includes(entry.path));
    envelope.seal.sha256 = sha256CanonicalJson(envelope.stable);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));
    assert.deepEqual(replaySealedRunV2({ runDirectory: result.runDirectory }).diagnostics, ['child_inventory_mismatch']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pure replay of retained blocked v2 run remains canonical and blocked', () => {
  const runDirectory = 'C:\\works\\QA-skills\\.slim\\evidence\\qa-cr-b2-parent-export-v2\\qa-cr-b2-parent-export-v2-a1-e29ad15ab686c32b50618c69';
  const replay = replaySealedRunV2({ runDirectory });
  const storedFacts = JSON.parse(readFileSync(path.join(runDirectory, 'score-input-facts.json'), 'utf8'));
  assert.equal(replay.authorityStatus, 'NON_AUTHORITATIVE');
  assert.equal(replay.replayStatus, 'BLOCKED');
  assert.deepEqual(replay.diagnostics, ['facts_blocked']);
  assert.ok(replay.facts);
  assert.deepEqual(replay.facts, storedFacts);
  assert.equal(sha256CanonicalJson(replay.facts), sha256CanonicalJson(storedFacts));
});

test('v2 envelope and inventory do not require credential-readiness.json', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const probe = await loadProbe();
    const runSpec = buildRunSpec({ probe, artifactRoot });
    const result = await executePrimaryRunV2({ artifactRoot, runSpec, runner: async () => happyRunnerFixture(runSpec) });
    assert.equal(result.envelope.stable.identity.runId, `qa-cr-b2-parent-export-v2-a1-${result.envelope.stable.identity.authorizationSha256.slice(0, 24)}`);
    assert.equal(result.envelope.stable.sources.inventory.some((entry) => entry.path === 'credential-readiness.json'), false);
    assert.equal(existsSync(path.join(result.runDirectory, 'credential-readiness.json')), false);
    assert.equal(replaySealedRunV2({ runDirectory: result.runDirectory }).replayStatus, 'OK');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('envelope exact nested validation rejects extras missing fields and absolute inventory paths', () => {
  const identity = buildPrimaryRunIdentityV2({
    probe: { probeID: 'qa-cr-b2-parent-export-v2' },
    authorization: { authorizationId: 'qa-cr-b2-parent-export-v2-attempt-1' },
    manifestSha256: '7'.repeat(64),
    scopeSha256: 'c'.repeat(64),
    caseId: 'seed-defect-auth-guard-small',
    caseSha256: '4'.repeat(64),
    fixtureTreeSha256: '6'.repeat(64),
    candidateDiffSha256: '3'.repeat(64),
    promptSha256: '9'.repeat(64),
    qaSkillTreeSha256: '8'.repeat(64),
    qaAgentSha256: 'a'.repeat(64),
    qaCrAgentSha256: 'b'.repeat(64),
    providerId: 'cpa',
    modelId: 'cpa/gpt-5.5',
    expectedRuntimeVersion: RUNTIME_VERSION,
    expectedExecutableSha256: '5'.repeat(64),
    artifactRootPathSha256: '1'.repeat(64),
  });
  const stable = {
    identity,
    probe: { probeId: 'qa-cr-b2-parent-export-v2', probeSha256: 'a'.repeat(64) },
    authorization: { authorizationId: 'qa-cr-b2-parent-export-v2-attempt-1', authorizationSha256: 'b'.repeat(64) },
    runtime: { schemaVersion: RUNTIME_PIN_V2_SCHEMA_VERSION, basename: 'opencode.exe', pathSha256: 'd'.repeat(64), bytes: 1, sha256Before: '5'.repeat(64), sha256After: '5'.repeat(64), observedVersion: RUNTIME_VERSION, expectedVersion: RUNTIME_VERSION, expectedSha256: '5'.repeat(64), eligibilityStatus: 'ELIGIBLE', issueCodes: [] },
    sources: { inventory: [{ path: 'probe.json', kind: 'probe', sha256: 'd'.repeat(64), bytes: 1 }, { path: 'telemetry.json', kind: 'telemetry', sha256: 'e'.repeat(64), bytes: 1 }, { path: 'score-input-facts.json', kind: 'score-input-facts', sha256: 'f'.repeat(64), bytes: 1 }], telemetry: { path: 'telemetry.json', sha256: 'e'.repeat(64) }, facts: { path: 'score-input-facts.json', sha256: 'f'.repeat(64) } },
  };
  const valid = { schemaVersion: EVIDENCE_ENVELOPE_V2_SCHEMA_VERSION, stable, volatile: { capturedAt: '2026-01-01T00:00:00.000Z', sealedAt: '2026-01-01T00:00:01.000Z' }, seal: { sha256: sha256CanonicalJson(stable) } };
  assert.doesNotThrow(() => validateEvidenceEnvelopeV2(valid));
  for (const mutated of [{ ...valid, stable: { ...stable, extra: true } }, { ...valid, volatile: { capturedAt: 'x' } }, { ...valid, stable: { ...stable, sources: { ...stable.sources, inventory: [{ ...stable.sources.inventory[0], path: 'C:/abs/probe.json' }] } } }]) {
    assert.throws(() => validateEvidenceEnvelopeV2(mutated));
  }
});

test('public v2 execute is an unconditional tombstone before any real work', async () => {
  assert.equal(PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_PATH, 'benchmarks/qa-cr-maturity/authorizations/b2-parent-export-v2-attempt-1.json');
  assert.equal(PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_SHA256, 'e29ad15ab686c32b50618c69983fb11e3151a941d0113cdf69c872217046c704');
  await assert.rejects(() => executePhaseB2ParentExportV2({
    opencodeExecutable: process.env.QA_SKILL_OPENCODE_BIN,
    providerConfigPath: process.env.QA_CR_MATURITY_PROVIDER_CONFIG_PATH,
    authorizationPath: process.env.QA_CR_MATURITY_AUTHORIZATION_PATH,
    artifactRoot: process.env.QA_CR_MATURITY_ARTIFACT_ROOT,
  }), { code: 'b2_v2_attempt_consumed' });
});

test('v2 activation uses exact approved file and canonical hash', () => {
  const authorizationPath = resolve(PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_PATH);
  assert.equal(existsSync(authorizationPath), true);
  assert.equal(authorizationPath, resolve('benchmarks/qa-cr-maturity/authorizations/b2-parent-export-v2-attempt-1.json'));
  const authorization = JSON.parse(readFileSync(authorizationPath, 'utf8'));
  assert.equal(sha256CanonicalJson(authorization), PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_SHA256);
  assert.deepEqual(validatePhaseB2ParentExportV2ActivationAuthorization({ authorizationPath }), {
    ok: true,
    authorizationPath: authorizationPath,
    authorization,
  });
});

test('v2 activation rejects alternate path and content drift before real work', async () => {
  const approvedPath = resolve(PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_PATH);
  const root = tempRoot();
  try {
    const alternatePath = path.join(root, 'copy.json');
    writeFileSync(alternatePath, readFileSync(approvedPath, 'utf8'));
    assert.equal(validatePhaseB2ParentExportV2ActivationAuthorization({ authorizationPath: alternatePath }).ok, false);

    const driftedPath = path.join(root, 'drift.json');
    const drifted = JSON.parse(readFileSync(approvedPath, 'utf8'));
    drifted.modelId = 'cpa/gpt-5.4';
    writeFileSync(driftedPath, JSON.stringify(drifted, null, 2));
    assert.equal(validatePhaseB2ParentExportV2ActivationAuthorization({ authorizationPath: approvedPath, readAuthorizationFile: () => JSON.stringify(drifted) }).ok, false);

    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const providerConfigPath = makeProviderConfigV2(root);
    await assert.rejects(() => executePhaseB2ParentExportV2({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath: alternatePath,
      artifactRoot,
    }), { code: 'b2_v2_attempt_consumed' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 simulation rejects any executable other than process.execPath before setup spawn export or version', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const providerConfigPath = makeProviderConfigV2(root);
    const context = preparePhaseB2ParentExportV2AuthorizationContext({ opencodeExecutable: process.execPath, artifactRoot, spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
    const authorizationPath = await makeAuthorizationFileV2({ root, context });
    let spawnCalls = 0;
    let exportCalls = 0;
    let versionCalls = 0;
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: path.join(path.dirname(process.execPath), 'node-other.exe'),
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion() { versionCalls += 1; return { ok: true, observedVersion: RUNTIME_VERSION }; },
      directSpawn() { spawnCalls += 1; throw new Error('must not spawn'); },
      exportSession() { exportCalls += 1; throw new Error('must not export'); },
    }), { code: 'simulation_requires_process_execpath' });
    assert.equal(spawnCalls, 0);
    assert.equal(exportCalls, 0);
    assert.equal(versionCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare helper computes immutable authorization context without creating a run directory', () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const context = preparePhaseB2ParentExportV2AuthorizationContext({ opencodeExecutable: process.execPath, artifactRoot, spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
    assert.equal(typeof context.qaSkillTreeSha256, 'string');
    assert.equal(context.qaSkillTreeSha256.length, 64);
    assert.equal(existsSync(path.join(artifactRoot, 'envelope.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 deterministic happy path is authoritative complete and isolated', async (t) => {
  const { root, calls, result, artifactRoot } = await invokeProcessAdapterV2();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assertAuthoritativeV2RealGate(result, artifactRoot);
  assert.equal(calls.filter((entry) => entry.kind === 'spawn').length, 1);
  assert.deepEqual(calls.filter((entry) => entry.kind === 'export').map((entry) => entry.sessionId), [PARENT_SESSION_ID, CHILD_SESSION_ID]);
  const spawnCall = calls.find((entry) => entry.kind === 'spawn');
  const exportCalls = calls.filter((entry) => entry.kind === 'export');
  assert.deepEqual(spawnCall.args.slice(0, 9), ['run', '--agent', 'qa', '--format', 'json', '--model', 'cpa/gpt-5.5', '--dir', spawnCall.cwd]);
  assert.match(spawnCall.args.at(-1), /Probe ID: qa-cr-b2-parent-export-v2/);
  assert.match(spawnCall.args.at(-1), /non-scoring plumbing probe/i);
  assert.match(spawnCall.args.at(-1), /exactly one direct qa-cr child/i);
  assert.match(spawnCall.args.at(-1), /Do not invoke qa-e2e/i);
  assert.equal(exportCalls[0].cwd, spawnCall.cwd);
  assert.equal(exportCalls[1].cwd, spawnCall.cwd);
  assert.equal(exportCalls[0].env, spawnCall.env);
  assert.equal(exportCalls[1].env, spawnCall.env);
  assert.equal(spawnCall.env.CPA_API_KEY, 'env-secret');
  assert.equal(spawnCall.env.HOME.includes('isolated-opencode'), true);
  assert.equal(spawnCall.env.APPDATA.includes('isolated-opencode'), true);
  assert.equal(spawnCall.env.XDG_CONFIG_HOME.includes('isolated-opencode'), true);
  assert.equal(existsSync(result.runDirectory), true);
  assert.equal(existsSync(artifactRoot), true);
});

test('v2 parent id failures and child topology mismatches fail closed without export retry', async (t) => {
  const missingParent = await invokeProcessAdapterV2({
    parentResult: { status: 0, signal: null, stdout: [parentTaskEventV2({ parentSessionId: PARENT_SESSION_ID, childSessionId: CHILD_SESSION_ID }), parentStepFinishV2({ parentSessionId: 'ses_other_parent' })].join('\n'), stderr: '', error: null },
    exportResults: new Map([[CHILD_SESSION_ID, { status: 0, stdout: validChildExportV2(), stderr: '', error: null }]]),
  });
  t.after(() => rmSync(missingParent.root, { recursive: true, force: true }));
  assert.deepEqual(missingParent.calls.filter((entry) => entry.kind === 'export').map((entry) => entry.sessionId), [CHILD_SESSION_ID]);
  assert.equal(missingParent.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(missingParent.result.facts.sourceAuthorityIssueCodes), /parent_export_not_ok|parent_telemetry_incomplete/);

  const extraTask = await invokeProcessAdapterV2({
    parentResult: { status: 0, signal: null, stdout: validParentJsonlV2({ extraTaskTypes: ['qa-e2e'] }), stderr: '', error: null },
    exportResults: new Map([[PARENT_SESSION_ID, { status: 0, stdout: validParentExportV2(), stderr: '', error: null }], [CHILD_SESSION_ID, { status: 0, stdout: validChildExportV2(), stderr: '', error: null }], ['ses_extra_0', { status: 0, stdout: validChildExportV2('ses_extra_0'), stderr: '', error: null }]]),
  });
  t.after(() => rmSync(extraTask.root, { recursive: true, force: true }));
  assert.deepEqual(extraTask.calls.filter((entry) => entry.kind === 'export').map((entry) => entry.sessionId), [PARENT_SESSION_ID, CHILD_SESSION_ID]);
  assert.equal(extraTask.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(extraTask.result.facts.sourceAuthorityIssueCodes), /extra_child_task_type|extra_task_type/);

  const multiple = await invokeProcessAdapterV2({
    parentResult: { status: 0, signal: null, stdout: validParentJsonlV2({ childSessionIds: [CHILD_SESSION_ID, 'ses_child_2'] }), stderr: '', error: null },
    exportResults: new Map([[PARENT_SESSION_ID, { status: 0, stdout: validParentExportV2(), stderr: '', error: null }], [CHILD_SESSION_ID, { status: 0, stdout: validChildExportV2(), stderr: '', error: null }], ['ses_child_2', { status: 0, stdout: validChildExportV2('ses_child_2'), stderr: '', error: null }]]),
  });
  t.after(() => rmSync(multiple.root, { recursive: true, force: true }));
  assert.deepEqual(multiple.calls.filter((entry) => entry.kind === 'export').map((entry) => entry.sessionId), [PARENT_SESSION_ID, CHILD_SESSION_ID, 'ses_child_2']);
  assert.equal(multiple.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(multiple.result.facts.sourceAuthorityIssueCodes), /duplicate_qa_cr_task|extra_child_export|childexportcount_mismatch/);
});

test('v2 malformed failed and terminal error paths are blocked and never retried', async (t) => {
  for (const scenario of [
    { label: 'parent export malformed', exportResults: new Map([[PARENT_SESSION_ID, { status: 0, stdout: '{', stderr: '', error: null }], [CHILD_SESSION_ID, { status: 0, stdout: validChildExportV2(), stderr: '', error: null }]]), pattern: /parent_export_not_ok/ },
    { label: 'child export failed', exportResults: new Map([[PARENT_SESSION_ID, { status: 0, stdout: validParentExportV2(), stderr: '', error: null }], [CHILD_SESSION_ID, { status: 2, stdout: '', stderr: '', error: null }]]), pattern: /child_export_not_ok/ },
    { label: 'parent nonzero', parentResult: { status: 9, signal: null, stdout: validParentJsonlV2(), stderr: '', error: null }, pattern: /terminal_nonzero/ },
    { label: 'parent timeout', parentResult: { status: null, signal: 'SIGTERM', stdout: validParentJsonlV2(), stderr: '', error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }, pattern: /terminal_signal|terminal_timed_out/ },
    { label: 'parent throw', extraOptions: { directSpawn() { throw new Error('boom'); } }, pattern: /terminal_error|runner_throw|terminal_error_uncontrolled/ },
  ]) {
    const pending = await invokeProcessAdapterV2(scenario);
    t.after(() => rmSync(pending.root, { recursive: true, force: true }));
    assert.equal(pending.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE', scenario.label);
    assert.equal(pending.result.replay.replayStatus, 'BLOCKED', scenario.label);
    assert.match(JSON.stringify(pending.result.facts.sourceAuthorityIssueCodes), scenario.pattern, scenario.label);
    const exports = pending.calls.filter((entry) => entry.kind === 'export');
    assert.equal(new Set(exports.map((entry) => `${entry.sessionId}:${entry.cwd}`)).size, exports.length, scenario.label);
  }
});

test('v2 preflight mismatches and occupied run directory block before parent spawn', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const providerConfigPath = makeProviderConfigV2(root);
    const context = preparePhaseB2ParentExportV2AuthorizationContext({ opencodeExecutable: process.execPath, artifactRoot, spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
    const authorizationPath = await makeAuthorizationFileV2({ root, context });
    let spawnCalls = 0;
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: '0.0.0' }),
      directSpawn() { spawnCalls += 1; return { status: 0, stdout: '', stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    }), { code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.RUNTIME_INELIGIBLE });
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      readExecutableBytes: () => Buffer.from('drift'),
      directSpawn() { spawnCalls += 1; return { status: 0, stdout: '', stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    }), { code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID });
    const badAuthPath = await makeAuthorizationFileV2({ root, context, overrides: { artifactRootPathSha256: 'f'.repeat(64) }, fileName: 'authorization-bad.json' });
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath: badAuthPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      directSpawn() { spawnCalls += 1; return { status: 0, stdout: '', stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    }), { code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID });
    const driftedSkillAuthPath = await makeAuthorizationFileV2({ root, context, overrides: { qaSkillTreeSha256: 'e'.repeat(64) }, fileName: 'authorization-skill-drift.json' });
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath: driftedSkillAuthPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      directSpawn() { spawnCalls += 1; return { status: 0, stdout: '', stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    }), { code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID });
    assert.equal(spawnCalls, 0);

    const first = await executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      directSpawn() { spawnCalls += 1; return { status: 0, signal: null, stdout: validParentJsonlV2(), stderr: '', error: null }; },
      exportSession({ sessionId }) { return sessionId === PARENT_SESSION_ID ? { status: 0, stdout: validParentExportV2(), stderr: '', error: null } : { status: 0, stdout: validChildExportV2(), stderr: '', error: null }; },
    });
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      directSpawn() { spawnCalls += 1; return { status: 0, stdout: '', stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    }));
    assert.equal(first.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
    assert.equal(spawnCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 cleanup failures never mask a sealed response or the original controlled exception', async () => {
  const success = await invokeProcessAdapterV2({
    extraOptions: {
      removeRuntimePath(target, options) {
        if (target.endsWith('repo')) throw new Error('cleanup boom');
        rmSync(target, options);
      },
    },
  });
  try {
    assert.equal(success.result.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
    assert.equal(success.result.runtimeStateRemoved, false);
  } finally {
    rmSync(success.root, { recursive: true, force: true });
  }

  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const providerConfigPath = makeProviderConfigV2(root);
    const context = preparePhaseB2ParentExportV2AuthorizationContext({ opencodeExecutable: process.execPath, artifactRoot, spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }), readExecutableBytes: readFileSync });
    const authorizationPath = await makeAuthorizationFileV2({ root, context, overrides: { artifactRootPathSha256: 'f'.repeat(64) } });
    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      directSpawn() { throw new Error('must not spawn'); },
      exportSession() { throw new Error('must not export'); },
      removeRuntimePath() { throw new Error('cleanup boom'); },
    }), { code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 pre-spawn executable drift blocks before parent spawn, seals evidence, and leaves the auth-keyed run directory occupied', async () => {
  const root = tempRoot();
  try {
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(artifactRoot);
    const providerConfigPath = makeProviderConfigV2(root);
    const stableBytes = Buffer.from('stable');
    const driftBytes = Buffer.from('drift');
    let readCount = 0;
    const readExecutableBytes = () => {
      readCount += 1;
      return readCount <= 4 ? stableBytes : driftBytes;
    };
    const context = preparePhaseB2ParentExportV2AuthorizationContext({
      opencodeExecutable: process.execPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      readExecutableBytes,
    });
    const authorizationPath = await makeAuthorizationFileV2({ root, context });
    let spawnCalls = 0;
    const first = await executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      readExecutableBytes,
      directSpawn() { spawnCalls += 1; return { status: 0, signal: null, stdout: validParentJsonlV2(), stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    });
    assert.equal(spawnCalls, 0);
    assert.equal(first.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.equal(first.replay.replayStatus, 'BLOCKED');
    assert.equal(first.runtimeStateRemoved, true);
    assert.equal(existsSync(first.runDirectory), true);
    assert.match(JSON.stringify(first.facts.sourceAuthorityIssueCodes), /runtime_pin_ineligible|runtimepinafter_mismatch|executableafter_mismatch|parentruncount_mismatch/i);

    await assert.rejects(() => executePhaseB2ParentExportV2Simulation({
      opencodeExecutable: process.execPath,
      providerConfigPath,
      authorizationPath,
      artifactRoot,
      spawnVersion: () => ({ ok: true, observedVersion: RUNTIME_VERSION }),
      readExecutableBytes: () => stableBytes,
      directSpawn() { spawnCalls += 1; return { status: 0, signal: null, stdout: validParentJsonlV2(), stderr: '', error: null }; },
      exportSession() { throw new Error('must not export'); },
    }), /existing_run_directory/);
    assert.equal(spawnCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 product diff agent and executable drift fail closed', async (t) => {
  const product = await invokeProcessAdapterV2({
    mutateDuringParent(cwd) { writeFileSync(path.join(cwd, 'src', 'audit.mjs'), 'export function logDeniedAccess(){ return { result: "mutated" }; }\n', 'utf8'); },
  });
  t.after(() => rmSync(product.root, { recursive: true, force: true }));
  assert.match(JSON.stringify(product.result.facts.sourceAuthorityIssueCodes), /fixturetreeafter_mismatch|productcompositeafter_mismatch/);

  const agent = await invokeProcessAdapterV2({
    mutateDuringParent(cwd) { writeFileSync(path.join(cwd, '.opencode', 'agents', 'qa-cr.md'), '# mutated\n', 'utf8'); },
  });
  t.after(() => rmSync(agent.root, { recursive: true, force: true }));
  assert.match(JSON.stringify(agent.result.facts.sourceAuthorityIssueCodes), /qacragentafter_mismatch|qacragent_mutated/i);

  const skill = await invokeProcessAdapterV2({
    mutateDuringParent(cwd) { writeFileSync(path.join(cwd, '.opencode', 'skills', 'qa-skill', 'SKILL.md'), '# mutated skill\n', 'utf8'); },
  });
  t.after(() => rmSync(skill.root, { recursive: true, force: true }));
  assert.match(JSON.stringify(skill.result.facts.sourceAuthorityIssueCodes), /qaskillafter_mismatch|qaskill_mutated/i);
  assert.equal(skill.result.facts.mutations.qaSkill, 'MUTATED');
  assert.equal(skill.result.replay.replayStatus, 'BLOCKED');

  const executable = await invokeProcessAdapterV2({
    readExecutableBytes: (() => { let count = 0; return () => Buffer.from(count++ < 4 ? 'stable' : 'drift'); })(),
    authorizationOverrides: { expectedExecutableSha256: sha256(Buffer.from('stable')) },
  });
  t.after(() => rmSync(executable.root, { recursive: true, force: true }));
  assert.match(JSON.stringify(executable.result.facts.sourceAuthorityIssueCodes), /runtimepinafter_mismatch|executableafter_mismatch/);
});

test('v2 late postflight failure preserves measured after evidence and retained exports', async (t) => {
  const pending = await invokeProcessAdapterV2({
    mutateDuringParent(cwd) {
      writeFileSync(path.join(cwd, 'src', 'audit.mjs'), 'export function logDeniedAccess(){ return { result: "mutated" }; }\n', 'utf8');
      rmSync(path.join(cwd, '.opencode', 'agents', 'qa-cr.md'));
    },
  });
  t.after(() => rmSync(pending.root, { recursive: true, force: true }));
  assert.equal(pending.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.equal(pending.result.replay.replayStatus, 'BLOCKED');
  assert.equal(pending.result.runtimeStateRemoved, true);
  assert.equal(existsSync(pending.result.runDirectory), true);
  assert.equal(existsSync(path.join(pending.result.runDirectory, 'parent-events.jsonl')), true);
  assert.equal(existsSync(path.join(pending.result.runDirectory, 'parent-export.json')), true);
  assert.equal(existsSync(path.join(pending.result.runDirectory, 'child-exports', '000.json')), true);
  const observation = JSON.parse(readFileSync(path.join(pending.result.runDirectory, 'run-observation.json'), 'utf8'));
  const facts = JSON.parse(readFileSync(path.join(pending.result.runDirectory, 'score-input-facts.json'), 'utf8'));
  assert.notEqual(observation.observed.fixtureTreeSha256After, observation.observed.fixtureTreeSha256Before);
  assert.notEqual(observation.observed.candidateDiffSha256After, observation.observed.candidateDiffSha256Before);
  assert.notEqual(observation.observed.productCompositeSha256After, observation.observed.productCompositeSha256Before);
  assert.equal(observation.observed.qaSkillTreeSha256After, observation.observed.qaSkillTreeSha256Before);
  assert.equal(observation.observed.qaAgentSha256After, observation.observed.qaAgentSha256Before);
  assert.equal(observation.observed.qaCrAgentSha256After, null);
  assert.equal(observation.observed.executableSha256After, null);
  assert.match(JSON.stringify(facts.sourceAuthorityIssueCodes), /fixturetreeafter_mismatch|productcompositeafter_mismatch|qacragentafter_unavailable|executableafter_unavailable/i);
});

test('v2 postflight special product entry cannot preserve authoritative evidence', async (t) => {
  let specialEntryError = null;
  const pending = await invokeProcessAdapterV2({
    mutateDuringParent(cwd) {
      const target = path.join(cwd, 'src', 'audit.mjs');
      const specialEntry = path.join(cwd, 'src', 'audit-special-link.mjs');
      try {
        symlinkSync(target, specialEntry);
      } catch (error) {
        specialEntryError = error;
      }
    },
  });
  t.after(() => rmSync(pending.root, { recursive: true, force: true }));
  if (specialEntryError) {
    assert.ok(['EPERM', 'EACCES', 'UNKNOWN'].includes(specialEntryError.code), specialEntryError.code);
    t.skip(`special entry creation unavailable: ${specialEntryError.code}`);
    return;
  }
  assert.equal(pending.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.equal(pending.result.replay.replayStatus, 'BLOCKED');
  assert.deepEqual(pending.result.safeDiagnostics, ['runner_throw']);
});

test('v2 redacts provider env auth and raw output secrets from retained artifacts and safe fields', async (t) => {
  const outputSecret = 'LEAK-OUTPUT-SECRET';
  const providerSecret = 'provider-secret-value';
  const envSecret = 'env-secret';
  const authSecret = 'auth-secret';
  const pending = await invokeProcessAdapterV2({
    parentResult: { status: 0, signal: null, stdout: `${outputSecret}\n${validParentJsonlV2()}`, stderr: '', error: null },
    exportResults: new Map([[PARENT_SESSION_ID, { status: 0, stdout: `${providerSecret}\n${validParentExportV2()}`, stderr: '', error: null }], [CHILD_SESSION_ID, { status: 0, stdout: `${envSecret}\n${authSecret}\n${validChildExportV2()}`, stderr: '', error: null }]]),
    extraOptions: { sensitiveValues: [outputSecret] },
  });
  t.after(() => rmSync(pending.root, { recursive: true, force: true }));
  const files = pending.result.envelope.stable.sources.inventory.map((entry) => entry.path).concat('envelope.json');
  for (const rel of files) {
    const text = readFileSync(path.join(pending.result.runDirectory, rel), 'utf8');
    assert.doesNotMatch(text, /LEAK-OUTPUT-SECRET|provider-secret-value|env-secret|auth-secret/);
  }
  assert.doesNotMatch(JSON.stringify(pending.result.safeDiagnostics), /LEAK-OUTPUT-SECRET|provider-secret-value|env-secret|auth-secret/);
});

test('v2 selected cpa auth key access and refresh values are redacted and only cpa auth is forwarded', async (t) => {
  for (const scenario of [
    {
      label: 'api-key-shape',
      authContent: JSON.stringify({ cpa: { type: 'api', key: 'CPA_KEY' }, anthropic: { type: 'api', key: 'ANTHROPIC_KEY' } }),
      parentJsonl: [parentTaskEventV2(), JSON.stringify(parentTextEventV2({ text: 'CPA_KEY' })), parentStepFinishV2()].join('\n'),
      childExport: validChildExportV2().replace('prompt', 'CPA_KEY'),
      pattern: /CPA_KEY|ANTHROPIC_KEY/,
    },
    {
      label: 'oauth-shape',
      authContent: JSON.stringify({ cpa: { type: 'oauth', access: 'CPA_ACCESS', refresh: 'CPA_REFRESH' }, anthropic: { type: 'api', key: 'ANTHROPIC_KEY' } }),
      parentJsonl: [parentTaskEventV2(), JSON.stringify(parentReasoningEventV2({ text: 'CPA_ACCESS' })), parentStepFinishV2()].join('\n'),
      childExport: validChildExportV2().replace('prompt', 'CPA_REFRESH'),
      pattern: /CPA_ACCESS|CPA_REFRESH|ANTHROPIC_KEY/,
    },
  ]) {
    const pending = await invokeProcessAdapterV2({
      baseEnv: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        OPENCODE_AUTH_CONTENT: scenario.authContent,
        ANTHROPIC_API_KEY: 'ANTHROPIC_ENV_KEY',
      },
      parentResult: { status: 0, signal: null, stdout: scenario.parentJsonl, stderr: '', error: null },
      exportResults: new Map([[PARENT_SESSION_ID, { status: 0, stdout: validParentExportV2(), stderr: '', error: null }], [CHILD_SESSION_ID, { status: 0, stdout: scenario.childExport, stderr: '', error: null }]]),
    });
    t.after(() => rmSync(pending.root, { recursive: true, force: true }));
    const spawnCall = pending.calls.find((entry) => entry.kind === 'spawn');
    assert.deepEqual(JSON.parse(spawnCall.env.OPENCODE_AUTH_CONTENT), { cpa: JSON.parse(scenario.authContent).cpa }, scenario.label);
    assert.equal('ANTHROPIC_API_KEY' in spawnCall.env, false, scenario.label);
    const files = pending.result.envelope.stable.sources.inventory.map((entry) => entry.path).concat('envelope.json');
    for (const rel of files) assert.doesNotMatch(readFileSync(path.join(pending.result.runDirectory, rel), 'utf8'), scenario.pattern, `${scenario.label}:${rel}`);
    assert.doesNotMatch(JSON.stringify(pending.result.safeDiagnostics), scenario.pattern, scenario.label);
  }
});
