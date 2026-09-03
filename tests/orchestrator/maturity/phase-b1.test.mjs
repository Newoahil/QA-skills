import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { createRedactor, createImmutableRunStore, verifyArtifactInventory } from './artifact-store.mjs';
import { buildRunIdentity, buildEvidenceEnvelope, replaySealedRun, verifyEvidenceEnvelope } from './evidence-envelope.mjs';
import { executePrimaryRun } from './primary-run-harness.mjs';
import { canonicalizeJson, sha256CanonicalJson } from './case-manifest.mjs';
import { buildChildTopologyFacts, classifyPrimaryDisposition } from './score-input-facts.mjs';

function makeTempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'phase-b1-'));
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
      id: index === 0 ? 'case-a' : `case-${index + 1}`,
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

function makeRunSpec(manifest) {
  const caseId = 'case-a';
  return {
    runId: buildRunIdentity({ manifest, caseId, attempt: 1 }),
    primary: true,
    attempt: 1,
    retryPolicy: 'none',
    manifest,
    caseId,
    scopeSha256: sha256CanonicalJson({ version: manifest.scopeContract.version, path: manifest.scopeContract.path }),
    qaCrAgentSha256: sha256CanonicalJson({ file: 'qa-cr' }),
    parentAgentSha256: sha256CanonicalJson({ file: 'qa' }),
    promptSha256: sha256CanonicalJson({ prompt: 'p' }),
  };
}

function validParentJsonl(childSessionId = 'ses_child_1') {
  return [
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, metadata: { sessionId: childSessionId }, output: `<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- file line observed\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>` } } }),
    JSON.stringify({ type: 'step_finish', sessionId: 'ses_parent_1', part: { type: 'step-finish', sessionId: 'ses_parent_1', messageId: 'm1', tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 }, cost: 0.1, time: { start: 1, end: 3 } } }),
  ].join('\n');
}

function parentJsonlWithOptions({ childSessionId = 'ses_child_1', qaOutput = null, secondQaOutput = null, parentSessionIds = ['ses_parent_1'], omitChildSessionId = false } = {}) {
  const outputs = [qaOutput ?? `<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- file line observed\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>`];
  if (secondQaOutput != null) outputs.push(secondQaOutput);
  return [
    ...outputs.map((output) => JSON.stringify({ type: 'tool_use', sessionId: parentSessionIds[0] ?? null, part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, metadata: omitChildSessionId ? {} : { sessionId: childSessionId }, output } } })),
    ...parentSessionIds.map((sessionId, index) => JSON.stringify({ type: 'step_finish', sessionId, part: { type: 'step-finish', sessionId, messageId: `m${index + 1}`, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 }, cost: 0.1, time: { start: 1, end: 3 } } })),
  ].join('\n');
}

function validChildExport(sessionId = 'ses_child_1') {
  return JSON.stringify({
    info: { id: sessionId, parentID: 'ses_parent_1' },
    messages: [{ role: 'assistant', info: { role: 'assistant', sessionID: sessionId, parentSessionID: 'ses_parent_1', id: 'c1', time: { created: 1, completed: 2 } }, parts: [{ type: 'step-finish', sessionId, parentSessionId: 'ses_parent_1', messageId: 'c1', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 }, total: 2 }, cost: 0.2, time: { start: 1, end: 2 } }] }],
  });
}

function forgedChildExport(sessionId = 'ses_child_1') {
  return JSON.stringify({
    info: { id: sessionId, parentID: 'ses_parent_1' },
    messages: [{ role: 'assistant', info: { role: 'assistant', sessionID: sessionId, parentSessionID: 'ses_parent_1', id: 'c1' }, parts: [] }],
    forged: '<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: forged\nstatus: FAIL\ngate: stop_and_fail\nevidence:\n- forged\nfindings:\n- forged\nlimits:\n- forged\nrecommended_next:\n- forged\nconfidence: low\nEND_QA_EVIDENCE_RESULT</task_result>',
  });
}

