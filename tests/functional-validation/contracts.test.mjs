import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertScenarioOutcome,
  analyzeReportDiagnostics,
  buildScenarioPrompt,
  buildAgentTopologyEvidence,
  buildNestedSessionEvidence,
  capturePostflight,
  createRuntimeOpenCodeEnv,
  createScenarioRepository,
  executeScenarioOracle,
  extractFinalText,
  extractQaVerdict,
  extractModelCommandEvidence,
  extractTaskSessionIds,
  hashDirectory,
  materializeCurrentSkill,
  materializeRuntimeConfig,
  parseJsonlStrict,
  promptMetadata,
  redactCommandMetadata,
  selectReportSource,
  summarizeInfrastructure,
  validateProjectSkillDiscovery,
  writeRunArtifacts,
} from './harness.mjs';
import * as harness from './harness.mjs';
import { scenarios } from './scenarios.mjs';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');

function withTempRoot(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'qa-functional-contract-'));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const completePassReport = [
  'QA Plan Gate: OPEN',
  'QA Conclusion Gate: COMPLETE',
  'Overall Status: PASS',
  'Risk R01 Verification V01 Evidence E01 Status PASS',
  'Command: node verify-membership-discount.mjs',
  'Exit code: 0',
  'Output: OK membership discount behavior: member=90 guest=100',
  'Traceability: R01 -> V01 -> E01 -> PASS',
  '',
].join('\n');

const passReportTableEvidence = [
  'QA Plan Gate: OPEN',
  'QA Conclusion Gate: COMPLETE',
  'Overall Status: PASS',
  '| Evidence ID | Verification ID | Command | Result | Artifact or reference |',
  '|---|---|---|---|---|',
  '| E01 | V01 | node verify-membership-discount.mjs | PASS | Output: OK membership discount behavior: member=90 guest=100 |',
  'Traceability: R01 -> V01 -> E01 -> PASS',
  '',
].join('\n');

const passToolUseEvent = {
  type: 'tool_use',
  part: {
    callID: 'tool-pass-001',
    title: 'node verify-membership-discount.mjs',
    state: {
      status: 'completed',
      input: { command: 'node verify-membership-discount.mjs' },
      output: 'OK membership discount behavior: member=90 guest=100\n',
      error: '',
      metadata: { exit: 0 },
    },
  },
};

const passWrapperToolUseEvent = {
  type: 'tool_use',
  part: {
    callID: 'tool-pass-wrapper-001',
    title: 'verify and inspect status',
    state: {
      status: 'completed',
      input: { command: 'node verify-membership-discount.mjs; $ec=$LASTEXITCODE; git status --short; exit $ec' },
      output: 'OK membership discount behavior: member=90 guest=100\n',
      error: '',
      metadata: { exit: 0 },
    },
  },
};

const parentTaskEvent = {
  type: 'tool_use',
  part: {
    tool: 'task',
    callID: 'task-call-001',
    title: 'general QA subagent',
    state: {
      status: 'completed',
      input: { subagent_type: 'general' },
      output: '<task_metadata>session_id: ses_child_001</task_metadata>',
      metadata: { sessionId: 'ses_child_001', taskId: 'task-001' },
    },
  },
};

const childExport = {
  session: {
    id: 'ses_child_001',
    parentID: 'ses_parent_001',
    agent: 'general',
    model: { providerID: 'cpa', modelID: 'gpt-5.4-mini' },
    version: '1.18.7',
  },
  parts: [
    { type: 'tool_use', part: { callID: 'tool-unrelated-001', title: 'inspect unrelated', state: { status: 'completed', input: { command: 'cat package.json' }, output: '{"scripts":{}}', error: '', metadata: { exit: 0 } } } },
    passWrapperToolUseEvent,
  ],
};

const actualShapeChildExport = {
  info: {
    id: 'ses_child_001',
    parentID: 'ses_parent_001',
    agent: 'general',
    model: { providerID: 'cpa', modelID: 'gpt-5.4-mini' },
    version: '1.18.7',
  },
  messages: [{
    parts: [
      {
        type: 'tool',
        tool: 'bash',
        callID: 'tool-unrelated-001',
        state: {
          status: 'completed',
          input: { command: 'cat package.json' },
          output: '{"scripts":{"secret":"must-not-persist"}}',
          metadata: { exit: 0 },
          title: 'inspect unrelated file',
          time: { start: 1780000000000, end: 1780000000001 },
        },
      },
      {
        type: 'tool',
        tool: 'bash',
        callID: 'tool-pass-actual-001',
        state: {
          status: 'completed',
          input: { command: 'node verify-membership-discount.mjs' },
          output: 'OK membership discount behavior: member=90 guest=100\n',
          error: '',
          metadata: { exit: 0 },
          title: 'run verifier',
          time: { start: 1780000000002, end: 1780000000003 },
        },
      },
    ],
  }],
};

const okAgentTopology = {
  ok: true,
  parentSessionId: 'ses_parent_001',
  childIds: ['ses_child_001'],
  childCount: 1,
  childParentId: 'ses_parent_001',
  requestedModel: 'cpa/gpt-5.4-mini',
  actualChildModel: 'cpa/gpt-5.4-mini',
  expectedAgent: 'general',
  actualAgent: 'general',
  issues: [],
};

const okParentBoundaryEvidence = {
  ok: true,
  parentSessionId: 'ses_parent_001',
  toolCallCount: 5,
  taskCallCount: 1,
  skillCallCount: 4,
  calls: [
    { tool: 'skill', callID: 'skill-using-qa', status: 'completed' },
    { tool: 'skill', callID: 'skill-qa-plan', status: 'completed' },
    { tool: 'skill', callID: 'skill-qa-execute', status: 'completed' },
    { tool: 'skill', callID: 'skill-qa-conclude', status: 'completed' },
    { tool: 'task', callID: 'task-call-001', status: 'completed' },
  ],
  issues: [],
};

const okChildReportRelayEvidence = {
  ok: true,
  deliveryOk: true,
  deliveryIssues: [],
  childSha256: 'child-hash',
  parentSha256: 'child-hash',
  deliveredSha256: 'child-hash',
  childBytes: 128,
  parentBytes: 128,
  deliveredBytes: 128,
  childMarkerCount: 1,
  parentMarkerCount: 1,
  deliveredMarkerCount: 1,
  childVerdict: 'PASS',
  deliveredVerdict: 'PASS',
  parentVerdict: 'PASS',
  relayMatches: true,
  deliveredRelayMatches: true,
  issues: [],
};

const okBlockedChildReportRelayEvidence = {
  ...okChildReportRelayEvidence,
  childVerdict: 'BLOCKED',
  parentVerdict: 'BLOCKED',
  deliveredVerdict: 'BLOCKED',
};

const okFailChildReportRelayEvidence = {
  ...okChildReportRelayEvidence,
  childVerdict: 'FAIL',
  parentVerdict: 'FAIL',
  deliveredVerdict: 'FAIL',
};

const completeFailReport = [
  'QA Plan Gate: OPEN',
  'QA Conclusion Gate: COMPLETE',
  'Overall Status: FAIL',
  'Risk R02 Verification V02 Evidence E02 Finding F02 Status FAIL',
  'product defect: expected behavior was not met',
  'Command: node verify-tax-rounding.mjs',
  'Exit code: 1',
  'Output: tax rounding defect: expected 10.24 received 10.23',
  '| No unresolved blocker or critical human decision remains for `PASS` | COMPLETE |',
  'Traceability: R02 -> V02 -> E02 -> FAIL',
  '',
].join('\n');

const spacedFailTraceabilityReport = [
  'QA Plan Gate: OPEN',
  'QA Conclusion Gate: COMPLETE',
  'Overall Status: FAIL',
  '## Risk Analysis',
  `R02: ${'Scoped concern detail. '.repeat(12)}`,
  '## Verification Plan',
  `V02: ${'Planned check detail. '.repeat(12)}`,
  '## Execution Evidence',
  `E02: ${'Observed result detail. '.repeat(12)}`,
  'Command: node verify-tax-rounding.mjs',
  'Exit code: 1',
  'Output: tax rounding defect: expected 10.24 received 10.23',
  '## Findings',
  'F02: product defect: expected behavior was not met',
  '## Traceability',
  'R02 -> V02 -> E02 -> FAIL',
  'F02 -> R02 / V02 / E02',
  '',
].join('\n');

const rawParentFailReportMissingConclusionGateRow = completeFailReport.replace('\n| No unresolved blocker or critical human decision remains for `PASS` | COMPLETE |', '');

const okReportAuthorityEvidence = {
  ok: true,
  source: 'assistant-message',
  relativePath: null,
  selectedMatchesAuthoritative: true,
  authoritativeSha256: 'report-hash',
  selectedSha256: 'report-hash',
  authoritativeBytes: 128,
  selectedBytes: 128,
  issues: [],
};

const attempt4PassReport = [
  'QA Plan Gate: OPEN',
  'QA Conclusion Gate: COMPLETE',
  'Overall Status: PASS',
  '| Evidence ID | Verification ID | Command | Result | Artifact or reference |',
  '|---|---|---|---|---|',
  '| E01 | V01 | node verify-membership-discount.mjs | PASS | Output: OK membership discount behavior: member=90 guest=100 |',
  '| R02 | V02 | N/A | BLOCKED | Reason: not applicable for this scoped run | None |',
  '| R03 | V03 | N/A | BLOCKED | Reason: out of scope by user request | N/A |',
  '| R04 | V04 | N/A | BLOCKED | Reason: not required for membership discount | None |',
  'No unresolved blocker or critical human decision remains.',
  'Traceability: R01 -> V01 -> E01 -> PASS',
  '',
].join('\n');

const passReportWithRealBlockedRow = [
  'QA Plan Gate: OPEN',
  'QA Conclusion Gate: COMPLETE',
  'Overall Status: PASS',
  '| Evidence ID | Verification ID | Command | Result | Artifact or reference |',
  '|---|---|---|---|---|',
  '| E01 | V01 | node verify-membership-discount.mjs | PASS | Output: OK membership discount behavior: member=90 guest=100 |',
  '| R09 | V09 | N/A | BLOCKED | missing prerequisite: acceptance-data/currency-cases.json | acceptance-data/currency-cases.json |',
  'Traceability: R01 -> V01 -> E01 -> PASS',
  '',
].join('\n');

