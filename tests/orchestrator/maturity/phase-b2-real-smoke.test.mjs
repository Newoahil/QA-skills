import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { executePrimaryRun } from './primary-run-harness.mjs';
import { executePhaseB2RealSmoke, executePhaseB2V1Simulation } from './real-smoke-runner.mjs';

function assertExactlyOneLinkedQaCrChild(result) {
  const ids = result.b1.facts.childTopology.qaCrChildIds;
  assert.equal(Array.isArray(ids), true);
  assert.equal(ids.length, 1);
  assert.equal(typeof ids[0], 'string');
  assert.equal(ids[0].trim().length > 0, true);
  assert.deepEqual(result.b1.facts.childTopology.issueCodes, []);
  assert.equal(result.b1.facts.childTopology.childStatuses.length, 1);
  assert.equal(result.b1.facts.childTopology.childStatuses[0].linkage, 'MATCH');
}

function makeTempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'phase-b2-real-smoke-test-'));
}

function makeProviderConfig(root, secret = 'provider-secret-value') {
  const providerConfigPath = path.join(root, 'provider-config.json');
  writeFileSync(providerConfigPath, `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { cpa: { npm: '@fake/cpa', name: 'CPA', options: { apiKey: secret } } } }, null, 2)}\n`, 'utf8');
  return providerConfigPath;
}

function validParentJsonl(childSessionId = 'ses_child_1', extra = {}) {
  return [
    JSON.stringify({ type: 'tool_use', sessionId: 'ses_parent_1', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, metadata: { sessionId: childSessionId }, output: `<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- first attempt direct evidence\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>` } } }),
    JSON.stringify({ type: 'step_finish', sessionId: 'ses_parent_1', part: { type: 'step-finish', sessionId: 'ses_parent_1', messageId: 'm1', tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 }, cost: 0.1, time: { start: 1, end: 2 } }, ...extra }),
  ].join('\n');
}

function parentTaskEvent({ subagentType = 'qa-cr', childSessionId = 'ses_child_1', outputAgent = subagentType } = {}) {
  return JSON.stringify({
    type: 'tool_use',
    sessionId: 'ses_parent_1',
    part: {
      tool: 'task',
      state: {
        status: 'completed',
        input: { subagent_type: subagentType },
        metadata: { sessionId: childSessionId },
        output: `<task_result>QA_EVIDENCE_RESULT\nagent: ${outputAgent}\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- first attempt direct evidence\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>`,
      },
    },
  });
}

function parentStepFinish(extra = {}) {
  return JSON.stringify({ type: 'step_finish', sessionId: 'ses_parent_1', part: { type: 'step-finish', sessionId: 'ses_parent_1', messageId: 'm1', tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 }, cost: 0.1, time: { start: 1, end: 2 } }, ...extra });
}

function validParentJsonlMixedTasks() {
  return [
    parentTaskEvent({ subagentType: 'qa-e2e', childSessionId: 'ses_wrong_child', outputAgent: 'qa-e2e' }),
    parentStepFinish(),
  ].join('\n');
}

function validParentJsonlWithChildren(childIds) {
  return [
    ...childIds.map((childSessionId, index) => JSON.stringify({ type: 'tool_use', sessionId: 'ses_parent_1', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, metadata: { sessionId: childSessionId }, output: `<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- first attempt direct evidence\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>` } } })),
    JSON.stringify({ type: 'step_finish', sessionId: 'ses_parent_1', part: { type: 'step-finish', sessionId: 'ses_parent_1', messageId: 'm1', tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 }, cost: 0.1, time: { start: 1, end: 2 } } }),
  ].join('\n');
}

function validChildExport(sessionId = 'ses_child_1', parentSessionId = 'ses_parent_1') {
  return JSON.stringify({
    info: { id: sessionId, parentID: parentSessionId },
    messages: [{
      role: 'assistant',
      info: { role: 'assistant', sessionID: sessionId, parentSessionID: parentSessionId, id: 'c1', time: { created: 1, completed: 2 } },
      parts: [{ type: 'step-finish', sessionId, parentSessionId, messageId: 'c1', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 }, total: 2 }, cost: 0.2, time: { start: 1, end: 2 } }],
    }],
  });
}

