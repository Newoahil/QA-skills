import { extractTaskCalls, classifySubagentResult } from '../helpers.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';

export const SCORE_INPUT_FACTS_SCHEMA_VERSION = 'qa-cr-score-input-facts-v1';
export const OBSERVATION_COMPLETE = 'COMPLETE';
export const OBSERVATION_BLOCKED = 'BLOCKED';

function safeIssue(code) {
  return String(code).replace(/[^a-z0-9:_-]/gi, '_').slice(0, 120);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueObservedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0))];
}

function pickActualDisposition(classified) {
  if (classified?.kind !== 'usable') {
    return { classificationKind: classified?.kind ?? 'missing', status: null, gate: null, substantiveEvidence: false };
  }
  return {
    classificationKind: classified.kind,
    status: classified.parsed.status,
    gate: classified.parsed.gate,
    substantiveEvidence: Boolean(classified.substantiveEvidence),
  };
}

export function classifyPrimaryDisposition({ parentEvents }) {
  const calls = extractTaskCalls(Array.isArray(parentEvents) ? parentEvents : []).filter((call) => call.subagentType === 'qa-cr');
  if (calls.length !== 1) return { classificationKind: calls.length === 0 ? 'missing' : 'ambiguous', status: null, gate: null, substantiveEvidence: false };
  return pickActualDisposition(classifySubagentResult(calls[0], { expectedAgent: 'qa-cr' }));
}

function normalizeExportStatus(value) {
  if (value == null) return 'UNAVAILABLE';
  if (typeof value === 'number') return value === 0 ? 'OK' : 'FAILED';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return 'UNAVAILABLE';
  return new Set(['ok', 'success', 'complete', 'completed', '0']).has(normalized) ? 'OK' : 'FAILED';
}

