import assert from 'node:assert/strict';

export function parseJsonlEvents(jsonlText) {
  return jsonlText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

export function extractTaskCalls(events) {
  return events
    .filter((event) => event?.type === 'tool_use' && event?.part?.tool === 'task')
    .map((event, index) => ({
      index,
      event,
      status: event?.part?.state?.status ?? null,
      input: event?.part?.state?.input ?? {},
      subagentType: event?.part?.state?.input?.subagent_type ?? null,
      output: event?.part?.state?.output ?? '',
      callID: event?.part?.callID ?? null,
    }));
}

export function extractTaskResultText(output) {
  const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/i.exec(String(output ?? ''));
  return match?.[1] ?? null;
}

export function extractCompletedTaskResultTexts(events) {
  return extractTaskCalls(events)
    .filter((call) => call.status === 'completed')
    .map((call) => ({
      ...call,
      taskResultText: extractTaskResultText(call.output),
    }))
    .filter((call) => typeof call.taskResultText === 'string' && call.taskResultText.length > 0);
}

export function collectToolUseInputs(events) {
  return events
    .filter((event) => event?.type === 'tool_use')
    .map((event) => event?.part?.state?.input)
    .filter(Boolean);
}

export function serializeToolUseInputs(events) {
  return JSON.stringify(collectToolUseInputs(events));
}

export function normalizePathLikeText(text) {
  return String(text ?? '').replace(/\\/g, '/');
}

export function combinedEvidenceText({ finalReport, events }) {
  const taskResultTexts = extractCompletedTaskResultTexts(events).map((entry) => entry.taskResultText);
  return [finalReport, ...taskResultTexts].filter(Boolean).join('\n');
}

export function finalStepTokens(events) {
  let total = null;
  for (const event of events) {
    if ((event?.type === 'step-finish' || event?.type === 'step_finish') && typeof event?.part?.tokens?.total === 'number') {
      total = event.part.tokens.total;
    }
  }
  return total;
}

export function extractE2ERunResults(text) {
  const source = String(text ?? '');
  const candidates = [
    ...source.matchAll(/E2E_RUN_RESULT[^{}\r\n]*(\{[^\r\n]+\})/g),
    ...source.matchAll(/E2E_RUN_RESULT[^\r\n]*\r?\n(?:```json\s*\r?\n)?(\{[^\r\n]+\})/g),
  ].map((match) => match[1]);
  return [...new Set(candidates)].map((candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function extractE2ERunResultsFromEvents(events) {
  return extractCompletedTaskResultTexts(events)
    .flatMap((entry) => extractE2ERunResults(entry.taskResultText).map((result) => ({
      subagentType: entry.subagentType,
      callID: entry.callID,
      result,
    })));
}

export function assertExactTaskTypes(events, expectedTaskTypes) {
  const actual = extractTaskCalls(events).map((call) => call.subagentType).filter(Boolean);
  assert.deepEqual(actual, expectedTaskTypes);
}

export function extractCompletedQaEvidenceResults(events) {
  return extractCompletedTaskResultTexts(events)
    .map((call) => {
      const parsed = parseQaEvidenceResult(call.taskResultText);
      return {
        ...call,
        qaEvidence: parsed,
      };
    })
    .filter((call) => call.qaEvidence);
}

export function extractFinalReport(events) {
  let finalText = null;
  for (const event of events) {
    const text = event?.part?.text ?? event?.text ?? null;
    if ((event?.type === 'text' || event?.type === 'message') && typeof text === 'string') {
      finalText = text;
    }
  }
  return finalText;
}

export function extractEvidenceBlocks(reportText) {
  if (typeof reportText !== 'string') return [];
  return reportText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''));
}

export function extractOverallStatus(reportText) {
  const match = /^Overall Status:\s*(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\s*$/m.exec(reportText ?? '');
  return match?.[1] ?? null;
}

export function validateFinalReport(reportText) {
  const status = extractOverallStatus(reportText);
  const nonEmptyLines = String(reportText ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const evidenceLike = /(evidence|command|exit code|observed|artifact)/i.test(reportText ?? '');
  const findingsLike = /(findings?|limits?|residual risk|none)/i.test(reportText ?? '');
  return {
    status,
    ok: Boolean(status && nonEmptyLines.length > 1 && evidenceLike && findingsLike),
    reasons: [
      !status ? 'missing Overall Status' : null,
      nonEmptyLines.length <= 1 ? 'status-only report' : null,
      !evidenceLike ? 'missing load-bearing evidence summary' : null,
      !findingsLike ? 'missing findings or limits summary' : null,
    ].filter(Boolean),
  };
}

export function parseQaEvidenceResult(text) {
  const match = /QA_EVIDENCE_RESULT\s*([\s\S]*?)END_QA_EVIDENCE_RESULT/.exec(text ?? '');
  if (!match) return null;
  const block = match[1];
  const status = /status:\s*(OK|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)/i.exec(block)?.[1] ?? null;
  const gate = /gate:\s*(continue|stop_and_fail|need_e2e|need_human|blocked)/i.exec(block)?.[1] ?? null;
  const lines = block.split(/\r?\n/);
  const evidence = [];
  let inEvidence = false;
  for (const line of lines) {
    if (/^\s*evidence:\s*$/i.test(line)) {
      inEvidence = true;
      continue;
    }
    if (/^\s*(findings|limits|recommended_next|confidence|status|gate|scope|agent):/i.test(line)) {
      inEvidence = false;
    }
    if (inEvidence) {
      const bullet = /^\s*-\s+(.+)$/.exec(line);
      if (bullet) evidence.push(bullet[1]);
    }
  }
  return { raw: block, status, gate, evidence };
}

export function classifySubagentResult(text) {
  const parsed = parseQaEvidenceResult(text);
  if (!parsed) return { kind: 'missing', actionable: false };
  if (parsed.evidence.length === 0) return { kind: 'inconclusive', actionable: false, parsed };
  return { kind: 'usable', actionable: true, parsed };
}

export function assertNoQaE2eAfterStop(events) {
  const completed = extractCompletedQaEvidenceResults(events);
  const stop = completed.find((call) => call.subagentType === 'qa-cr' && call.qaEvidence?.gate === 'stop_and_fail');
  if (!stop) return;

  const taskCalls = extractTaskCalls(events);
  for (const call of taskCalls) {
    if (call.index <= stop.index) continue;
    assert.notEqual(call.subagentType, 'qa-e2e', 'qa-e2e must not appear after a completed qa-cr stop_and_fail result');
  }
}