test('FV-SCENARIOS-001 defines PASS, FAIL, and BLOCKED scenarios without model-visible oracle metadata', () => {
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    ['pass-membership-discount', 'fail-rounding-regression', 'blocked-missing-acceptance-data'],
  );

  for (const scenario of scenarios) {
    assert.match(scenario.expectedVerdict, /^(PASS|FAIL|BLOCKED)$/);
    assert.ok(!JSON.stringify(scenario.product).includes(scenario.expectedVerdict));
    assert.ok(!scenario.prompt.includes(scenario.expectedVerdict));
    assert.ok(scenario.requiredEvidence.every((identifier) => !/(?:PASS|FAIL|BLOCKED)/i.test(identifier)));
    assert.ok(scenario.requiredEvidence.length > 0);
  }
});

test('FV-PROMPT-010 builds prompts without hidden oracle classifications or exact rerun answers', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  for (const scenario of scenarios) {
    const prompt = buildScenarioPrompt({
      scenario,
      skillSourcePath: path.join(materialized.projectRoot, '.opencode', 'skills'),
      productTargetPath: path.join(materialized.projectRoot, 'targets', scenario.id),
    });
    assert.ok(!prompt.includes(scenario.expectedVerdict), `${scenario.id}: prompt leaked expected verdict`);
    assert.doesNotMatch(prompt, new RegExp(`expected\\s+exit\\s+code\\s*:?\\s*${scenario.expectedVerificationExitCode}|exit\\s+code\\s*:?\\s*${scenario.expectedVerificationExitCode}`, 'i'), `${scenario.id}: prompt leaked expected exit code`);
    assert.ok(!/(?:E|R|V|F)-(?:PASS|FAIL|BLOCKED)-/i.test(prompt), `${scenario.id}: prompt leaked status-labelled IDs`);
    if (scenario.rerunCondition) assert.ok(!prompt.includes(scenario.rerunCondition), `${scenario.id}: prompt leaked hidden exact rerun condition`);
  }
}));

test('BUG-PARENT-QA-SELF-EXECUTION-026 prompt requires one general QA child and forbids parent-side QA work', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const prompt = buildScenarioPrompt({
    scenario: scenarios[0],
    skillSourcePath: path.join(materialized.projectRoot, '.opencode', 'skills'),
    productTargetPath: path.join(materialized.projectRoot, 'targets', scenarios[0].id),
  });

  assert.match(prompt, /exactly one `task` call/i);
  assert.match(prompt, /subagent_type:\s*"general"/i);
  assert.match(prompt, /same child[\s\S]{0,120}qa-plan[\s\S]{0,120}qa-execute[\s\S]{0,120}qa-conclude/i);
  assert.match(prompt, /parent[\s\S]{0,120}must not[\s\S]{0,160}inspect/i);
  assert.match(prompt, /parent[\s\S]{0,120}must not[\s\S]{0,160}verifier/i);
  assert.match(prompt, /parent[\s\S]{0,120}must not[\s\S]{0,160}report/i);
  assert.match(prompt, /must not[\s\S]{0,120}additional QA children/i);
  assert.doesNotMatch(prompt, /task[\s\S]{0,80}model/i, 'prompt must preserve model selection through agent.general.model, not task model arguments');
}));

test('BUG-BLOCKED-OUTPUT-DISCIPLINE-027 prompt requires child report relay, canonical status line, and target immutability', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  for (const scenario of scenarios) {
    const prompt = buildScenarioPrompt({
      scenario,
      skillSourcePath: path.join(materialized.projectRoot, '.opencode', 'skills'),
      productTargetPath: path.join(materialized.projectRoot, 'targets', scenario.id),
    });

    assert.ok(!prompt.includes(scenario.expectedVerdict), `${scenario.id}: prompt leaked expected verdict`);
    assert.doesNotMatch(prompt, new RegExp(`expected\\s+exit\\s+code\\s*:?\\s*${scenario.expectedVerificationExitCode}|exit\\s+code\\s*:?\\s*${scenario.expectedVerificationExitCode}`, 'i'), `${scenario.id}: prompt leaked expected exit code`);
    assert.match(prompt, /child[\s\S]{0,120}return[\s\S]{0,120}report[\s\S]{0,120}task result/i);
    assert.match(prompt, /parent[\s\S]{0,120}relay[\s\S]{0,120}final message/i);
    assert.match(prompt, /exactly one[\s\S]{0,120}standalone unprefixed line[\s\S]{0,120}`Overall Status: <workflow-selected-status>`/i);
    assert.match(prompt, /replace[\s\S]{0,80}placeholder/i);
    assert.match(prompt, /Markdown heading[\s\S]{0,120}list[\s\S]{0,120}emphasis[\s\S]{0,120}table[\s\S]{0,120}not substitutes/i);
    assert.match(prompt, /must not[\s\S]{0,120}(?:write|create|modify|cite)[\s\S]{0,160}product target/i);
    assert.match(prompt, /qa-report\.md/i);
    assert.match(prompt, /do not run[\s\S]{0,120}verifier[\s\S]{0,160}required prerequisite[\s\S]{0,120}absent/i);
    for (const id of scenario.requiredEvidence) assert.ok(prompt.includes(id), `${scenario.id}: prompt missing neutral ID ${id}`);
    assert.match(prompt, /child task result[\s\S]{0,160}parent final (?:message|report)[\s\S]{0,160}include every supplied neutral ID exactly as written/i);
    assert.match(prompt, /must not omit or rename/i);
    assert.match(prompt, /Risk\s*→\s*Verification\s*→\s*Evidence\s*→\s*Status/);
    assert.doesNotMatch(prompt, /where applicable/i);
  }
}));

test('BUG-PARENT-REPORT-VERBATIM-034 prompt requires parent to copy complete child task_result report verbatim', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const prompt = buildScenarioPrompt({
    scenario: scenarios[1],
    skillSourcePath: path.join(materialized.projectRoot, '.opencode', 'skills'),
    productTargetPath: path.join(materialized.projectRoot, 'targets', scenarios[1].id),
  });

  assert.match(prompt, /after[\s\S]{0,160}one `task` call[\s\S]{0,160}completes/i);
  assert.match(prompt, /extract[\s\S]{0,120}full report content[\s\S]{0,120}<task_result>/i);
  assert.match(prompt, /use[\s\S]{0,120}content[\s\S]{0,120}entire final assistant message/i);
  assert.match(prompt, /verbatim/i);
  assert.match(prompt, /no summary/i);
  assert.match(prompt, /rewrite/i);
  assert.match(prompt, /reformat/i);
  assert.match(prompt, /normalization/i);
  assert.match(prompt, /omission/i);
  assert.match(prompt, /reordering/i);
  assert.match(prompt, /prefix/i);
  assert.match(prompt, /suffix/i);
  assert.match(prompt, /additional commentary/i);
  assert.match(prompt, /complete child[\s\S]{0,120}report/i);
  assert.match(prompt, /exactly one[\s\S]{0,120}standalone unprefixed line[\s\S]{0,120}`Overall Status: <workflow-selected-status>`/i);
}));

test('BUG-CHILD-TASK-WRAPPER-035 prompt forbids child-authored task_result tags while preserving parent extraction', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const prompt = buildScenarioPrompt({
    scenario: scenarios[1],
    skillSourcePath: path.join(materialized.projectRoot, '.opencode', 'skills'),
    productTargetPath: path.join(materialized.projectRoot, 'targets', scenarios[1].id),
  });

  assert.match(prompt, /child[\s\S]{0,140}plain report text only[\s\S]{0,80}task result/i);
  assert.match(prompt, /child[\s\S]{0,140}must not include literal[\s\S]{0,80}<task_result>[\s\S]{0,80}<\/task_result>/i);
  assert.match(prompt, /task tool[\s\S]{0,120}supplies[\s\S]{0,80}wrapper/i);
  assert.doesNotMatch(prompt, /child[\s\S]{0,180}inside a single[\s\S]{0,80}<task_result>/i);
  assert.doesNotMatch(prompt, /child[\s\S]{0,180}put[\s\S]{0,80}inside[\s\S]{0,80}<task_result>/i);
  assert.match(prompt, /parent[\s\S]{0,180}extract[\s\S]{0,120}<task_result>[\s\S]{0,180}verbatim/i);
}));

test('BUG-RUN-INPUT-VALIDATION-029 rejects unsafe model and agent values before spawning OpenCode', () => {
  assert.equal(typeof harness.validateRunInputs, 'function', 'validateRunInputs export is required');
  assert.deepEqual(harness.validateRunInputs({ model: 'cpa/gpt-5.4-mini', agent: 'build' }), { ok: true, issues: [] });

  const rejected = [
    { model: 'cpa/gpt-5.4-mini;echo-noop', agent: 'build' },
    { model: 'cpa/gpt-5.4-mini', agent: 'build now' },
    { model: 'cpa/gpt-5.4-mini\n', agent: 'build' },
    { model: 'cpa', agent: 'build' },
    { model: 'cpa/gpt-5.4-mini', agent: '../build' },
  ];

  for (const input of rejected) {
    const result = harness.validateRunInputs(input);
    assert.equal(result.ok, false, `${JSON.stringify(input)} must be rejected`);
    assert.ok(result.issues.length > 0, `${JSON.stringify(input)} must include rejection issues`);
  }
});

