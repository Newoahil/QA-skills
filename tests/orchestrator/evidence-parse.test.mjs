import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoQaE2eAfterStop,
  assertExactTaskTypes,
  classifySubagentResult,
  collectToolUseInputs,
  extractE2ERunResults,
  parseQaEvidenceResult,
  extractQaEvidenceBlocks,
  extractCompletedQaEvidenceResults,
  extractFinalReport,
  extractTaskCalls,
  normalizePathLikeText,
  parseJsonlEvents,
  serializeToolUseInputs,
  validateFinalReport,
} from './helpers.mjs';

function wrapTaskResult(text) {
  return `<task_result>\n${text}\n</task_result>`;
}

function validBlock(overrides = {}) {
  return [
    'QA_EVIDENCE_RESULT',
    `agent: ${overrides.agent ?? 'qa-cr'}`,
    `scope: ${overrides.scope ?? 'bounded diff'}`,
    `status: ${overrides.status ?? 'FAIL'}`,
    `gate: ${overrides.gate ?? 'stop_and_fail'}`,
    'evidence:',
    `  - ${overrides.evidence ?? 'file: src/a.ts:10 exit code 1 observed mismatch'}`,
    'findings:',
    `  - ${overrides.finding ?? 'mismatch'}`,
    'limits:',
    `  - ${overrides.limit ?? 'none'}`,
    'recommended_next:',
    `  - ${overrides.next ?? 'none'}`,
    `confidence: ${overrides.confidence ?? 'high because direct evidence'}`,
    'END_QA_EVIDENCE_RESULT',
  ].join('\n');
}

test('stop_and_fail prevents later qa-e2e work in parsed event stream', () => {
  const jsonl = [
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: '<task_result>\nQA_EVIDENCE_RESULT\nagent: qa-cr\nstatus: FAIL\ngate: stop_and_fail\nevidence:\n  - file: src/a.ts:10\nfindings:\n  - mismatch\nlimits:\n  - none\nrecommended_next:\n  - none\nconfidence: high\nEND_QA_EVIDENCE_RESULT\n</task_result>' } } }),
    JSON.stringify({ type: 'text', part: { text: 'Overall Status: FAIL\nEvidence: file src/a.ts:10\nFindings: mismatch' } }),
  ].join('\n');

  assert.doesNotThrow(() => assertNoQaE2eAfterStop(parseJsonlEvents(jsonl)));
});

test('extractQaEvidenceBlocks parses all blocks and tracks structure', () => {
  const blocks = extractQaEvidenceBlocks(`${validBlock()}\nnoise\n${validBlock({ agent: 'qa-e2e', status: 'OK', gate: 'continue' })}`);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].parsed.agent, 'qa-cr');
  assert.equal(blocks[1].parsed.agent, 'qa-e2e');
  assert.deepEqual(blocks[0].structuralIssues, []);
});

test('compatibility parser refuses multiple blocks instead of choosing one', () => {
  assert.equal(parseQaEvidenceResult(`${validBlock()}\n${validBlock()}`), null);
});

test('skill or prompt text containing stop_and_fail or qa-e2e does not trigger false stop detection', () => {
  const jsonl = [
    JSON.stringify({ type: 'tool_use', part: { tool: 'skill', state: { status: 'completed', input: { name: 'qa-skill' }, output: 'mention stop_and_fail and qa-e2e in prose only' } } }),
    JSON.stringify({ type: 'text', part: { text: 'Prompt says stop_and_fail and qa-e2e but no task completed yet' } }),
  ].join('\n');
  const events = parseJsonlEvents(jsonl);
  assert.deepEqual(extractCompletedQaEvidenceResults(events), []);
  assert.doesNotThrow(() => assertNoQaE2eAfterStop(events));
});

test('real completed qa-cr stop followed by qa-e2e task is rejected', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: wrapTaskResult(validBlock()) } } }),
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'running', input: { subagent_type: 'qa-e2e' }, output: '' } } }),
  ].join('\n'));
  assert.throws(() => assertNoQaE2eAfterStop(events), /qa-e2e must not appear/i);
});

test('status-only final report is invalid', () => {
  const result = validateFinalReport('Overall Status: PASS');
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /status-only report/i);
});

test('final report with status plus evidence and finding or limit is valid', () => {
  const report = [
    'Overall Status: PASS',
    'Evidence: command node verify.mjs; exit code 0; observed checkout stays disabled',
    'Findings: none',
    'Limits: sampled one regression control only',
  ].join('\n');
  const result = validateFinalReport(report);
  assert.equal(result.ok, true);
});