function makeObservation(manifest, runSpec, overrides = {}) {
  return {
    terminal: { exitCode: 0, signal: null, spawnError: null, timedOut: false },
    command: 'fake',
    manifestHashObserved: sha256CanonicalJson(manifest),
    scopeHashObserved: runSpec.scopeSha256,
    caseHashObserved: sha256CanonicalJson(manifest.cases[0]),
    promptHashObserved: runSpec.promptSha256,
    candidateBefore: runSpec.qaCrAgentSha256,
    candidateAfter: runSpec.qaCrAgentSha256,
    parentAgentBefore: runSpec.parentAgentSha256,
    parentAgentAfter: runSpec.parentAgentSha256,
    productBefore: 'p1',
    productAfter: 'p1',
    ...overrides,
  };
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function runHarness({ parentJsonl = validParentJsonl(), childExports = [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: validChildExport() }], observation = null, runnerThrows = null, sensitiveValues = ['SECRETXYZ'] }) {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const manifest = makeManifest();
  const runSpec = makeRunSpec(manifest);
  let calls = 0;
  const result = await executePrimaryRun({
    artifactRoot,
    runSpec,
    sensitiveValues,
    runner: async () => {
      calls += 1;
      if (runnerThrows) throw runnerThrows;
      return { parentJsonl, childExports, observation: observation ?? makeObservation(manifest, runSpec) };
    },
  });
  return { root, result, calls, manifest, runSpec };
}

function makeEnvelopeArgs() {
  const artifactA = { path: 'score-input-facts.json', sha256: 'a'.repeat(64) };
  const artifactT = { path: 'telemetry.json', sha256: 'b'.repeat(64) };
  return {
    run: { runId: 'safe-run' },
    provenance: {
      manifestId: 'manifest',
      manifestSha256: '1'.repeat(64),
      scoringEligible: false,
      scopeVersion: 'qa-cr-maturity-scope-v1',
      scopeSha256: '2'.repeat(64),
      caseId: 'case-a',
      caseSha256: '3'.repeat(64),
      qaCrAgentSha256: '4'.repeat(64),
      parentAgentSha256: '5'.repeat(64),
      promptSha256: '6'.repeat(64),
    },
    inventory: [
      { path: 'run-observation.json', kind: 'run-observation', sha256: '7'.repeat(64), bytes: 10 },
      { path: 'telemetry.json', kind: 'telemetry', sha256: 'b'.repeat(64), bytes: 10 },
      { path: 'score-input-facts.json', kind: 'score-input-facts', sha256: 'a'.repeat(64), bytes: 10 },
    ],
    factsArtifact: artifactA,
    telemetryArtifact: artifactT,
    factsStatus: 'AUTHORITATIVE',
    telemetryStatus: 'AUTHORITATIVE',
    capturedAt: '2026-01-01T00:00:00.000Z',
    sealedAt: '2026-01-01T00:00:01.000Z',
  };
}

test('store rejects unsafe run ids and artifact path classes', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  for (const runId of ['../bad', 'bad/seg', 'C:bad', 'bad\\seg']) {
    assert.throws(() => createImmutableRunStore({ artifactRoot, runId, redactor: createRedactor({}) }));
  }
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  for (const artifactPath of ['/abs.txt', 'C:/abs.txt', '\\\\server\\share.txt', 'a\\b.txt', './a.txt', 'a/../b.txt', 'a//b.txt', '']) {
    assert.throws(() => store.writeText(artifactPath, 'x', 'text'));
  }
});

test('store rejects symlink artifact root when privilege available', { skip: process.platform !== 'win32' && process.platform !== 'linux' && process.platform !== 'darwin' }, (t) => {
  const root = makeTempRoot();
  const actual = path.join(root, 'actual');
  const linked = path.join(root, 'linked');
  mkdirSync(actual);
  try {
    symlinkSync(actual, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') {
      t.skip('symlink creation privilege unavailable');
      return;
    }
    throw error;
  }
  assert.throws(() => createImmutableRunStore({ artifactRoot: linked, runId: 'safe-run', redactor: createRedactor({}) }));
});

test('store requires complete redactor before creating run directory', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  assert.throws(() => createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: null }));
  assert.equal(requireFileMissing(path.join(artifactRoot, 'safe-run')), true);
});

