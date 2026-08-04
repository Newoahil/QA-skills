import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BENCHMARK_RUBRIC,
  compareArmScorecards,
  validateBenchmarkManifest,
  validateScorecard,
} from './real-project-benchmark-contracts.mjs';
import { fingerprintProjectTree } from './run-project-scenario.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../benchmarks/real-projects/manifest.json', import.meta.url), 'utf8'));
const apiUrl = new URL('./real-project-benchmark.mjs', import.meta.url);

async function benchmarkApi() {
  return import(apiUrl.href);
}

async function withTempDirectory(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'qa-real-project-benchmark-spec-'));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeText(root, relativePath, text) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text, 'utf8');
}

function scorecard({ armId = 'skill', dimensionScores = {}, scorer = 'automated-heuristic' } = {}) {
  const dimensions = Object.fromEntries(Object.entries(BENCHMARK_RUBRIC).map(([dimension, weight]) => [
    dimension,
    { score: dimensionScores[dimension] ?? weight, evidenceIds: [`E-${dimension}`] },
  ]));
  const total = Object.values(dimensions).reduce((sum, entry) => sum + entry.score, 0);
  return {
    armId,
    pairId: manifest.pairs[0].pairId,
    snapshotId: manifest.pairs[0].postSnapshot.snapshotId,
    runId: `phase2-${armId}-primary`,
    actualVerdict: 'PASS',
    scorer,
    scoringLabel: 'automated heuristic',
    dimensions,
    total,
  };
}

function fakeSpawnRecorder({ status = 0, stdout = '', stderr = '' } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status, stdout, stderr, error: null, signal: null };
  };
  return { calls, spawn };
}

function assertOutsidePath(candidate, parent, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative), message);
}

function createSyntheticBenchmarkFixture(root, { pairIndex = 0 } = {}) {
  const focusedPair = JSON.parse(JSON.stringify(manifest.pairs[pairIndex]));
  const focusedManifest = { ...JSON.parse(JSON.stringify(manifest)), pairs: [focusedPair] };
  const corpusRoot = path.join(root, 'corpus');
  const artifactRoot = path.join(root, 'artifacts');
  const skillPackRoot = path.join(root, 'qa-skill-pack');
  writeText(skillPackRoot, 'using-project-qa/SKILL.md', '# using-project-qa\n');
  for (const snapshot of [focusedPair.preSnapshot, focusedPair.postSnapshot]) {
    writeText(corpusRoot, path.join(snapshot.localSnapshot, 'package.json'), '{"type":"module"}\n');
    writeText(corpusRoot, path.join(snapshot.localSnapshot, 'tests/example.test.mjs'), `import test from "node:test";\ntest("${snapshot.snapshotId}", () => {});\n`);
    snapshot.treeSha256 = fingerprintProjectTree(path.join(corpusRoot, snapshot.localSnapshot)).treeSha256;
  }
  return { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot };
}

function passingDirectSpawn() {
  return { status: 0, stdout: 'oracle pass\n', stderr: '', error: null, signal: null };
}

function validOpenCodeResult({ finalText = 'Overall Status: PASS\n', command = null } = {}) {
  return {
    status: 'COMPLETED',
    finalText,
    finalMessage: finalText,
    terminal: { timeoutMs: 1000, durationMs: 1 },
    agentTopology: { ok: true },
    parentBoundaryEvidence: { ok: true },
    childReportRelayEvidence: { ok: true },
    reportAuthorityEvidence: { ok: true },
    modelCommandEvidence: command ? { ok: true, actualCommand: command, expectedCommand: command, invocationKind: 'exact', issues: [] } : { ok: false, issues: ['not relevant'] },
  };
}

test('RPB-API-001 exposes the thin deterministic harness API without model-facing side effects', async () => {
  const api = await benchmarkApi();
  const expectedExports = [
    'expandBenchmarkManifest',
    'resolveCorpusSnapshotPath',
    'fingerprintCorpusSnapshot',
    'verifyPinnedSnapshotFingerprint',
    'buildArmPrompt',
    'buildOpenCodeRunArgs',
    'buildBenchmarkOpenCodeEnv',
    'createBenchmarkRunPlan',
    'executeDirectArgv',
    'interpretOracleVerdict',
    'detectPostflightMutation',
    'validateBenchmarkRunScorecard',
    'validateBenchmarkComparison',
    'parseBenchmarkCliArgs',
    'resolveExternalArtifactRoot',
    'runRealProjectBenchmark',
    'buildBenchmarkSummary',
  ];

  for (const exportName of expectedExports) assert.equal(typeof api[exportName], 'function', `${exportName} must be exported`);
});

test('RPB-MANIFEST-002 expands the pinned draft manifest into one baseline and one skill primary run per snapshot', async () => {
  const api = await benchmarkApi();
  assert.deepEqual(validateBenchmarkManifest(manifest), { ok: true, diagnostics: [] });

  const expansion = api.expandBenchmarkManifest({ manifest });
  assert.equal(expansion.manifestStatus, 'draft');
  assert.equal(expansion.runs.length, manifest.pairs.length * 2 * 2);
  assert.deepEqual([...new Set(expansion.runs.map((run) => run.armId))].sort(), ['baseline', 'skill']);

  for (const pair of manifest.pairs) {
    for (const snapshot of [pair.preSnapshot, pair.postSnapshot]) {
      const runs = expansion.runs.filter((run) => run.pairId === pair.pairId && run.snapshotId === snapshot.snapshotId);
      assert.deepEqual(runs.map((run) => run.armId).sort(), ['baseline', 'skill']);
      assert.equal(runs.filter((run) => run.primary === true).length, 2);
      assert.equal(runs.some((run) => run.retry || run.silentRerun), false, 'expanded runs must not imply retry or silent rerun');
      for (const run of runs) assert.deepEqual(run.directArgvArrays, snapshot.directArgvArrays);
    }
  }
});

test('RPB-PATH-003 resolves corpus snapshots inside the corpus root and verifies pinned fingerprints without writes', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const corpusRoot = path.join(root, 'corpus');
  const snapshotRoot = path.join(corpusRoot, 'snapshots', 'synthetic', 'pre');
  writeText(snapshotRoot, 'package.json', '{"type":"module"}\n');
  writeText(snapshotRoot, 'test/example.test.mjs', 'import test from "node:test"; test("ok", () => {});\n');

  const resolved = api.resolveCorpusSnapshotPath({ corpusRoot, localSnapshot: 'snapshots/synthetic/pre' });
  assert.equal(path.resolve(resolved.absolutePath), path.resolve(snapshotRoot));
  assert.equal(resolved.relativePath, 'snapshots/synthetic/pre');
  assert.throws(() => api.resolveCorpusSnapshotPath({ corpusRoot, localSnapshot: '../escape' }), /unsafe|escape|traversal/i);
  assert.throws(() => api.resolveCorpusSnapshotPath({ corpusRoot, localSnapshot: path.join(root, 'outside') }), /absolute|drive|unsafe/i);

  const before = readFileSync(path.join(snapshotRoot, 'package.json'), 'utf8');
  const fingerprint = api.fingerprintCorpusSnapshot({ snapshotRoot });
  assert.match(fingerprint.treeSha256, /^[0-9a-f]{64}$/);
  assert.equal(api.verifyPinnedSnapshotFingerprint({ snapshotRoot, expectedTreeSha256: fingerprint.treeSha256 }).ok, true);
  assert.equal(readFileSync(path.join(snapshotRoot, 'package.json'), 'utf8'), before, 'fingerprinting must not mutate the corpus snapshot');

  writeText(snapshotRoot, 'test/example.test.mjs', 'throw new Error("changed");\n');
  const mismatch = api.verifyPinnedSnapshotFingerprint({ snapshotRoot, expectedTreeSha256: fingerprint.treeSha256 });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.diagnostics.join('\n'), /fingerprint|treeSha256|changed/i);
}));