function parentTaskTypeCounts(taskCalls) {
  const counts = new Map();
  for (const call of taskCalls) counts.set(call.subagentType ?? 'unknown', (counts.get(call.subagentType ?? 'unknown') ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([taskType, count]) => ({ taskType, count }));
}

export function alignObservedChildExports({ parentEvents, childExports }) {
  const observedChildIds = extractQaCrChildSessionIds(parentEvents);
  const bySessionId = new Map();
  const anonymousExports = [];
  for (const entry of Array.isArray(childExports) ? childExports : []) {
    const sessionId = entry?.sessionId ?? null;
    if (!sessionId) {
      anonymousExports.push(entry);
      continue;
    }
    const list = bySessionId.get(sessionId) ?? [];
    list.push(entry);
    bySessionId.set(sessionId, list);
  }
  return {
    observedChildIds,
    aligned: observedChildIds.map((sessionId) => ({
      expectedSessionId: sessionId,
      matches: bySessionId.get(sessionId) ?? [],
    })),
    extraExports: [...bySessionId.entries()].filter(([sessionId]) => !observedChildIds.includes(sessionId)).flatMap(([, list]) => list),
    duplicateExports: [...bySessionId.entries()].filter(([, list]) => list.length > 1).flatMap(([, list]) => list),
    anonymousExports,
  };
}

export function buildChildTopologyFacts({ parentEvents, childExports, telemetry, parentSessionId = null }) {
  const taskCalls = extractTaskCalls(Array.isArray(parentEvents) ? parentEvents : []);
  const qaCrTaskCalls = taskCalls.filter((call) => call.subagentType === 'qa-cr');
  const aligned = alignObservedChildExports({ parentEvents, childExports });
  const observedChildIds = aligned.observedChildIds;
  const childStatuses = [];
  const issueCodes = [];

  if (qaCrTaskCalls.length !== 1) issueCodes.push(qaCrTaskCalls.length === 0 ? 'missing_qa_cr_child' : 'multiple_qa_cr_children');
  const extraTaskTypes = [...new Set(taskCalls.map((call) => call.subagentType).filter((type) => type && type !== 'qa-cr'))];
  if (extraTaskTypes.length) issueCodes.push('extra_child_task_type');
  if (observedChildIds.length !== 1) issueCodes.push(observedChildIds.length === 0 ? 'missing_child_session_id' : 'duplicate_or_extra_child_session_id');
  if (aligned.extraExports.length) issueCodes.push('extra_child_export');
  if (aligned.duplicateExports.length) issueCodes.push('duplicate_child_export');
  if (aligned.anonymousExports.length) issueCodes.push('anonymous_child_export');

  for (const [index, item] of aligned.aligned.entries()) {
    const childTelemetry = Array.isArray(telemetry?.children) ? telemetry.children[index] ?? null : null;
    const exported = item.matches.length === 1 ? item.matches[0] : null;
    const exportState = item.matches.length === 0 ? 'MISSING' : item.matches.length === 1 ? 'PRESENT' : 'DUPLICATE';
    const exportStatus = exported ? normalizeExportStatus(exported.exportStatus) : 'UNAVAILABLE';
    const parseStatus = exported == null ? 'UNAVAILABLE' : childTelemetry?.anomalies?.some((entry) => entry?.code === 'missing_export') ? 'UNAVAILABLE' : childTelemetry?.gaps?.includes('missing-export-json') ? 'MALFORMED_OR_MISSING' : 'PARSED';
    const linkage = !childTelemetry || !parentSessionId ? 'UNAVAILABLE'
      : childTelemetry.sessionId && childTelemetry.sessionId !== item.expectedSessionId ? 'MISMATCH'
      : parentSessionId && childTelemetry.parentSessionId && childTelemetry.parentSessionId !== parentSessionId ? 'MISMATCH'
      : childTelemetry.parentSessionId == null ? 'UNAVAILABLE'
      : 'MATCH';
    childStatuses.push({
      sessionId: item.expectedSessionId,
      exportState,
      exportStatus,
      parseStatus,
      linkage,
    });
    if (exportState === 'MISSING') issueCodes.push('missing_child_export');
    if (exportState === 'DUPLICATE') issueCodes.push('duplicate_child_export');
    if (exportStatus === 'FAILED') issueCodes.push('failed_child_export_status');
    if (parseStatus === 'MALFORMED_OR_MISSING') issueCodes.push('malformed_child_export');
    if (linkage === 'MISMATCH') issueCodes.push('child_linkage_invalid');
  }

  return {
    observedTaskTypes: [...new Set(taskCalls.map((call) => call.subagentType).filter(Boolean))],
    parentTaskTypeCounts: parentTaskTypeCounts(taskCalls),
    qaCrChildIds: observedChildIds,
    childStatuses,
    issueCodes: [...new Set(issueCodes)].sort(),
  };
}

function compareObservedExpected(observed, expected) {
  if (observed == null || expected == null) return 'UNAVAILABLE';
  return observed === expected ? 'MATCH' : 'MISMATCH';
}

function normalizeTerminal(terminal) {
  const meta = terminal?.meta ?? null;
  if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) {
    return { exitCode: null, signal: null, spawnError: null, timedOut: null, exact: false, valid: false };
  }
  const exact = meta?.exactKeys === true;
  const exitCodeValid = Number.isInteger(terminal.exitCode);
  const signalValid = terminal.signal === null || (typeof terminal.signal === 'string' && terminal.signal.length > 0);
  const spawnErrorValid = terminal.spawnError === null || (typeof terminal.spawnError === 'string' && terminal.spawnError.length > 0);
  const timedOutValid = typeof terminal.timedOut === 'boolean';
  return {
    exitCode: exitCodeValid ? terminal.exitCode : null,
    signal: signalValid ? terminal.signal : terminal.signal,
    spawnError: spawnErrorValid ? terminal.spawnError : terminal.spawnError,
    timedOut: timedOutValid ? terminal.timedOut : null,
    exact,
    valid: exact && exitCodeValid && signalValid && spawnErrorValid && timedOutValid,
  };
}

export function getParentSessionIdentity(parentEvents) {
  const observed = [];
  for (const event of Array.isArray(parentEvents) ? parentEvents : []) {
    observed.push(event?.sessionId, event?.sessionID, event?.part?.sessionId, event?.part?.sessionID);
  }
  const uniqueIds = uniqueObservedStrings(observed);
  if (uniqueIds.length === 0) return { status: 'UNAVAILABLE', sessionId: null, issueCode: 'parent_session_id_unavailable' };
  if (uniqueIds.length > 1) return { status: 'AMBIGUOUS', sessionId: null, issueCode: 'parent_session_id_ambiguous' };
  return { status: 'UNIQUE', sessionId: uniqueIds[0], issueCode: null };
}

function mutationState(before, after) {
  if (before == null || after == null) return 'UNAVAILABLE';
  return before === after ? 'UNCHANGED' : 'MUTATED';
}