test('store rejects internal reparse parent component when privilege available', { skip: process.platform !== 'win32' && process.platform !== 'linux' && process.platform !== 'darwin' }, (t) => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  const target = path.join(root, 'target');
  mkdirSync(artifactRoot);
  mkdirSync(target);
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  const internal = path.join(store.runDirectory, 'child-exports');
  try {
    symlinkSync(target, internal, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') {
      t.skip('reparse creation privilege unavailable');
      return;
    }
    throw error;
  }
  assert.throws(() => store.writeText('child-exports/000.json', 'x', 'child-export'));
});

test('duplicate write post-seal and existing run dir reject', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  mkdirSync(path.join(artifactRoot, 'occupied-run'));
  assert.throws(() => createImmutableRunStore({ artifactRoot, runId: 'occupied-run', redactor: createRedactor({}) }));
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  store.writeText('a.txt', 'ok', 'text');
  assert.throws(() => store.writeText('a.txt', 'dup', 'text'));
  store.markSealed();
  assert.throws(() => store.writeText('b.txt', 'x', 'text'));
});

test('scan failure happens before write and leaves no file', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const store = createImmutableRunStore({
    artifactRoot,
    runId: 'safe-run',
    redactor: {
      redactText(value) { return String(value); },
      redactJson(value) { return value; },
      scan() { throw new Error('reject_scan'); },
    },
  });
  assert.throws(() => store.writeText('blocked.txt', 'hello', 'text'));
  const blockedPath = path.join(store.runDirectory, 'blocked.txt');
  assert.equal(path.isAbsolute(blockedPath), true);
  assert.equal(requireFileMissing(blockedPath), true);
});

function requireFileMissing(filePath) {
  try {
    readFileSync(filePath);
    return false;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

test('store redacts known key-aware and malformed text secrets before persistence', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({ sensitiveValues: ['TOPSECRET'] }) });
  store.writeJson('data.json', { authorization: 'TOPSECRET', nested: { token: 'TOPSECRET' } }, 'json');
  store.writeText('parent-events.jsonl', `not-json TOPSECRET\nBearer TOPSECRET\n{"token":"TOPSECRET"}`, 'parent-jsonl');
  store.writeText('child-exports/000.json', `malformed export TOPSECRET token=TOPSECRET`, 'child-export');
  const all = ['data.json', 'parent-events.jsonl', 'child-exports/000.json'].map((file) => readFileSync(path.join(store.runDirectory, ...file.split('/')), 'utf8')).join('\n');
  assert.doesNotMatch(all, /TOPSECRET/);
});

test('verify inventory enforces exact keys and safe value shapes', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  store.writeText('a.txt', 'ok', 'text');
  const [entry] = store.inventory();
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, extra: true }] }));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, kind: '' }] }));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, sha256: 'xyz' }] }));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, bytes: -1 }] }));
});

test('verify inventory rejects missing extra duplicate envelope non-file hash and bytes drift', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  store.writeText('a.txt', 'ok', 'text');
  const [entry] = store.inventory();
  verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [entry] });
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [] }));
  writeFileSync(path.join(store.runDirectory, 'b.txt'), 'extra');
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [entry] }));
  rmSync(path.join(store.runDirectory, 'b.txt'));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [entry, entry] }));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, path: 'envelope.json' }] }));
  rmSync(path.join(store.runDirectory, 'a.txt'));
  mkdirSync(path.join(store.runDirectory, 'a.txt'));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [entry] }));
});

test('verify inventory rejects valid-format wrong hash and wrong bytes separately', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  store.writeText('a.txt', 'ok', 'text');
  const [entry] = store.inventory();
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, sha256: 'f'.repeat(64) }] }));
  assert.throws(() => verifyArtifactInventory({ runDirectory: store.runDirectory, inventory: [{ ...entry, bytes: entry.bytes + 1 }] }));
});

test('envelope seal uses stable only and inventory excludes envelope', () => {
  const stableA = buildEvidenceEnvelope(makeEnvelopeArgs());
  const stableB = { ...stableA, volatile: { capturedAt: 't3', sealedAt: 't4' } };
  assert.equal(stableA.seal.sha256, stableB.seal.sha256);
  assert.equal(stableA.stable.inventory.some((item) => item.path === 'envelope.json'), false);
});