test('RPB-PROMPT-004 keeps baseline and skill prompts symmetric while withholding oracle and fingerprint data', async () => {
  const api = await benchmarkApi();
  const pair = manifest.pairs[0];
  const snapshot = pair.preSnapshot;
  const baseline = api.buildArmPrompt({ manifest, pair, snapshot, armId: 'baseline' });
  const skill = api.buildArmPrompt({ manifest, pair, snapshot, armId: 'skill' });

  assert.equal(baseline.request, skill.request);
  assert.ok(baseline.prompt.includes(pair.request), 'baseline prompt must preserve pair.request verbatim');
  assert.ok(skill.prompt.includes(pair.request), 'skill prompt must preserve pair.request verbatim');
  assert.ok(baseline.prompt.includes(pair.publicIssueTitle), 'baseline prompt must preserve publicIssueTitle verbatim');
  assert.ok(skill.prompt.includes(pair.publicIssueTitle), 'skill prompt must preserve publicIssueTitle verbatim');
  assert.ok(baseline.prompt.includes(pair.acceptanceEvidence), 'baseline prompt must preserve acceptanceEvidence verbatim');
  assert.ok(skill.prompt.includes(pair.acceptanceEvidence), 'skill prompt must preserve acceptanceEvidence verbatim');
  assert.equal(baseline.visibleScenarioText, skill.visibleScenarioText, 'project scenario text must be identical across arms');
  assert.equal(baseline.skillLoaded, false);
  assert.equal(skill.skillLoaded, true);
  assert.ok(!baseline.prompt.includes(snapshot.expectedVerdict), 'baseline prompt must not leak expected verdict');
  assert.ok(!skill.prompt.includes(snapshot.expectedVerdict), 'skill prompt must not leak expected verdict');
  assert.ok(!baseline.prompt.includes(snapshot.treeSha256), 'baseline prompt must not leak pinned fingerprint');
  assert.ok(!skill.prompt.includes(snapshot.treeSha256), 'skill prompt must not leak pinned fingerprint');
  const forbiddenPromptFragments = [
    ...pair.expectedRisks,
    ...pair.expectedModules,
    ...pair.expectedFlows,
    snapshot.expectedVerdict,
    snapshot.treeSha256,
    JSON.stringify(snapshot.directArgvArrays),
    JSON.stringify(BENCHMARK_RUBRIC),
  ];
  for (const prompt of [baseline.prompt, skill.prompt]) {
    for (const fragment of forbiddenPromptFragments) {
      assert.ok(!prompt.includes(fragment), `prompt must not leak frozen benchmark metadata: ${fragment}`);
    }
  }
  assert.ok(!/(?:^|\n)\s*#{1,6}\s*(?:oracle|answer key|local verification command|verifier command)\b/im.test(`${baseline.prompt}\n${skill.prompt}`));
  assert.ok(!/expected verdict|expected risk|expected module|expected flow|rubric|scorecard|fingerprint|treeSha256|directArgvArrays/i.test(`${baseline.prompt}\n${skill.prompt}`));
  for (const skillName of ['using-project-qa', 'project-qa-plan', 'project-qa-execute', 'project-qa-conclude']) {
    assert.ok(skill.prompt.includes(skillName), `skill prompt must name ${skillName}`);
    assert.ok(!baseline.prompt.includes(skillName), `baseline prompt must not name ${skillName}`);
  }
});

test('RPB-OPENCODE-005 builds shell-free OpenCode run args with pure JSON output and fixed runtime selectors', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const invocation = api.buildOpenCodeRunArgs({
    command: 'opencode',
    dir: root,
    model: 'cpa/gpt-5.6-sol',
    agent: 'build',
    prompt: 'Perform read-only project QA.',
  });
  const args = invocation.args;

  assert.equal(invocation.command, 'opencode');
  assert.equal(invocation.shell, false);
  assert.ok(Array.isArray(args), 'OpenCode invocation args must be a direct argv array');
  assert.ok(args.includes('run'), 'OpenCode invocation must use run');
  assert.ok(args.includes('--pure'), 'OpenCode invocation must use --pure');
  assert.deepEqual(args.slice(args.indexOf('--dir'), args.indexOf('--dir') + 2), ['--dir', root]);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'cpa/gpt-5.6-sol']);
  assert.deepEqual(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2), ['--agent', 'build']);
  assert.ok(args.some((arg, index) => /^--(?:output-)?format$/.test(arg) && args[index + 1] === 'json'), 'OpenCode invocation must request JSON output format');
}));

test('RPB-OPENCODE-005A builds isolated OpenCode env without host config, unrelated values, or plugin exposure', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const isolatedRoot = path.join(root, 'isolated-opencode');
  const env = api.buildBenchmarkOpenCodeEnv({
    isolatedRoot,
    baseEnv: {
      PATH: 'kept-path',
      SystemRoot: 'C:\\Windows',
      LANG: 'C',
      ANTHROPIC_API_KEY: 'required-provider-auth',
      OPENCODE_AUTH_CONTENT: '{"provider":"required"}',
      XDG_CONFIG_HOME: path.join(root, 'host-config'),
      APPDATA: path.join(root, 'host-appdata'),
      API_TOKEN: 'drop-token',
      PASSWORD: 'drop-password',
      NORMAL_VALUE: 'drop-normal',
    },
  });

  assert.equal(env.PATH, 'kept-path');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.LANG, 'C');
  assert.equal(env.ANTHROPIC_API_KEY, 'required-provider-auth');
  assert.equal(env.OPENCODE_AUTH_CONTENT, '{"provider":"required"}');
  for (const key of ['API_TOKEN', 'PASSWORD', 'NORMAL_VALUE']) assert.equal(Object.hasOwn(env, key), false, `${key} must not be inherited`);
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TEMP', 'TMP']) {
    assert.equal(typeof env[key], 'string', `${key} must be remapped`);
    assert.equal(path.resolve(env[key]).startsWith(path.resolve(isolatedRoot)), true, `${key} must be under isolatedRoot`);
    assert.ok(!env[key].includes('host-config') && !env[key].includes('host-appdata'), `${key} must not reuse host config paths`);
  }
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, '1');
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS, '1');
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, '1');
}));

test('RPB-OPENCODE-005B extracts only the selected provider definition from host config into isolated env', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const isolatedRoot = path.join(root, 'isolated-provider-env');
  const providerConfigPath = path.join(root, 'host-opencode.json');
  const providerSecret = 'fake-provider-secret-value';
  writeFileSync(providerConfigPath, `${JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      cpa: { npm: '@fake/cpa', name: 'CPA', options: { apiKey: providerSecret, baseURL: 'https://provider.example.invalid' } },
      other: { npm: '@fake/other', name: 'Other', options: { apiKey: 'other-secret' } },
    },
    plugin: ['host-plugin'],
    mcp: { host: { command: 'host-mcp' } },
    skills: { host: { path: 'host-skill' } },
    model: 'other/model',
    unrelated: { keep: false },
  }, null, 2)}\n`, 'utf8');

  const env = api.buildBenchmarkOpenCodeEnv({
    isolatedRoot,
    model: 'cpa/gpt-5.6-sol',
    providerConfigPath,
    baseEnv: { PATH: 'kept-path', OPENCODE_CONFIG_CONTENT: '{"provider":{"host":true}}' },
  });
  assert.equal(typeof env.OPENCODE_CONFIG_CONTENT, 'string', 'selected provider config must be materialized into OPENCODE_CONFIG_CONTENT');
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);

  assert.deepEqual(Object.keys(config.provider), ['cpa']);
  assert.deepEqual(config.provider.cpa, {
    npm: '@fake/cpa',
    name: 'CPA',
    options: { apiKey: providerSecret, baseURL: 'https://provider.example.invalid' },
  });
  assert.equal(JSON.stringify(config).includes('other-secret'), false);
  assert.equal('plugin' in config, false);
  assert.equal('mcp' in config, false);
  assert.equal('skills' in config, false);
  assert.equal('unrelated' in config, false);
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, '1');
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, '1');

  const metadata = api.redactBenchmarkCommandMetadata?.({ env, args: ['run', '--pure'] }) ?? api.redactCommandMetadata?.({ env, args: ['run', '--pure'] });
  if (metadata) {
    assert.equal(JSON.stringify(metadata).includes(providerSecret), false, 'persisted command metadata must redact provider API keys');
    assert.match(JSON.stringify(metadata), /REDACTED/i);
  }
}));

