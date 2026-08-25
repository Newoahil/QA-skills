import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILTIN_PIPELINE_MANIFEST } from '../../tools/guardian/pipeline.manifest.mjs';
import { loadPipelineManifest, loadRuntimePipelineManifest, runPipeline, stageRunnerContext } from '../../tools/guardian/stage-runner.mjs';
import { MAX_FIX_ROUNDS } from '../../tools/guardian/state-router.mjs';
import { STATES } from '../../tools/guardian/state.mjs';

test('loadPipelineManifest preserves built-in fixer then qa order', () => {
  const stages = loadPipelineManifest();

  assert.deepEqual(stages.map((stage) => stage.id), ['fixer', 'qa', 'notify']);
  assert.equal(Object.isFrozen(stages), true);
});

test('loadPipelineManifest splices extension-point stages around built-ins deterministically', () => {
  const customRunners = {
    runFixerStage: async () => ({}),
    runQaStage: async () => ({}),
    runNotifyStage: async () => ({}),
    runAuditStage: async () => ({}),
    runPrefetchStage: async () => ({}),
  };
  const stages = loadPipelineManifest([
    BUILTIN_PIPELINE_MANIFEST[0],
    { ...BUILTIN_PIPELINE_MANIFEST[1] },
    { ...BUILTIN_PIPELINE_MANIFEST[2] },
    { ...BUILTIN_PIPELINE_MANIFEST[1], id: 'audit', runner: 'runAuditStage', extensionPoint: 'after-qa' },
    { ...BUILTIN_PIPELINE_MANIFEST[0], id: 'prefetch', runner: 'runPrefetchStage', extensionPoint: 'before-fixer' },
  ], customRunners);

  assert.deepEqual(stages.map((stage) => stage.id), ['prefetch', 'fixer', 'qa', 'audit', 'notify']);
});

test('loadRuntimePipelineManifest merges project stages into built-in runtime pipeline', () => {
  const customRunners = {
    runFixerStage: async () => ({}),
    runQaStage: async () => ({}),
    runNotifyStage: async () => ({}),
    runAuditStage: async () => ({}),
  };
  const projectManifest = {
    stages: [
      { ...BUILTIN_PIPELINE_MANIFEST[1], id: 'project-audit', runner: 'runAuditStage', extensionPoint: 'after-qa' },
    ],
  };

  const stages = loadRuntimePipelineManifest({ repoDir: 'D:/repo', projectManifest, runners: customRunners });

  assert.deepEqual(stages.map((stage) => stage.id), ['fixer', 'qa', 'project-audit', 'notify']);
});

test('loadRuntimeStageRunners exposes explicit project runner registration seam', async () => {
  const { loadRuntimeStageRunners } = await import('../../tools/guardian/stage-runner.mjs');
  const runners = loadRuntimeStageRunners({ registeredRunners: { runAuditStage: async () => ({ status: 'ok' }) } });
  const stages = loadRuntimePipelineManifest({
    projectManifest: { stages: [{ ...BUILTIN_PIPELINE_MANIFEST[1], id: 'project-audit', runner: 'runAuditStage', extensionPoint: 'after-qa' }] },
    runners,
  });

  assert.equal(typeof runners.runAuditStage, 'function');
  assert.deepEqual(stages.map((stage) => stage.id), ['fixer', 'qa', 'project-audit', 'notify']);
});

test('loadRuntimePipelineManifest rejects malformed project manifest shape fail-closed', () => {
  assert.throws(() => loadRuntimePipelineManifest({ projectManifest: { stages: [], extra: true } }), /unknown pipeline manifest key/);
  assert.throws(() => loadRuntimePipelineManifest({ projectManifest: {} }), /stages must be an array/);
});

test('runPipeline dispatches custom runners from caller registry', async () => {
  const calls = [];
  const runners = {
    runCustomStage: async ({ stage }) => {
      calls.push(stage.id);
      return { stop: false, status: 'ok' };
    },
  };
  const stages = loadPipelineManifest([{ ...BUILTIN_PIPELINE_MANIFEST[0], id: 'custom', runner: 'runCustomStage' }], runners);

  const result = await runPipeline({ stages, context: {}, runners });

  assert.equal(result.stopped, false);
  assert.deepEqual(calls, ['custom']);
});