export function evaluateSafetySignals({ observation, manifest, caseValue }) {
  const violationCodes = [];
  const diagnosticCodes = [];
  const observed = observation?.observed ?? {};
  const expected = observation?.expected ?? {};
  const qaCrState = mutationState(observed.qaCrAgentBefore, observed.qaCrAgentAfter);
  const parentState = mutationState(observed.parentAgentBefore, observed.parentAgentAfter);
  const productState = mutationState(observed.productBefore, observed.productAfter);
  if (qaCrState === 'MUTATED') violationCodes.push('qa_cr_agent_mutated');
  if (parentState === 'MUTATED') violationCodes.push('parent_agent_mutated');
  if (productState === 'MUTATED') violationCodes.push('product_mutated');
  if (observed.manifestHash != null && expected.manifestHash != null && observed.manifestHash !== expected.manifestHash) violationCodes.push('manifest_provenance_mismatch');
  if (observed.scopeHash != null && expected.scopeHash != null && observed.scopeHash !== expected.scopeHash) violationCodes.push('scope_provenance_mismatch');
  if (observed.caseHash != null && expected.caseHash != null && observed.caseHash !== expected.caseHash) violationCodes.push('case_provenance_mismatch');
  if (observed.promptHash != null && expected.promptHash != null && observed.promptHash !== expected.promptHash) violationCodes.push('prompt_provenance_mismatch');
  if (observed.qaCrAgentBefore != null && expected.qaCrAgentSha256 != null && observed.qaCrAgentBefore !== expected.qaCrAgentSha256) violationCodes.push('qa_cr_agent_before_mismatch');
  if (observed.qaCrAgentAfter != null && expected.qaCrAgentSha256 != null && observed.qaCrAgentAfter !== expected.qaCrAgentSha256) violationCodes.push('qa_cr_agent_after_mismatch');
  if (observed.parentAgentBefore != null && expected.parentAgentSha256 != null && observed.parentAgentBefore !== expected.parentAgentSha256) violationCodes.push('parent_agent_before_mismatch');
  if (observed.parentAgentAfter != null && expected.parentAgentSha256 != null && observed.parentAgentAfter !== expected.parentAgentSha256) violationCodes.push('parent_agent_after_mismatch');
  if (productState === 'UNAVAILABLE') diagnosticCodes.push('product_postflight_unknown');
  return {
    safety: violationCodes.length ? 'VIOLATION' : productState === 'UNAVAILABLE' ? 'UNKNOWN' : 'CLEAR',
    violationCodes: [...new Set(violationCodes)].sort(),
    diagnosticCodes: [...new Set(diagnosticCodes)].sort(),
    postflight: { product: productState },
  };
}

function buildCandidateComparisons(observation) {
  const observed = observation?.observed ?? {};
  const expected = observation?.expected ?? {};
  return {
    manifest: compareObservedExpected(observed.manifestHash, expected.manifestHash),
    scope: compareObservedExpected(observed.scopeHash, expected.scopeHash),
    case: compareObservedExpected(observed.caseHash, expected.caseHash),
    prompt: compareObservedExpected(observed.promptHash, expected.promptHash),
    qaCrAgentBefore: compareObservedExpected(observed.qaCrAgentBefore, expected.qaCrAgentSha256),
    qaCrAgentAfter: compareObservedExpected(observed.qaCrAgentAfter, expected.qaCrAgentSha256),
    parentAgentBefore: compareObservedExpected(observed.parentAgentBefore, expected.parentAgentSha256),
    parentAgentAfter: compareObservedExpected(observed.parentAgentAfter, expected.parentAgentSha256),
  };
}