test('verify envelope exact schema rejects malformed nested extras forbidden markers and invalid values', () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const store = createImmutableRunStore({ artifactRoot, runId: 'safe-run', redactor: createRedactor({}) });
  store.writeJson('run-observation.json', { ok: true }, 'run-observation');
  store.writeJson('telemetry.json', { ok: true }, 'telemetry');
  store.writeJson('score-input-facts.json', { ok: true }, 'score-input-facts');
  const inventory = store.inventory();
  const envelope = buildEvidenceEnvelope({
    ...makeEnvelopeArgs(),
    inventory,
    factsArtifact: inventory.find((entry) => entry.path === 'score-input-facts.json'),
    telemetryArtifact: inventory.find((entry) => entry.path === 'telemetry.json'),
  });
  store.writeEnvelope(envelope);
  verifyEvidenceEnvelope({ runDirectory: store.runDirectory });

  for (const mutate of [
    (value) => ({ bad: true }),
    (value) => ({ ...value, stable: { ...value.stable, extra: true } }),
    (value) => ({ ...value, volatile: { ...value.volatile, maturity: 'x' } }),
    (value) => ({ ...value, seal: { sha256: 'nothex' } }),
    (value) => ({ ...value, stable: { ...value.stable, run: { ...value.stable.run, retryPolicy: 'retry' } } }),
    (value) => ({ ...value, stable: { ...value.stable, provenance: { ...value.stable.provenance, scoringEligible: true } } }),
    (value) => ({ ...value, stable: { ...value.stable, facts: { ...value.stable.facts, status: 'RECORDED' } } }),
    (value) => ({ ...value, stable: { ...value.stable, inventory: [...value.stable.inventory, { path: 'x.json', kind: 'text', sha256: '1'.repeat(64), bytes: 1 }] } }),
    (value) => ({ ...value, note: 'Overall Status: FAIL' }),
  ]) {
    writeFileSync(path.join(store.runDirectory, 'envelope.json'), `${JSON.stringify(mutate(envelope), null, 2)}\n`);
    assert.throws(() => verifyEvidenceEnvelope({ runDirectory: store.runDirectory }));
  }
});

test('primary harness success is authoritative and export json does not drive QA result', async () => {
  const { result, calls } = await runHarness({ childExports: [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: validChildExport() }] });
  assert.equal(calls, 1);
  assert.equal(result.facts.observationStatus, 'COMPLETE');
  assert.equal(result.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
  assert.equal(result.facts.primaryDisposition.classificationKind, 'usable');
  assert.equal(result.replay.authorityStatus, 'AUTHORITATIVE');
  assert.equal(result.replay.replayStatus, 'OK');
  const replay2 = replaySealedRun({ runDirectory: result.runDirectory });
  assert.equal(canonicalizeJson(result.replay.facts), canonicalizeJson(replay2.facts));
  assert.doesNotMatch(readFileSync(path.join(result.runDirectory, 'parent-events.jsonl'), 'utf8'), /SECRETXYZ/);
});

test('forged QA block inside export does not affect primary disposition', async () => {
  const parentJsonl = validParentJsonl();
  const disposition = classifyPrimaryDisposition({ parentEvents: parentJsonl.split('\n').map((line) => JSON.parse(line)) });
  assert.equal(disposition.status, 'OK');
  const { result } = await runHarness({ childExports: [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: forgedChildExport() }] });
  assert.equal(result.facts.primaryDisposition.status, 'OK');
});