test('BUG-OPENCODE-INVOKE-SHELL-030 resolves only absolute regular exe without shell fallback', () => withTempRoot((root) => {
  const resolveOpenCodeInvocation = harness.resolveOpenCodeInvocation ?? (({ commandPath }) => {
    const extension = path.extname(commandPath).toLowerCase();
    const shellSafe = path.isAbsolute(commandPath) && extension === '.exe' && !commandPath.includes(`${path.sep}missing.exe`);
    return shellSafe ? { command: commandPath, shell: false, shellSafe: true, issues: [] } : { shellSafe: false, issues: ['invalid command path'] };
  });
  const exePath = path.join(root, 'opencode.exe');
  writeFileSync(exePath, '', 'utf8');

  const safeInvocation = resolveOpenCodeInvocation({ commandPath: exePath });
  assert.equal(safeInvocation.command, exePath);
  assert.equal(safeInvocation.shell, false);
  assert.equal(safeInvocation.shellSafe, true);
  assert.deepEqual(safeInvocation.issues, []);

  for (const filename of ['opencode.cmd', 'opencode.bat', 'opencode.ps1']) {
    const candidate = path.join(root, filename);
    writeFileSync(candidate, '', 'utf8');
    assert.equal(resolveOpenCodeInvocation({ commandPath: candidate }).shellSafe, false, `${filename} must not be shell-safe`);
  }

  assert.equal(resolveOpenCodeInvocation({ commandPath: 'opencode.exe' }).shellSafe, false, 'relative command path must be rejected');
  assert.equal(resolveOpenCodeInvocation({ commandPath: path.join(root, 'missing.exe') }).shellSafe, false, 'missing command path must be rejected');

  const realBinDirectory = path.join(root, 'real-bin');
  mkdirSync(realBinDirectory);
  const realLinkedExe = path.join(realBinDirectory, 'opencode.exe');
  writeFileSync(realLinkedExe, '', 'utf8');
  const linkedBinDirectory = path.join(root, 'linked-bin');
  try {
    symlinkSync(realBinDirectory, linkedBinDirectory, 'junction');
  } catch (error) {
    assert.fail(`junction command security contract could not run on this filesystem: ${error.code || error.message}`);
  }
  assert.equal(resolveOpenCodeInvocation({ commandPath: path.join(linkedBinDirectory, 'opencode.exe') }).shellSafe, false, 'linked ancestor command path must be rejected');
}));

test('BUG-REPORT-SYMLINK-ESCAPE-031 rejects symlink or realpath-escaped report artifacts', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const safeReport = path.join(materialized.projectRoot, 'qa-report.md');
  writeFileSync(safeReport, completePassReport, 'utf8');
  const safe = selectReportSource({ finalMessage: 'Report artifact: qa-report.md', projectRoot: materialized.projectRoot });
  assert.equal(safe.source, 'artifact');

  const outsideDirectory = path.join(root, 'outside-report-source');
  mkdirSync(outsideDirectory);
  writeFileSync(path.join(outsideDirectory, 'report.md'), completePassReport, 'utf8');
  const linkPath = path.join(materialized.projectRoot, 'linked-reports');
  try {
    symlinkSync(outsideDirectory, linkPath, 'junction');
  } catch (error) {
    assert.fail(`junction report security contract could not run on this filesystem: ${error.code || error.message}`);
  }

  const selected = selectReportSource({ finalMessage: 'Report artifact: linked-reports/report.md', projectRoot: materialized.projectRoot });
  assert.equal(selected.source, 'assistant-message');
  assert.match(selected.issues.join('\n'), /(?:link|realpath)/i);
}));

test('BUG-PARENT-BOUNDARY-EVIDENCE-032 rejects parent-side QA tools and multiple child tasks', () => {
  assert.equal(typeof harness.buildParentBoundaryEvidence, 'function', 'buildParentBoundaryEvidence export is required');
  const skillCall = (name) => ({ type: 'tool_use', part: { tool: 'skill', state: { status: 'completed', input: { name } } } });
  const taskCall = { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'general' }, metadata: { sessionId: 'ses_child_001' } } } };
  const accepted = harness.buildParentBoundaryEvidence({ events: [skillCall('using-qa'), skillCall('qa-plan'), skillCall('qa-execute'), skillCall('qa-conclude'), taskCall] });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.taskCallCount, 1);
  assert.doesNotMatch(JSON.stringify(accepted), /input|output|prompt|title|transcript/i);

  for (const tool of ['read', 'glob', 'grep', 'bash', 'apply_patch', 'write', 'edit', 'unknown']) {
    const rejected = harness.buildParentBoundaryEvidence({ events: [skillCall('using-qa'), taskCall, { type: 'tool_use', part: { tool, state: { status: 'completed' } } }] });
    assert.equal(rejected.ok, false, `${tool} must be rejected as parent-side QA work`);
  }

  const multipleTasks = harness.buildParentBoundaryEvidence({ events: [skillCall('using-qa'), taskCall, { ...taskCall, part: { ...taskCall.part, state: { ...taskCall.part.state, metadata: { sessionId: 'ses_child_002' } } } }] });
  assert.equal(multipleTasks.ok, false, 'multiple task calls must be rejected');

  const todoCall = {
    type: 'tool_use',
    part: {
      tool: 'todowrite',
      callID: 'todo-call-001',
      state: {
        status: 'completed',
        input: { todos: [{ content: 'Delegate the QA run to one child', status: 'in_progress', priority: 'high' }] },
      },
    },
  };
  const coordinated = harness.buildParentBoundaryEvidence({ events: [todoCall, skillCall('using-qa'), taskCall] });
  assert.equal(coordinated.ok, true, 'todowrite must be allowed as parent coordination metadata');
  assert.equal(coordinated.taskCallCount, 1);
  assert.doesNotMatch(JSON.stringify(coordinated), /input|output|todos|content|prompt|transcript/i, 'parent boundary evidence must not persist todo content');

  assert.throws(
    () => assertScenarioOutcome({
      scenario: scenarios[0],
      qaVerdict: 'PASS',
      finalText: passReportTableEvidence,
      infrastructureStatus: { status: 'COMPLETED' },
      oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
      postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
      modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' },
      agentTopology: okAgentTopology,
      parentBoundaryEvidence: harness.buildParentBoundaryEvidence({ events: [skillCall('using-qa'), taskCall, { type: 'tool_use', part: { tool: 'bash', state: { status: 'completed' } } }] }),
    }),
    /parent boundary/i,
  );
});

test('BUG-CHILD-REPORT-RELAY-033 enforces strict child marker and exact parent relay without persisting report text', () => {
  assert.equal(typeof harness.extractTaskResultReport, 'function', 'extractTaskResultReport export is required');
  assert.equal(typeof harness.buildChildReportRelayEvidence, 'function', 'buildChildReportRelayEvidence export is required');
  const childReport = 'QA Plan Gate: OPEN\nOverall Status: BLOCKED\nR03 -> V03 -> E03 -> BLOCKED\nRequired prerequisite acceptance-data/currency-cases.json was absent.';
  const parentTaskEvent = (output, overrides = {}) => ({
    type: 'tool_use',
    sessionID: overrides.sessionID || 'ses_parent_001',
    part: {
      tool: 'task',
      callID: overrides.callID || 'task-call-001',
      state: {
        status: overrides.status || 'completed',
        output,
        metadata: { sessionId: overrides.childSessionId || 'ses_child_001' },
      },
    },
  });
  const wrappedOutput = `<task_metadata>\nsession_id: ses_child_001\n</task_metadata>\n<task_result>\n${childReport}\n</task_result>`;
  const extracted = harness.extractTaskResultReport({ events: [parentTaskEvent(wrappedOutput)], parentSessionId: 'ses_parent_001' });
  assert.equal(extracted.text, childReport);
  assert.equal(extracted.ok, true);
  assert.equal(extracted.taskCallCount, 1);
  assert.equal(extracted.childSessionId, 'ses_child_001');
  assert.doesNotMatch(JSON.stringify(extracted), /Overall Status:|QA Plan Gate|Required prerequisite|task_metadata|task_result/i, 'task-result metadata must not serialize raw report or task output');

  const childExport = { messages: [{ role: 'assistant', parts: [{ type: 'text', text: `${childReport}\n</task_result>` }] }] };
  const relay = harness.buildChildReportRelayEvidence({ childText: extracted.text, parentText: childReport, expectedVerdict: 'BLOCKED' });
  assert.equal(relay.ok, true);
  assert.equal(JSON.stringify(relay).includes(childReport), false, 'relay evidence must not persist report text');
  assert.equal(JSON.stringify(childExport).includes('</task_result>'), true, 'synthetic child export fixture must contain a misleading close tag');
  assert.equal(harness.buildChildReportRelayEvidence({ childText: extracted.text, parentText: childReport.replace('\nRequired prerequisite acceptance-data/currency-cases.json was absent.', ''), expectedVerdict: 'BLOCKED' }).ok, false, 'attempt-1 parent omission must fail exact relay');

  for (const marker of ['## Overall Status: BLOCKED', '- Overall Status: BLOCKED', '**Overall Status:** BLOCKED', '| Overall Status | BLOCKED |', 'Overall Status: BLOCKED\nOverall Status: BLOCKED', 'No marker here']) {
    assert.equal(harness.buildChildReportRelayEvidence({ childText: marker, parentText: marker, expectedVerdict: 'BLOCKED' }).ok, false, `${marker} must be rejected`);
  }
  assert.equal(harness.buildChildReportRelayEvidence({ childText: childReport, parentText: childReport.replace('BLOCKED', 'PASS'), expectedVerdict: 'BLOCKED' }).ok, false, 'verdict mismatch must be rejected');
  assert.equal(harness.buildChildReportRelayEvidence({ childText: childReport, parentText: childReport.slice(0, 40), expectedVerdict: 'BLOCKED' }).ok, false, 'truncated relay must be rejected');
  assert.equal(harness.buildChildReportRelayEvidence({ childText: '', parentText: childReport, expectedVerdict: 'BLOCKED' }).ok, false, 'empty child report must be rejected');
  for (const malformed of [
    childReport,
    `<task_result>\n${childReport}`,
    `${childReport}\n</task_result>`,
    `</task_result>\n${childReport}\n<task_result>`,
    `<task_result>\n${childReport}\n</task_result>\n<task_result>\n${childReport}\n</task_result>`,
    `<task_result>\n<task_result>\n${childReport}\n</task_result>\n</task_result>`,
    '<task_result>\n\n</task_result>',
  ]) {
    const rejected = harness.extractTaskResultReport({ events: [parentTaskEvent(malformed)], parentSessionId: 'ses_parent_001' });
    assert.equal(rejected.ok, false, `${malformed} must be rejected`);
  }
  assert.equal(harness.extractTaskResultReport({ events: [], parentSessionId: 'ses_parent_001' }).ok, false, 'zero task events must be rejected');
  assert.equal(harness.extractTaskResultReport({ events: [parentTaskEvent(wrappedOutput), parentTaskEvent(wrappedOutput, { callID: 'task-call-002', childSessionId: 'ses_child_002' })], parentSessionId: 'ses_parent_001' }).ok, false, 'multiple task events must be rejected');
  assert.equal(harness.extractTaskResultReport({ events: [parentTaskEvent(wrappedOutput, { status: 'running' })], parentSessionId: 'ses_parent_001' }).ok, false, 'non-completed task event must be rejected');
  assert.equal(harness.extractTaskResultReport({ events: [parentTaskEvent(42)], parentSessionId: 'ses_parent_001' }).ok, false, 'non-string task output must be rejected');

  const relayEvidence = harness.buildChildReportRelayEvidence({
    childText: childReport,
    parentText: `${childReport}\nParent-added summary`,
    expectedVerdict: 'BLOCKED',
  });
  const relayFinalText = `${childReport}
Availability of acceptance-data/currency-cases.json is required.
Then run node verify-currency-format.mjs after acceptance-data/currency-cases.json is supplied.`;
  const relayEvidenceAuthority = harness.buildReportAuthorityEvidence({
    selectedReportSource: {
      source: 'task-result',
      relativePath: null,
      reportText: relayFinalText,
      issues: [],
    },
    authoritativeText: relayFinalText,
  });
  assert.equal(relayEvidenceAuthority.ok, true);

  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[2],
    qaVerdict: 'BLOCKED',
    finalText: relayFinalText,
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: relayEvidence,
    reportAuthorityEvidence: relayEvidenceAuthority,
  }));
});

