import { extractTaskCalls, classifySubagentResult } from '../helpers.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';
import { RUN_TELEMETRY_V2_SCHEMA_VERSION } from './collect-run-telemetry-v2.mjs';
import { sha256CanonicalValueV2 } from './runtime-pin-v2.mjs';

export const SCORE_INPUT_FACTS_V2_SCHEMA_VERSION = 'qa-cr-score-input-facts-v2';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_CODE_RE = /^[a-z][a-z0-9_:-]{0,63}$/;

function uniqueSorted(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => typeof value === 'string' ? value.toLowerCase() : value).filter((value) => typeof value === 'string' && SAFE_CODE_RE.test(value)))].sort();
}

function normalizeStatus(value, fallback = 'UNAVAILABLE') {
  return ['OK', 'FAILED', 'MISSING', 'MALFORMED'].includes(value) ? value : fallback;
}

function classifyPrimary(parentEvents) {
  const calls = extractTaskCalls(Array.isArray(parentEvents) ? parentEvents : []);
  const qaCrCalls = calls.filter((call) => call.subagentType === 'qa-cr');
  const issueCodes = [];
  if (qaCrCalls.length === 0) issueCodes.push('missing_qa_cr_task');
  if (qaCrCalls.length > 1) issueCodes.push('duplicate_qa_cr_task');
  const extraTaskTypes = [...new Set(calls.map((call) => call.subagentType).filter((value) => value && value !== 'qa-cr'))];
  if (extraTaskTypes.length) issueCodes.push('extra_child_task_type');
  const classified = qaCrCalls.length === 1 ? classifySubagentResult(qaCrCalls[0], { expectedAgent: 'qa-cr' }) : { kind: 'missing', substantiveEvidence: false, parsed: null };
  if (classified.kind !== 'usable') issueCodes.push(`primary_${classified.kind}`);
  if (classified.kind === 'usable' && !classified.substantiveEvidence) issueCodes.push('primary_not_substantive');
  if (typeof classified?.raw === 'string' && /overall status:/i.test(classified.raw)) issueCodes.push('primary_contains_overall_status');
  return {
    primaryDisposition: {
      classificationKind: classified.kind ?? 'missing',
      status: classified?.parsed?.status ?? null,
      gate: classified?.parsed?.gate ?? null,
      substantiveEvidence: classified?.substantiveEvidence === true,
    },
    qaCrCalls,
    taskCalls: calls,
    issueCodes,
  };
}