test('RPB-OPENCODE-005C normalizes unsupported Ultra reasoningEffort for the selected provider model in isolated env', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const isolatedRoot = path.join(root, 'isolated-provider-env');
  const providerConfigPath = path.join(root, 'host-opencode.json');
  writeFileSync(providerConfigPath, `${JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      cpa: {
        npm: '@fake/cpa',
        name: 'CPA',
        options: {
          apiKey: 'fake-provider-secret',
          baseURL: 'https://provider.example.invalid',
        },
        models: {
          'gpt-5.6-sol': {
            options: {
              reasoningEffort: 'Ultra',
              temperature: 0.2,
            },
            maxTokens: 123456,
          },
        },
      },
      other: { npm: '@fake/other', name: 'Other', options: { apiKey: 'other-secret' } },
    },
    plugin: ['host-plugin'],
    mcp: { host: { command: 'host-mcp' } },
    skills: { host: { path: 'host-skill' } },
    model: 'cpa/gpt-5.6-sol',
  }, null, 2)}\n`, 'utf8');

  const env = api.buildBenchmarkOpenCodeEnv({
    isolatedRoot,
    model: 'cpa/gpt-5.6-sol',
    providerConfigPath,
    baseEnv: {},
  });

  assert.equal(typeof env.OPENCODE_CONFIG_CONTENT, 'string', 'selected provider config must be materialized into OPENCODE_CONFIG_CONTENT');
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);

  assert.deepEqual(Object.keys(config.provider), ['cpa']);
  assert.equal(config.provider.cpa.models['gpt-5.6-sol'].options.reasoningEffort, 'max');
  assert.equal(config.provider.cpa.models['gpt-5.6-sol'].options.temperature, 0.2);
  assert.equal(config.provider.cpa.models['gpt-5.6-sol'].maxTokens, 123456);
  assert.deepEqual(config.provider.cpa.options, {
    apiKey: 'fake-provider-secret',
    baseURL: 'https://provider.example.invalid',
  });
  assert.equal(config.provider.cpa.npm, '@fake/cpa');
  assert.equal(config.provider.cpa.name, 'CPA');
  assert.equal(JSON.stringify(config).includes('other-secret'), false);
  assert.equal('plugin' in config, false);
  assert.equal('mcp' in config, false);
  assert.equal('skills' in config, false);
}));

test('RPB-EXEC-006 executes generic Node and Python direct argv through an injected spawn seam with shell disabled', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const recorder = fakeSpawnRecorder({ status: 0, stdout: 'ok\n' });
  const nodeRun = await api.executeDirectArgv({ cwd: root, argv: ['node', '--test'], timeoutMs: 1000, spawn: recorder.spawn });
  const pythonRun = await api.executeDirectArgv({ cwd: root, argv: ['python', '-c', 'print("ok")'], timeoutMs: 1000, spawn: recorder.spawn });

  assert.equal(nodeRun.exitStatus, 0);
  assert.equal(pythonRun.exitStatus, 0);
  assert.deepEqual(recorder.calls.map((call) => [call.command, call.args]), [
    ['node', ['--test']],
    ['python', ['-c', 'print("ok")']],
  ]);
  for (const call of recorder.calls) {
    assert.equal(call.options.cwd, root);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
  assert.throws(() => api.executeDirectArgv({ cwd: root, argv: ['bash', '-lc', 'node --test'], spawn: recorder.spawn }), /shell|wrapper|direct argv/i);
  assert.throws(() => api.executeDirectArgv({ cwd: root, argv: ['npm', 'install'], spawn: recorder.spawn }), /unsafe|install|package|network|direct argv/i);
  assert.throws(() => api.executeDirectArgv({ cwd: root, argv: ['curl', 'https://example.invalid'], spawn: recorder.spawn }), /unsafe|network|curl|direct argv/i);
  assert.throws(() => api.executeDirectArgv({ cwd: root, argv: ['node', '-e', 'import fs from "node:fs"; fs.rmSync("x", { recursive: true, force: true })'], spawn: recorder.spawn }), /unsafe|destructive|rm|direct argv/i);

  const envRecorder = fakeSpawnRecorder({ status: 0, stdout: 'env ok\n' });
  await api.executeDirectArgv({
    cwd: root,
    argv: ['node', '--version'],
    spawn: envRecorder.spawn,
    env: {
      PATH: 'kept-path',
      SystemRoot: 'C:\\Windows',
      LANG: 'C',
      API_TOKEN: 'drop-token',
      PASSWORD: 'drop-password',
      PROVIDER_API_KEY: 'drop-provider',
      OPENCODE_AUTH_CONTENT: 'drop-opencode',
      NORMAL_VALUE: 'drop-normal',
      HOME: path.join(root, 'host-home'),
      TEMP: path.join(root, 'host-temp'),
    },
  });
  const childEnv = envRecorder.calls[0].options.env;
  assert.equal(childEnv.PATH, 'kept-path');
  assert.equal(childEnv.SystemRoot, 'C:\\Windows');
  assert.equal(childEnv.LANG, 'C');
  for (const key of ['API_TOKEN', 'PASSWORD', 'PROVIDER_API_KEY', 'OPENCODE_AUTH_CONTENT', 'NORMAL_VALUE']) {
    assert.equal(Object.hasOwn(childEnv, key), false, `${key} must not be forwarded to direct argv child env`);
  }
  for (const key of ['HOME', 'TEMP', 'TMP']) {
    assert.equal(typeof childEnv[key], 'string', `${key} must be remapped for direct argv child env`);
    assertOutsidePath(childEnv[key], root, `${key} must be outside the product target`);
  }
}));

test('RPB-PLAN-007 creates one primary run per arm and snapshot with no retry path', async () => {
  const api = await benchmarkApi();
  const plan = api.createBenchmarkRunPlan({ manifest, corpusRoot: path.resolve('benchmarks/real-projects'), artifactRoot: path.resolve('outside-artifacts') });
  const identities = new Set();

  assert.equal(plan.runs.length, manifest.pairs.length * 2 * 2);
  for (const run of plan.runs) {
    const identity = `${run.armId}:${run.pairId}:${run.snapshotId}`;
    assert.equal(identities.has(identity), false, `duplicate primary run ${identity}`);
    identities.add(identity);
    assert.equal(run.primary, true);
    assert.equal(run.attempt, 1);
    assert.equal(run.maxAttempts, 1);
    assert.equal(run.retryPolicy, 'none');
  }
});

test('RPB-ORACLE-008 interprets direct execution verdicts and detects postflight corpus mutation', async () => {
  const api = await benchmarkApi();
  assert.deepEqual(api.interpretOracleVerdict({ execution: { exitStatus: 0 }, expectedVerdict: 'PASS' }), { actualVerdict: 'PASS', matchesExpectedVerdict: true });
  assert.deepEqual(api.interpretOracleVerdict({ execution: { exitStatus: 1 }, expectedVerdict: 'FAIL' }), { actualVerdict: 'FAIL', matchesExpectedVerdict: true });
  assert.equal(api.interpretOracleVerdict({ execution: { exitStatus: 'SPAWN_ERROR' }, expectedVerdict: 'PASS' }).actualVerdict, 'BLOCKED');
  assert.equal(api.interpretOracleVerdict({ execution: { exitStatus: 'TIMED_OUT' }, expectedVerdict: 'PASS' }).actualVerdict, 'BLOCKED');

  const unchanged = api.detectPostflightMutation({ beforeFingerprint: { treeSha256: 'a'.repeat(64) }, afterFingerprint: { treeSha256: 'a'.repeat(64) } });
  const changed = api.detectPostflightMutation({ beforeFingerprint: { treeSha256: 'a'.repeat(64) }, afterFingerprint: { treeSha256: 'b'.repeat(64) } });
  assert.equal(unchanged.ok, true);
  assert.equal(changed.ok, false);
  assert.match(changed.diagnostics.join('\n'), /mutation|changed|fingerprint/i);
});