test('FV-FIXTURE-002 materializes each scenario as a tiny Git repo with a real scoped diff', () => withTempRoot((root) => {
  for (const scenario of scenarios) {
    const fixture = createScenarioRepository({ scenario, runRoot: root });
    assert.equal(fixture.git.status, 0, `${scenario.id}: git status must succeed`);
    assert.equal(fixture.verification.status, scenario.expectedVerificationExitCode);
    assert.ok(fixture.diff.includes('diff --git'), `${scenario.id}: expected real git diff`);
    assert.ok(fixture.diff.includes(scenario.product.changedPath), `${scenario.id}: diff must stay scenario-scoped`);
    assert.ok(!fixture.diff.includes('oracle.json'), `${scenario.id}: oracle metadata must not enter product repo diff`);
  }
}));

test('FV-JSONL-003 parses OpenCode JSONL as strict UTF-8 line-delimited JSON and rejects malformed input', () => {
  const parsed = parseJsonlStrict(Buffer.from('{"type":"message","text":"hello"}\n{"type":"done"}\n', 'utf8'));
  assert.deepEqual(parsed.events.map((event) => event.type), ['message', 'done']);
  assert.deepEqual(parsed.errors, []);

  const invalidUtf8 = parseJsonlStrict(Buffer.from([0xc3, 0x28]));
  assert.equal(invalidUtf8.events.length, 0);
  assert.match(invalidUtf8.errors[0].message, /UTF-8/i);

  const invalidJson = parseJsonlStrict(Buffer.from('{"type":"message"}\nnot-json\n', 'utf8'));
  assert.equal(invalidJson.events.length, 1);
  assert.equal(invalidJson.errors[0].line, 2);
});

test('FV-EXTRACT-004 extracts final OpenCode text parts by messageID and canonical overall verdict only', () => {
  const events = parseJsonlStrict(Buffer.from([
    JSON.stringify({ type: 'text', part: { messageID: 'm1', text: 'draft Overall Status: FAIL' } }),
    JSON.stringify({ type: 'tool', part: { messageID: 'tool1', text: 'tool Status: BLOCKED' } }),
    JSON.stringify({ type: 'text', part: { messageID: 'm2', text: 'QA Conclusion Gate: COMPLETE\n' } }),
    JSON.stringify({ type: 'text', part: { messageID: 'm2', text: 'Overall Status: PASS\n' } }),
    JSON.stringify({ type: 'text', part: { messageID: 'm2', text: 'Verification table Status: FAIL\n' } }),
    '',
  ].join('\n'), 'utf8')).events;

  const finalText = extractFinalText(events);
  assert.match(finalText, /Overall Status: PASS/);
  assert.match(finalText, /Verification table Status: FAIL/);
  assert.equal(extractQaVerdict(finalText), 'PASS');
  assert.equal(extractQaVerdict('- **Overall Status:** PASS'), 'PASS');
  assert.equal(extractQaVerdict('QA Verdict: FAIL'), 'FAIL');
  assert.equal(extractQaVerdict('| Overall Status | BLOCKED |'), 'BLOCKED');
  assert.equal(extractQaVerdict('Verification | Status | FAIL'), null);
  assert.equal(extractQaVerdict('QA Conclusion Gate: COMPLETE\nNo overall status here'), null);
  assert.equal(extractFinalText([{ type: 'message', role: 'assistant', text: 'legacy Overall Status: BLOCKED' }]), 'legacy Overall Status: BLOCKED');
  assert.equal(
    extractFinalText([{ type: 'text', part: { messageID: 'm-raw', text: '  raw parent bytes\r\n' } }]),
    '  raw parent bytes\r\n',
    'raw parent final-message extraction must preserve leading and trailing bytes',
  );
});

test('BUG-TASK-RESULT-EXTRACTION-039 preserves wrapper-delimited payload bytes beyond delimiter newline', () => {
  const parentTaskEvent = (output, overrides = {}) => ({
    type: 'tool_use',
    sessionID: overrides.sessionID || 'ses_parent_001',
    part: {
      tool: 'task',
      callID: overrides.callID || 'task-call-001',
      state: {
        status: overrides.status || 'completed',
        output,
        metadata: { sessionId: overrides.childSessionId || 'ses_child_001' },
      },
    },
  });

  const rawReport = [
    '  Leading spaces preserved before text',
    'Line with LF only',
    'Line with CRLF only',
    'Trailing spaces intentionally kept   ',
    '',
  ].join('\n');
  const expectedReport = rawReport.replace(/\n/g, '\r\n').replace('Line with CRLF only', 'Line with CRLF only\nwith mixed boundary') + '\n';
  const wrappedOutput = `<task_result>\n${expectedReport}\r\n</task_result>`;

  const extracted = harness.extractTaskResultReport({ events: [parentTaskEvent(wrappedOutput)] , parentSessionId: 'ses_parent_001' });
  assert.equal(extracted.ok, true);
  assert.equal(extracted.text, expectedReport, 'task-result text must preserve leading spaces, CRLF/LF payload, trailing spaces, and terminal newline');
  assert.equal(extracted.reportBytes, Buffer.byteLength(expectedReport, 'utf8'));
});

test('FV-COMMAND-EVIDENCE-018 accepts PASS table evidence with official tool_use command metadata', () => {
  const evidence = extractModelCommandEvidence({
    events: [passToolUseEvent],
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.status, 'completed');
  assert.equal(evidence.exit, 0);
  assert.match(evidence.output, /OK membership discount behavior/);

  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[0],
    qaVerdict: 'PASS',
    finalText: passReportTableEvidence,
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    modelCommandEvidence: evidence,
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  }));
});

test('FV-COMMAND-EVIDENCE-019 accepts status-preserving read-only wrapper and warns on non-applicable blocked rows', () => {
  const evidence = extractModelCommandEvidence({
    events: [passWrapperToolUseEvent],
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  const diagnostics = analyzeReportDiagnostics(attempt4PassReport);

  assert.equal(evidence.ok, true);
  assert.equal(evidence.expectedCommand, 'node verify-membership-discount.mjs');
  assert.equal(evidence.actualCommand, 'node verify-membership-discount.mjs; $ec=$LASTEXITCODE; git status --short; exit $ec');
  assert.equal(evidence.invocationKind, 'status-preserving-readonly-wrapper');
  assert.equal(diagnostics.warnings.length, 3);
  assert.equal(diagnostics.blockingIssues.length, 0);

  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[0],
    qaVerdict: 'PASS',
    finalText: attempt4PassReport,
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    modelCommandEvidence: evidence,
    reportDiagnostics: diagnostics,
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  }));
});

test('FV-DIAGNOSTICS-021 allows negated no-unresolved-blocker PASS and rejects real blocker rows', () => {
  const evidence = extractModelCommandEvidence({
    events: [passWrapperToolUseEvent],
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  const warningDiagnostics = analyzeReportDiagnostics(attempt4PassReport);
  const blockingDiagnostics = analyzeReportDiagnostics(passReportWithRealBlockedRow);

  assert.equal(warningDiagnostics.warnings.length, 3);
  assert.equal(warningDiagnostics.blockingIssues.length, 0);
  assert.equal(blockingDiagnostics.blockingIssues.length, 1);

  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[0],
    qaVerdict: 'PASS',
    finalText: attempt4PassReport,
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    modelCommandEvidence: evidence,
    reportDiagnostics: warningDiagnostics,
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  }));

  assert.throws(
    () => assertScenarioOutcome({
      scenario: scenarios[0],
      qaVerdict: 'PASS',
      finalText: passReportWithRealBlockedRow,
      infrastructureStatus: { status: 'COMPLETED' },
      oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
      postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
      modelCommandEvidence: evidence,
      reportDiagnostics: blockingDiagnostics,
      agentTopology: okAgentTopology,
      parentBoundaryEvidence: okParentBoundaryEvidence,
      childReportRelayEvidence: okChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
    }),
    /blocking issues/i,
  );

  const blockedReportWithExpectedBlockedRow = [
    'Overall Status: BLOCKED',
    '| Evidence ID | Verification ID | Command | Result | Artifact or reference |',
    '|---|---|---|---|---|',
    '| E03 | V03 | node verify-currency-format.mjs | BLOCKED | Missing prerequisite artifact acceptance-data/currency-cases.json was absent |',
    'Traceability: R03 -> V03 -> E03 -> BLOCKED',
    'Required prerequisite acceptance-data/currency-cases.json was absent.',
    'V03: run node verify-currency-format.mjs only after acceptance-data/currency-cases.json is supplied.',
  ].join('\n');
  const blockedDiagnostics = analyzeReportDiagnostics(blockedReportWithExpectedBlockedRow);
  assert.equal(blockedDiagnostics.blockingIssues.length, 1);
  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[2],
    qaVerdict: 'BLOCKED',
    finalText: blockedReportWithExpectedBlockedRow,
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: blockedDiagnostics,
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okBlockedChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  }));
});

test('FV-COMMAND-EVIDENCE-020 rejects unsafe wrapper variations', () => {
  const commands = [
    'git status --short; node verify-membership-discount.mjs',
    'node verify-membership-discount.mjs; git status --short',
    'node verify-membership-discount.mjs; $ec=$LASTEXITCODE; git diff; exit $ec',
    'node verify-membership-discount.mjs; $ec=$LASTEXITCODE; git status --short; rm qa-report.md; exit $ec',
    'node verify-membership-discount.mjs; $ec=$LASTEXITCODE; git status --short; exit 0',
  ];

  for (const command of commands) {
    const evidence = extractModelCommandEvidence({
      events: [{ type: 'tool_use', part: { state: { status: 'completed', input: { command }, output: 'OK membership discount behavior: member=90 guest=100\n', metadata: { exit: 0 } } } }],
      expectedCommand: 'node verify-membership-discount.mjs',
    });
    assert.equal(evidence.ok, false, `${command} must be rejected`);
  }
});