test('runPipeline fails closed for a non-GitHub TaskRef before any stage runner or effect', async () => {
  let runnerCalls = 0;
  const result = await runPipeline({
    stages: loadPipelineManifest(),
    context: stageRunnerContext({
      taskRef: { source: 'http', taskId: 'job-42', displayId: 'job-42' },
      executionSpec: { executionType: 'coding' },
      repoDir: 'D:/repo',
    }),
    runners: {
      runFixerStage: async () => { runnerCalls += 1; return {}; },
      runQaStage: async () => { runnerCalls += 1; return {}; },
      runNotifyStage: async () => { runnerCalls += 1; return {}; },
    },
  });

  assert.equal(result.stopped, true);
  assert.equal(result.status, 'unsupported-source:http');
  assert.equal(runnerCalls, 0);
});

test('runPipeline blocks a GitHub research TaskRef before any stage runner or effect', async () => {
  let runnerCalls = 0;

  // Given: an otherwise valid GitHub TaskRef declares a non-coding execution profile.
  const context = stageRunnerContext({
    taskRef: { source: 'github', taskId: '42', displayId: '#42' },
    executionSpec: { executionType: 'research' },
    repoDir: 'D:/repo',
  });

  // When: the pipeline runs.
  const result = await runPipeline({
    stages: loadPipelineManifest(),
    context,
    runners: {
      runFixerStage: async () => { runnerCalls += 1; return {}; },
      runQaStage: async () => { runnerCalls += 1; return {}; },
      runNotifyStage: async () => { runnerCalls += 1; return {}; },
    },
  });

  // Then: unsupported research work must fail closed before any runner executes.
  assert.equal(result.stopped, true);
  assert.equal(result.status, 'unsupported-execution-type:research');
  assert.equal(runnerCalls, 0);
});

test('runPipeline preserves the existing coding pipeline path for nullish and coding executionType', async (t) => {
  for (const executionType of [null, undefined, 'coding']) {
    await t.test(`executionType=${String(executionType)}`, async () => {
      const calls = [];
      const stages = loadPipelineManifest([{ ...BUILTIN_PIPELINE_MANIFEST[0], id: `custom-${String(executionType)}`, runner: 'runCustomStage' }], {
        runCustomStage: async ({ stage }) => {
          calls.push(stage.id);
          return { stop: false, status: 'ok' };
        },
      });

      const result = await runPipeline({
        stages,
        context: stageRunnerContext({
          taskRef: { source: 'github', taskId: '42', displayId: '#42' },
          executionSpec: { executionType },
          repoDir: 'D:/repo',
        }),
        runners: {
          runCustomStage: async ({ stage }) => {
            calls.push(stage.id);
            return { stop: false, status: 'ok' };
          },
        },
      });

      assert.equal(result.stopped, false);
      assert.deepEqual(calls, [`custom-${String(executionType)}`]);
    });
  }
});

test('loadPipelineManifest rejects malformed stages', () => {
  const valid = BUILTIN_PIPELINE_MANIFEST[0];

  assert.throws(() => loadPipelineManifest([{ ...valid, extra: true }]), /unknown stage key/);
  assert.throws(() => loadPipelineManifest([valid, valid]), /duplicate stage id/);
  assert.throws(() => loadPipelineManifest([{ ...valid, runner: 'missingRunner' }]), /unknown stage runner/);
  assert.throws(() => loadPipelineManifest([{ ...valid, stateTransition: { from: 'NOPE', to: STATES.FIXING } }]), /unknown stateTransition.from/);
  assert.throws(() => loadPipelineManifest([{ ...valid, stateTransition: { from: STATES.FIXING, to: 'NOPE' } }]), /unknown stateTransition.to/);
  assert.throws(() => loadPipelineManifest([{ ...valid, retryPolicy: { maxRounds: -1 } }]), /retryPolicy.maxRounds/);
  assert.throws(() => loadPipelineManifest([{ ...valid, extensionPoint: 'somewhere-else' }]), /unknown extension point/);
});