function summarizeChildTopology({ parentEvents, childArtifacts, telemetry }) {
  const { qaCrCalls, taskCalls } = classifyPrimary(parentEvents);
  const observedIds = extractQaCrChildSessionIds(parentEvents);
  const childRaw = (childArtifacts || []).filter((entry) => entry?.kind === 'raw');
  const childObs = (childArtifacts || []).filter((entry) => entry?.kind === 'observation');
  const issueCodes = [];
  if (qaCrCalls.length !== 1) issueCodes.push('parent_run_count_invalid');
  if (childRaw.length !== 1 || childObs.length !== 1) issueCodes.push(childRaw.length < 1 || childObs.length < 1 ? 'missing_child_export' : 'extra_child_export');
  if (childRaw.length !== childObs.length) issueCodes.push('child_pair_mismatch');
  if (observedIds.length !== childRaw.length) issueCodes.push(observedIds.length < childRaw.length ? 'extra_child_export' : 'missing_child_export');
  const telemetryChildren = Array.isArray(telemetry?.children) ? telemetry.children : [];
  for (let index = 0; index < Math.max(childRaw.length, childObs.length, observedIds.length); index += 1) {
    const raw = childRaw[index] ?? null;
    const obs = childObs[index] ?? null;
    const expectedId = observedIds[index] ?? null;
    const telemetryChild = telemetryChildren[index] ?? null;
    if (!raw || !obs || !expectedId) continue;
    if (String(raw.index) !== String(obs.index) || ![String(index), String(index).padStart(3, '0')].includes(String(raw.index)) || ![String(index), String(index).padStart(3, '0')].includes(String(obs.index))) issueCodes.push('child_index_mismatch');
    if (!raw.sessionId || !obs.sessionId) issueCodes.push('anonymous_child_export');
    if (raw.sessionId !== obs.sessionId || raw.sessionId !== expectedId) issueCodes.push('child_session_mismatch');
    if (telemetryChild?.sessionId !== raw.sessionId) issueCodes.push('telemetry_child_session_mismatch');
    if (telemetryChild?.parentSessionId == null || telemetry?.parent?.sessionId == null) issueCodes.push('child_parent_linkage_unavailable');
    else if (telemetryChild.parentSessionId !== telemetry.parent.sessionId) issueCodes.push('child_parent_linkage_invalid');
  }
  if (taskCalls.some((call) => call.subagentType && call.subagentType !== 'qa-cr')) issueCodes.push('extra_task_type');
  return {
    observedQaCrTaskCount: qaCrCalls.length,
    observedTaskTypes: [...new Set(taskCalls.map((call) => call.subagentType).filter(Boolean))].sort(),
    observedChildSessionIds: [...new Set(observedIds)].sort(),
    rawExportCount: childRaw.length,
    observationCount: childObs.length,
    parentLinkageStatus: issueCodes.includes('child_parent_linkage_invalid')
      ? 'INVALID'
      : issueCodes.includes('missing_child_export') || issueCodes.includes('child_pair_mismatch') || issueCodes.includes('anonymous_child_export') || issueCodes.includes('child_parent_linkage_unavailable')
        ? 'UNAVAILABLE'
        : 'MATCH',
    issueCodes: uniqueSorted(issueCodes),
  };
}

function terminalSummary(observation, runnerErrorCode) {
  const terminal = observation?.terminal ?? {};
  const issueCodes = [];
  if (observation?.terminalContractStatus !== 'VALID') issueCodes.push('terminal_contract_invalid');
  if (JSON.stringify(Object.keys(terminal).sort()) !== JSON.stringify(['errorCode', 'exitCode', 'signal', 'timedOut'])) issueCodes.push('terminal_schema_invalid');
  const successTuple = terminal.exitCode === 0 && terminal.signal === null && terminal.errorCode === null && terminal.timedOut === false;
  const nullExitFailure = terminal.exitCode === null && (terminal.signal !== null || terminal.errorCode !== null || terminal.timedOut === true);
  if (!successTuple && !nullExitFailure) issueCodes.push('terminal_tuple_invalid');
  if (!successTuple && terminal.exitCode !== null && terminal.exitCode !== 0) issueCodes.push('terminal_nonzero');
  if (terminal.signal !== null) issueCodes.push('terminal_signal');
  if (terminal.timedOut !== false) issueCodes.push('terminal_timed_out');
  if (terminal.errorCode !== null) issueCodes.push(terminal.errorCode === 'terminal_error_uncontrolled' ? 'terminal_error_uncontrolled' : 'terminal_error');
  if (Array.isArray(observation?.postflightIssueCodes) && observation.postflightIssueCodes.length) issueCodes.push('postflight_issues_present');
  if (observation?.runtimeCleanupSucceeded !== true || observation?.runtimeCleanupStatus !== 'SUCCESS') issueCodes.push('runtime_cleanup_failed');
  if (runnerErrorCode) issueCodes.push(runnerErrorCode);
  return {
    status: issueCodes.length === 0 ? 'SUCCESS' : 'FAILED',
    exitCode: Number.isInteger(terminal.exitCode) ? terminal.exitCode : null,
    signal: typeof terminal.signal === 'string' ? terminal.signal : null,
    timedOut: terminal.timedOut === true,
    errorCode: typeof terminal.errorCode === 'string' ? terminal.errorCode : null,
    issueCodes: uniqueSorted(issueCodes),
  };
}