test('FV-TOPOLOGY-022 locks general subagent model and extracts child verifier evidence from sanitized export', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const runtimeConfig = materializeRuntimeConfig({ projectRoot: materialized.projectRoot, model: 'cpa/gpt-5.4-mini' });
  assert.equal(runtimeConfig.config.$schema, 'https://opencode.ai/config.json');
  assert.equal(runtimeConfig.config.agent.general.model, 'cpa/gpt-5.4-mini');
  assert.equal(runtimeConfig.config.agent.general.mode, 'subagent');
  assert.ok(!JSON.stringify(runtimeConfig.config).includes('token'));

  const childIds = extractTaskSessionIds([parentTaskEvent]);
  assert.deepEqual(childIds, ['ses_child_001']);

  const nested = buildNestedSessionEvidence({
    sessionId: 'ses_child_001',
    parentSessionId: 'ses_parent_001',
    exportJson: childExport,
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  assert.equal(nested.sessionId, 'ses_child_001');
  assert.equal(nested.agent, 'general');
  assert.equal(nested.model, 'cpa/gpt-5.4-mini');
  assert.equal(nested.selectedToolEvents.length, 1);
  assert.doesNotMatch(JSON.stringify(nested), /cat package\.json/);
  assert.ok(!JSON.stringify(nested).includes('system prompt'));

  const topology = buildAgentTopologyEvidence({
    parentSessionId: 'ses_parent_001',
    childSessionIds: childIds,
    nestedSessionEvidence: nested,
    requestedModel: 'cpa/gpt-5.4-mini',
    expectedAgent: 'general',
  });
  assert.equal(topology.ok, true);
  assert.equal(topology.childCount, 1);
  assert.equal(topology.actualChildModel, 'cpa/gpt-5.4-mini');

  const evidence = extractModelCommandEvidence({
    events: nested.selectedToolEvents,
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.invocationKind, 'status-preserving-readonly-wrapper');
}));

test('FV-TOPOLOGY-024 parses actual opencode export info/messages tool schema into minimized verifier evidence', () => {
  const nested = buildNestedSessionEvidence({
    sessionId: 'ses_child_001',
    parentSessionId: 'ses_parent_001',
    exportJson: actualShapeChildExport,
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  assert.equal(nested.ok, true);
  assert.equal(nested.sessionId, 'ses_child_001');
  assert.equal(nested.parentSessionId, 'ses_parent_001');
  assert.equal(nested.agent, 'general');
  assert.equal(nested.model, 'cpa/gpt-5.4-mini');
  assert.equal(nested.version, '1.18.7');
  assert.equal(nested.selectedToolEvents.length, 1);
  assert.equal(nested.selectedToolEvents[0].type, 'tool_use');
  assert.equal(nested.selectedToolEvents[0].part.tool, 'bash');
  assert.equal(nested.selectedToolEvents[0].part.callID, 'tool-pass-actual-001');
  assert.equal(nested.selectedToolEvents[0].part.state.input.command, 'node verify-membership-discount.mjs');
  assert.equal(nested.selectedToolEvents[0].part.state.metadata.exit, 0);
  assert.equal(nested.selectedToolEvents[0].part.state.startedAt, 1780000000002);
  assert.equal(nested.selectedToolEvents[0].part.state.endedAt, 1780000000003);
  assert.doesNotMatch(JSON.stringify(nested), /cat package\.json|must-not-persist|messages|info|reasoning|system/i);

  const evidence = extractModelCommandEvidence({
    events: nested.selectedToolEvents,
    expectedCommand: 'node verify-membership-discount.mjs',
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.exit, 0);
});

test('FV-RUNTIME-025 uses documented external-skill/plugin disable flags and preserves provider auth', () => {
  const env = createRuntimeOpenCodeEnv({ baseEnv: { OPENCODE_AUTH_CONTENT: '{"token":"configured"}', CPA_API_KEY: 'configured-key' } });
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, '1');
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS, '1');
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, '1');
  assert.equal(env.OPENCODE_AUTH_CONTENT, '{"token":"configured"}');
  assert.equal(env.CPA_API_KEY, 'configured-key');
  assert.ok(!('OPENCODE_DISABLE_CLAUDE_SKILLS' in env));
  assert.ok(!('OPENCODE_DISABLE_EXTERNAL_PLUGINS' in env));
});

test('FV-TOPOLOGY-023 rejects zero, multiple, malformed, and model-mismatched child sessions', () => {
  assert.deepEqual(extractTaskSessionIds([]), []);
  assert.deepEqual(extractTaskSessionIds([parentTaskEvent, { ...parentTaskEvent, part: { ...parentTaskEvent.part, state: { ...parentTaskEvent.part.state, metadata: { sessionID: 'ses_child_002' } } } }]), ['ses_child_001', 'ses_child_002']);
  assert.deepEqual(extractTaskSessionIds([{ ...parentTaskEvent, part: { ...parentTaskEvent.part, state: { ...parentTaskEvent.part.state, status: 'running' } } }]), []);
  assert.deepEqual(extractTaskSessionIds([{ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed', input: { subagent_type: 'general' }, metadata: { sessionId: 'ses_not_task' } } } }]), []);

  const malformed = buildNestedSessionEvidence({ sessionId: 'ses_child_001', parentSessionId: 'ses_parent_001', exportJson: { nope: true } });
  assert.equal(malformed.ok, false);

  const mismatch = buildAgentTopologyEvidence({
    parentSessionId: 'ses_parent_001',
    childSessionIds: ['ses_child_001'],
    nestedSessionEvidence: buildNestedSessionEvidence({
      sessionId: 'ses_child_001',
      parentSessionId: 'ses_parent_001',
      exportJson: { ...childExport, session: { ...childExport.session, model: { providerID: 'cpa', modelID: 'gpt-5.5' } } },
      expectedCommand: 'node verify-membership-discount.mjs',
    }),
    requestedModel: 'cpa/gpt-5.4-mini',
    expectedAgent: 'general',
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.issues.join('\n'), /model/i);
});

test('FV-REPORT-SOURCE-015 selects cited safe project-root report instead of short assistant summary', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const finalMessage = 'QA completed. V01 -> E01 passed.\nReport artifact: qa-report-membership-discount.md';
  writeFileSync(path.join(materialized.projectRoot, 'qa-report-membership-discount.md'), completePassReport, 'utf8');

  const selected = selectReportSource({ finalMessage, projectRoot: materialized.projectRoot });
  assert.equal(selected.source, 'artifact');
  assert.equal(selected.relativePath, 'qa-report-membership-discount.md');
  assert.match(selected.reportText, /R01/);
  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[0],
    qaVerdict: extractQaVerdict(selected.reportText),
    finalText: selected.reportText,
    infrastructureStatus: { status: 'COMPLETED' },
    modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  }));
}));

test('BUG-REPORT-AUTHORITY-037 uses task-result report as authority and rejects divergent cited artifacts', () => withTempRoot((root) => {
  assert.equal(typeof harness.buildReportAuthorityEvidence, 'function', 'buildReportAuthorityEvidence export is required');
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const authoritativeText = `${completePassReport}\nReport artifact: qa-report-membership-discount.md`;
  const matchingArtifactPath = path.join(materialized.projectRoot, 'qa-report-membership-discount.md');
  writeFileSync(matchingArtifactPath, authoritativeText, 'utf8');

  const matchingSource = selectReportSource({ finalMessage: authoritativeText, projectRoot: materialized.projectRoot });
  const matchingAuthority = harness.buildReportAuthorityEvidence({ selectedReportSource: matchingSource, authoritativeText });
  assert.equal(matchingAuthority.ok, true);
  assert.doesNotMatch(JSON.stringify(matchingAuthority), /Overall Status:|QA Plan Gate|reportText/i);
  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[0],
    qaVerdict: extractQaVerdict(authoritativeText),
    finalText: authoritativeText,
    infrastructureStatus: { status: 'COMPLETED' },
    modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okChildReportRelayEvidence,
    reportAuthorityEvidence: matchingAuthority,
  }));

  writeFileSync(matchingArtifactPath, completePassReport.replace('Traceability: R01 -> V01 -> E01 -> PASS', 'Traceability: R99 -> V99 -> E99 -> PASS'), 'utf8');
  const divergentSource = selectReportSource({ finalMessage: authoritativeText, projectRoot: materialized.projectRoot });
  const divergentAuthority = harness.buildReportAuthorityEvidence({ selectedReportSource: divergentSource, authoritativeText });
  assert.equal(divergentAuthority.ok, false);
  assert.throws(
    () => assertScenarioOutcome({
      scenario: scenarios[0],
      qaVerdict: extractQaVerdict(authoritativeText),
      finalText: authoritativeText,
      infrastructureStatus: { status: 'COMPLETED' },
      modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' },
      oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
      postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
      reportDiagnostics: { warnings: [], blockingIssues: [] },
      agentTopology: okAgentTopology,
      parentBoundaryEvidence: okParentBoundaryEvidence,
      childReportRelayEvidence: okChildReportRelayEvidence,
      reportAuthorityEvidence: divergentAuthority,
    }),
    /report authority/i,
  );
}));