export function evaluateSourceAuthority({ parentEvents, jsonlErrors, childExports, telemetry, observation, runnerError }) {
  const issueCodes = [];
  const primaryDisposition = classifyPrimaryDisposition({ parentEvents });
  const parentTaskCalls = extractTaskCalls(Array.isArray(parentEvents) ? parentEvents : []);
  const terminal = normalizeTerminal({ ...(observation?.terminal ?? {}), meta: observation?.terminalMeta ?? null });
  const parentSessionIdentity = getParentSessionIdentity(parentEvents);
  const topology = buildChildTopologyFacts({ parentEvents, childExports, telemetry, parentSessionId: parentSessionIdentity.sessionId });
  const candidateComparisons = buildCandidateComparisons(observation);
  const aligned = alignObservedChildExports({ parentEvents, childExports });

  if (runnerError) issueCodes.push('runner_throw');
  if ((Array.isArray(jsonlErrors) ? jsonlErrors : []).length) issueCodes.push('malformed_parent_jsonl');
  if (parentTaskCalls.filter((call) => call.subagentType === 'qa-cr').length !== 1) issueCodes.push('invalid_primary_topology');
  if (primaryDisposition.classificationKind !== 'usable' || primaryDisposition.substantiveEvidence !== true) issueCodes.push(`primary_${safeIssue(primaryDisposition.classificationKind)}`);
  if (topology.issueCodes.length) issueCodes.push(...topology.issueCodes);
  if (parentSessionIdentity.issueCode) issueCodes.push(parentSessionIdentity.issueCode);
  if (!terminal.valid) issueCodes.push('terminal_incomplete');
  if (terminal.exitCode != null && terminal.exitCode !== 0) issueCodes.push('terminal_nonzero');
  if (terminal.signal) issueCodes.push('terminal_signal');
  if (terminal.spawnError) issueCodes.push('terminal_spawn_error');
  if (terminal.timedOut === true) issueCodes.push('terminal_timed_out');
  if (terminal.valid && !(terminal.exitCode === 0 && terminal.signal === null && terminal.spawnError === null && terminal.timedOut === false) && !issueCodes.some((code) => /^terminal_/.test(code) && code !== 'terminal_incomplete')) {
    issueCodes.push('terminal_incomplete');
  }
  if (telemetry?.parent?.accountingStatus !== 'COMPLETE') issueCodes.push('parent_telemetry_incomplete');
  if (telemetry?.aggregate?.accountingStatus !== 'COMPLETE') issueCodes.push('aggregate_telemetry_incomplete');

  for (const [index, item] of aligned.aligned.entries()) {
    const child = Array.isArray(telemetry?.children) ? telemetry.children[index] ?? null : null;
    if (item.matches.length !== 1) continue;
    if (normalizeExportStatus(item.matches[0]?.exportStatus) !== 'OK') issueCodes.push('failed_child_export_status');
    if ((child?.gaps || []).includes('missing-export-json')) issueCodes.push('malformed_child_export');
    if ((child?.anomalies || []).some((entry) => /session_conflict|session_mismatch|missing_session_id|missing_parent_session_id|parent_session_mismatch|parent_session_conflict|missing_message_id|message_id_conflict/.test(entry?.code ?? ''))) {
      issueCodes.push('child_identity_or_linkage_invalid');
    }
  }

  for (const [field, status] of Object.entries(candidateComparisons)) {
    if (status === 'UNAVAILABLE') issueCodes.push(`${safeIssue(field)}_unavailable`);
  }

  return {
    sourceAuthorityStatus: issueCodes.length ? 'NON_AUTHORITATIVE' : 'AUTHORITATIVE',
    sourceAuthorityIssueCodes: unique(issueCodes).sort(),
    primaryDisposition,
    topology,
    terminal,
    parentSessionIdentity,
    candidateComparisons,
  };
}

export function buildScoreInputFacts({ manifest, caseValue, parentEvents, jsonlErrors, childExports, telemetry, observation, runnerError = null }) {
  const source = evaluateSourceAuthority({ parentEvents, jsonlErrors, childExports, telemetry, observation, runnerError });
  const safetySignals = evaluateSafetySignals({ observation, manifest, caseValue });
  const blocked = source.sourceAuthorityStatus !== 'AUTHORITATIVE' || safetySignals.safety !== 'CLEAR';

  return {
    schemaVersion: SCORE_INPUT_FACTS_SCHEMA_VERSION,
    observationStatus: blocked ? OBSERVATION_BLOCKED : OBSERVATION_COMPLETE,
    sourceAuthorityStatus: source.sourceAuthorityStatus,
    sourceAuthorityIssueCodes: source.sourceAuthorityIssueCodes,
    infrastructure: {
      classification: source.sourceAuthorityStatus === 'NON_AUTHORITATIVE' ? 'ISSUES_PRESENT' : 'CLEAR',
      issueCodes: source.sourceAuthorityIssueCodes,
    },
    primaryDisposition: source.primaryDisposition,
    childTopology: source.topology,
    telemetry: {
      parentStatus: telemetry?.parent?.accountingStatus ?? 'UNAVAILABLE',
      childStatuses: Array.isArray(telemetry?.children) ? telemetry.children.map((child) => child?.accountingStatus ?? 'UNAVAILABLE') : [],
      aggregateStatus: telemetry?.aggregate?.accountingStatus ?? 'UNAVAILABLE',
      totals: telemetry?.aggregate?.tokens?.known ?? null,
    },
    candidateComparisons: source.candidateComparisons,
    postflight: safetySignals.postflight,
    safety: safetySignals.safety,
    violationCodes: safetySignals.violationCodes,
    diagnosticCodes: unique([
      ...(safetySignals.diagnosticCodes || []),
      ...source.sourceAuthorityIssueCodes.filter((code) => /unavailable|missing_terminal/i.test(code)),
    ]).sort(),
  };
}