function provenanceComparisons({ identity, observation, runtimePin, expectedChildCount }) {
  const observed = observation?.observed ?? {};
  const expectedProductCompositeSha256 = sha256CanonicalValueV2({ fixtureTreeSha256: identity.fixtureTreeSha256, candidateDiffSha256: identity.candidateDiffSha256 });
  return {
    manifest: observed.manifestSha256 === identity.manifestSha256 ? 'MATCH' : observed.manifestSha256 == null ? 'UNAVAILABLE' : 'MISMATCH',
    scope: observed.scopeSha256 === identity.scopeSha256 ? 'MATCH' : observed.scopeSha256 == null ? 'UNAVAILABLE' : 'MISMATCH',
    case: observed.caseSha256 === identity.caseSha256 ? 'MATCH' : observed.caseSha256 == null ? 'UNAVAILABLE' : 'MISMATCH',
    prompt: observed.promptSha256 === identity.promptSha256 ? 'MATCH' : observed.promptSha256 == null ? 'UNAVAILABLE' : 'MISMATCH',
    qaSkillBefore: observed.qaSkillTreeSha256Before === identity.qaSkillTreeSha256 ? 'MATCH' : observed.qaSkillTreeSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    qaSkillAfter: observed.qaSkillTreeSha256After === identity.qaSkillTreeSha256 ? 'MATCH' : observed.qaSkillTreeSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    qaAgentBefore: observed.qaAgentSha256Before === identity.qaAgentSha256 ? 'MATCH' : observed.qaAgentSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    qaAgentAfter: observed.qaAgentSha256After === identity.qaAgentSha256 ? 'MATCH' : observed.qaAgentSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    qaCrAgentBefore: observed.qaCrAgentSha256Before === identity.qaCrAgentSha256 ? 'MATCH' : observed.qaCrAgentSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    qaCrAgentAfter: observed.qaCrAgentSha256After === identity.qaCrAgentSha256 ? 'MATCH' : observed.qaCrAgentSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    fixtureTreeBefore: observed.fixtureTreeSha256Before === identity.fixtureTreeSha256 ? 'MATCH' : observed.fixtureTreeSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    fixtureTreeAfter: observed.fixtureTreeSha256After === identity.fixtureTreeSha256 ? 'MATCH' : observed.fixtureTreeSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    candidateDiffBefore: observed.candidateDiffSha256Before === identity.candidateDiffSha256 ? 'MATCH' : observed.candidateDiffSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    candidateDiffAfter: observed.candidateDiffSha256After === identity.candidateDiffSha256 ? 'MATCH' : observed.candidateDiffSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    productCompositeBefore: observed.productCompositeSha256Before === expectedProductCompositeSha256 ? 'MATCH' : observed.productCompositeSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    productCompositeAfter: observed.productCompositeSha256After === expectedProductCompositeSha256 ? 'MATCH' : observed.productCompositeSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    executableBefore: observed.executableSha256Before === identity.expectedExecutableSha256 ? 'MATCH' : observed.executableSha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    executableAfter: observed.executableSha256After === identity.expectedExecutableSha256 ? 'MATCH' : observed.executableSha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    runtimePinBefore: runtimePin?.sha256Before === identity.expectedExecutableSha256 ? 'MATCH' : runtimePin?.sha256Before == null ? 'UNAVAILABLE' : 'MISMATCH',
    runtimePinAfter: runtimePin?.sha256After === identity.expectedExecutableSha256 ? 'MATCH' : runtimePin?.sha256After == null ? 'UNAVAILABLE' : 'MISMATCH',
    commandHash: typeof observation?.commandHash === 'string' && SHA256_RE.test(observation.commandHash) ? 'MATCH' : 'UNAVAILABLE',
    parentRunCount: observed.parentRunCount === 1 ? 'MATCH' : observed.parentRunCount == null ? 'UNAVAILABLE' : 'MISMATCH',
    parentExportCount: observed.parentExportCount === 1 ? 'MATCH' : observed.parentExportCount == null ? 'UNAVAILABLE' : 'MISMATCH',
    childExportCount: observed.childExportCount === expectedChildCount && observed.childExportCount === 1 ? 'MATCH' : observed.childExportCount == null ? 'UNAVAILABLE' : 'MISMATCH',
    sameEnvironment: observed.sameEnvironment === true ? 'MATCH' : observed.sameEnvironment == null ? 'UNAVAILABLE' : 'MISMATCH',
    sameWorkingDirectory: observed.sameWorkingDirectory === true ? 'MATCH' : observed.sameWorkingDirectory == null ? 'UNAVAILABLE' : 'MISMATCH',
    envIdentity: typeof observed.envIdentitySha256 === 'string' && SHA256_RE.test(observed.envIdentitySha256) ? 'MATCH' : 'UNAVAILABLE',
    cwdIdentity: typeof observed.cwdIdentitySha256 === 'string' && SHA256_RE.test(observed.cwdIdentitySha256) ? 'MATCH' : 'UNAVAILABLE',
  };
}