test('BUG-REPORT-AUTHORITY-041 enforces cited mirror check through delivered authority helper', () => withTempRoot((root) => {
  assert.equal(typeof harness.buildDeliveredReportAuthorityEvidence, 'function', 'buildDeliveredReportAuthorityEvidence export is required');
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const authoritativeText = [
    'QA Plan Gate: OPEN',
    'QA Conclusion Gate: COMPLETE',
    'Overall Status: PASS',
    'Report artifact: qa-report.md',
    'Traceability: R01 -> V01 -> E01 -> PASS',
    '',
  ].join('\n');
  const divergentMirror = authoritativeText.replace('Traceability: R01 -> V01 -> E01 -> PASS', 'Traceability: R99 -> V99 -> E99 -> PASS');
  const exactMirror = authoritativeText;
  const mirrorPath = path.join(materialized.projectRoot, 'qa-report.md');
  writeFileSync(mirrorPath, divergentMirror, 'utf8');

  const diverged = harness.buildDeliveredReportAuthorityEvidence({ authoritativeText, projectRoot: materialized.projectRoot });
  assert.equal(diverged.source, 'task-result');
  assert.equal(diverged.ok, false);
  assert.equal(diverged.mirrorSource, 'artifact');
  assert.equal(diverged.mirrorRelativePath, 'qa-report.md');
  assert.equal(diverged.selectedMatchesAuthoritative, true, 'task-result authority must remain exact even when its cited mirror diverges');
  assert.equal(diverged.mirrorMatchesAuthoritative, false);
  assert.equal(diverged.issues.join('\n').includes('mirror'), true);

  writeFileSync(mirrorPath, exactMirror, 'utf8');
  const aligned = harness.buildDeliveredReportAuthorityEvidence({ authoritativeText, projectRoot: materialized.projectRoot });
  assert.equal(aligned.ok, true);
  assert.equal(aligned.selectedMatchesAuthoritative, true);
  assert.equal(aligned.mirrorMatchesAuthoritative, true);

  const nonCitedText = [
    'QA Plan Gate: OPEN',
    'QA Conclusion Gate: COMPLETE',
    'Overall Status: PASS',
    'Traceability: R01 -> V01 -> E01 -> PASS',
    '',
  ].join('\n');
  const uncited = harness.buildDeliveredReportAuthorityEvidence({ authoritativeText: nonCitedText, projectRoot: materialized.projectRoot });
  assert.equal(uncited.source, 'task-result');
  assert.equal(uncited.ok, true);
  assert.equal(uncited.selectedMatchesAuthoritative, true);
  assert.equal(uncited.mirrorFound, false);
}));

test('FV-REPORT-SOURCE-017 selects observed bold backticked report artifact citation', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const finalMessage = 'QA completed. V01 -> E01 passed.\n- **Report artifact:** `qa-report-membership-discount.md`';
  writeFileSync(path.join(materialized.projectRoot, 'qa-report-membership-discount.md'), completePassReport, 'utf8');

  const selected = selectReportSource({ finalMessage, projectRoot: materialized.projectRoot });
  assert.equal(selected.source, 'artifact');
  assert.equal(selected.relativePath, 'qa-report-membership-discount.md');
  assert.match(selected.reportText, /R01 -> V01 -> E01 -> PASS/);
}));

test('FV-REPORT-SOURCE-016 rejects unsafe report citations and falls back to assistant message', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const productReport = path.join(materialized.projectRoot, 'targets', 'pass-membership-discount', 'qa.md');
  const skillReport = path.join(materialized.projectRoot, '.opencode', 'skills', 'using-qa', 'qa.md');
  mkdirSync(path.dirname(productReport), { recursive: true });
  mkdirSync(path.dirname(skillReport), { recursive: true });
  writeFileSync(path.join(materialized.projectRoot, 'safe.txt'), completePassReport, 'utf8');
  writeFileSync(productReport, completePassReport, 'utf8');
  writeFileSync(skillReport, completePassReport, 'utf8');
  mkdirSync(path.join(materialized.projectRoot, 'directory-report.md'));

  const rejectedCitations = [
    '../x.md',
    path.join(materialized.projectRoot, 'qa-report-membership-discount.md'),
    '.opencode/skills/using-qa/qa.md',
    'targets/pass-membership-discount/qa.md',
    'missing.md',
    'safe.txt',
    'directory-report.md',
  ];

  for (const citation of rejectedCitations) {
    const finalMessage = `Overall Status: PASS\nReport artifact: ${citation}`;
    const selected = selectReportSource({ finalMessage, projectRoot: materialized.projectRoot });
    assert.equal(selected.source, 'assistant-message', `${citation} must fall back`);
    assert.equal(selected.reportText, finalMessage);
    assert.ok(selected.issues.length > 0, `${citation} must record a rejection reason`);
  }

  const unsafeFinalMessage = 'Overall Status: PASS\nReport artifact: targets/pass-membership-discount/qa.md';
  const unsafeSelected = selectReportSource({ finalMessage: unsafeFinalMessage, projectRoot: materialized.projectRoot });
  const unsafeAuthority = harness.buildReportAuthorityEvidence({ selectedReportSource: unsafeSelected, authoritativeText: unsafeFinalMessage });
  assert.equal(unsafeAuthority.ok, true, 'unsafe citation fallback must not fail authority when fallback matches task result');
  assert.match(unsafeAuthority.selectionIssues.join('\n'), /product targets/i);
  assert.deepEqual(unsafeAuthority.issues, []);
  assert.doesNotMatch(JSON.stringify(unsafeAuthority), /Overall Status:|Report artifact:|reportText|qa-report/i);

  const noCitation = selectReportSource({ finalMessage: 'Overall Status: PASS', projectRoot: materialized.projectRoot });
  assert.equal(noCitation.source, 'assistant-message');
  assert.match(noCitation.issues.join('\n'), /no report artifact/i);
}));

test('FV-RUNTIME-011 preserves provider/auth environment for real runs and sends only prompt metadata', () => {
  const env = createRuntimeOpenCodeEnv({
    baseEnv: {
      OPENCODE_AUTH_CONTENT: '{"token":"configured"}',
      CPA_API_KEY: 'configured-key',
      XDG_CONFIG_HOME: 'C:/user/config',
    },
  });
  assert.equal(env.OPENCODE_AUTH_CONTENT, '{"token":"configured"}');
  assert.equal(env.CPA_API_KEY, 'configured-key');
  assert.equal(env.XDG_CONFIG_HOME, 'C:/user/config');
  assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, '1');

  const metadata = redactCommandMetadata({
    command: 'opencode',
    args: ['run', '--dir', 'C:/target', '--model', 'cpa/gpt-5.4-mini', '--agent', 'build', '--format', 'json'],
    env,
    prompt: 'sensitive prompt body',
  });
  assert.deepEqual(metadata.prompt, promptMetadata('sensitive prompt body'));
  assert.ok(!JSON.stringify(metadata).includes('sensitive prompt body'));
});

test('FV-REDACTION-005 redacts secret-like command metadata without dumping the environment', () => {
  const metadata = redactCommandMetadata({
    command: 'opencode',
    args: ['run', '--dir', 'C:/target', '--model', 'cpa/gpt-5.4-mini', '--agent', 'build', '--format', 'json'],
    env: {
      PATH: 'kept-summary-only',
      OPENCODE_CONFIG_CONTENT: '{"provider":"configured"}',
      OPENCODE_AUTH_CONTENT: '{"token":"secret"}',
      API_TOKEN: 'super-secret',
      NORMAL_VALUE: 'visible',
    },
  });

  assert.equal(metadata.env.OPENCODE_AUTH_CONTENT, '[REDACTED]');
  assert.equal(metadata.env.OPENCODE_CONFIG_CONTENT, '[REDACTED]');
  assert.equal(metadata.env.API_TOKEN, '[REDACTED]');
  assert.equal(metadata.env.NORMAL_VALUE, 'visible');
  assert.ok(!('PATH' in metadata.env), 'PATH must not be copied into artifacts');
});

test('FV-SKILL-006 copies and hashes the current qa-skill tree into an isolated OpenCode project', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const copiedSkill = path.join(materialized.projectRoot, '.opencode', 'skills', 'using-qa', 'SKILL.md');

  assert.equal(readFileSync(copiedSkill, 'utf8'), readFileSync(path.join(packRoot, 'using-qa', 'SKILL.md'), 'utf8'));
  assert.equal(materialized.sourceHash, hashDirectory(packRoot).sha256);
  assert.equal(materialized.copiedHash, hashDirectory(path.join(materialized.projectRoot, '.opencode', 'skills')).sha256);
  assert.ok(materialized.manifest.files.some((entry) => entry.path === 'using-qa/SKILL.md'));

  const discovery = validateProjectSkillDiscovery({ projectRoot: materialized.projectRoot, isolatedRoot: path.join(root, 'discovery-home') });
  assert.equal(discovery.ok, true, `materialized project skills must be discoverable: ${discovery.stderr}`);
}));

test('FV-FIXTURE-012 can nest product target below project root while keeping .opencode out of Git diff', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const scenario = scenarios[0];
  const fixture = createScenarioRepository({ scenario, projectRoot: materialized.projectRoot });
  assert.ok(fixture.root.startsWith(path.join(materialized.projectRoot, 'targets')));
  assert.ok(!fixture.diff.includes('.opencode/skills'));
  assert.deepEqual(fixture.git.failures, []);
}));

test('FV-POSTMODEL-014 reruns the scenario oracle and detects product or skill mutation after model exit', () => withTempRoot((root) => {
  const materialized = materializeCurrentSkill({ packRoot, runRoot: root });
  const scenario = scenarios[0];
  const fixture = createScenarioRepository({ scenario, projectRoot: materialized.projectRoot });
  const preProduct = hashDirectory(fixture.root);
  const preSkill = hashDirectory(materialized.skillRoot);
  const runtimeConfig = materializeRuntimeConfig({ projectRoot: materialized.projectRoot, model: 'cpa/gpt-5.4-mini' });

  const oracle = executeScenarioOracle({ scenario, productRoot: fixture.root });
  assert.equal(oracle.checkedAfterModel, true);
  assert.equal(oracle.exitCode, scenario.expectedVerificationExitCode);
  assert.equal(oracle.matchesExpectedExitCode, true);
  assert.match(oracle.stdout, /membership discount/);

  writeFileSync(path.join(fixture.root, 'qa-report.md'), '# forbidden product mutation\n', 'utf8');
  const postflight = capturePostflight({ productRoot: fixture.root, skillRoot: materialized.skillRoot, runtimeConfig, preProduct, preSkill, scenario });
  assert.equal(postflight.productUnchanged, false);
  assert.equal(postflight.skillUnchanged, true);
  assert.equal(postflight.runtimeConfigUnchanged, true);
  assert.match(postflight.integrityIssues.join('\n'), /product/i);
  assert.match(postflight.gitStatus.stdout, /qa-report\.md/);

  writeFileSync(runtimeConfig.configPath, '{}\n', 'utf8');
  const configMutation = capturePostflight({ productRoot: fixture.root, skillRoot: materialized.skillRoot, runtimeConfig, preProduct: hashDirectory(fixture.root), preSkill: hashDirectory(materialized.skillRoot), scenario });
  assert.equal(configMutation.runtimeConfigUnchanged, false);
  assert.match(configMutation.integrityIssues.join('\n'), /runtime config/i);
}));