test('RPB-SCORE-009 validates automated heuristic scorecards and baseline-vs-skill comparisons without human-scoring claims', async () => {
  const api = await benchmarkApi();
  const baseline = scorecard({ armId: 'baseline', dimensionScores: { verdict: 10, coverage: 10 } });
  const skill = scorecard({ armId: 'skill' });
  assert.equal(validateScorecard(baseline).ok, true);
  assert.equal(validateScorecard(skill).ok, true);

  const scoreValidation = api.validateBenchmarkRunScorecard({ manifestStatus: 'draft', scorecard: skill });
  assert.equal(scoreValidation.ok, true);
  assert.match(JSON.stringify(scoreValidation), /automated[ -]heuristic/i);
  assert.ok(!/independent human|human scored|human judge/i.test(JSON.stringify(scoreValidation)));
  assert.equal(api.validateBenchmarkRunScorecard({ manifestStatus: 'draft', scorecard: { ...skill, scorer: 'independent-human' } }).ok, false);

  const comparison = api.validateBenchmarkComparison({ manifestStatus: 'draft', comparison: compareArmScorecards({ baseline, skill, threshold: 5 }) });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.approvedEffectivenessClaim, false, 'draft manifests cannot yield approved effectiveness claims');

  const approvedAutomated = api.validateBenchmarkComparison({ manifestStatus: 'approved', comparison: compareArmScorecards({ baseline, skill, threshold: 5 }), scorer: 'automated-heuristic' });
  assert.equal(approvedAutomated.ok, true);
  assert.equal(approvedAutomated.approvedEffectivenessClaim, false, 'approved automated heuristic improvements still require independent human scoring');
});

test('RPB-CLI-010 requires strict opt-in and external artifact roots before any real project benchmark can run', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const manifestPath = path.join(root, 'manifest.json');
  const corpusRoot = path.join(root, 'corpus');
  const externalArtifactRoot = path.join(root, 'artifacts');
  const internalArtifactRoot = path.join(corpusRoot, 'test-results');
  const providerConfigPath = path.join(root, 'host-opencode.json');
  const providerConfigDirectory = path.join(root, 'provider-config-dir');
  writeText(root, 'manifest.json', JSON.stringify(manifest));
  writeFileSync(providerConfigPath, JSON.stringify({ provider: { cpa: { npm: '@fake/cpa' } } }), 'utf8');
  mkdirSync(providerConfigDirectory, { recursive: true });

  assert.throws(() => api.parseBenchmarkCliArgs(['--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot]), /opt.?in|allow-real-project-benchmark/i);
  assert.throws(() => api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot]), /comparison threshold|required/i);
  assert.throws(() => api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot, '--comparison-threshold', '-1']), /comparison threshold|non-negative/i);
  assert.throws(() => api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot, '--comparison-threshold', '5', '--unknown']), /unknown|strict/i);
  assert.throws(() => api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', internalArtifactRoot, '--comparison-threshold', '5']), /artifact root.*outside|external/i);
  assert.throws(() => api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot, '--comparison-threshold', '5', '--provider-config', 'relative-opencode.json']), /provider config|absolute|regular file/i);
  assert.throws(() => api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot, '--comparison-threshold', '5', '--provider-config', providerConfigDirectory]), /provider config|regular file/i);

  const parsed = api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot, '--comparison-threshold', '5', '--provider-config', providerConfigPath]);
  assert.equal(parsed.allowRealProjectBenchmark, true);
  assert.equal(parsed.comparisonThreshold, 5);
  assert.equal(path.resolve(parsed.providerConfigPath), path.resolve(providerConfigPath));
  assert.equal(path.resolve(parsed.artifactRoot), path.resolve(externalArtifactRoot));
  const envParsed = api.parseBenchmarkCliArgs(['--allow-real-project-benchmark', '--manifest', manifestPath, '--corpus-root', corpusRoot, '--artifact-root', externalArtifactRoot, '--comparison-threshold', '5'], { QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH: providerConfigPath });
  assert.equal(path.resolve(envParsed.providerConfigPath), path.resolve(providerConfigPath));
  const artifactRoot = api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: externalArtifactRoot });
  assert.equal(path.resolve(artifactRoot.absolutePath), path.resolve(externalArtifactRoot));
}));

test('RPB-PATH-010A rejects external artifact roots that overlap corpus or source in either direction', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const corpusRoot = path.join(root, 'corpus');
  const sourceSnapshotRoot = path.join(corpusRoot, 'snapshots', 'case', 'post');
  const artifactRoot = path.join(root, 'artifacts');
  writeText(sourceSnapshotRoot, 'package.json', '{}\n');
  mkdirSync(artifactRoot, { recursive: true });

  assert.throws(() => api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: corpusRoot }), /outside|overlap|same|external/i);
  assert.throws(() => api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: path.join(corpusRoot, 'results') }), /outside|overlap|external/i);
  assert.throws(() => api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: root }), /outside|overlap|contains|external/i);
  assert.throws(() => api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: sourceSnapshotRoot, sourceSnapshotRoot }), /outside|overlap|same|external/i);
  assert.throws(() => api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: path.join(sourceSnapshotRoot, 'results'), sourceSnapshotRoot }), /outside|overlap|external/i);
  assert.throws(() => api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot: path.join(root, 'source-parent'), sourceSnapshotRoot: path.join(root, 'source-parent', 'snapshot') }), /outside|overlap|contains|external/i);
  assert.equal(path.resolve(api.resolveExternalArtifactRoot({ corpusRoot, artifactRoot }).absolutePath), path.resolve(artifactRoot));
}));