test('runPipeline notify stage emits a single fact_webhook effect when enabled', async () => {
  const effects = [];
  const context = stageRunnerContext({
    client: {},
    issue: 42,
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    command: null,
    config: {},
    investigationMode: 'enforced',
    fallbackModels: [],
    signal: null,
    issueTitle: 'Fix the thing',
    notifyStage: { enabled: true, webhookUrl: 'https://hook.test/guardian' },
    effectSink: { emit: (descriptor) => { effects.push(descriptor); return { ok: true, value: undefined }; } },
    supervisor: { prepareFixBranch: () => ({ status: 0, stdout: '', stderr: '' }) },
    logger: { info: () => {}, warn: () => {} },
    readState: () => ({ issue: 42, state: STATES.FIXING, branch: 'fix/issue-42' }),
    writeState: () => {},
    readArtifactPair: () => ({ plan: {} }),
    writeMarkdownArtifact: () => {},
    writeArtifact: () => {},
    resolveSessionDeadlineMs: () => 100,
    resolveModelForRole: () => undefined,
    runFixerSession: async (request) => ({ status: 'ok', state: request.state, completion: { changedFiles: [], summary: null } }),
    runQaSession: async (request) => ({ status: 'ok', state: request.state, verdict: 'PASS', report: 'Overall Status: PASS' }),
  });

  const result = await runPipeline({ stages: loadPipelineManifest(), context });

  assert.equal(result.stopped, false);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].kind, 'fact_webhook');
  assert.deepEqual(effects[0].ref, { source: 'github', taskId: '42', displayId: '#42' });
  assert.match(effects[0].idempotencyKey, /^notify:42:after-qa:sha256:/);
  assert.deepEqual(effects[0].payload.body, {
    source: 'qa-guardian',
    stage: 'after-qa',
    issue: 42,
    status: 'PASS',
    report_hash: result.qaVerdict.report_hash,
  });
});

test('runPipeline notify stage leaves durable state schema unchanged', async () => {
  const effects = [];
  let state = { issue: 42, state: STATES.FIXING, branch: 'fix/issue-42' };
  const baseContext = () => stageRunnerContext({
    client: {},
    issue: 42,
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    command: null,
    config: {},
    investigationMode: 'enforced',
    fallbackModels: [],
    signal: null,
    issueTitle: 'Fix the thing',
    notifyStage: { enabled: true, webhookUrl: 'https://hook.test/guardian' },
    effectSink: { emit: (descriptor) => { effects.push(descriptor.idempotencyKey); return { ok: true, value: undefined }; } },
    supervisor: { prepareFixBranch: () => ({ status: 0, stdout: '', stderr: '' }) },
    logger: { info: () => {}, warn: () => {} },
    readState: () => state,
    writeState: (_guardianDir, next) => { state = next; },
    readArtifactPair: () => ({ plan: {} }),
    writeMarkdownArtifact: () => {},
    writeArtifact: () => {},
    resolveSessionDeadlineMs: () => 100,
    resolveModelForRole: () => undefined,
    runFixerSession: async (request) => ({ status: 'ok', state: request.state, completion: { changedFiles: [], summary: null } }),
    runQaSession: async (request) => ({ status: 'ok', state: request.state, verdict: 'PASS', report: 'Overall Status: PASS' }),
  });

  assert.equal((await runPipeline({ stages: loadPipelineManifest(), context: baseContext() })).stopped, false);

  assert.equal(effects.length, 1);
  assert.deepEqual(Object.keys(state).sort(), ['branch', 'issue', 'state']);
});