function mutationComparisons(observation) {
  const observed = observation?.observed ?? {};
  const unchanged = (before, after) => before == null || after == null ? 'UNAVAILABLE' : before === after ? 'UNCHANGED' : 'MUTATED';
  return {
    qaSkill: unchanged(observed.qaSkillTreeSha256Before, observed.qaSkillTreeSha256After),
    qaAgent: unchanged(observed.qaAgentSha256Before, observed.qaAgentSha256After),
    qaCrAgent: unchanged(observed.qaCrAgentSha256Before, observed.qaCrAgentSha256After),
    fixtureTree: unchanged(observed.fixtureTreeSha256Before, observed.fixtureTreeSha256After),
    candidateDiff: unchanged(observed.candidateDiffSha256Before, observed.candidateDiffSha256After),
    productComposite: unchanged(observed.productCompositeSha256Before, observed.productCompositeSha256After),
    executable: unchanged(observed.executableSha256Before, observed.executableSha256After),
  };
}

export function buildScoreInputFactsV2({ identity, probe, authorization, runtimePin, parentEvents, jsonlErrors, telemetry, observation, childArtifacts, parentExportObservation, childExportObservations, runnerErrorCode = null }) {
  const primary = classifyPrimary(parentEvents);
  const topology = summarizeChildTopology({ parentEvents, childArtifacts, telemetry });
  const terminal = terminalSummary(observation, runnerErrorCode);
  const expectedChildCount = topology.observedChildSessionIds.length;
  const provenance = provenanceComparisons({ identity, observation, runtimePin, expectedChildCount });
  const mutations = mutationComparisons(observation);
  const issueCodes = [
    ...primary.issueCodes,
    ...topology.issueCodes,
    ...terminal.issueCodes,
    ...(Array.isArray(jsonlErrors) && jsonlErrors.length ? ['parent_jsonl_malformed'] : []),
    telemetry?.parent?.accountingStatus === 'COMPLETE' ? null : 'parent_telemetry_incomplete',
    telemetry?.aggregate?.accountingStatus === 'COMPLETE' ? null : 'aggregate_telemetry_incomplete',
    telemetry?.emitTiming?.status === 'COMPLETE' || telemetry?.emitTiming?.status === 'UNAVAILABLE' ? null : 'emit_timing_schema_incomplete',
    runtimePin?.validationStatus === 'VALID' && runtimePin?.eligibilityStatus === 'ELIGIBLE' ? null : 'runtime_pin_ineligible',
    authorization?.validationStatus === 'AUTHORIZED' ? null : 'authorization_invalid',
    probe?.probeStatus === 'VALID' ? null : 'probe_invalid',
    ...Object.entries(provenance).flatMap(([key, value]) => value === 'MATCH' ? [] : [value === 'UNAVAILABLE' ? `${key}_unavailable` : `${key}_${String(value).toLowerCase()}`]),
    ...Object.entries(mutations).flatMap(([key, value]) => value === 'UNCHANGED' ? [] : [value === 'UNAVAILABLE' ? `${key}_unavailable` : `${key}_${String(value).toLowerCase()}`]),
    normalizeStatus(parentExportObservation?.status) === 'OK' ? null : 'parent_export_not_ok',
    ...((Array.isArray(childExportObservations) ? childExportObservations : []).flatMap((entry) => normalizeStatus(entry?.status) === 'OK' ? [] : ['child_export_not_ok'])),
    observation?.postflightIssueCodes?.length ? 'postflight_issue_codes_present' : null,
    observation?.runtimeCleanupSucceeded === true && observation?.runtimeCleanupStatus === 'SUCCESS' ? null : 'runtime_cleanup_unsuccessful',
  ];
  const sourceAuthorityIssueCodes = uniqueSorted(issueCodes);
  const sourceAuthorityStatus = sourceAuthorityIssueCodes.length === 0 ? 'AUTHORITATIVE' : 'NON_AUTHORITATIVE';
  return {
    schemaVersion: SCORE_INPUT_FACTS_V2_SCHEMA_VERSION,
    sourceAuthorityStatus,
    sourceAuthorityIssueCodes,
    observationStatus: sourceAuthorityStatus === 'AUTHORITATIVE' ? 'COMPLETE' : 'BLOCKED',
    probeStatus: probe?.probeStatus ?? 'INVALID',
    authorizationStatus: authorization?.validationStatus ?? 'REJECTED',
    runtimePinStatus: runtimePin?.eligibilityStatus ?? 'INELIGIBLE',
    primaryDisposition: primary.primaryDisposition,
    childTopology: topology,
    telemetry: {
      schemaVersion: RUN_TELEMETRY_V2_SCHEMA_VERSION,
      parentStatus: telemetry?.parent?.accountingStatus ?? 'UNAVAILABLE',
      childStatuses: Array.isArray(telemetry?.children) ? telemetry.children.map((child) => child?.accountingStatus ?? 'UNAVAILABLE') : [],
      aggregateStatus: telemetry?.aggregate?.accountingStatus ?? 'UNAVAILABLE',
      emitTimingStatus: telemetry?.emitTiming?.status ?? 'UNAVAILABLE',
      emitTimingDiagnosticOnly: true,
    },
    parse: {
      parentJsonlStatus: Array.isArray(jsonlErrors) && jsonlErrors.length ? 'MALFORMED' : 'PARSED',
      parentExportStatus: normalizeStatus(parentExportObservation?.status),
      childExportStatuses: (Array.isArray(childExportObservations) ? childExportObservations : []).map((entry) => normalizeStatus(entry?.status)),
    },
    exportObservations: {
      parent: { sessionId: parentExportObservation?.sessionId ?? null, status: normalizeStatus(parentExportObservation?.status), errorCode: parentExportObservation?.errorCode ?? null },
      children: (Array.isArray(childExportObservations) ? childExportObservations : []).map((entry) => ({ sessionId: entry?.sessionId ?? null, status: normalizeStatus(entry?.status), errorCode: entry?.errorCode ?? null })),
    },
    terminal,
    runtimePin: {
      expectedVersion: runtimePin?.expectedVersion ?? null,
      observedVersion: runtimePin?.observedVersion ?? null,
      eligibilityStatus: runtimePin?.eligibilityStatus ?? 'INELIGIBLE',
      issueCodes: uniqueSorted(runtimePin?.issueCodes),
      hashStatus: runtimePin?.sha256Before == null && runtimePin?.sha256After == null
        ? 'UNAVAILABLE'
        : runtimePin?.sha256Before === identity.expectedExecutableSha256 && runtimePin?.sha256After === identity.expectedExecutableSha256
          ? 'MATCH'
          : 'MISMATCH',
    },
    provenance,
    mutations,
    runner: {
      status: runnerErrorCode ? 'ERROR' : 'OK',
      errorCodes: runnerErrorCode ? [runnerErrorCode] : [],
    },
  };
}