test('RPB-RUN-011 runs the high-level fake benchmark once per arm and snapshot with external artifacts and no skill leakage', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const focusedPair = JSON.parse(JSON.stringify(manifest.pairs[0]));
  const focusedManifest = { ...JSON.parse(JSON.stringify(manifest)), pairs: [focusedPair] };
  const corpusRoot = path.join(root, 'corpus');
  const artifactRoot = path.join(root, 'artifacts');
  const skillPackRoot = path.join(root, 'qa-skill-pack');
  writeText(skillPackRoot, 'using-project-qa/SKILL.md', '# using-project-qa\n');
  for (const snapshot of [focusedPair.preSnapshot, focusedPair.postSnapshot]) {
    writeText(corpusRoot, path.join(snapshot.localSnapshot, 'package.json'), '{"type":"module"}\n');
    writeText(
      corpusRoot,
      path.join(snapshot.localSnapshot, 'tests/example.test.mjs'),
      `import test from "node:test";\ntest("${snapshot.snapshotId}", () => {});\n`,
    );
    snapshot.treeSha256 = fingerprintProjectTree(path.join(corpusRoot, snapshot.localSnapshot)).treeSha256;
  }

  const openCodeCalls = [];
  const directSpawnCalls = [];
  const fakeOpenCode = async (context) => {
    openCodeCalls.push(context);
    assert.equal(path.resolve(context.artifactRoot).startsWith(path.resolve(artifactRoot)), true, 'OpenCode artifacts must stay under the external artifact root');
    assert.equal(path.resolve(context.artifactRoot).startsWith(path.resolve(corpusRoot)), false, 'OpenCode artifacts must not be inside the corpus root');
    assert.equal(Object.hasOwn(context, 'expectedVerdict'), false, 'OpenCode runner context must not expose expectedVerdict');
    assert.equal(Object.hasOwn(context, 'directArgvArrays'), false, 'OpenCode runner context must not expose frozen oracle argv fields');
    const serializedContext = JSON.stringify(context);
    assert.ok(!serializedContext.includes(JSON.stringify(focusedPair.preSnapshot.directArgvArrays)), 'OpenCode runner context must not expose pre oracle argv');
    assert.ok(!serializedContext.includes(JSON.stringify(focusedPair.postSnapshot.directArgvArrays)), 'OpenCode runner context must not expose post oracle argv');
    assert.ok(!serializedContext.includes(focusedPair.preSnapshot.directArgvArrays[0].join(' ')), 'OpenCode runner context must not expose pre verifier command');
    assert.ok(!serializedContext.includes(focusedPair.postSnapshot.directArgvArrays[0].join(' ')), 'OpenCode runner context must not expose post verifier command');
    const snapshot = context.snapshotId === focusedPair.preSnapshot.snapshotId ? focusedPair.preSnapshot : focusedPair.postSnapshot;
    const exactVerifierCommand = snapshot.directArgvArrays[0].join(' ');
    const validAuthorityEvidence = {
      agentTopology: { ok: true },
      parentBoundaryEvidence: { ok: true },
      childReportRelayEvidence: { ok: true },
      reportAuthorityEvidence: { ok: true },
    };
    const invalidAuthorityEvidence = {
      agentTopology: { ok: false, issues: ['synthetic missing topology'] },
      parentBoundaryEvidence: { ok: false, issues: ['synthetic missing parent boundary'] },
      childReportRelayEvidence: { ok: false, issues: ['synthetic missing child relay'] },
      reportAuthorityEvidence: { ok: false, issues: ['synthetic missing report authority'] },
    };
    return {
      status: 'COMPLETED',
      finalText: 'Overall Status: PASS\n',
      transcriptPath: path.join(context.artifactRoot, `${context.runId}.jsonl`),
      ...(context.snapshotId === focusedPair.postSnapshot.snapshotId ? validAuthorityEvidence : invalidAuthorityEvidence),
      modelCommandEvidence: context.snapshotId === focusedPair.preSnapshot.snapshotId
        ? { ok: true, actualCommand: 'node unrelated-health-check.mjs', expectedCommand: exactVerifierCommand, invocationKind: 'rejected', issues: ['unrelated command evidence must not score'] }
        : { ok: true, actualCommand: exactVerifierCommand, expectedCommand: exactVerifierCommand, invocationKind: 'exact', issues: [] },
    };
  };
  const fakeDirectSpawn = (command, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(path.resolve(options.cwd).startsWith(path.resolve(corpusRoot)), false, 'direct argv execution must not run in the original corpus snapshot');
    const snapshotId = options.snapshotId ?? options.context?.snapshotId ?? options.env?.QA_SKILL_BENCHMARK_SNAPSHOT_ID;
    assert.ok([focusedPair.preSnapshot.snapshotId, focusedPair.postSnapshot.snapshotId].includes(snapshotId), 'direct spawn seam must receive a stable snapshot identity');
    const status = snapshotId === focusedPair.preSnapshot.snapshotId ? 1 : 0;
    const result = { status, stdout: `oracle ${snapshotId}\n`, stderr: '', error: null, signal: null };
    directSpawnCalls.push({ command, args, options, result });
    return result;
  };

  const result = await api.runRealProjectBenchmark({
    manifest: focusedManifest,
    corpusRoot,
    artifactRoot,
    skillPackRoot,
    comparisonThreshold: 5,
    openCodeRunner: fakeOpenCode,
    directSpawn: fakeDirectSpawn,
  });

  assert.equal(result.runs.length, 4);
  assert.equal(openCodeCalls.length, 4);
  assert.equal(directSpawnCalls.length, 4);
  assert.deepEqual(openCodeCalls.map((call) => `${call.armId}:${call.snapshotId}`).sort(), [
    `baseline:${focusedManifest.pairs[0].postSnapshot.snapshotId}`,
    `baseline:${focusedManifest.pairs[0].preSnapshot.snapshotId}`,
    `skill:${focusedManifest.pairs[0].postSnapshot.snapshotId}`,
    `skill:${focusedManifest.pairs[0].preSnapshot.snapshotId}`,
  ].sort());
  for (const snapshot of [focusedPair.preSnapshot, focusedPair.postSnapshot]) {
    const baselineContext = openCodeCalls.find((call) => call.armId === 'baseline' && call.snapshotId === snapshot.snapshotId);
    const skillContext = openCodeCalls.find((call) => call.armId === 'skill' && call.snapshotId === snapshot.snapshotId);
    assert.equal(baselineContext.visibleScenarioText, skillContext.visibleScenarioText, 'baseline and skill visible scenario text must match per snapshot');
    assert.match(baselineContext.visibleScenarioText, /Target project path:\s*target\b/);
    assert.ok(!baselineContext.visibleScenarioText.includes(root), 'visible scenario text must not include temp host paths');
  }
  for (const call of openCodeCalls) {
    assert.equal(call.attempt, 1);
    assert.equal(call.maxAttempts, 1);
    assert.equal(call.retryPolicy, 'none');
    if (call.armId === 'baseline') {
      assert.equal(call.skillLoaded, false);
      assert.equal(call.skillRoot ?? null, null);
      assert.ok(!JSON.stringify(call).includes('using-project-qa/SKILL.md'), 'baseline run context must not include copied Skill content');
    } else {
      assert.equal(call.skillLoaded, true);
      assert.equal(path.resolve(call.skillSourceRoot), path.resolve(skillPackRoot));
      assert.match(JSON.stringify(call.copiedSkillManifest), /using-project-qa\/SKILL\.md/);
    }
  }
  for (const call of directSpawnCalls) {
    const snapshotId = call.options.snapshotId ?? call.options.context?.snapshotId ?? call.options.env?.QA_SKILL_BENCHMARK_SNAPSHOT_ID;
    const expectedStatus = snapshotId === focusedPair.preSnapshot.snapshotId ? 1 : 0;
    assert.equal(call.result.status, expectedStatus);
  }
  for (const run of result.runs) {
    assert.equal(path.resolve(run.artifactRoot).startsWith(path.resolve(artifactRoot)), true);
    assert.equal(path.resolve(run.artifactRoot).startsWith(path.resolve(corpusRoot)), false);
    assert.equal(run.retryCount, 0);
  }
  const preRuns = result.runs.filter((run) => run.snapshotId === focusedPair.preSnapshot.snapshotId);
  const postRuns = result.runs.filter((run) => run.snapshotId === focusedPair.postSnapshot.snapshotId);
  assert.equal(preRuns.length, 2);
  assert.equal(postRuns.length, 2);
  for (const run of preRuns) {
    assert.equal(run.modelVerdict, 'PASS');
    assert.equal(run.oracleVerdict, 'FAIL');
    assert.equal(run.scorecard.actualVerdict, 'PASS', 'scorecard actualVerdict must preserve the model verdict rather than oracle truth');
    assert.equal(run.scorecard.dimensions.verdict.score, 0, 'wrong model PASS on oracle FAIL must receive zero verdict score');
    assert.equal(run.scorecard.dimensions.commandEvidence.score, 0, 'irrelevant pre command evidence must not score');
    assert.equal(run.scorecard.dimensions.report.score, 0, 'invalid pre topology/report authority must force report score to zero');
    assert.equal(run.scorecard.dimensions.traceability.score, 0, 'invalid pre topology/report authority must force traceability score to zero');
    assert.equal(run.scorecard.dimensions.readOnly.score, 0, 'read-only score must require valid authority evidence in addition to postflight and cleanup');
  }
  for (const run of postRuns) {
    assert.equal(run.modelVerdict, 'PASS');
    assert.equal(run.oracleVerdict, 'PASS');
    assert.equal(run.scorecard.actualVerdict, 'PASS');
    assert.equal(run.scorecard.dimensions.verdict.score, BENCHMARK_RUBRIC.verdict, 'matching post PASS must retain the full verdict score');
    assert.equal(run.scorecard.dimensions.commandEvidence.score, BENCHMARK_RUBRIC.commandEvidence, 'exact post verifier command evidence must receive full command score');
    assert.equal(run.scorecard.dimensions.report.score, BENCHMARK_RUBRIC.report, 'valid post topology/report authority allows full report score');
    assert.equal(run.scorecard.dimensions.traceability.score, 0, 'minimal post final text has no risk chain, so traceability may remain zero');
    assert.equal(run.scorecard.dimensions.readOnly.score, BENCHMARK_RUBRIC.readOnly, 'read-only scores only when authority, postflight, and cleanup are valid');
  }
}));