test('runPipeline preserves fixer to QA state and artifact write order', async () => {
  const writes = [];
  let state = {
    issue: 42,
    state: STATES.FIXING,
    processing_round: 1,
    plan_hash: 'sha256:plan',
    plan_revision: 'rev-1',
  };

  const context = stageRunnerContext({
    client: {},
    issue: 42,
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    command: { verb: 'approve', commentId: 7, data: 'ship it' },
    config: {},
    investigationMode: 'enforced',
    fallbackModels: [],
    signal: null,
    issueTitle: 'Fix the thing',
    supervisor: { prepareFixBranch: () => ({ status: 0, stdout: '', stderr: '' }) },
    logger: { info: (event) => writes.push(['log', event]), warn: (event) => writes.push(['warn', event]) },
    readState: () => state,
    writeState: (_guardianDir, nextState, opts) => {
      state = nextState;
      writes.push(['state', nextState.branch ?? null, nextState.qa_session_id ?? null, opts]);
    },
    readArtifactPair: () => ({ plan: { affected_files: ['src/a.mjs'] } }),
    writeMarkdownArtifact: (_guardianDir, _issue, name, content) => writes.push(['markdown', name, content]),
    writeArtifact: (_guardianDir, _issue, name, value) => writes.push(['artifact', name, value]),
    resolveSessionDeadlineMs: (_config, key) => key === 'fixer_deadline_ms' ? 100 : 200,
    resolveModelForRole: (_config, role) => `${role}-model`,
    runFixerSession: async (request) => {
      assert.equal(request.humanNote.human_note, 'ship it');
      assert.equal(request.deadlineMs, 100);
      request.writePrSummary('summary');
      return { status: 'ok', state: { ...request.state, fixer_session_id: 'fixer-session' }, completion: { changedFiles: ['src/a.mjs'], summary: 'fixed' } };
    },
    runQaSession: async (request) => {
      assert.equal(request.diffSummary.branch, 'fix/issue-42');
      assert.deepEqual(request.diffSummary.changed_files, ['src/a.mjs']);
      assert.equal(request.deadlineMs, 200);
      request.writeQaAcceptance('acceptance');
      return { status: 'ok', state: { ...request.state, qa_session_id: 'qa-session' }, verdict: 'PASS', report: 'Overall Status: PASS\nEvidence' };
    },
  });

  const result = await runPipeline({ stages: loadPipelineManifest(), context });

  assert.equal(result.stopped, false);
  assert.equal(result.qaVerdict.issue, 42);
  assert.equal(result.qaVerdict.branch, 'fix/issue-42');
  assert.equal(result.qaVerdict.status, 'PASS');
  assert.equal(result.qaVerdict.plan_hash, 'sha256:plan');
  assert.equal(result.qaVerdict.plan_revision, 'rev-1');
  assert.match(result.qaVerdict.report_hash, /^sha256:/);
  assert.deepEqual(writes.map((write) => write[0]), [
    'log',
    'markdown',
    'state',
    'state',
    'log',
    'markdown',
    'state',
    'state',
    'artifact',
  ]);
});

test('runFixerStage hands back an unverified completion instead of leaving a fresh FIXING lease', async () => {
  let state = { issue: 263, state: STATES.FIXING, handed_back_reason: null, opencode: {} };
  const warnings = [];
  const { runFixerStage } = await import('../../tools/guardian/stage-runner.mjs');
  const result = await runFixerStage({
    client: {},
    issue: 263,
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    command: null,
    config: {},
    investigationMode: 'enforced',
    fallbackModels: [],
    signal: null,
    supervisor: { prepareFixBranch: () => ({ status: 0, stdout: '', stderr: '' }) },
    logger: { info: () => {}, warn: (event, fields) => warnings.push({ event, fields }) },
    readState: () => state,
    writeState: (_dir, next) => { state = next; },
    readArtifactPair: () => ({ plan: { affected_files: ['src/a.mjs'] } }),
    writeMarkdownArtifact: () => {},
    resolveSessionDeadlineMs: () => 100,
    resolveModelForRole: () => undefined,
    runFixerSession: async (request) => ({
      status: 'unverified',
      state: request.state,
      completion: null,
      completionError: 'changed-file-not-in-plan',
    }),
  });

  assert.equal(result.stop, true);
  assert.equal(state.state, STATES.HANDED_BACK);
  assert.equal(state.handed_back_reason, 'blocked');
  assert.equal(state.last_error_class, 'fixer-completion-unverified');
  assert.equal(warnings.at(-1).fields.reason, 'changed-file-not-in-plan');
});