test('evidence-free subagent result is non-actionable and must not count as usable evidence', () => {
  const classification = classifySubagentResult(validBlock({ status: 'OK', gate: 'continue', evidence: 'none' }));
  assert.equal(classification.kind, 'evidence_free');
  assert.equal(classification.actionable, false);
  assert.equal(classification.canSupportPass, false);
});

test('final report parser returns last report-shaped text event', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'text', part: { text: 'draft' } }),
    JSON.stringify({ type: 'message', text: 'Overall Status: BLOCKED\nEvidence: supplied diff missing\nLimits: none' }),
  ].join('\n'));
  assert.match(extractFinalReport(events), /Overall Status: BLOCKED/);
});

test('extractTaskCalls reads subagent types only from task tool inputs', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' } } } }),
    JSON.stringify({ type: 'tool_use', part: { tool: 'read', state: { status: 'completed', input: { subagent_type: 'qa-e2e' } } } }),
  ].join('\n'));
  assert.deepEqual(extractTaskCalls(events).map((call) => call.subagentType), ['qa-cr']);
});

test('normalizePathLikeText accepts Windows and POSIX separators for path assertions', () => {
  const text = 'src\\helpers\\formatValue.ts and src/session/audit.ts';
  assert.match(normalizePathLikeText(text), /src\/helpers\/formatValue\.ts/);
  assert.match(normalizePathLikeText(text), /src\/session\/audit\.ts/);
});

test('serializeToolUseInputs exposes .git and gitdir markers for detector assertions', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'tool_use', part: { tool: 'read', state: { status: 'completed', input: { filePath: '/repo/.git/config' } } } }),
    JSON.stringify({ type: 'tool_use', part: { tool: 'read', state: { status: 'completed', input: { filePath: '/repo/gitdir-link' } } } }),
  ].join('\n'));
  const inputs = collectToolUseInputs(events);
  assert.equal(inputs.length, 2);
  const serialized = serializeToolUseInputs(events);
  assert.match(serialized, /\.git/);
  assert.match(serialized, /gitdir/);
});

test('extractE2ERunResults parses raw runner result blocks from task output text', () => {
  const canonical = extractE2ERunResults([
    'log line',
    'E2E_RUN_RESULT',
    '{"status":"FAIL","testExitCode":1,"cleanup":{"ok":true}}',
    'END_E2E_RUN_RESULT',
  ].join('\n'));
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].status, 'FAIL');
  assert.equal(canonical[0].testExitCode, 1);
  assert.equal(canonical[0].cleanup.ok, true);

  const indented = extractE2ERunResults([
    '  - Raw final E2E_RUN_RESULT exactly observed:',
    '    E2E_RUN_RESULT',
    '    {"status":"FAIL","testExitCode":1,"cleanup":{"ok":true}}',
    '    END_E2E_RUN_RESULT',
  ].join('\n'));
  assert.equal(indented.length, 1);
  assert.equal(indented[0].status, 'FAIL');
  assert.equal(indented[0].cleanup.ok, true);

  const inline = extractE2ERunResults('  - Raw E2E_RUN_RESULT: `{"status":"FAIL","testExitCode":1,"cleanup":{"ok":true}}`');
  assert.equal(inline.length, 1);
  assert.equal(inline[0].cleanup.ok, true);

  const fenced = extractE2ERunResults([
    'Raw `E2E_RUN_RESULT`:',
    '```json',
    '{"status":"FAIL","testExitCode":1,"cleanup":{"ok":true}}',
    '```',
  ].join('\n'));
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].testExitCode, 1);
});

test('assertExactTaskTypes validates ordered real task sequence', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-e2e' } } } }),
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' } } } }),
  ].join('\n'));
  assert.doesNotThrow(() => assertExactTaskTypes(events, ['qa-e2e', 'qa-cr']));
  assert.throws(() => assertExactTaskTypes(events, ['qa-cr', 'qa-e2e']));
});