test('RPB-RUN-012 preserves deterministic failure artifacts and does not retry when an injected primary run throws', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const focusedPair = JSON.parse(JSON.stringify(manifest.pairs[0]));
  const focusedManifest = { ...JSON.parse(JSON.stringify(manifest)), pairs: [focusedPair] };
  const corpusRoot = path.join(root, 'corpus');
  const artifactRoot = path.join(root, 'artifacts');
  const skillPackRoot = path.join(root, 'qa-skill-pack');
  writeText(skillPackRoot, 'using-project-qa/SKILL.md', '# using-project-qa\n');
  for (const snapshot of [focusedPair.preSnapshot, focusedPair.postSnapshot]) {
    writeText(corpusRoot, path.join(snapshot.localSnapshot, 'package.json'), '{"type":"module"}\n');
    writeText(corpusRoot, path.join(snapshot.localSnapshot, 'tests/example.test.mjs'), `import test from "node:test";\ntest("${snapshot.snapshotId}", () => {});\n`);
    snapshot.treeSha256 = fingerprintProjectTree(path.join(corpusRoot, snapshot.localSnapshot)).treeSha256;
  }

  const failingRunDirectory = path.join(artifactRoot, focusedPair.pairId, focusedPair.preSnapshot.snapshotId, 'baseline', focusedManifest.arms.baseline.primaryRuns[0].runId);
  const openCodeCalls = [];
  const failureSecret = 'API_TOKEN=failure-secret-value';
  await assert.rejects(
    () => api.runRealProjectBenchmark({
      manifest: focusedManifest,
      corpusRoot,
      artifactRoot,
      skillPackRoot,
      comparisonThreshold: 5,
      openCodeRunner: async (context) => {
        openCodeCalls.push(context);
        if (context.armId === 'baseline' && context.snapshotId === focusedPair.preSnapshot.snapshotId) throw new Error(`synthetic OpenCode failure ${failureSecret}`);
        return { status: 'COMPLETED', finalText: 'Overall Status: PASS\n' };
      },
      directSpawn: () => ({ status: 0, stdout: '', stderr: '', error: null, signal: null }),
    }),
    /synthetic OpenCode failure/,
  );

  assert.equal(openCodeCalls.filter((call) => call.armId === 'baseline' && call.snapshotId === focusedPair.preSnapshot.snapshotId).length, 1, 'failing primary run must not be retried');
  assert.equal(existsSync(path.join(failingRunDirectory, 'failure.json')), true, 'failure artifact must be retained in the external run directory');
  assert.equal(existsSync(path.join(failingRunDirectory, 'cleanup.json')), true, 'cleanup artifact must be retained in the external run directory');
  const failure = JSON.parse(readFileSync(path.join(failingRunDirectory, 'failure.json'), 'utf8'));
  const failureText = JSON.stringify(failure);
  const cleanup = JSON.parse(readFileSync(path.join(failingRunDirectory, 'cleanup.json'), 'utf8'));
  assert.match(failure.error?.message || failure.message || '', /synthetic OpenCode failure/);
  assert.equal(failureText.includes(failureSecret), false, 'failure.json must not persist raw secret-like thrown error text');
  assert.match(failureText, /REDACTED/i, 'failure.json must visibly indicate secret redaction');
  assert.equal(cleanup.attempted, true);
}));

test('RPB-RUN-012B rejects non-throwing infrastructure failures and fail-closes with failure artifacts', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const failingRunDirectory = path.join(artifactRoot, focusedPair.pairId, focusedPair.preSnapshot.snapshotId, 'baseline', focusedManifest.arms.baseline.primaryRuns[0].runId);
  const openCodeCalls = [];
  const providerOnlySecret = 'opaque-provider-only-secret-value';
  let rejectedError = null;

  try {
    await api.runRealProjectBenchmark({
      manifest: focusedManifest,
      corpusRoot,
      artifactRoot,
      skillPackRoot,
      comparisonThreshold: 5,
      openCodeRunner: async (context) => {
        openCodeCalls.push(context);
        if (context.armId === 'baseline' && context.snapshotId === focusedPair.preSnapshot.snapshotId) {
          return {
            status: 'COMPLETED',
            finalText: 'Overall Status: PASS\n',
            terminal: {
              exitCode: 1,
              timeoutMs: 1000,
              durationMs: 5,
              platform: process.platform,
              node: process.version,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              signal: null,
              spawnError: null,
              stdoutBytes: 0,
              stderrBytes: 0,
            },
            events: [{ type: 'error', error: { data: { message: `unknown certificate verification error ${providerOnlySecret}` } } }],
            redactionEnv: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { cpa: { options: { apiKey: providerOnlySecret } } } }),
            },
          };
        }
        return validOpenCodeResult({ command: context.snapshotId === focusedPair.preSnapshot.snapshotId ? focusedPair.preSnapshot.directArgvArrays[0].join(' ') : focusedPair.postSnapshot.directArgvArrays[0].join(' ') });
      },
      directSpawn: passingDirectSpawn,
    });
  } catch (error) {
    rejectedError = error;
  }

  assert.ok(rejectedError, 'runRealProjectBenchmark should reject on non-throwing infrastructure failures');
  assert.match(rejectedError.message, /unknown certificate verification error|exit code|COMPLETED|terminal|fail-closed/i);
  assert.equal(openCodeCalls.filter((call) => call.armId === 'baseline' && call.snapshotId === focusedPair.preSnapshot.snapshotId).length, 1, 'failing primary run must not be retried');
  assert.equal(openCodeCalls.length, 1, 'first failed primary run should fail-closed before continuing to other runs');

  assert.equal(existsSync(path.join(failingRunDirectory, 'failure.json')), true, 'failure artifact must be retained for infrastructure failure');
  assert.equal(existsSync(path.join(failingRunDirectory, 'cleanup.json')), true, 'cleanup artifact must be retained for infrastructure failure');
  assert.equal(existsSync(path.join(failingRunDirectory, 'scorecard.json')), false, 'failed run must not emit a normal scorecard');
  const failureText = readFileSync(path.join(failingRunDirectory, 'failure.json'), 'utf8');
  assert.equal(failureText.includes(providerOnlySecret), false, 'failure.json must redact values known only to the run-specific provider config');
  assert.match(failureText, /REDACTED/i, 'failure.json must visibly mark run-specific provider secret redaction');
  assert.equal(existsSync(path.join(artifactRoot, focusedPair.pairId, focusedPair.preSnapshot.snapshotId, 'comparison.json')), false, 'no per-snapshot comparison should be produced for a failed primary run');
  assert.equal(existsSync(path.join(artifactRoot, focusedPair.pairId, 'comparison.json')), false, 'no per-pair comparison should be produced when a primary run fails');
}));