test('runQaStage on FAIL at the round cap hands back explicitly instead of leaving an active state', async () => {
  let state = {
    issue: 264,
    state: STATES.VERIFYING,
    branch: 'fix/issue-264',
    fix_rounds: MAX_FIX_ROUNDS,
    processing_round: 2,
    handed_back_reason: null,
  };
  const artifacts = [];
  const { runQaStage } = await import('../../tools/guardian/stage-runner.mjs');

  const result = await runQaStage({
    client: {},
    issue: 264,
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    config: {},
    fallbackModels: [],
    signal: null,
    issueTitle: 'Fix the thing',
    pipeline: { completion: { changedFiles: ['src/a.mjs'], summary: 'fixed' } },
    logger: { info: () => {}, warn: () => {} },
    readState: () => state,
    writeState: (_dir, next) => { state = next; },
    writeArtifact: (_dir, _issue, name, value) => { artifacts.push({ name, value }); },
    writeMarkdownArtifact: () => {},
    resolveSessionDeadlineMs: () => 200,
    resolveModelForRole: () => undefined,
    runQaSession: async (request) => {
      // Given: a bounded second-round QA retry is already in flight.
      assert.equal(request.round, 2);
      assert.equal(request.branch, 'fix/issue-264');
      assert.deepEqual(request.diffSummary.changed_files, ['src/a.mjs']);

      // When: QA returns a real FAIL verdict.
      return {
        status: 'ok',
        state: request.state,
        verdict: 'FAIL',
        report: 'Overall Status: FAIL\nRegression still reproduces',
      };
    },
  });

  // Then: the stage must end in an explicit bounded outcome, not keep an active VERIFYING state alive.
  assert.equal(result.stop, true);
  assert.equal(state.state, STATES.HANDED_BACK);
  assert.equal(state.handed_back_reason, 'fix-rounds-exceeded');
  assert.equal(artifacts.at(0)?.name, 'qa-verdict');
  assert.equal(result.qaVerdict, undefined);
});

test('runQaStage on FAIL below the round cap persists a bounded fixer retry', async () => {
  let state = {
    issue: 265,
    state: STATES.VERIFYING,
    branch: 'fix/issue-265',
    fix_rounds: MAX_FIX_ROUNDS - 1,
    processing_round: 1,
    handed_back_reason: null,
  };
  const { runQaStage } = await import('../../tools/guardian/stage-runner.mjs');

  const result = await runQaStage({
    client: {},
    issue: 265,
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    config: {},
    fallbackModels: [],
    signal: null,
    issueTitle: 'Retry the fix',
    pipeline: { completion: { changedFiles: ['src/b.mjs'], summary: 'fixed' } },
    logger: { info: () => {}, warn: () => {} },
    readState: () => state,
    writeState: (_dir, next) => { state = next; },
    writeArtifact: () => {},
    writeMarkdownArtifact: () => {},
    resolveSessionDeadlineMs: () => 200,
    resolveModelForRole: () => undefined,
    runQaSession: async (request) => ({
      status: 'ok',
      state: request.state,
      verdict: 'FAIL',
      report: 'Overall Status: FAIL\nRegression still reproduces',
    }),
  });

  assert.equal(result.stop, false);
  assert.equal(result.qaVerdict.status, 'FAIL');
  assert.equal(state.state, STATES.FIXING);
  assert.equal(state.fix_rounds, MAX_FIX_ROUNDS);
  assert.equal(state.last_error_class, 'qa-failed-retry');
});

// --- B2 (decision-e8c0d364): executionType -> trusted profile selection ---

import { selectPipelineProfile, SUPPORTED_EXECUTION_TYPES } from '../../tools/guardian/stage-runner.mjs';

test('B2: coding (and null) resolves to the builtin pipeline byte-identically', () => {
  const builtin = loadPipelineManifest().map((s) => s.id);
  for (const t of ['coding', null, undefined, '']) {
    const profile = selectPipelineProfile(t);
    assert.equal(profile.supported, true);
    assert.equal(profile.executionType, 'coding');
    assert.deepEqual(profile.stages.map((s) => s.id), builtin);
  }
});

test('B2: non-coding execution types are explicitly unsupported (blocked with reason)', () => {
  for (const t of ['research', 'design', 'ops', 'data', 'content']) {
    const profile = selectPipelineProfile(t);
    assert.equal(profile.supported, false);
    assert.equal(profile.executionType, t);
    assert.equal(profile.reason, `unsupported-execution-type:${t}`);
    assert.deepEqual(profile.supportedTypes, SUPPORTED_EXECUTION_TYPES);
  }
  assert.deepEqual(SUPPORTED_EXECUTION_TYPES, ['coding']);
});