test('classifySubagentResult is table-driven fail-closed across task envelopes', () => {
  const cases = [
    { name: 'valid result', input: wrapTaskResult(validBlock({ agent: 'qa-cr', status: 'OK', gate: 'continue', evidence: 'command node verify.mjs; exit code 0; observed match' })), expected: 'usable', expectedAgent: 'qa-cr' },
    { name: 'missing block', input: wrapTaskResult('plain text only'), expected: 'missing' },
    { name: 'completed output without wrapper', input: { status: 'completed', output: validBlock(), error: null }, expected: 'missing' },
    { name: 'missing required fields', input: wrapTaskResult(validBlock({ confidence: '<high|medium|low>' })), expected: 'malformed' },
    { name: 'empty placeholder evidence', input: wrapTaskResult(validBlock({ evidence: '<raw evidence>' })), expected: 'evidence_free' },
    { name: 'wrong agent', input: wrapTaskResult(validBlock({ agent: 'qa-e2e' })), expected: 'malformed', expectedAgent: 'qa-cr' },
    { name: 'duplicate identical blocks ambiguous', input: wrapTaskResult(`${validBlock({ status: 'OK', gate: 'continue' })}\n${validBlock({ status: 'OK', gate: 'continue' })}`), expected: 'ambiguous' },
    { name: 'multiple differing blocks conflicting', input: wrapTaskResult(`${validBlock({ status: 'OK', gate: 'continue' })}\n${validBlock({ status: 'FAIL', gate: 'stop_and_fail' })}`), expected: 'conflicting' },
    { name: 'task status refused', input: { status: 'error', output: '', error: 'request refused by host' }, expected: 'refused' },
    { name: 'task status generic failed', input: { status: 'failed', output: '', error: 'subagent crashed unexpectedly' }, expected: 'failed' },
    { name: 'timeout via status', input: { status: 'timed_out', output: '', error: null }, expected: 'timed_out' },
    { name: 'timeout via generic error text', input: { status: 'error', output: '', error: 'operation timed out after 30s' }, expected: 'timed_out' },
    { name: 'pending incomplete', input: { status: 'running', output: '', error: null }, expected: 'incomplete' },
  ];

  for (const testCase of cases) {
    const result = classifySubagentResult(testCase.input, { expectedAgent: testCase.expectedAgent });
    assert.equal(result.kind, testCase.expected, testCase.name);
    assert.equal(result.actionable, testCase.expected === 'usable', testCase.name);
    if (testCase.expected === 'usable') {
      assert.equal(result.canSupportPass, true, testCase.name);
    } else {
      assert.equal(result.canSupportPass, false, testCase.name);
    }
  }
});

test('optimistic status with objective nonzero exit evidence is conflicting and preserves raw failure text', () => {
  const result = classifySubagentResult(wrapTaskResult(validBlock({ status: 'OK', gate: 'continue', evidence: 'command node verify.mjs; exit code 1; observed mismatch' })));
  assert.equal(result.kind, 'conflicting');
  assert.match(result.raw, /exit code 1/i);
  assert.equal(result.actionable, false);
  assert.equal(result.canSupportPass, false);
  assert.equal(result.canSupportFail, true);
  assert.equal(result.parsed.status, 'OK');
});

test('trusted usable OK supports PASS and trusted usable FAIL supports FAIL only', () => {
  const ok = classifySubagentResult(wrapTaskResult(validBlock({ agent: 'qa-cr', status: 'OK', gate: 'continue', evidence: 'command node verify.mjs; exit code 0; observed match' })), { expectedAgent: 'qa-cr' });
  const fail = classifySubagentResult(wrapTaskResult(validBlock({ agent: 'qa-cr', status: 'FAIL', gate: 'stop_and_fail' })), { expectedAgent: 'qa-cr' });
  assert.equal(ok.kind, 'usable');
  assert.equal(ok.canSupportPass, true);
  assert.equal(ok.canSupportFail, false);
  assert.equal(fail.kind, 'usable');
  assert.equal(fail.canSupportPass, false);
  assert.equal(fail.canSupportFail, true);
});

test('pessimistic stop without substantive evidence does not short-circuit qa-e2e', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: wrapTaskResult(validBlock({ evidence: 'none' })) } } }),
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'running', input: { subagent_type: 'qa-e2e' }, output: '' } } }),
  ].join('\n'));
  assert.doesNotThrow(() => assertNoQaE2eAfterStop(events));
});

test('PASS missing required claim is invalid while BLOCKED may rely on limits', () => {
  const passReport = [
    'Overall Status: PASS',
    'Evidence: command node verify.mjs; exit code 0; observed visible state',
    'Findings: none',
    'Limits: none',
  ].join('\n');
  const blockedReport = [
    'Overall Status: BLOCKED',
    'Evidence: command node verify.mjs; exit code 1; observed missing fixture',
    'Findings: none',
    'Limits: required audit token claim not covered because fixture is missing',
  ].join('\n');
  assert.equal(validateFinalReport(passReport, { requiredClaims: [/audit token/i] }).ok, false);
  assert.equal(validateFinalReport(blockedReport, { requiredClaims: [/audit token/i] }).ok, true);
});