test('RPB-RUN-012A rejects a non-empty top-level artifact root before OpenCode and preserves aggregate evidence', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const aggregateSentinel = path.join(artifactRoot, 'aggregate-sentinel.txt');
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(aggregateSentinel, 'do not overwrite aggregate evidence\n', 'utf8');
  const beforeBytes = readFileSync(aggregateSentinel);
  const openCodeCalls = [];

  await assert.rejects(
    () => api.runRealProjectBenchmark({
      manifest: focusedManifest,
      corpusRoot,
      artifactRoot,
      skillPackRoot,
      comparisonThreshold: 5,
      openCodeRunner: async (context) => {
        openCodeCalls.push(context);
        return validOpenCodeResult({ command: focusedPair.postSnapshot.directArgvArrays[0].join(' ') });
      },
      directSpawn: passingDirectSpawn,
    }),
    /artifact root|non-empty|overwrite|occupied|existing/i,
  );

  assert.equal(openCodeCalls.length, 0, 'non-empty top-level artifact root must reject before OpenCode');
  assert.deepEqual(readFileSync(aggregateSentinel), beforeBytes, 'existing aggregate evidence must remain byte-identical');
}));

test('RPB-RUN-013 redacts secret-like values from persisted text and JSON artifacts', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const sentinel = 'API_TOKEN=artifact-secret-value';
  const result = await api.runRealProjectBenchmark({
    manifest: focusedManifest,
    corpusRoot,
    artifactRoot,
    skillPackRoot,
    comparisonThreshold: 5,
    snapshotFilter: focusedPair.postSnapshot.snapshotId,
    openCodeRunner: async () => ({
      ...validOpenCodeResult({ finalText: `Overall Status: PASS\n${sentinel}\n`, command: focusedPair.postSnapshot.directArgvArrays[0].join(' ') }),
      modelCommandEvidence: { ok: true, actualCommand: `node --test ${sentinel}`, expectedCommand: focusedPair.postSnapshot.directArgvArrays[0].join(' '), invocationKind: 'exact', issues: [] },
      modelCommandEvents: [{ command: `node --test ${sentinel}`, output: sentinel }],
      rawStdout: Buffer.from(`{"type":"text","part":{"text":"${sentinel}"}}\n`, 'utf8'),
      stderr: `stderr ${sentinel}`,
      events: [{ type: 'message', text: `event ${sentinel}` }],
    }),
    directSpawn: passingDirectSpawn,
  });

  const runRoot = result.runs.find((run) => run.armId === 'baseline').artifactRoot;
  for (const relativePath of ['raw-stdout.jsonl', 'stderr.txt', 'events.json', 'final-message.md', 'final-report.md', 'model-command-evidence.json', 'model-command-events.json']) {
    const persisted = readFileSync(path.join(runRoot, relativePath), 'utf8');
    assert.ok(!persisted.includes(sentinel), `${relativePath} must not persist raw secret-like values`);
    assert.match(persisted, /REDACTED/i, `${relativePath} must visibly indicate redaction`);
  }
}));

test('RPB-RUN-014 separates model-input metadata from assessor-only frozen truth artifacts', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const result = await api.runRealProjectBenchmark({
    manifest: focusedManifest,
    corpusRoot,
    artifactRoot,
    skillPackRoot,
    comparisonThreshold: 5,
    snapshotFilter: focusedPair.postSnapshot.snapshotId,
    openCodeRunner: async () => validOpenCodeResult({ command: focusedPair.postSnapshot.directArgvArrays[0].join(' ') }),
    directSpawn: passingDirectSpawn,
  });

  const runRoot = result.runs.find((run) => run.armId === 'baseline').artifactRoot;
  const runInput = JSON.parse(readFileSync(path.join(runRoot, 'run-input.json'), 'utf8'));
  const runInputText = JSON.stringify(runInput);
  assert.equal(JSON.stringify(runInput).includes('expectedVerdict'), false, 'run-input.json must be model-input metadata only');
  assert.equal(JSON.stringify(runInput).includes('directArgvArrays'), false, 'run-input.json must not persist frozen oracle argv');
  assert.equal(runInputText.includes('treeSha256'), false, 'run-input.json must not persist pinned tree hash keys');
  assert.equal(runInputText.includes(focusedPair.postSnapshot.treeSha256), false, 'run-input.json must not persist the actual pinned snapshot hash value');
  const oracle = JSON.parse(readFileSync(path.join(runRoot, 'oracle.json'), 'utf8'));
  assert.equal(oracle.assessorOnly, true, 'oracle frozen truth artifact must be explicitly assessor-only');
  assert.equal(oracle.checkedAfterModel, true, 'oracle assessor artifact must be written after model completion');
}));

test('RPB-RUN-015 detects original Skill source mutation during Skill arm postflight', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const result = await api.runRealProjectBenchmark({
    manifest: focusedManifest,
    corpusRoot,
    artifactRoot,
    skillPackRoot,
    comparisonThreshold: 5,
    snapshotFilter: focusedPair.postSnapshot.snapshotId,
    openCodeRunner: async (context) => {
      if (context.armId === 'skill') writeText(skillPackRoot, 'using-project-qa/MUTATED.txt', 'mutated source\n');
      return validOpenCodeResult({ command: focusedPair.postSnapshot.directArgvArrays[0].join(' ') });
    },
    directSpawn: passingDirectSpawn,
  });

  const skillRun = result.runs.find((run) => run.armId === 'skill');
  assert.equal(skillRun.postflight.skillSourceUnchanged, false);
  assert.equal(skillRun.postflight.ok, false);
  assert.equal(skillRun.scorecard.dimensions.readOnly.score, 0, 'mutated original Skill source must zero read-only score even when model says PASS');
}));

test('RPB-RUN-015A fails closed or zeros read-only when original Skill source is deleted during a Skill run', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const skillRunDirectory = path.join(artifactRoot, focusedPair.pairId, focusedPair.postSnapshot.snapshotId, 'skill', focusedManifest.arms.skill.primaryRuns[0].runId);
  let result = null;
  let rejected = null;
  try {
    result = await api.runRealProjectBenchmark({
      manifest: focusedManifest,
      corpusRoot,
      artifactRoot,
      skillPackRoot,
      comparisonThreshold: 5,
      snapshotFilter: focusedPair.postSnapshot.snapshotId,
      openCodeRunner: async (context) => {
        if (context.armId === 'skill') rmSync(skillPackRoot, { recursive: true, force: true });
        return validOpenCodeResult({ command: focusedPair.postSnapshot.directArgvArrays[0].join(' ') });
      },
      directSpawn: passingDirectSpawn,
    });
  } catch (error) {
    rejected = error;
  }

  if (rejected) {
    assert.equal(existsSync(path.join(skillRunDirectory, 'failure.json')), true, 'deleted Skill source failures must retain failure.json');
    assert.equal(existsSync(path.join(skillRunDirectory, 'cleanup.json')), true, 'deleted Skill source failures must retain cleanup.json');
  } else {
    const skillRun = result.runs.find((run) => run.armId === 'skill');
    assert.equal(skillRun.postflight.skillSourceUnchanged, false);
    assert.equal(skillRun.postflight.ok, false);
    assert.equal(skillRun.scorecard.dimensions.readOnly.score, 0, 'deleted original Skill source must zero read-only score even when model says PASS');
  }
}));

test('RPB-RUN-015B rejects an existing non-empty per-run artifact directory without deleting evidence or calling OpenCode', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const occupiedRunDirectory = path.join(artifactRoot, focusedPair.pairId, focusedPair.postSnapshot.snapshotId, 'baseline', focusedManifest.arms.baseline.primaryRuns[0].runId);
  const sentinelPath = path.join(occupiedRunDirectory, 'sentinel.txt');
  mkdirSync(occupiedRunDirectory, { recursive: true });
  writeFileSync(sentinelPath, 'do not remove existing evidence\n', 'utf8');
  const openCodeCalls = [];

  await assert.rejects(
    () => api.runRealProjectBenchmark({
      manifest: focusedManifest,
      corpusRoot,
      artifactRoot,
      skillPackRoot,
      comparisonThreshold: 5,
      snapshotFilter: focusedPair.postSnapshot.snapshotId,
      openCodeRunner: async (context) => {
        if (context.armId === 'baseline' && context.snapshotId === focusedPair.postSnapshot.snapshotId) openCodeCalls.push(context);
        return validOpenCodeResult({ command: focusedPair.postSnapshot.directArgvArrays[0].join(' ') });
      },
      directSpawn: passingDirectSpawn,
    }),
    /artifact|exists|non-empty|overwrite|occupied/i,
  );

  assert.equal(readFileSync(sentinelPath, 'utf8'), 'do not remove existing evidence\n', 'existing evidence sentinel must be preserved');
  assert.equal(openCodeCalls.length, 0, 'occupied run identity must reject before calling OpenCode');
}));

