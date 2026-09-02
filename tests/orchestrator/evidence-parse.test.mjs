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
  const lines = [
    'QA_EVIDENCE_RESULT',
    `agent: ${overrides.agent ?? 'qa-cr'}`,
    `scope: ${overrides.scope ?? 'bounded diff'}`,
    `status: ${overrides.status ?? 'FAIL'}`,
    `gate: ${overrides.gate ?? 'stop_and_fail'}`,
    'evidence:',
    `  - ${overrides.evidence ?? 'file: src/a.ts:10 exit code 1 observed mismatch'}`,
    'END_QA_EVIDENCE_RESULT',
  ];
  if (overrides.findingsBlock !== false) {
    lines.splice(lines.length - 1, 0, 'findings:', `  - ${overrides.finding ?? 'mismatch'}`);
  }
  if (overrides.limitsBlock !== false) {
    lines.splice(lines.length - 1, 0, 'limits:', `  - ${overrides.limit ?? 'none'}`);
  }
  if (overrides.recommendedNextBlock !== false) {
    lines.splice(lines.length - 1, 0, 'recommended_next:', `  - ${overrides.next ?? 'none'}`);
  }
  if (overrides.confidenceBlock !== false) {
    lines.splice(lines.length - 1, 0, `confidence: ${overrides.confidence ?? 'high because direct evidence'}`);
  }
  return lines.join('\n');
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

test('compatibility parser refuses structurally incomplete single block', () => {
  assert.equal(parseQaEvidenceResult(validBlock({ evidence: 'none' })), null);
});

test('optional auxiliary fields may be absent without making a block malformed', () => {
  const block = [
    'QA_EVIDENCE_RESULT',
    'agent: qa-cr',
    'scope: bounded diff',
    'status: OK',
    'gate: continue',
    'evidence:',
    '  - command node verify.mjs; exit code 0; observed match',
    'limits:',
    '  - none',
    'END_QA_EVIDENCE_RESULT',
  ].join('\n');
  const classification = classifySubagentResult(block, { expectedAgent: 'qa-cr' });
  assert.equal(classification.kind, 'usable');
});