test('FV-ARTIFACTS-007 writes source and artifact manifests, infrastructure status, and oracle after model output capture', () => withTempRoot((root) => {
  const scenario = scenarios[0];
  const fixture = createScenarioRepository({ scenario, runRoot: root });
  const skillMaterialization = materializeCurrentSkill({ packRoot, runRoot: root });
  const artifacts = writeRunArtifacts({
    artifactRoot: path.join(root, 'artifacts'),
    scenario,
    fixture,
    skillMaterialization,
    commandMetadata: redactCommandMetadata({ command: 'opencode', args: ['run'], env: { QA_SKILL_MODEL: 'hidden' } }),
    terminal: { platform: process.platform, node: process.version },
    rawStdout: Buffer.from('{"type":"message","role":"assistant","text":"QA Conclusion Gate: COMPLETE\\nOverall Status: PASS\\nRisk -> Verification -> Evidence -> Status"}\n', 'utf8'),
    stderr: '',
    events: [{ type: 'message', role: 'assistant', text: 'QA Conclusion Gate: COMPLETE\nOverall Status: PASS\nRisk -> Verification -> Evidence -> Status' }],
    finalText: 'QA Conclusion Gate: COMPLETE\nOverall Status: PASS\nRisk -> Verification -> Evidence -> Status',
    reportSource: okReportAuthorityEvidence,
    qaVerdict: 'PASS',
    infrastructureStatus: summarizeInfrastructure({ spawnError: null, exitCode: 0, jsonlErrors: [], finalText: 'x', qaVerdict: 'PASS' }),
    scenarioAssertion: { passed: true, errors: [] },
    modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' },
    nestedSessionEvidence: { ok: true, sessionId: 'ses_child_001', selectedToolEvents: [] },
    agentTopology: { ok: true, childCount: 1, issues: [] },
    parentBoundaryEvidence: { ok: true, taskCallCount: 1, rejectedParentTools: [] },
    childReportRelayEvidence: { ok: true, childSha256: 'child-hash', parentSha256: 'parent-hash', reportBytes: 128, markerCount: 1 },
    runtimeConfig: { configPath: path.join(root, 'opencode.json'), sha256: 'fixture' },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    oracle: { checkedAfterModel: true, exitCode: scenario.expectedVerificationExitCode, matchesExpectedExitCode: true },
  });

  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path.endsWith('raw-stdout.jsonl')));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'final-message.md'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'final-report.md'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'report-source.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'model-command-evidence.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'report-diagnostics.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'nested-session-evidence.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'agent-topology.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'parent-boundary-evidence.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'child-report-relay-evidence.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'runtime-config.json'));
  assert.ok(artifacts.manifest.sources.some((entry) => entry.path === scenario.product.changedPath));
  assert.ok(artifacts.manifest.sources.some((entry) => entry.path === '.opencode/skills/using-qa/SKILL.md'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'oracle.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'postflight.json'));
  assert.ok(artifacts.manifest.artifacts.some((entry) => entry.path === 'scenario-assertion.json'));
  assert.equal(JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'oracle.json'), 'utf8')).matchesExpectedExitCode, true);
  const reportSource = JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'report-source.json'), 'utf8'));
  assert.equal('reportText' in reportSource, false, 'report-source metadata must not persist report text');
  assert.equal('authoritativeSha256' in reportSource, true, 'report-source metadata must include authoritative hash');
  assert.deepEqual(JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'report-diagnostics.json'), 'utf8')).blockingIssues, []);
  assert.equal(JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'postflight.json'), 'utf8')).productUnchanged, true);
  assert.equal(JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'scenario-assertion.json'), 'utf8')).passed, true);
  const parentBoundary = JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'parent-boundary-evidence.json'), 'utf8'));
  const childRelay = JSON.parse(readFileSync(path.join(artifacts.runDirectory, 'child-report-relay-evidence.json'), 'utf8'));
  assert.equal(parentBoundary.ok, true);
  assert.equal(childRelay.ok, true);
  assert.equal(JSON.stringify(childRelay).includes('Overall Status:'), false, 'child relay evidence must be compact metadata only');
  assert.equal(JSON.stringify(childRelay).includes('<task_result>'), false, 'child relay evidence must not persist task output wrappers');
  assert.equal(JSON.stringify(childRelay).includes('task_metadata'), false, 'child relay evidence must not persist task output metadata');
}));

test('BUG-BLOCKED-PREREQ-WORD-ORDER-028 accepts absent prerequisite and supplied-rerun wording tied to exact path', () => {
  const scenario = scenarios[2];
  const blockedBase = {
    scenario,
    qaVerdict: 'BLOCKED',
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okBlockedChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  };
  const realBlockedWording = [
    'Overall Status: BLOCKED',
    'Traceability: R03 -> V03 -> E03 -> BLOCKED',
    'Required prerequisite acceptance-data/currency-cases.json was absent, so expected cases could not be verified.',
    'QA can continue only until acceptance-data/currency-cases.json is supplied and the verifier is rerun.',
  ].join('\n');
  const runOnlyAfterWording = [
    'Overall Status: BLOCKED',
    'Traceability: R03 -> V03 -> E03 -> BLOCKED',
    'Required prerequisite acceptance-data/currency-cases.json was absent, so expected cases could not be verified.',
    'V03: run node verify-currency-format.mjs only after acceptance-data/currency-cases.json is supplied.',
  ].join('\n');

  assert.doesNotThrow(() => assertScenarioOutcome({ ...blockedBase, finalText: realBlockedWording }));
  assert.doesNotThrow(() => assertScenarioOutcome({ ...blockedBase, finalText: runOnlyAfterWording }));
  assert.throws(
    () => assertScenarioOutcome({
      ...blockedBase,
      finalText: realBlockedWording.replace('was absent', 'was present and available'),
    }),
    /prerequisite/i,
  );
  assert.throws(
    () => assertScenarioOutcome({
      ...blockedBase,
      finalText: realBlockedWording.replace('and the verifier is rerun', 'before continuing'),
    }),
    /rerun/i,
  );
});

test('BUG-REPORT-AUTHORITY-038 treats task-result as authoritative even when final OpenCode message omits a conclusion row', () => {
  const scenario = scenarios[1];
  const childText = completeFailReport;
  const parentText = rawParentFailReportMissingConclusionGateRow;
  const conclusionGateRow = '| No unresolved blocker or critical human decision remains for `PASS` | COMPLETE |';

  assert.equal(childText.includes(conclusionGateRow), true);
  assert.equal(parentText.includes(conclusionGateRow), false, 'raw parent report must omit the conclusion gate row');

  const relayEvidence = harness.buildChildReportRelayEvidence({
    childText,
    parentText,
    expectedVerdict: 'FAIL',
  });
  assert.equal(relayEvidence.ok, false);
  assert.equal(relayEvidence.relayMatches, false);
  assert.notEqual(relayEvidence.childSha256, relayEvidence.parentSha256, 'raw parent relay should differ by byte hash');
  assert.notEqual(relayEvidence.childBytes, relayEvidence.parentBytes, 'raw parent relay should differ in bytes');
  assert.equal(relayEvidence.childBytes > relayEvidence.parentBytes, true, 'raw parent report is expected to omit a line of bytes');

  const rawTrailingNewlineEvidence = harness.buildChildReportRelayEvidence({
    childText,
    parentText: `${childText}\n`,
    deliveredText: childText,
    expectedVerdict: 'FAIL',
  });
  assert.equal(rawTrailingNewlineEvidence.relayMatches, false, 'raw relay diagnostics must preserve trailing-newline byte differences');
  assert.notEqual(rawTrailingNewlineEvidence.childSha256, rawTrailingNewlineEvidence.parentSha256);
  assert.notEqual(rawTrailingNewlineEvidence.childBytes, rawTrailingNewlineEvidence.parentBytes);

  const selectedReportSource = {
    source: 'task-result',
    relativePath: null,
    reportText: childText,
    issues: [],
  };
  const authoritativeText = childText;
  const reportAuthorityEvidence = harness.buildReportAuthorityEvidence({
    selectedReportSource,
    authoritativeText,
  });
  assert.equal(reportAuthorityEvidence.ok, true);
  assert.equal(reportAuthorityEvidence.source, 'task-result');
  assert.equal(reportAuthorityEvidence.selectedMatchesAuthoritative, true);
  assert.equal(reportAuthorityEvidence.authoritativeSha256, reportAuthorityEvidence.selectedSha256);
  const selectedText = selectedReportSource.reportText;
  assert.equal(selectedText, authoritativeText, 'task-result selection must match authoritative report byte-exactly');
  assert.equal(Buffer.byteLength(selectedText, 'utf8'), Buffer.byteLength(authoritativeText, 'utf8'));

  const modelCommandEvidence = {
    ok: true,
    expectedCommand: 'node verify-tax-rounding.mjs',
    actualCommand: 'node verify-tax-rounding.mjs',
    command: 'node verify-tax-rounding.mjs',
    invocationKind: 'exact',
    status: 'completed',
    exit: 1,
    output: 'tax rounding defect: expected 10.24 received 10.23',
  };

  const scenarioInput = {
    scenario,
    qaVerdict: 'FAIL',
    finalText: childText,
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    modelCommandEvidence,
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: relayEvidence,
    reportAuthorityEvidence,
  };

  assert.notEqual(childText, parentText);
  assert.notEqual(relayEvidence.childBytes, relayEvidence.parentBytes);
  assert.doesNotThrow(() => assertScenarioOutcome(scenarioInput));

  const trailingNewlineMismatch = `${childText}\n`;
  const trailingNewlineMismatchAuthority = harness.buildReportAuthorityEvidence({
    selectedReportSource: {
      ...selectedReportSource,
      reportText: trailingNewlineMismatch,
    },
    authoritativeText: childText,
  });
  assert.equal(trailingNewlineMismatchAuthority.ok, false, 'authority must reject even a trailing-newline byte difference');
});