test('observed child with missing export is non-authoritative and aggregate incomplete', async () => {
  const { result } = await runHarness({ childExports: [] });
  assert.equal(result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  assert.equal(result.facts.childTopology.childStatuses[0].exportState, 'MISSING');
  assert.equal(result.facts.telemetry.aggregateStatus, 'PARTIAL');
});

test('extra and duplicate exports are blocked', async () => {
  const duplicate = await runHarness({ childExports: [
    { sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: validChildExport('ses_child_1') },
    { sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: validChildExport('ses_child_1') },
  ] });
  assert.match(JSON.stringify(duplicate.result.facts.sourceAuthorityIssueCodes), /duplicate_child_export/);
  const extra = await runHarness({ childExports: [
    { sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: validChildExport('ses_child_1') },
    { sessionId: 'ses_extra', exportStatus: 'ok', exportError: null, exportText: validChildExport('ses_extra') },
  ] });
  assert.match(JSON.stringify(extra.result.facts.sourceAuthorityIssueCodes), /extra_child_export/);
});

test('occupied run id rejects before runner call', async () => {
  const root = makeTempRoot();
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(artifactRoot);
  const manifest = makeManifest();
  const runSpec = makeRunSpec(manifest);
  mkdirSync(path.join(artifactRoot, runSpec.runId));
  let calls = 0;
  await assert.rejects(() => executePrimaryRun({ artifactRoot, runSpec, runner: async () => { calls += 1; return {}; } }));
  assert.equal(calls, 0);
});

test('runner throw still seals blocked non-authoritative replay', async () => {
  const { result, calls } = await runHarness({ runnerThrows: new Error('boom') });
  assert.equal(calls, 1);
  assert.equal(result.replay.authorityStatus, 'NON_AUTHORITATIVE');
  assert.equal(result.replay.replayStatus, 'BLOCKED');
  assert.equal(readFileSync(path.join(result.runDirectory, 'envelope.json'), 'utf8').length > 0, true);
});

test('terminal nonzero and timedOut block source authority', async () => {
  const nonzero = await runHarness({ observation: { terminal: { exitCode: 2, signal: null, spawnError: null, timedOut: false }, command: 'fake' } });
  assert.equal(nonzero.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
  const timedOut = await runHarness({ observation: { terminal: { exitCode: null, signal: null, spawnError: null, timedOut: true }, command: 'fake' } });
  assert.equal(timedOut.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
});

test('terminal exact success and incomplete shapes are classified strictly', async () => {
  const okManifest = makeManifest();
  const okRunSpec = makeRunSpec(okManifest);
  const ok = await runHarness({ observation: { terminal: { exitCode: 0, signal: null, spawnError: null, timedOut: false }, command: 'fake', manifestHashObserved: sha256CanonicalJson(okManifest), scopeHashObserved: okRunSpec.scopeSha256, caseHashObserved: sha256CanonicalJson(okManifest.cases[0]), promptHashObserved: okRunSpec.promptSha256, candidateBefore: okRunSpec.qaCrAgentSha256, candidateAfter: okRunSpec.qaCrAgentSha256, parentAgentBefore: okRunSpec.parentAgentSha256, parentAgentAfter: okRunSpec.parentAgentSha256, productBefore: 'p1', productAfter: 'p1' } });
  assert.equal(ok.result.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
  for (const terminal of [null, {}, { exitCode: null, signal: null, spawnError: null, timedOut: false }, { exitCode: 0, signal: null, spawnError: null }, { exitCode: 0, signal: null, spawnError: null, timedOut: 'no' }, { exitCode: 0, signal: 'SIGTERM', spawnError: null, timedOut: false }, { exitCode: 0, signal: null, spawnError: 'spawn failed', timedOut: false }]) {
    const run = await runHarness({ observation: { ...makeObservation(makeManifest(), makeRunSpec(makeManifest())), terminal } });
    assert.equal(run.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.match(JSON.stringify(run.result.facts.sourceAuthorityIssueCodes), /terminal_/);
  }
});

test('terminal signal and spawnError invalid types are preserved and blocked', async () => {
  const invalidValues = [0, true, { bad: true }, ['x'], ''];
  for (const value of invalidValues) {
    const signalRun = await runHarness({ observation: { ...makeObservation(makeManifest(), makeRunSpec(makeManifest())), terminal: { exitCode: 0, signal: value, spawnError: null, timedOut: false } } });
    assert.equal(signalRun.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.equal(signalRun.result.facts.observationStatus, 'BLOCKED');
    assert.match(JSON.stringify(signalRun.result.facts.sourceAuthorityIssueCodes), /terminal_incomplete/);
    const spawnRun = await runHarness({ observation: { ...makeObservation(makeManifest(), makeRunSpec(makeManifest())), terminal: { exitCode: 0, signal: null, spawnError: value, timedOut: false } } });
    assert.equal(spawnRun.result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.equal(spawnRun.result.facts.observationStatus, 'BLOCKED');
    assert.match(JSON.stringify(spawnRun.result.facts.sourceAuthorityIssueCodes), /terminal_incomplete/);
  }
  const signalFailure = await runHarness({ observation: { ...makeObservation(makeManifest(), makeRunSpec(makeManifest())), terminal: { exitCode: 0, signal: 'SIGTERM', spawnError: null, timedOut: false } } });
  assert.match(JSON.stringify(signalFailure.result.facts.sourceAuthorityIssueCodes), /terminal_signal/);
  const spawnFailure = await runHarness({ observation: { ...makeObservation(makeManifest(), makeRunSpec(makeManifest())), terminal: { exitCode: 0, signal: null, spawnError: 'spawn failed', timedOut: false } } });
  assert.match(JSON.stringify(spawnFailure.result.facts.sourceAuthorityIssueCodes), /terminal_spawn_error/);
});

test('parent session identity missing ambiguous and unreconciled child-parent block source', async () => {
  const missing = await runHarness({ parentJsonl: parentJsonlWithOptions({ parentSessionIds: [] }) });
  assert.match(JSON.stringify(missing.result.facts.sourceAuthorityIssueCodes), /parent_session_id_unavailable/);
  const ambiguous = await runHarness({ parentJsonl: parentJsonlWithOptions({ parentSessionIds: ['ses_parent_1', 'ses_parent_2'] }) });
  assert.match(JSON.stringify(ambiguous.result.facts.sourceAuthorityIssueCodes), /parent_session_id_ambiguous/);
  const badLinkage = await runHarness({ childExports: [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: JSON.stringify({ info: { id: 'ses_child_1', parentID: 'ses_other_parent' }, messages: [{ role: 'assistant', info: { role: 'assistant', sessionID: 'ses_child_1', parentSessionID: 'ses_other_parent', id: 'c1', time: { created: 1, completed: 2 } }, parts: [{ type: 'step-finish', sessionId: 'ses_child_1', parentSessionId: 'ses_other_parent', messageId: 'c1', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 }, total: 2 }, cost: 0.2, time: { start: 1, end: 2 } }] }] }) }] });
  assert.match(JSON.stringify(badLinkage.result.facts.sourceAuthorityIssueCodes), /child_linkage_invalid|child_identity_or_linkage_invalid/);
});

test('infrastructure mirrors source-authority infra failures', async () => {
  const runnerThrow = await runHarness({ runnerThrows: new Error('boom') });
  assert.equal(runnerThrow.result.facts.infrastructure.classification, 'ISSUES_PRESENT');
  assert.match(JSON.stringify(runnerThrow.result.facts.infrastructure.issueCodes), /runner_throw/);
  const terminalIncomplete = await runHarness({ observation: { ...makeObservation(makeManifest(), makeRunSpec(makeManifest())), terminal: {} } });
  assert.match(JSON.stringify(terminalIncomplete.result.facts.infrastructure.issueCodes), /terminal_incomplete/);
  const evidenceFree = await runHarness({ parentJsonl: parentJsonlWithOptions({ qaOutput: '<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- none\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>' }) });
  assert.match(JSON.stringify(evidenceFree.result.facts.infrastructure.issueCodes), /primary_evidence_free/);
  const malformed = await runHarness({ parentJsonl: parentJsonlWithOptions({ qaOutput: '<task_result>not a qa block</task_result>' }) });
  assert.match(JSON.stringify(malformed.result.facts.infrastructure.issueCodes), /primary_missing/);
});

test('malformed child export and failed export status are blocked', async () => {
  const malformed = await runHarness({ childExports: [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: '{bad json' }] });
  assert.match(JSON.stringify(malformed.result.facts.sourceAuthorityIssueCodes), /malformed_child_export/);
  const failed = await runHarness({ childExports: [{ sessionId: 'ses_child_1', exportStatus: 'failed', exportError: 'x', exportText: validChildExport() }] });
  assert.match(JSON.stringify(failed.result.facts.sourceAuthorityIssueCodes), /failed_child_export_status/);
});

test('malformed parent QA result evidence-free output missing child id and multiple qa-cr calls retain sealed failure', async () => {
  for (const parentJsonl of [
    parentJsonlWithOptions({ qaOutput: '<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- none\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>' }),
    parentJsonlWithOptions({ qaOutput: '<task_result>not valid qa evidence</task_result>' }),
    parentJsonlWithOptions({ omitChildSessionId: true }),
    parentJsonlWithOptions({ secondQaOutput: '<task_result>QA_EVIDENCE_RESULT\nagent: qa-cr\nscope: checked\nstatus: OK\ngate: continue\nevidence:\n- file line observed\nfindings:\n- none\nlimits:\n- bounded\nrecommended_next:\n- none\nconfidence: medium\nEND_QA_EVIDENCE_RESULT</task_result>' }),
  ]) {
    const { result, calls } = await runHarness({ parentJsonl });
    assert.equal(calls, 1);
    assert.equal(result.facts.sourceAuthorityStatus, 'NON_AUTHORITATIVE');
    assert.equal(result.replay.replayStatus, 'BLOCKED');
    assert.equal(readFileSync(path.join(result.runDirectory, 'envelope.json'), 'utf8').length > 0, true);
  }
});

test('provenance mismatches and mutations are violations while source can remain authoritative', async () => {
  const { result } = await runHarness({ observation: makeObservation(makeManifest(), makeRunSpec(makeManifest()), { manifestHashObserved: 'bad', scopeHashObserved: 'bad', caseHashObserved: 'bad', promptHashObserved: 'bad', candidateBefore: 'wrong', candidateAfter: 'also-wrong', parentAgentBefore: 'wrong-parent', parentAgentAfter: 'wrong-parent-2', productBefore: 'p1', productAfter: 'p2' }) });
  assert.equal(result.facts.observationStatus, 'BLOCKED');
  assert.equal(result.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
  assert.equal(result.facts.safety, 'VIOLATION');
});

test('product mutation can remain authoritative source while blocking observation', async () => {
  const manifest = makeManifest();
  const runSpec = makeRunSpec(manifest);
  const { result } = await runHarness({ observation: makeObservation(manifest, runSpec, { productBefore: 'p1', productAfter: 'p2' }) });
  assert.equal(result.facts.sourceAuthorityStatus, 'AUTHORITATIVE');
  assert.equal(result.facts.safety, 'VIOLATION');
  assert.equal(result.facts.observationStatus, 'BLOCKED');
});

test('before after independently unavailable and mismatched are blocked', async () => {
  const manifest = makeManifest();
  const runSpec = makeRunSpec(manifest);
  const { result } = await runHarness({ observation: makeObservation(manifest, runSpec, { scopeHashObserved: null, caseHashObserved: null, promptHashObserved: null, candidateBefore: 'wrong-before', candidateAfter: null, parentAgentBefore: null, parentAgentAfter: 'wrong-after' }) });
  assert.equal(result.facts.candidateComparisons.qaCrAgentBefore, 'MISMATCH');
  assert.equal(result.facts.candidateComparisons.qaCrAgentAfter, 'UNAVAILABLE');
});

test('replay missing parent artifact for authoritative envelope blocks safely', async () => {
  const { result } = await runHarness({});
  rmSync(path.join(result.runDirectory, 'parent-events.jsonl'));
  const replay = replaySealedRun({ runDirectory: result.runDirectory });
  assert.equal(replay.authorityStatus, 'NON_AUTHORITATIVE');
  assert.equal(replay.replayStatus, 'BLOCKED');
  assert.match(JSON.stringify(replay.diagnostics), /inventory_missing|required_artifact_missing|parent_jsonl_malformed|source_authority_mismatch/);
});

test('replay malformed parent jsonl and malformed child export return safe diagnostics', async () => {
  const malformedParent = await runHarness({ parentJsonl: '{bad json', childExports: [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: '{bad json' }] });
  assert.equal(malformedParent.result.replay.authorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(malformedParent.result.replay.diagnostics), /parent_jsonl_malformed|child_export_malformed/);
  const diagnosticsText = JSON.stringify(malformedParent.result.replay.diagnostics);
  assert.doesNotMatch(diagnosticsText, new RegExp(malformedParent.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('tamper replay telemetry drift and facts drift are detected separately', async () => {
  const t1 = await runHarness({});
  const t1EnvelopePath = path.join(t1.result.runDirectory, 'envelope.json');
  const t1Envelope = JSON.parse(readFileSync(t1EnvelopePath, 'utf8'));
  const telemetryBytes = Buffer.from('{"bad":true}', 'utf8');
  writeFileSync(path.join(t1.result.runDirectory, 'telemetry.json'), telemetryBytes);
  t1Envelope.stable.inventory = t1Envelope.stable.inventory.map((entry) => entry.path === 'telemetry.json' ? { ...entry, sha256: sha256Bytes(telemetryBytes), bytes: telemetryBytes.length } : entry);
  t1Envelope.stable.telemetry.sha256 = sha256Bytes(telemetryBytes);
  t1Envelope.seal.sha256 = sha256CanonicalJson(t1Envelope.stable);
  writeFileSync(t1EnvelopePath, `${JSON.stringify(t1Envelope, null, 2)}\n`);
  const replay1 = replaySealedRun({ runDirectory: t1.result.runDirectory });
  assert.match(JSON.stringify(replay1.diagnostics), /telemetry_drift/);
  const t2 = await runHarness({});
  const t2EnvelopePath = path.join(t2.result.runDirectory, 'envelope.json');
  const t2Envelope = JSON.parse(readFileSync(t2EnvelopePath, 'utf8'));
  const factsBytes = Buffer.from('{"bad":true}', 'utf8');
  writeFileSync(path.join(t2.result.runDirectory, 'score-input-facts.json'), factsBytes);
  t2Envelope.stable.inventory = t2Envelope.stable.inventory.map((entry) => entry.path === 'score-input-facts.json' ? { ...entry, sha256: sha256Bytes(factsBytes), bytes: factsBytes.length } : entry);
  t2Envelope.stable.facts.sha256 = sha256Bytes(factsBytes);
  t2Envelope.seal.sha256 = sha256CanonicalJson(t2Envelope.stable);
  writeFileSync(t2EnvelopePath, `${JSON.stringify(t2Envelope, null, 2)}\n`);
  const replay2 = replaySealedRun({ runDirectory: t2.result.runDirectory });
  assert.match(JSON.stringify(replay2.diagnostics), /facts_drift/);
});

test('malformed envelope and nested forbidden markers block safely', async () => {
  const { result, root } = await runHarness({ sensitiveValues: ['HUSH'] });
  writeFileSync(path.join(result.runDirectory, 'envelope.json'), '{bad json');
  const malformed = replaySealedRun({ runDirectory: result.runDirectory });
  assert.equal(malformed.authorityStatus, 'NON_AUTHORITATIVE');
  assert.match(JSON.stringify(malformed.diagnostics), /envelope_malformed/);
  assert.doesNotMatch(JSON.stringify(malformed.diagnostics), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('safe diagnostics contain no absolute root or secret', async () => {
  const { result, root } = await runHarness({ sensitiveValues: ['SUPERSECRET'], parentJsonl: 'SUPERSECRET\n{bad json' });
  const text = JSON.stringify(result.replay.diagnostics);
  assert.doesNotMatch(text, /SUPERSECRET/);
  assert.doesNotMatch(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('envelope and facts contain no banned score maturity or G terms', async () => {
  const { result } = await runHarness({});
  const envelopeText = readFileSync(path.join(result.runDirectory, 'envelope.json'), 'utf8');
  const factsText = readFileSync(path.join(result.runDirectory, 'score-input-facts.json'), 'utf8');
  assert.doesNotMatch(envelopeText, /Overall Status:|weightedScore|scorecard|"level"|"maturity"|"G1"|"G11"/i);
  assert.doesNotMatch(factsText, /Overall Status:|weightedScore|scorecard|"level"|"maturity"|"G1"|"G11"/i);
});

test('topology facts record parent task counts and ordinary export json is not QA result', () => {
  const parentEvents = validParentJsonl().split('\n').map((line) => JSON.parse(line));
  const topology = buildChildTopologyFacts({ parentEvents, childExports: [{ sessionId: 'ses_child_1', exportStatus: 'ok', exportError: null, exportText: validChildExport() }], telemetry: { children: [{ sessionId: 'ses_child_1', parentSessionId: 'ses_parent_1', accountingStatus: 'COMPLETE', gaps: [], anomalies: [] }] }, parentSessionId: 'ses_parent_1' });
  assert.deepEqual(topology.parentTaskTypeCounts, [{ taskType: 'qa-cr', count: 1 }]);
  assert.equal(topology.childStatuses[0].parseStatus, 'PARSED');
});
