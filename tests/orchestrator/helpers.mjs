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
      error: summarizeTaskError(event?.part?.state?.error ?? null),
      callID: event?.part?.callID ?? null,
    }));
}

function summarizeTaskError(error) {
  if (error == null) return null;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function extractTaskResultText(output) {
  const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/i.exec(String(output ?? ''));
  return match?.[1] ?? null;
}

const QA_RESULT_STATUSES = new Set(['OK', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const QA_RESULT_GATES = new Set(['continue', 'stop_and_fail', 'need_e2e', 'need_human', 'blocked']);

function isPlaceholderValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.length === 0 || /^<.+>$/.test(normalized) || normalized === 'tbd' || normalized === 'todo';
}

function parseBulletSection(block, sectionName) {
  const pattern = new RegExp(`^\\s*${sectionName}:\\s*$`, 'i');
  const stopPattern = /^\s*(agent|scope|status|gate|evidence|findings|limits|recommended_next|confidence):/i;
  const lines = block.split(/\r?\n/);
  const values = [];
  let inSection = false;
  for (const line of lines) {
    if (pattern.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && stopPattern.test(line)) {
      inSection = false;
    }
    if (!inSection) continue;
    const bullet = /^\s*-\s+(.+)$/.exec(line);
    if (bullet) values.push(bullet[1]);
  }
  return values;
}

function parseScalarField(block, fieldName) {
  return new RegExp(`^\\s*${fieldName}:\\s*(.+)$`, 'im').exec(block)?.[1]?.trim() ?? null;
}

function blockStructuralIssues(parsed) {
  const issues = [];
  if (isPlaceholderValue(parsed.agent)) issues.push('missing agent');
  if (isPlaceholderValue(parsed.scope)) issues.push('missing scope');
  if (!QA_RESULT_STATUSES.has(parsed.status)) issues.push('invalid status');
  if (!QA_RESULT_GATES.has(parsed.gate)) issues.push('invalid gate');
  if (isPlaceholderValue(parsed.confidence)) issues.push('missing confidence');
  for (const sectionName of ['findings', 'limits', 'recommended_next']) {
    if (parsed[sectionName].length === 0) issues.push(`missing ${sectionName}`);
  }
  if (parsed.evidence.length === 0) {
    issues.push('missing evidence');
  } else if (parsed.evidence.every((value) => isPlaceholderValue(value) || /^none$/i.test(value.trim()))) {
    issues.push('evidence is empty or placeholder');
  }
  return issues;
}

export function extractQaEvidenceBlocks(text) {
  const source = String(text ?? '');
  const matches = [...source.matchAll(/QA_EVIDENCE_RESULT\s*([\s\S]*?)END_QA_EVIDENCE_RESULT/g)];
  return matches.map((match, index) => {
    const block = match[1];
    const parsed = {
      agent: parseScalarField(block, 'agent'),
      scope: parseScalarField(block, 'scope'),
      status: parseScalarField(block, 'status'),
      gate: parseScalarField(block, 'gate'),
      evidence: parseBulletSection(block, 'evidence'),
      findings: parseBulletSection(block, 'findings'),
      limits: parseBulletSection(block, 'limits'),
      recommended_next: parseBulletSection(block, 'recommended_next'),
      confidence: parseScalarField(block, 'confidence'),
    };
    const structuralIssues = blockStructuralIssues(parsed);
    return {
      index,
      raw: match[0],
      body: block,
      markerCount: 1,
      structuralIssues,
      parsed,
      usable: structuralIssues.length === 0,
      substantiveEvidence: parsed.evidence.some((value) => !isPlaceholderValue(value) && !/^none$/i.test(value.trim())),
    };
  });
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
    ...source.matchAll(/E2E_RUN_RESULT[^\r\n]*\r?\n\s*(?:```json\s*\r?\n\s*)?(\{[^\r\n]+\})/g),
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
  const options = arguments[1] ?? {};
  const status = extractOverallStatus(reportText);
  const nonEmptyLines = String(reportText ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const evidenceLike = /(evidence|command|exit code|observed|artifact)/i.test(reportText ?? '');
  const findingsLike = /(findings?|limits?|residual risk|none)/i.test(reportText ?? '');
  const missingRequiredClaims = (options.requiredClaims ?? []).filter((claim) => {
    const pattern = claim instanceof RegExp ? claim : new RegExp(String(claim), 'i');
    return !pattern.test(reportText ?? '');
  });
  return {
    status,
    ok: Boolean(status && nonEmptyLines.length > 1 && evidenceLike && findingsLike && !(status === 'PASS' && missingRequiredClaims.length > 0)),
    missingRequiredClaims,
    reasons: [
      !status ? 'missing Overall Status' : null,
      nonEmptyLines.length <= 1 ? 'status-only report' : null,
      !evidenceLike ? 'missing load-bearing evidence summary' : null,
      !findingsLike ? 'missing findings or limits summary' : null,
      status === 'PASS' && missingRequiredClaims.length > 0 ? `missing required claims: ${missingRequiredClaims.map(String).join(', ')}` : null,
    ].filter(Boolean),
  };
}

export function parseQaEvidenceResult(text) {
  const blocks = extractQaEvidenceBlocks(text);
  if (blocks.length !== 1 || !blocks[0]?.parsed) return null;
  return {
    raw: blocks[0].body,
    status: blocks[0].parsed.status,
    gate: blocks[0].parsed.gate,
    evidence: blocks[0].parsed.evidence,
  };
}

export function classifySubagentResult(input, options = {}) {
  const expectedAgent = options.expectedAgent ?? null;
  if (input && typeof input === 'object' && 'status' in input && 'output' in input) {
    const errorText = String(input.error ?? '');
    if (input.status === 'timed_out' || /timed\s*out|timeout/i.test(errorText)) {
      return { kind: 'timed_out', actionable: false, canSupportPass: false, canSupportFail: false, raw: input.output ?? '', error: input.error ?? null };
    }
    if (/refused|denied|rejected|not available|unavailable/i.test(errorText)) {
      return { kind: 'refused', actionable: false, canSupportPass: false, canSupportFail: false, raw: input.output ?? '', error: input.error ?? null };
    }
    if (input.status === 'error' || input.status === 'failed' || input.error) {
      return { kind: 'failed', actionable: false, canSupportPass: false, canSupportFail: false, raw: input.output ?? '', error: input.error ?? null };
    }
    if (input.status !== 'completed') return { kind: 'incomplete', actionable: false, canSupportPass: false, canSupportFail: false, raw: input.output ?? '' };
    const taskResultText = extractTaskResultText(input.output);
    if (!taskResultText) return { kind: 'missing', actionable: false, canSupportPass: false, canSupportFail: false, raw: input.output ?? '', wrapperMissing: true };
    return classifySubagentResult(taskResultText, options);
  }

  const blocks = extractQaEvidenceBlocks(input);
  if (blocks.length === 0) return { kind: 'missing', actionable: false, canSupportPass: false, canSupportFail: false, raw: String(input ?? ''), blockCount: 0 };
  if (blocks.length > 1) {
    const first = JSON.stringify(blocks[0].parsed);
    const equivalent = blocks.every((block) => JSON.stringify(block.parsed) === first);
    return {
      kind: equivalent ? 'ambiguous' : 'conflicting',
      actionable: false,
      canSupportPass: false,
      canSupportFail: !equivalent,
      raw: String(input ?? ''),
      blocks,
      blockCount: blocks.length,
    };
  }
  const [block] = blocks;
  if (expectedAgent && block.parsed.agent !== expectedAgent) {
    return { kind: 'malformed', actionable: false, canSupportPass: false, canSupportFail: false, raw: String(input ?? ''), blocks, issues: ['wrong agent'] };
  }
  if (block.structuralIssues.length > 0) {
    const evidenceFreeOnly = block.structuralIssues.every((issue) => issue === 'missing evidence' || issue === 'evidence is empty or placeholder');
    return {
      kind: evidenceFreeOnly ? 'evidence_free' : 'malformed',
      actionable: false,
      canSupportPass: false,
      canSupportFail: false,
      raw: String(input ?? ''),
      blocks,
      issues: block.structuralIssues,
      substantiveEvidence: block.substantiveEvidence,
    };
  }

  const objectiveFailureConflict = block.parsed.status === 'OK' && block.substantiveEvidence && block.parsed.evidence.some((value) => (
    /(?:^|\b)exit code\s*[:=]?\s*([1-9]\d*)\b/i.test(value)
    || /\btestExitCode\s*[:=]\s*([1-9]\d*)\b/i.test(value)
    || /\brunner status\s*[:=]\s*FAIL\b/i.test(value)
    || /"status"\s*:\s*"FAIL"/.test(value)
  ));
  if (objectiveFailureConflict) {
    return {
      kind: 'conflicting',
      actionable: false,
      canSupportPass: false,
      canSupportFail: true,
      raw: String(input ?? ''),
      blocks,
      parsed: block.parsed,
      substantiveEvidence: block.substantiveEvidence,
      issues: ['optimistic status conflicts with objective nonzero exit evidence'],
    };
  }

  return {
    kind: 'usable',
    actionable: true,
    canSupportPass: block.parsed.status === 'OK',
    canSupportFail: block.parsed.status === 'FAIL' && block.substantiveEvidence,
    raw: String(input ?? ''),
    blocks,
    parsed: block.parsed,
    substantiveEvidence: block.substantiveEvidence,
  };
}

export function assertNoQaE2eAfterStop(events) {
  const completed = extractCompletedQaEvidenceResults(events);
  const stop = completed.find((call) => {
    if (call.subagentType !== 'qa-cr') return false;
    const classified = classifySubagentResult(call, { expectedAgent: 'qa-cr' });
    return classified.kind === 'usable'
      && classified.parsed.status === 'FAIL'
      && classified.parsed.gate === 'stop_and_fail'
      && classified.substantiveEvidence;
  });
  if (!stop) return;

  const taskCalls = extractTaskCalls(events);
  for (const call of taskCalls) {
    if (call.index <= stop.index) continue;
    assert.notEqual(call.subagentType, 'qa-e2e', 'qa-e2e must not appear after a completed qa-cr stop_and_fail result');
  }
}
