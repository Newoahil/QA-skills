import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoQaE2eAfterStop,
  classifySubagentResult,
  collectToolUseInputs,
  extractCompletedQaEvidenceResults,
  extractFinalReport,
  extractTaskCalls,
  normalizePathLikeText,
  parseJsonlEvents,
  serializeToolUseInputs,
  validateFinalReport,
} from './helpers.mjs';

test('stop_and_fail prevents later qa-e2e work in parsed event stream', () => {
  const jsonl = [
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: '<task_result>\nQA_EVIDENCE_RESULT\nagent: qa-cr\nstatus: FAIL\ngate: stop_and_fail\nevidence:\n  - file: src/a.ts:10\nfindings:\n  - mismatch\nlimits:\n  - none\nrecommended_next:\n  - none\nconfidence: high\nEND_QA_EVIDENCE_RESULT\n</task_result>' } } }),
    JSON.stringify({ type: 'text', part: { text: 'Overall Status: FAIL\nEvidence: file src/a.ts:10\nFindings: mismatch' } }),
  ].join('\n');

  assert.doesNotThrow(() => assertNoQaE2eAfterStop(parseJsonlEvents(jsonl)));
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
    JSON.stringify({ type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: '<task_result>\nQA_EVIDENCE_RESULT\nagent: qa-cr\nstatus: FAIL\ngate: stop_and_fail\nevidence:\n  - file: src/a.ts:10\nfindings:\n  - mismatch\nlimits:\n  - none\nrecommended_next:\n  - none\nconfidence: high\nEND_QA_EVIDENCE_RESULT\n</task_result>' } } }),
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

test('evidence-free subagent result is inconclusive and must not count as usable evidence', () => {
  const classification = classifySubagentResult([
    'QA_EVIDENCE_RESULT',
    'agent: qa-cr',
    'status: OK',
    'gate: continue',
    'evidence:',
    'findings:',
    '  - none',
    'limits:',
    '  - none',
    'recommended_next:',
    '  - none',
    'confidence: low',
    'END_QA_EVIDENCE_RESULT',
  ].join('\n'));
  assert.equal(classification.kind, 'inconclusive');
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
