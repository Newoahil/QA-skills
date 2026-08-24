import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILTIN_PIPELINE_MANIFEST } from '../../tools/guardian/pipeline.manifest.mjs';
import { loadPipelineManifest, runPipeline, stageRunnerContext } from '../../tools/guardian/stage-runner.mjs';
import { STATES } from '../../tools/guardian/state.mjs';

test('loadPipelineManifest preserves built-in fixer then qa order', () => {
  const stages = loadPipelineManifest();

  assert.deepEqual(stages.map((stage) => stage.id), ['fixer', 'qa', 'notify']);
  assert.equal(Object.isFrozen(stages), true);
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
  assert.deepEqual(effects[0].payload.body, {
    source: 'qa-guardian',
    stage: 'after-qa',
    issue: 42,
    status: 'PASS',
    report_hash: result.qaVerdict.report_hash,
  });
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