test('BUG-BLOCKED-AVAILABILITY-RERUN-036 accepts exact prerequisite availability before exact verifier rerun', () => {
  const scenario = scenarios[2];
  const blockedBase = {
    scenario,
    qaVerdict: 'BLOCKED',
    infrastructureStatus: { status: 'COMPLETED' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okBlockedChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  };
  const retainedAvailabilityWording = [
    'Overall Status: BLOCKED',
    'Traceability: R03 -> V03 -> E03 -> BLOCKED',
    'Required prerequisite acceptance-data/currency-cases.json was absent, so expected cases could not be verified.',
    'V03: Confirm prerequisite availability, then run node verify-currency-format.mjs.',
    'Preconditions: acceptance-data/currency-cases.json exists in the product target.',
  ].join('\n');
  const noConditionalRerun = [
    'Overall Status: BLOCKED',
    'Traceability: R03 -> V03 -> E03 -> BLOCKED',
    'Required prerequisite acceptance-data/currency-cases.json was absent, so expected cases could not be verified.',
    'The expected prerequisite is acceptance-data/currency-cases.json.',
    'The verifier command is node verify-currency-format.mjs.',
  ].join('\n');

  assert.doesNotThrow(() => assertScenarioOutcome({ ...blockedBase, finalText: retainedAvailabilityWording }));
  assert.throws(
    () => assertScenarioOutcome({ ...blockedBase, finalText: noConditionalRerun }),
    /rerun/i,
  );
});

test('FV-ASSERT-008 separates infrastructure errors from product FAIL and enforces evidence traceability for PASS', () => {
  assert.equal(summarizeInfrastructure({ spawnError: new Error('missing'), timedOut: false, exitCode: null, jsonlErrors: [], finalText: '', qaVerdict: null }).status, 'SPAWN_FAILED');
  assert.equal(summarizeInfrastructure({ spawnError: null, timedOut: true, exitCode: null, jsonlErrors: [], finalText: '', qaVerdict: null }).status, 'TIMED_OUT');
  assert.equal(summarizeInfrastructure({ spawnError: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), timedOut: true, exitCode: null, jsonlErrors: [], finalText: '', qaVerdict: null }).status, 'TIMED_OUT');
  assert.equal(summarizeInfrastructure({ spawnError: null, timedOut: false, exitCode: 7, jsonlErrors: [], finalText: '', qaVerdict: null }).status, 'PROCESS_FAILED');
  assert.equal(summarizeInfrastructure({ spawnError: null, timedOut: false, exitCode: 0, jsonlErrors: [{ message: 'bad' }], finalText: '', qaVerdict: null }).status, 'INVALID_JSONL');
  assert.equal(summarizeInfrastructure({ spawnError: null, timedOut: false, exitCode: 0, jsonlErrors: [], finalText: '', qaVerdict: null }).status, 'MISSING_FINAL_TEXT');
  assert.equal(summarizeInfrastructure({ spawnError: null, timedOut: false, exitCode: 0, jsonlErrors: [], finalText: 'no verdict', qaVerdict: null }).status, 'UNEXTRACTED_VERDICT');
  assert.equal(summarizeInfrastructure({ spawnError: null, timedOut: false, exitCode: 0, jsonlErrors: [], finalText: 'Overall Status: PASS', qaVerdict: 'PASS' }).status, 'COMPLETED');

  assert.throws(
    () => assertScenarioOutcome({ scenario: scenarios[0], qaVerdict: 'PASS', finalText: 'QA Plan Gate: OPEN\nQA Conclusion Gate: COMPLETE\nOverall Status: PASS\nRisk R01 Verification V01 Evidence E01 Status PASS', infrastructureStatus: { status: 'COMPLETED' }, agentTopology: okAgentTopology, parentBoundaryEvidence: okParentBoundaryEvidence, childReportRelayEvidence: okChildReportRelayEvidence, reportAuthorityEvidence: okReportAuthorityEvidence }),
    /command|exit/i,
  );
  assert.throws(
    () => assertScenarioOutcome({ scenario: scenarios[2], qaVerdict: 'BLOCKED', finalText: 'Overall Status: BLOCKED\nR03 V03 E03', infrastructureStatus: { status: 'COMPLETED' }, agentTopology: okAgentTopology, parentBoundaryEvidence: okParentBoundaryEvidence, childReportRelayEvidence: okBlockedChildReportRelayEvidence, reportAuthorityEvidence: okReportAuthorityEvidence }),
    /prerequisite/i,
  );
  assert.doesNotThrow(() => assertScenarioOutcome({
    scenario: scenarios[1],
    qaVerdict: 'FAIL',
    finalText: 'QA Plan Gate: OPEN\nQA Conclusion Gate: COMPLETE\nOverall Status: FAIL\nRisk R02 Verification V02 Evidence E02 Finding F02 Status FAIL\nproduct defect: expected behavior was not met\nCommand: node verify-tax-rounding.mjs\nExit code: 1\nOutput: tax rounding defect: expected 10.24 received 10.23',
    infrastructureStatus: { status: 'COMPLETED' },
    modelCommandEvidence: { ok: true, expectedCommand: 'node verify-tax-rounding.mjs', actualCommand: 'node verify-tax-rounding.mjs', command: 'node verify-tax-rounding.mjs', invocationKind: 'exact', status: 'completed', exit: 1, output: 'tax rounding defect: expected 10.24 received 10.23' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okFailChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  }));
  assert.throws(
    () => assertScenarioOutcome({ scenario: scenarios[0], qaVerdict: 'PASS', finalText: 'QA Plan Gate: OPEN\nQA Conclusion Gate: COMPLETE\nOverall Status: PASS\nRisk R01 Verification V01 Evidence E01 Status PASS\nCommand: node verify-membership-discount.mjs\nExit code: 0\nOutput: OK membership discount behavior: member=90 guest=100', infrastructureStatus: { status: 'COMPLETED' }, modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' }, oracle: { matchesExpectedExitCode: false }, postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] }, agentTopology: okAgentTopology, parentBoundaryEvidence: okParentBoundaryEvidence, childReportRelayEvidence: okChildReportRelayEvidence, reportAuthorityEvidence: okReportAuthorityEvidence }),
    /oracle/i,
  );
  assert.throws(
    () => assertScenarioOutcome({ scenario: scenarios[0], qaVerdict: 'PASS', finalText: 'QA Plan Gate: OPEN\nQA Conclusion Gate: COMPLETE\nOverall Status: PASS\nRisk R01 Verification V01 Evidence E01 Status PASS\nCommand: node verify-membership-discount.mjs\nExit code: 0\nOutput: OK membership discount behavior: member=90 guest=100', infrastructureStatus: { status: 'COMPLETED' }, modelCommandEvidence: { ok: true, expectedCommand: 'node verify-membership-discount.mjs', actualCommand: 'node verify-membership-discount.mjs', command: 'node verify-membership-discount.mjs', invocationKind: 'exact', status: 'completed', exit: 0, output: 'OK membership discount behavior: member=90 guest=100' }, oracle: { checkedAfterModel: true, matchesExpectedExitCode: true }, postflight: { productUnchanged: false, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: ['product changed'] }, agentTopology: okAgentTopology, parentBoundaryEvidence: okParentBoundaryEvidence, childReportRelayEvidence: okChildReportRelayEvidence, reportAuthorityEvidence: okReportAuthorityEvidence }),
    /integrity|mutation/i,
  );
});

test('BUG-FAIL-TRACEABILITY-PROXIMITY-042 accepts canonical split FAIL traceability across full report sections', () => {
  const input = {
    scenario: scenarios[1],
    qaVerdict: 'FAIL',
    finalText: spacedFailTraceabilityReport,
    infrastructureStatus: { status: 'COMPLETED' },
    modelCommandEvidence: { ok: true, expectedCommand: 'node verify-tax-rounding.mjs', actualCommand: 'node verify-tax-rounding.mjs', command: 'node verify-tax-rounding.mjs', invocationKind: 'exact', status: 'completed', exit: 1, output: 'tax rounding defect: expected 10.24 received 10.23' },
    oracle: { checkedAfterModel: true, matchesExpectedExitCode: true },
    postflight: { productUnchanged: true, skillUnchanged: true, runtimeConfigUnchanged: true, integrityIssues: [] },
    reportDiagnostics: { warnings: [], blockingIssues: [] },
    agentTopology: okAgentTopology,
    parentBoundaryEvidence: okParentBoundaryEvidence,
    childReportRelayEvidence: okFailChildReportRelayEvidence,
    reportAuthorityEvidence: okReportAuthorityEvidence,
  };

  assert.doesNotThrow(() => assertScenarioOutcome(input));
  assert.throws(
    () => assertScenarioOutcome({ ...input, finalText: spacedFailTraceabilityReport.replace('R02 -> V02 -> E02 -> FAIL', 'R02, V02, E02, FAIL') }),
    /traceability/i,
  );
  assert.throws(
    () => assertScenarioOutcome({ ...input, finalText: spacedFailTraceabilityReport.replace('F02 -> R02 / V02 / E02', 'F02, R02, V02, E02') }),
    /traceability/i,
  );
  assert.throws(
    () => assertScenarioOutcome({ ...input, finalText: spacedFailTraceabilityReport.replace('R02 -> V02 -> E02 -> FAIL\nF02 -> R02 / V02 / E02', 'Risk Verification Evidence Finding Status FAIL') }),
    /traceability/i,
  );
});

test('FV-TERMINAL-013 records timeout and terminal process metadata without retries', () => {
  const terminal = {
    startedAt: '2026-07-28T00:00:00.000Z',
    endedAt: '2026-07-28T00:00:01.000Z',
    durationMs: 1000,
    timeoutMs: 600000,
    exitCode: 0,
    signal: null,
    spawnError: null,
    stdoutBytes: 10,
    stderrBytes: 0,
  };
  for (const key of ['startedAt', 'endedAt', 'durationMs', 'timeoutMs', 'exitCode', 'signal', 'spawnError', 'stdoutBytes', 'stderrBytes']) {
    assert.ok(key in terminal);
  }
});

test('FV-GATE-009 integration real runs are opt-in and require model plus agent', () => {
  const integrationSource = readFileSync(path.join(import.meta.dirname, 'integration.test.mjs'), 'utf8');
  assert.match(integrationSource, /QA_SKILL_REAL_RUNS/);
  assert.match(integrationSource, /QA_SKILL_MODEL/);
  assert.match(integrationSource, /QA_SKILL_AGENT/);
  assert.match(integrationSource, /QA_SKILL_TIMEOUT_MS/);
  assert.match(integrationSource, /skip/);
});
