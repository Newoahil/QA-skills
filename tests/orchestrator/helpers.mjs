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
const KNOWN_PLACEHOLDERS = new Set([
  '<assigned scope>',
  '<bounded slice or flow actually checked>',
  '<assigned diff/touched-file scope actually checked>',
  '<raw command/output/artifact/file-line/log/observed behavior>',
  '<raw file-line/code relationship/contract/test-output/log/diff evidence>',
  '<finding tied to evidence, or none>',
  '<what was not checked and why>',
  '<next evidence/fix/human step, or none>',
  '<next evidence/fix/human/e2e step, or none>',
  '<high|medium|low plus reason>',
]);

function isPlaceholderValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.length === 0 || KNOWN_PLACEHOLDERS.has(normalized) || normalized === 'tbd' || normalized === 'todo';
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

const QA_REQUIRED_FIELDS = ['agent', 'scope', 'status', 'gate', 'evidence', 'limits'];
const QA_OPTIONAL_FIELDS = ['findings', 'recommended_next', 'confidence'];
const QA_KNOWN_FIELDS = new Set([...QA_REQUIRED_FIELDS, ...QA_OPTIONAL_FIELDS]);
const QA_BULLET_FIELDS = new Set(['evidence', 'findings', 'limits', 'recommended_next']);

function parseStructuredQaEvidenceBlock(block) {
  const parsed = {
    agent: null,
    scope: null,
    status: null,
    gate: null,
    evidence: [],
    findings: [],
    limits: [],
    recommended_next: [],
    confidence: null,
  };
  const structuralIssues = [];
  const fieldCounts = Object.fromEntries([...QA_KNOWN_FIELDS].map((field) => [field, 0]));
  let currentSection = null;

  for (const rawLine of String(block ?? '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    const fieldMatch = /^([a-z_]+):\s*(.*)$/.exec(trimmed);
    if (fieldMatch) {
      const [, fieldName, remainder] = fieldMatch;
      currentSection = null;
      if (!QA_KNOWN_FIELDS.has(fieldName)) {
        structuralIssues.push(`unknown top-level field: ${fieldName}`);
        continue;
      }

      fieldCounts[fieldName] += 1;
      if ((QA_REQUIRED_FIELDS.includes(fieldName) && fieldCounts[fieldName] !== 1)
        || (QA_OPTIONAL_FIELDS.includes(fieldName) && fieldCounts[fieldName] > 1)) {
        structuralIssues.push(`duplicate field: ${fieldName}`);
      }

      if (QA_BULLET_FIELDS.has(fieldName)) {
        if (remainder.trim().length > 0) structuralIssues.push(`invalid inline content for field: ${fieldName}`);
        currentSection = fieldName;
      } else {
        parsed[fieldName] = remainder.trim() || null;
      }
      continue;
    }

    const bulletMatch = /^-\s+(.+)$/.exec(trimmed);
    if (bulletMatch && currentSection) {
      parsed[currentSection].push(bulletMatch[1]);
      continue;
    }

    structuralIssues.push(currentSection ? `invalid content in field: ${currentSection}` : 'unexpected content');
  }

  for (const fieldName of QA_REQUIRED_FIELDS) {
    if (fieldCounts[fieldName] !== 1) structuralIssues.push(`missing field: ${fieldName}`);
  }

  return { parsed, structuralIssues };
}

function blockStructuralIssues(parsed) {
  const issues = [];
  if (isPlaceholderValue(parsed.agent)) issues.push('missing agent');
  if (isPlaceholderValue(parsed.scope)) issues.push('missing scope');
  if (!QA_RESULT_STATUSES.has(parsed.status)) issues.push('invalid status');
  if (!QA_RESULT_GATES.has(parsed.gate)) issues.push('invalid gate');
  if (parsed.limits.length === 0) issues.push('missing limits');
  if (parsed.evidence.length === 0) {
    issues.push('missing evidence');
  } else if (parsed.evidence.every((value) => isPlaceholderValue(value) || /^none$/i.test(value.trim()))) {
    issues.push('evidence is empty or placeholder');
  }
  return issues;
}

export function extractQaEvidenceBlocks(text) {
  const source = String(text ?? '');
  const matches = [...source.matchAll(/(?:^|\r?\n)[ \t]*QA_EVIDENCE_RESULT[ \t]*\r?\n([\s\S]*?)(?:\r?\n)[ \t]*END_QA_EVIDENCE_RESULT[ \t]*(?=\r?\n|$)/g)];
  return matches.map((match, index) => {
    const block = match[1];
    const { parsed, structuralIssues: shapeIssues } = parseStructuredQaEvidenceBlock(block);
    const structuralIssues = [...shapeIssues, ...blockStructuralIssues(parsed)];
    return {
      index,
      raw: match[0],
      body: block,
      structuralIssues,
      parsed,
      usable: structuralIssues.length === 0,
      substantiveEvidence: parsed.evidence.some((value) => !isPlaceholderValue(value) && !/^none$/i.test(value.trim())),
    };
  });
}

const EPISTEMICALLY_NEGATIVE_EVIDENCE_PATTERN = /\b(?:not verified|could not be verified|not observed|was not observed|not validated|unverified|unchecked|not checked|unable to verify|unable to confirm|cannot verify|could not verify|no evidence)\b/i;
const UNRESOLVED_REQUIRED_CLAIM_PATTERN = /(?:\b(?:was\s+)?skipp(?:ed|ing)\b|\bnot(?:[ -]+)?(?:run|performed|done|completed)\b|\bdeferred(?: until later)?\b|\bpending\b(?:(?:\s+(?:review|verification|validation|confirmation|execution|run))|(?:\s*[.!;:,)\]]*)?\s*$))/i;