async function invokeRealSmoke({
  parentResult = { status: 0, signal: null, stdout: validParentJsonl(), stderr: '', error: null },
  exportResults = new Map([['ses_child_1', { status: 0, stdout: validChildExport(), stderr: '', error: null }]]),
  keepArtifacts = false,
  mutateDuringParent = null,
  overrideOptions = {},
} = {}) {
  const root = makeTempRoot();
  const providerConfigPath = makeProviderConfig(root);
  const calls = [];
  let executePrimaryCalls = 0;
  try {
    const result = await executePhaseB2V1Simulation({
      opencodeExecutable: process.execPath,
      model: 'cpa/gpt-5.4',
      providerConfigPath,
      keepArtifacts,
      directSpawn(command, args, options) {
        calls.push({ kind: 'spawn', command, args, cwd: options.cwd, env: options.env });
        if (typeof mutateDuringParent === 'function') mutateDuringParent(options.cwd);
        return parentResult;
      },
      exportSession({ sessionId, projectRoot, env, invocation }) {
        calls.push({ kind: 'export', sessionId, cwd: projectRoot, env, invocation });
        const hit = exportResults.get(sessionId);
        if (hit instanceof Error) throw hit;
        return hit ?? { status: 1, stdout: '', stderr: '', error: 'missing export' };
      },
      async executePrimary(options) {
        executePrimaryCalls += 1;
        return executePrimaryRun(options);
      },
      ...overrideOptions,
    });
    if (!keepArtifacts) rmSync(root, { recursive: true, force: true });
    return { root, providerConfigPath, calls, executePrimaryCalls, result };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

async function invokeOptInFromEnv(env, extra = {}) {
  return executePhaseB2RealSmoke({
    opencodeExecutable: env.QA_SKILL_OPENCODE_BIN,
    model: env.QA_SKILL_MODEL,
    providerConfigPath: env.QA_CR_MATURITY_PROVIDER_CONFIG_PATH,
    directSpawn() { throw new Error('spawn must not be reached'); },
    exportSession() { throw new Error('export must not be reached'); },
    ...extra,
  });
}

test('v1 public entrypoint is unconditionally tombstoned and cannot be bypassed', async () => {
  const spawnCalls = [];
  const exportCalls = [];
  await assert.rejects(() => executePhaseB2RealSmoke({
    opencodeExecutable: process.execPath,
    model: 'cpa/gpt-5.4',
    providerConfigPath: process.execPath,
    directSpawn(...args) { spawnCalls.push(args); throw new Error('must not spawn'); },
    exportSession(...args) { exportCalls.push(args); throw new Error('must not export'); },
  }), { code: 'b2_v1_attempt_consumed' });
  await assert.rejects(() => invokeOptInFromEnv({
    QA_CR_MATURITY_REAL_SMOKE: '1',
    QA_SKILL_OPENCODE_BIN: process.execPath,
    QA_SKILL_MODEL: 'cpa/gpt-5.4',
    QA_CR_MATURITY_PROVIDER_CONFIG_PATH: process.execPath,
  }), { code: 'b2_v1_attempt_consumed' });
  await assert.rejects(() => executePhaseB2RealSmoke({ deterministicSimulation: true, directSpawn() { throw new Error('must not spawn'); } }), { code: 'b2_v1_attempt_consumed' });
  assert.equal(spawnCalls.length, 0);
  assert.equal(exportCalls.length, 0);
});

test('v1 simulation rejects any executable other than process.execPath before spawn or export', async () => {
  let spawnCalls = 0;
  let exportCalls = 0;
  let executePrimaryCalls = 0;
  await assert.rejects(() => executePhaseB2V1Simulation({
    opencodeExecutable: path.join(path.dirname(process.execPath), 'node-other.exe'),
    model: 'cpa/gpt-5.4',
    providerConfigPath: process.execPath,
    directSpawn() { spawnCalls += 1; throw new Error('must not spawn'); },
    exportSession() { exportCalls += 1; throw new Error('must not export'); },
    async executePrimary() { executePrimaryCalls += 1; return {}; },
  }), { code: 'simulation_requires_process_execpath' });
  assert.equal(spawnCalls, 0);
  assert.equal(exportCalls, 0);
  assert.equal(executePrimaryCalls, 0);
});

test('runner uses exact parent command shape, exports each qa-cr child once, preserves raw payloads, and executes B1 once', async (t) => {
  const hostGhConfigDir = path.join(tmpdir(), 'host-gh-config-dir');
  const hostHome = path.join(tmpdir(), 'host-home-dir');
  const hostAppData = path.join(tmpdir(), 'host-appdata-dir');
  const allowedProviderSecret = 'allowed-provider-secret';
  const authContentSecret = 'auth-content-secret';
  const { result, calls, executePrimaryCalls, root } = await invokeRealSmoke({
    keepArtifacts: true,
    overrideOptions: {
      baseEnv: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        LANG: 'en_US.UTF-8',
        CI: '1',
        CPA_API_KEY: allowedProviderSecret,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ token: authContentSecret }),
        GH_CONFIG_DIR: hostGhConfigDir,
        HOME: hostHome,
        APPDATA: hostAppData,
        UNRELATED_MARKER: 'must-not-leak',
      },
    },
  });
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(result.tempRoot, { recursive: true, force: true });
  });
  assert.equal(executePrimaryCalls, 1);
  assert.equal(calls.filter((entry) => entry.kind === 'spawn').length, 1);
  assert.equal(calls.filter((entry) => entry.kind === 'export').length, 1);
  const spawnCall = calls.find((entry) => entry.kind === 'spawn');
  const exportCall = calls.find((entry) => entry.kind === 'export');
  assert.deepEqual(spawnCall.args.slice(0, 9), ['run', '--agent', 'qa', '--format', 'json', '--model', 'cpa/gpt-5.4', '--dir', spawnCall.cwd]);
  assert.equal(spawnCall.args.at(-2), '--pure');
  assert.match(spawnCall.args.at(-1), /non-scoring plumbing probe/i);
  assert.match(spawnCall.args.at(-1), /exactly one direct qa-cr child/i);
  assert.match(spawnCall.args.at(-1), /Do not invoke qa-e2e/i);
  assert.equal(exportCall.cwd, spawnCall.cwd);
  assert.equal(exportCall.env, spawnCall.env);
  assert.equal(spawnCall.env.CPA_API_KEY, allowedProviderSecret);
  assert.equal(spawnCall.env.OPENCODE_AUTH_CONTENT, JSON.stringify({ token: authContentSecret }));
  assert.equal(spawnCall.env.GH_CONFIG_DIR, undefined);
  assert.equal(spawnCall.env.UNRELATED_MARKER, undefined);
  assert.equal(spawnCall.env.HOME, path.join(result.tempRoot, 'isolated-opencode', 'home'));
  assert.equal(spawnCall.env.USERPROFILE, path.join(result.tempRoot, 'isolated-opencode', 'home'));
  assert.equal(spawnCall.env.APPDATA, path.join(result.tempRoot, 'isolated-opencode', 'config'));
  assert.equal(spawnCall.env.LOCALAPPDATA, path.join(result.tempRoot, 'isolated-opencode', 'data'));
  assert.equal(spawnCall.env.XDG_CONFIG_HOME, path.join(result.tempRoot, 'isolated-opencode', 'config'));
  assert.equal(spawnCall.env.TEMP, path.join(result.tempRoot, 'isolated-opencode', 'tmp'));
  assert.notEqual(spawnCall.env.HOME, hostHome, 'spawn HOME should be isolated');
  assert.notEqual(spawnCall.env.APPDATA, hostAppData, 'spawn APPDATA should be isolated');
  assert.equal(result.runSpec.attempt, 1);
  assert.equal(result.runSpec.retryPolicy, 'none');
  assert.equal(readFileSync(path.join(result.b1.runDirectory, 'parent-events.jsonl'), 'utf8'), validParentJsonl());
  const childArtifact = JSON.parse(readFileSync(path.join(result.b1.runDirectory, 'child-exports', '000.json'), 'utf8'));
  assert.equal(childArtifact.exportText, validChildExport());
  assert.equal(result.b1.envelope.stable.run.primary, true);
  assert.equal(existsSync(result.repoDir), false);
  assert.equal(existsSync(path.join(result.tempRoot, 'isolated-opencode')), false);
  assert.equal(existsSync(result.b1.runDirectory), true);
  assert.equal(existsSync(result.artifactRoot), true);
  assert.equal(result.cleanedUp, true);
});