test('html evidence is not treated as placeholder evidence', () => {
  const classification = classifySubagentResult(validBlock({ evidence: '<button disabled> remains visible and non-interactive' }));
  assert.equal(classification.kind, 'usable');
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

test('final report accepts English load-bearing evidence heading with nested content', () => {
  const report = [
    'Overall Status: PASS',
    'Load-bearing evidence:',
    '- command node verify.mjs',
    '- audit token redacted before logging',
    'Findings:',
    '- none',
    'Limits:',
    '- none',
  ].join('\n');
  const result = validateFinalReport(report, { requiredClaimEvidence: [/audit token redacted/i] });
  assert.equal(result.ok, true);
  assert.equal(result.evidenceSections.length, 1);
});

test('final report accepts Chinese evidence section with bullets', () => {
  const report = [
    'Overall Status: PASS',
    '关键证据：',
    '- 运行时双击仅触发一次提交',
    '- audit token redacted in log output',
    '限制：',
    '- none',
  ].join('\n');
  const result = validateFinalReport(report, { requiredClaimEvidence: [/audit token redacted/i] });
  assert.equal(result.ok, true);
  assert.equal(result.evidenceSections.length, 1);
});

test('required claim may be satisfied by evidence bullet content', () => {
  const report = [
    'Overall Status: PASS',
    'Code-review evidence:',
    '- src/session/audit.ts keeps audit token redacted before output',
    'Limits:',
    '- none',
  ].join('\n');
  const result = validateFinalReport(report, { requiredClaimEvidence: [/audit token redacted/i] });
  assert.equal(result.ok, true);
});

test('claim mentioned only in limits does not close PASS', () => {
  const report = [
    'Overall Status: PASS',
    'Evidence: command node verify.mjs; exit code 0; observed visible state',
    'Limits:',
    '- audit token redacted not verified yet',
  ].join('\n');
  const result = validateFinalReport(report, { requiredClaimEvidence: [/audit token redacted/i] });
  assert.equal(result.ok, false);
});

test('linked-worktree style CR gate report is valid without explicit evidence heading', () => {
  const report = [
    'Overall Status: PASS',
    'Scope: caller supplied HEAD/diff for bounded status text change',
    'P0 CR gate:',
    '- caller diff shows `src/ui/status.ts` changed from `"ready"` to `"ready-now"`',
    '- file: src/ui/status.ts line 1 preserves exported status constant with value `ready-now`',
    'Findings:',
    '- none',
    'Limits:',
    '- none',
  ].join('\n');
  const result = validateFinalReport(report, { requiredClaimEvidence: [/ready-now/i] });
  assert.equal(result.ok, true);
  assert.equal(result.concreteEvidenceLines.length > 0, true);
});

test('final report accepts common Chinese evidence and limits wording', () => {
  const report = [
    'Overall Status: PASS',
    '证据：audit token redacted in log output; exit code 0',
    '限制：none',
  ].join('\n');
  const result = validateFinalReport(report);
  assert.equal(result.ok, true);
});

test('evidence-free subagent result is non-actionable and must not count as usable evidence', () => {
  const classification = classifySubagentResult(validBlock({ status: 'OK', gate: 'continue', evidence: 'none' }));
  assert.equal(classification.kind, 'evidence_free');
  assert.equal(classification.actionable, false);
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
    { name: 'missing required fields', input: wrapTaskResult(validBlock({ limitsBlock: false })), expected: 'malformed' },
    { name: 'empty placeholder evidence', input: wrapTaskResult(validBlock({ evidence: '<raw command/output/artifact/file-line/log/observed behavior>' })), expected: 'evidence_free' },
    { name: 'wrong agent', input: wrapTaskResult(validBlock({ agent: 'qa-e2e' })), expected: 'malformed', expectedAgent: 'qa-cr' },
    { name: 'duplicate identical blocks ambiguous', input: wrapTaskResult(`${validBlock({ status: 'OK', gate: 'continue' })}\n${validBlock({ status: 'OK', gate: 'continue' })}`), expected: 'ambiguous' },
    { name: 'multiple differing blocks ambiguous', input: wrapTaskResult(`${validBlock({ status: 'OK', gate: 'continue' })}\n${validBlock({ status: 'FAIL', gate: 'stop_and_fail' })}`), expected: 'ambiguous' },
    { name: 'task status refused', input: { status: 'error', output: '', error: 'request refused by host' }, expected: 'refused' },
    { name: 'task status generic failed', input: { status: 'failed', output: '', error: 'subagent crashed unexpectedly' }, expected: 'failed' },
    { name: 'timeout via status', input: { status: 'timed_out', output: '', error: null }, expected: 'timed_out' },
    { name: 'timeout via structured error text', input: { status: 'error', output: '', error: { message: 'operation timed out after 30s' } }, expected: 'timed_out' },
    { name: 'timeout via generic error text', input: { status: 'error', output: '', error: 'operation timed out after 30s' }, expected: 'timed_out' },
    { name: 'pending incomplete', input: { status: 'running', output: '', error: null }, expected: 'incomplete' },
  ];

  for (const testCase of cases) {
    const result = classifySubagentResult(testCase.input, { expectedAgent: testCase.expectedAgent });
    assert.equal(result.kind, testCase.expected, testCase.name);
    assert.equal(result.actionable, testCase.expected === 'usable', testCase.name);
  }
});

test('no semantic FAIL inference from exit-code strings alone', () => {
  const result = classifySubagentResult(wrapTaskResult(validBlock({ status: 'OK', gate: 'continue', evidence: 'command node verify.mjs; exit code 1; observed mismatch' })));
  assert.equal(result.kind, 'usable');
  assert.match(result.raw, /exit code 1/i);
  assert.equal(result.parsed.status, 'OK');
});

test('pessimistic stop without substantive evidence does not short-circuit qa-e2e', () => {
  const events = parseJsonlEvents([
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: wrapTaskResult(validBlock({ evidence: 'none' })) } } }),
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'running', input: { subagent_type: 'qa-e2e' }, output: '' } } }),
  ].join('\n'));
  assert.doesNotThrow(() => assertNoQaE2eAfterStop(events));
});

test('PASS required claim evidence must appear in evidence-bearing line, not mere mention elsewhere', () => {
  const passReport = [
    'Overall Status: PASS',
    'Evidence: command node verify.mjs; exit code 0; observed visible state',
    'Findings: audit token 未验证',
    'Limits: none',
  ].join('\n');
  const closingPassReport = [
    'Overall Status: PASS',
    'Evidence: audit token redacted in log output; exit code 0; observed visible state',
    'Findings: none',
    'Limits: none',
  ].join('\n');
  const blockedReport = [
    'Overall Status: BLOCKED',
    'Evidence: command node verify.mjs; exit code 1; observed missing fixture',
    'Findings: none',
    'Limits: required audit token claim not covered because fixture is missing',
  ].join('\n');
  assert.equal(validateFinalReport(passReport, { requiredClaimEvidence: [/audit token/i] }).ok, false);
  assert.equal(validateFinalReport(closingPassReport, { requiredClaimEvidence: [/audit token/i] }).ok, true);
  assert.equal(validateFinalReport(blockedReport, { requiredClaimEvidence: [/audit token/i] }).ok, true);
});