function containsPositiveClaimEvidence(evidenceLines, claim) {
  const pattern = claim instanceof RegExp ? claim : new RegExp(String(claim), 'i');
  return evidenceLines.some((line) => pattern.test(line)
    && !EPISTEMICALLY_NEGATIVE_EVIDENCE_PATTERN.test(line)
    && !UNRESOLVED_REQUIRED_CLAIM_PATTERN.test(line));
}

function extractReportSections(reportText) {
  const lines = String(reportText ?? '').split(/\r?\n/);
  const evidenceHeaderPattern = /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:(?:load-bearing|runtime|code-review)(?:\s+(?:runtime|code-review))?\s+)?evidence(?:\s+and\s+findings)?\s*[:：]|^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:证据|关键证据|运行时证据|代码审查证据|证据与发现)\s*[:：]/i;
  const compatibleEvidenceBearingHeadingPattern = /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:p0\s+cr\s+gate|cr\s+gate|code-review\s+evidence)\s*[:：]/i;
  const evidenceFindingsHeaderPattern = /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:evidence\s+and\s+findings|证据与发现)\s*[:：]/i;
  const findingsHeaderPattern = /^(?:#{1,6}\s*)?(?:findings?|发现|结论)\s*[:：]?/i;
  const limitsHeaderPattern = /^(?:#{1,6}\s*)?(?:limits?|residual risk|限制|残余风险|未覆盖)\s*[:：]?/i;
  const recommendationHeaderPattern = /^(?:#{1,6}\s*)?(?:recommended_next|recommendations?|建议)\s*[:：]?/i;
  const futureWorkHeaderPattern = /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:planned\s+(?:verification|checks?)|待验证|计划验证)\s*[:：]?/i;
  const nonEvidenceHeaderPattern = /^(?:#{1,6}\s*)?(?:commitments?|scope|environment-needed handoff|next steps?|suggestions?|承诺|范围|环境交接|环境需求交接|下一步|后续步骤|建议)\s*[:：]?/i;
  const stopPattern = /^(?:#{1,6}\s*)?(?:findings?|发现|结论|limits?|residual risk|限制|残余风险|未覆盖|recommended_next|recommendations?|建议|commitments?|scope|environment-needed handoff|next steps?|suggestions?|planned\s+(?:verification|checks?)|承诺|范围|环境交接|环境需求交接|下一步|后续步骤|待验证|计划验证)\s*[:：]?/i;
  const plainHeadingPattern = /^(?![-*]\s)(?:[A-Za-z][A-Za-z0-9 _()\/-]*|[\u4e00-\u9fffA-Za-z0-9 _()\/-]{1,40})\s*[:：]\s*$/;
  const evidenceSections = [];
  const concreteEvidenceLines = [];

  const concreteEvidencePattern = /(`[^`]+`|\b[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+\b|\bfile\s*:\s*[^\s]+|\bline\s+\d+\b|\bHEAD\b|\bdiff\b|https?:\/\/|\bexit code\b|\bobserved\b|\bstdout\b|\bstderr\b)/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!evidenceHeaderPattern.test(line)) continue;

    const sectionLines = [line];
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidateRaw = lines[next];
      const candidate = candidateRaw.trim();
      if (candidate.length === 0) {
        sectionLines.push(candidate);
        continue;
      }
      if (stopPattern.test(candidate) || plainHeadingPattern.test(candidate)) break;
      if (/^(?:#{1,6}\s*)/.test(candidate) && !/^(?:[-*]\s*)/.test(candidate)) break;
      sectionLines.push(candidateRaw);
    }
    evidenceSections.push(sectionLines.join('\n').trim());
  }

  let collectingConcreteEvidence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (evidenceHeaderPattern.test(line) || compatibleEvidenceBearingHeadingPattern.test(line)) {
      collectingConcreteEvidence = true;
      concreteEvidenceLines.push(line);
      continue;
    }
    if (futureWorkHeaderPattern.test(line)) {
      collectingConcreteEvidence = false;
      continue;
    }
    if (nonEvidenceHeaderPattern.test(line)) {
      collectingConcreteEvidence = false;
      continue;
    }
    if (stopPattern.test(line)) {
      collectingConcreteEvidence = false;
      continue;
    }
    if (plainHeadingPattern.test(line)) {
      collectingConcreteEvidence = false;
      continue;
    }
    if (/^(?:#{1,6}\s*)/.test(line) && !stopPattern.test(line)) {
      collectingConcreteEvidence = false;
    }
    if (!collectingConcreteEvidence) continue;
    if (!nonEvidenceHeaderPattern.test(line) && !futureWorkHeaderPattern.test(line) && concreteEvidencePattern.test(line)) {
      concreteEvidenceLines.push(line);
    }
  }

  return {
    evidenceSections,
    concreteEvidenceLines,
    hasFindingsSection: lines.some((line) => findingsHeaderPattern.test(line.trim()) || evidenceFindingsHeaderPattern.test(line.trim())),
    hasLimitsSection: lines.some((line) => limitsHeaderPattern.test(line.trim())),
    hasRecommendationSection: lines.some((line) => recommendationHeaderPattern.test(line.trim())),
  };
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
  const lines = String(reportText ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections = extractReportSections(reportText);
  const evidenceText = [...sections.evidenceSections, ...sections.concreteEvidenceLines].join('\n');
  const findingsLike = sections.hasFindingsSection || sections.hasLimitsSection;
  const requiredClaimEvidence = options.requiredClaimEvidence ?? options.requiredClaims ?? [];
  const missingRequiredClaims = status === 'PASS'
    ? requiredClaimEvidence.filter((claim) => !containsPositiveClaimEvidence([...sections.evidenceSections, ...sections.concreteEvidenceLines], claim))
    : requiredClaimEvidence.filter((claim) => {
      const pattern = claim instanceof RegExp ? claim : new RegExp(String(claim), 'i');
      return !pattern.test(evidenceText);
    });
  return {
    status,
    ok: Boolean(status && lines.length > 1 && (sections.evidenceSections.length > 0 || sections.concreteEvidenceLines.length > 0) && findingsLike && !(status === 'PASS' && missingRequiredClaims.length > 0)),
    missingRequiredClaims,
    evidenceSections: sections.evidenceSections,
    concreteEvidenceLines: sections.concreteEvidenceLines,
    reasons: [
      !status ? 'missing Overall Status' : null,
      lines.length <= 1 ? 'status-only report' : null,
      (sections.evidenceSections.length === 0 && sections.concreteEvidenceLines.length === 0) ? 'missing load-bearing evidence summary' : null,
      !findingsLike ? 'missing findings or limits summary' : null,
      status === 'PASS' && missingRequiredClaims.length > 0 ? `missing required claims: ${missingRequiredClaims.map(String).join(', ')}` : null,
    ].filter(Boolean),
  };
}

export function parseQaEvidenceResult(text) {
  const classified = classifySubagentResult(text);
  if (classified.kind !== 'usable') return null;
  const block = classified.blocks[0];
  return {
    raw: block.body,
    status: block.parsed.status,
    gate: block.parsed.gate,
    evidence: block.parsed.evidence,
  };
}

export function classifySubagentResult(input, options = {}) {
  const expectedAgent = options.expectedAgent ?? null;
  if (input && typeof input === 'object' && 'status' in input && 'output' in input) {
    const errorText = summarizeTaskError(input.error ?? '');
    if (input.status === 'timed_out' || /timed\s*out|timeout/i.test(errorText)) {
      return { kind: 'timed_out', actionable: false, raw: input.output ?? '', error: input.error ?? null };
    }
    if (/refused|denied|rejected|not available|unavailable/i.test(errorText)) {
      return { kind: 'refused', actionable: false, raw: input.output ?? '', error: input.error ?? null };
    }
    if (input.status === 'error' || input.status === 'failed' || input.error) {
      return { kind: 'failed', actionable: false, raw: input.output ?? '', error: input.error ?? null };
    }
    if (input.status !== 'completed') return { kind: 'incomplete', actionable: false, raw: input.output ?? '' };
    const taskResultText = extractTaskResultText(input.output);
    if (!taskResultText) return { kind: 'missing', actionable: false, raw: input.output ?? '', wrapperMissing: true };
    return classifySubagentResult(taskResultText, options);
  }

  const blocks = extractQaEvidenceBlocks(input);
  if (blocks.length === 0) return { kind: 'missing', actionable: false, raw: String(input ?? ''), blockCount: 0 };
  if (blocks.length > 1) {
    return {
      kind: 'ambiguous',
      actionable: false,
      raw: String(input ?? ''),
      blocks,
      blockCount: blocks.length,
    };
  }
  const [block] = blocks;
  if (expectedAgent && block.parsed.agent !== expectedAgent) {
    return { kind: 'malformed', actionable: false, raw: String(input ?? ''), blocks, issues: ['wrong agent'] };
  }
  if (block.structuralIssues.length > 0) {
    const evidenceFreeOnly = block.structuralIssues.every((issue) => issue === 'missing evidence' || issue === 'evidence is empty or placeholder');
    return {
      kind: evidenceFreeOnly ? 'evidence_free' : 'malformed',
      actionable: false,
      raw: String(input ?? ''),
      blocks,
      issues: block.structuralIssues,
      substantiveEvidence: block.substantiveEvidence,
    };
  }

  return {
    kind: 'usable',
    actionable: true,
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
    assert.ok(!['qa-api', 'qa-e2e'].includes(call.subagentType), 'qa-api or qa-e2e must not appear after a completed qa-cr stop_and_fail result');
  }
}