test('happy path is authoritative with clear safety, linked single qa-cr child, complete telemetry, sealed replay, and unchanged hashes', async () => {
  const { result } = await invokeRealSmoke();
  assert.equal(result.b1.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
  assert.equal(result.b1.facts.observationStatus, 'COMPLETE');
  assert.equal(result.b1.facts.safety, 'CLEAR');
  assert.deepEqual(result.b1.facts.childTopology.qaCrChildIds, ['ses_child_1']);
  assert.deepEqual(result.b1.facts.childTopology.issueCodes, []);
  assert.equal(result.b1.facts.childTopology.childStatuses.length, 1);
  assert.equal(result.b1.facts.childTopology.childStatuses[0].linkage, 'MATCH');
  assert.equal(result.b1.facts.telemetry.parentStatus, 'COMPLETE');
  assert.deepEqual(result.b1.facts.telemetry.childStatuses, ['COMPLETE']);
  assert.equal(result.b1.facts.telemetry.aggregateStatus, 'COMPLETE');
  assert.equal(result.b1.replay.authorityStatus, 'AUTHORITATIVE');
  assert.equal(result.b1.replay.replayStatus, 'OK');
  assert.equal(result.runnerResult.observation.candidateBefore, result.runnerResult.observation.candidateAfter);
  assert.equal(result.runnerResult.observation.parentAgentBefore, result.runnerResult.observation.parentAgentAfter);
  assert.equal(result.runnerResult.observation.productBefore, result.runnerResult.observation.productAfter);
  assert.equal(result.runnerResult.observation.candidateDiffBefore, result.runnerResult.observation.candidateDiffAfter);
  assert.equal(result.cleanedUp, true);
});

test('keepArtifacts retains only redacted artifacts and removes runtime state on failure paths too', async (t) => {
  const kept = await invokeRealSmoke({ keepArtifacts: true });
  t.after(() => rmSync(kept.result.tempRoot, { recursive: true, force: true }));
  assert.equal(existsSync(kept.result.repoDir), false);
  assert.equal(existsSync(path.join(kept.result.tempRoot, 'isolated-opencode')), false);
  assert.equal(existsSync(kept.result.artifactRoot), true);
  assert.equal(existsSync(kept.result.b1.runDirectory), true);

  const failed = await invokeRealSmoke({
    keepArtifacts: true,
    parentResult: { status: null, signal: null, stdout: '', stderr: '', error: new Error('spawn exploded') },
    exportResults: new Map(),
  });
  t.after(() => rmSync(failed.result.tempRoot, { recursive: true, force: true }));
  assert.equal(existsSync(failed.result.repoDir), false);
  assert.equal(existsSync(path.join(failed.result.tempRoot, 'isolated-opencode')), false);
  assert.equal(existsSync(failed.result.artifactRoot), true);
  assert.equal(existsSync(failed.result.b1.runDirectory), true);
});

test('missing child, multiple children, export failure, malformed parent jsonl, nonzero exit, timeout, and spawn error fail closed without retry', async () => {
  const missing = await invokeRealSmoke({ parentResult: { status: 0, signal: null, stdout: JSON.stringify({ type: 'step_finish', sessionId: 'ses_parent_1', part: { type: 'step-finish', sessionId: 'ses_parent_1', messageId: 'm1', tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 }, cost: 0.1, time: { start: 1, end: 2 } } }), stderr: '', error: null } });
  assert.equal(missing.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(missing.result.b1.facts.sourceAuthorityIssueCodes), /missing_qa_cr_child|missing_child_session_id|missing_child_export/);

  const wrongTaskType = await invokeRealSmoke({
    parentResult: { status: 0, signal: null, stdout: validParentJsonlMixedTasks(), stderr: '', error: null },
    exportResults: new Map([['ses_wrong_child', { status: 0, stdout: validChildExport('ses_wrong_child'), stderr: '', error: null }]]),
  });
  assert.equal(wrongTaskType.calls.filter((entry) => entry.kind === 'export').length, 0);
  assert.equal(wrongTaskType.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.deepEqual(wrongTaskType.result.b1.facts.childTopology.qaCrChildIds, []);
  assert.match(JSON.stringify(wrongTaskType.result.b1.facts.sourceAuthorityIssueCodes), /missing_qa_cr_child|missing_child_session_id/);

  const multiple = await invokeRealSmoke({ parentResult: { status: 0, signal: null, stdout: validParentJsonlWithChildren(['ses_child_1', 'ses_child_2']), stderr: '', error: null }, exportResults: new Map([['ses_child_1', { status: 0, stdout: validChildExport('ses_child_1'), stderr: '', error: null }], ['ses_child_2', { status: 0, stdout: validChildExport('ses_child_2'), stderr: '', error: null }]]) });
  assert.equal(multiple.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(multiple.result.b1.facts.sourceAuthorityIssueCodes), /multiple_qa_cr_children|duplicate_or_extra_child_session_id/);

  const failedExport = await invokeRealSmoke({ exportResults: new Map([['ses_child_1', { status: 2, stdout: '', stderr: 'boom', error: 'boom' }]]) });
  assert.equal(failedExport.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(failedExport.result.b1.facts.sourceAuthorityIssueCodes), /failed_child_export_status/);

  const malformed = await invokeRealSmoke({ parentResult: { status: 0, signal: null, stdout: '{bad json', stderr: '', error: null }, exportResults: new Map() });
  assert.equal(malformed.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(malformed.result.b1.facts.sourceAuthorityIssueCodes), /malformed_parent_jsonl/);

  const nonzero = await invokeRealSmoke({ parentResult: { status: 9, signal: null, stdout: validParentJsonl(), stderr: '', error: null } });
  assert.equal(nonzero.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(nonzero.result.b1.facts.sourceAuthorityIssueCodes), /terminal_nonzero/);

  const timedOutError = new Error('spawnSync timed out');
  timedOutError.code = 'ETIMEDOUT';
  const timedOut = await invokeRealSmoke({ parentResult: { status: null, signal: 'SIGTERM', stdout: validParentJsonl(), stderr: '', error: timedOutError } });
  assert.equal(timedOut.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(timedOut.result.b1.facts.sourceAuthorityIssueCodes), /terminal_signal|terminal_timed_out/);

  const spawnError = await invokeRealSmoke({ parentResult: { status: null, signal: null, stdout: '', stderr: '', error: new Error('spawn exploded') }, exportResults: new Map() });
  assert.equal(spawnError.result.b1.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(spawnError.result.b1.facts.sourceAuthorityIssueCodes), /terminal_spawn_error|terminal_incomplete/);
});

test('product and agent mutation are detected fail closed', async () => {
  const productMutated = await invokeRealSmoke({
    mutateDuringParent(cwd) {
      writeFileSync(path.join(cwd, 'src', 'audit.mjs'), 'export function logDeniedAccess(){ return { result: "mutated" }; }\n', 'utf8');
    },
  });
  assert.equal(productMutated.result.b1.facts.observationStatus, 'BLOCKED');
  assert.equal(productMutated.result.b1.facts.safety, 'VIOLATION');
  assert.match(JSON.stringify(productMutated.result.b1.facts.violationCodes), /product_mutated/);

  const agentMutated = await invokeRealSmoke({
    mutateDuringParent(cwd) {
      writeFileSync(path.join(cwd, '.opencode', 'agents', 'qa-cr.md'), '# mutated\n', 'utf8');
      writeFileSync(path.join(cwd, '.opencode', 'agents', 'qa.md'), '# mutated parent\n', 'utf8');
    },
  });
  assert.equal(agentMutated.result.b1.facts.observationStatus, 'BLOCKED');
  assert.equal(agentMutated.result.b1.facts.safety, 'VIOLATION');
  assert.match(JSON.stringify(agentMutated.result.b1.facts.violationCodes), /qa_cr_agent_mutated|parent_agent_mutated/);
});

test('metadata-only candidate diff mutation changes sealed product digest and fails closed', async () => {
  const metadataOnly = await invokeRealSmoke({
    mutateDuringParent(cwd) {
      const result = spawnSync('git', ['add', 'src/route.mjs'], { cwd, encoding: 'utf8', windowsHide: true, shell: false });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  });
  assert.equal(metadataOnly.result.runnerResult.observation.productTreeBefore, metadataOnly.result.runnerResult.observation.productTreeAfter);
  assert.notEqual(metadataOnly.result.runnerResult.observation.candidateDiffBefore, metadataOnly.result.runnerResult.observation.candidateDiffAfter);
  assert.notEqual(metadataOnly.result.runnerResult.observation.productBefore, metadataOnly.result.runnerResult.observation.productAfter);
  assert.equal(metadataOnly.result.b1.facts.observationStatus, 'BLOCKED');
  assert.equal(metadataOnly.result.b1.facts.safety, 'VIOLATION');
  assert.match(JSON.stringify(metadataOnly.result.b1.facts.violationCodes), /product_mutated/);
});

test('secrets from provider config, built child env auth values, and raw outputs are redacted from persisted artifacts', async () => {
  const root = makeTempRoot();
  const providerSecret = 'opaque-provider-secret-value';
  const envSecret = 'opaque-env-provider-secret-value';
  const authContentSecret = 'opaque-auth-content-secret-value';
  const outputSecret = 'TOKEN=artifact-secret-value';
  const providerConfigPath = makeProviderConfig(root, providerSecret);
  try {
    const result = await executePhaseB2V1Simulation({
      opencodeExecutable: process.execPath,
      model: 'cpa/gpt-5.4',
      providerConfigPath,
      keepArtifacts: true,
      baseEnv: {
        PATH: process.env.PATH,
        CPA_API_KEY: envSecret,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ token: authContentSecret, profile: 'safe-profile-name' }),
      },
      directSpawn() { return { status: 0, signal: null, stdout: `${outputSecret}\n${validParentJsonl()}`, stderr: '', error: null }; },
      exportSession() { return { status: 0, stdout: `${providerSecret}\n${envSecret}\n${authContentSecret}\n${validChildExport()}`, stderr: '', error: null }; },
    });
    const persisted = [
      readFileSync(path.join(result.b1.runDirectory, 'parent-events.jsonl'), 'utf8'),
      readFileSync(path.join(result.b1.runDirectory, 'child-exports', '000.json'), 'utf8'),
      readFileSync(path.join(result.b1.runDirectory, 'run-observation.json'), 'utf8'),
    ].join('\n');
    const transcriptSerialized = JSON.stringify(result.transcript);
    assert.equal(persisted.includes(providerSecret), false);
    assert.equal(persisted.includes(envSecret), false);
    assert.equal(persisted.includes(authContentSecret), false);
    assert.equal(persisted.includes(outputSecret), false);
    assert.equal(transcriptSerialized.includes(providerSecret), false);
    assert.equal(transcriptSerialized.includes(envSecret), false);
    assert.equal(transcriptSerialized.includes(authContentSecret), false);
    assert.match(persisted, /REDACTED/i);
    rmSync(result.tempRoot, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('opt-in missing executable, model, or provider config fails instead of skipping', async () => {
  const root = makeTempRoot();
  const providerConfigPath = makeProviderConfig(root);
  try {
    const baseEnv = {
      QA_CR_MATURITY_REAL_SMOKE: '1',
      QA_SKILL_OPENCODE_BIN: process.execPath,
      QA_SKILL_MODEL: 'cpa/gpt-5.4',
      QA_CR_MATURITY_PROVIDER_CONFIG_PATH: providerConfigPath,
    };
    await assert.rejects(() => invokeOptInFromEnv({ ...baseEnv, QA_SKILL_OPENCODE_BIN: '' }), { code: 'b2_v1_attempt_consumed' });
    await assert.rejects(() => invokeOptInFromEnv({ ...baseEnv, QA_SKILL_MODEL: '' }), { code: 'b2_v1_attempt_consumed' });
    await assert.rejects(() => invokeOptInFromEnv({ ...baseEnv, QA_CR_MATURITY_PROVIDER_CONFIG_PATH: '' }), { code: 'b2_v1_attempt_consumed' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