test('RPB-RUN-016 preserves failure and cleanup artifacts for pinned fingerprint preflight failures', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  focusedPair.preSnapshot.treeSha256 = '0'.repeat(64);
  const failingRunDirectory = path.join(artifactRoot, focusedPair.pairId, focusedPair.preSnapshot.snapshotId, 'baseline', focusedManifest.arms.baseline.primaryRuns[0].runId);
  await assert.rejects(
    () => api.runRealProjectBenchmark({
      manifest: focusedManifest,
      corpusRoot,
      artifactRoot,
      skillPackRoot,
      comparisonThreshold: 5,
      snapshotFilter: focusedPair.preSnapshot.snapshotId,
      openCodeRunner: async () => validOpenCodeResult(),
      directSpawn: passingDirectSpawn,
    }),
    /fingerprint|treeSha256|changed/i,
  );
  assert.equal(existsSync(path.join(failingRunDirectory, 'failure.json')), true, 'preflight failure must retain failure.json after run directory is known');
  assert.equal(existsSync(path.join(failingRunDirectory, 'cleanup.json')), true, 'preflight failure must retain cleanup.json after run directory is known');
}));

test('RPB-RUN-017 successful benchmark cycle writes corpus, scorecard, comparison, limitation, and summary artifacts', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const result = await api.runRealProjectBenchmark({
    manifest: focusedManifest,
    corpusRoot,
    artifactRoot,
    skillPackRoot,
    comparisonThreshold: 5,
    openCodeRunner: async (context) => {
      const snapshot = context.snapshotId === focusedPair.preSnapshot.snapshotId ? focusedPair.preSnapshot : focusedPair.postSnapshot;
      return validOpenCodeResult({ command: snapshot.directArgvArrays[0].join(' ') });
    },
    directSpawn: passingDirectSpawn,
  });

  for (const relativePath of ['corpus-manifest.json', 'run-order.json', 'benchmark-summary.md', 'limitations.md']) {
    assert.equal(existsSync(path.join(result.artifactRoot, relativePath)), true, `${relativePath} must be written for successful cycles`);
  }
  const corpusManifest = JSON.parse(readFileSync(path.join(result.artifactRoot, 'corpus-manifest.json'), 'utf8'));
  assert.equal(corpusManifest.assessorOnly, true, 'corpus-manifest.json must be marked assessor-only');
  assert.equal(corpusManifest.schemaVersion, focusedManifest.schemaVersion);
  assert.deepEqual(corpusManifest.runConfig, focusedManifest.runConfig, 'corpus manifest must preserve frozen runConfig');
  assert.equal(corpusManifest.pairs[0].repositoryUrl, focusedPair.repositoryUrl);
  assert.equal(corpusManifest.pairs[0].publicIssueUrl, focusedPair.publicIssueUrl);
  assert.equal(corpusManifest.pairs[0].repositoryLicense, focusedPair.repositoryLicense);
  assert.deepEqual(corpusManifest.pairs[0].preSnapshot, focusedPair.preSnapshot, 'corpus manifest must preserve full frozen preSnapshot');
  assert.deepEqual(corpusManifest.pairs[0].postSnapshot, focusedPair.postSnapshot, 'corpus manifest must preserve full frozen postSnapshot');
  assert.equal(existsSync(path.join(result.artifactRoot, 'scorecards')), true, 'scorecards directory must be written');
  for (const run of result.runs) {
    assert.equal(existsSync(path.join(run.artifactRoot, 'cleanup.json')), true, 'each successful per-run artifact directory must contain cleanup.json');
  }
  for (const snapshot of [focusedPair.preSnapshot, focusedPair.postSnapshot]) {
    assert.equal(existsSync(path.join(result.artifactRoot, focusedPair.pairId, snapshot.snapshotId, 'comparison.json')), true, 'per-snapshot comparison.json must be written');
    assert.equal(existsSync(path.join(result.artifactRoot, focusedPair.pairId, snapshot.snapshotId, 'comparison.md')), true, 'per-snapshot comparison.md must be written');
  }
  assert.equal(existsSync(path.join(result.artifactRoot, focusedPair.pairId, 'comparison.json')), true, 'per-pair comparison.json must be written');
  assert.equal(existsSync(path.join(result.artifactRoot, focusedPair.pairId, 'comparison.md')), true, 'per-pair comparison.md must be written');
}));

test('RPB-RUN-018 aggregate summary remains draft/inconclusive while preserving observed improvement counts', async () => withTempDirectory(async (root) => {
  const api = await benchmarkApi();
  const { focusedManifest, focusedPair, corpusRoot, artifactRoot, skillPackRoot } = createSyntheticBenchmarkFixture(root);
  const result = await api.runRealProjectBenchmark({
    manifest: focusedManifest,
    corpusRoot,
    artifactRoot,
    skillPackRoot,
    comparisonThreshold: 5,
    snapshotFilter: focusedPair.postSnapshot.snapshotId,
    openCodeRunner: async (context) => validOpenCodeResult({
      finalText: context.armId === 'baseline' ? 'Overall Status: FAIL\n' : 'Overall Status: PASS\n',
      command: focusedPair.postSnapshot.directArgvArrays[0].join(' '),
    }),
    directSpawn: passingDirectSpawn,
  });

  assert.ok(result.comparisons.some((comparison) => comparison.comparison?.conclusion === 'improvement' || comparison.conclusion === 'improvement'), 'observed improvement must be preserved in comparison data');
  assert.equal(result.summary.approvedEffectivenessClaim, false);
  assert.match(result.summary.text, /draft/i);
  assert.match(result.summary.text, /inconclusive/i);
  assert.match(result.summary.text, /improvement/i, 'aggregate summary must not hide observed improvement outcomes');
  assert.match(result.summary.text, /1\s+improvement|improvement\s*[:=]\s*1/i, 'aggregate summary must preserve observed comparison counts');
}));

test('RPB-SUMMARY-013 reports draft or inconclusive results without approved effectiveness wording', async () => {
  const api = await benchmarkApi();
  const summary = api.buildBenchmarkSummary({
    manifestStatus: 'draft',
    comparison: { ok: true, conclusion: 'improvement', skill_delta: { total: 10, verdict: 5 } },
    runCount: 12,
    scorer: 'automated-heuristic',
  });
  const inconclusive = api.buildBenchmarkSummary({
    manifestStatus: 'approved',
    comparison: { ok: false, conclusion: 'inconclusive', diagnostics: ['missing scorecard'] },
    runCount: 12,
    scorer: 'automated-heuristic',
  });

  assert.match(summary.text, /draft/i);
  assert.match(summary.text, /automated heuristic/i);
  assert.ok(!/approved effectiveness|proves effectiveness|independent human scoring/i.test(summary.text));
  assert.equal(summary.approvedEffectivenessClaim, false);
  assert.match(inconclusive.text, /inconclusive/i);
  assert.equal(inconclusive.approvedEffectivenessClaim, false);
});

test('RPB-DETERMINISM-014 keeps synthetic test fixtures local and deterministic', () => {
  const serialized = JSON.stringify(manifest);
  assert.equal(createHash('sha256').update(serialized).digest('hex').length, 64);
  assert.ok(!/api\.openai|api\.anthropic|api\.openrouter|localhost:\d+/i.test(serialized));
});
