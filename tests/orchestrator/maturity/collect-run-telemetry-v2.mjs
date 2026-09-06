import { createHash } from 'node:crypto';

export const RUN_TELEMETRY_V2_SCHEMA_VERSION = 'qa-cr-run-telemetry-v2';

const STEP_FINISH_EVENT_TYPE = 'step_finish';
const STEP_START_EVENT_TYPE = 'step_start';
const TOOL_USE_EVENT_TYPE = 'tool_use';
const TEXT_EVENT_TYPE = 'text';
const REASONING_EVENT_TYPE = 'reasoning';
const ERROR_EVENT_TYPE = 'error';
const ALLOWED_ENVELOPE_EVENT_TYPES = new Set([STEP_START_EVENT_TYPE, STEP_FINISH_EVENT_TYPE, TOOL_USE_EVENT_TYPE, TEXT_EVENT_TYPE, REASONING_EVENT_TYPE, ERROR_EVENT_TYPE]);
const STEP_START_PART_TYPE = 'step-start';
const STEP_FINISH_PART_TYPE = 'step-finish';
const TOOL_PART_TYPE = 'tool';
const CONTROLLED_EXPORT_STATUSES = new Set(['OK', 'FAILED', 'MISSING', 'MALFORMED']);
const CONTROLLED_ERROR_CODE = /^[a-z0-9_:-]+$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeValue(value) {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  if (typeof value === 'number') return Number.isFinite(value) ? { type: 'number', value } : { type: 'number', kind: 'non-finite' };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'string') return { type: 'string', length: value.length, sha256: sha256(value) };
  return { type: typeof value };
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' ? value.length > 0 : value != null))];
}

function toNonNegativeInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

function toFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validateSessionTime(info, issueCodes, anomalies, context) {
  const created = toNonNegativeInteger(info?.time?.created);
  const updated = toNonNegativeInteger(info?.time?.updated);
  if (created === null || updated === null) {
    collectIssue(issueCodes, 'export_session_time_invalid', anomalies, { context });
    return;
  }
  if (updated < created) collectIssue(issueCodes, 'export_session_time_order_invalid', anomalies, { context });
}

function validatePathInfo(pathInfo, issueCodes, anomalies, context) {
  if (!isPlainObject(pathInfo) || !isNonEmptyString(pathInfo.cwd) || !isNonEmptyString(pathInfo.root)) {
    collectIssue(issueCodes, 'assistant_message_path_invalid', anomalies, { context });
    return;
  }
  if (/^[A-Za-z]:\\|^\\\\|^\//.test(pathInfo.cwd) || /^[A-Za-z]:\\|^\\\\|^\//.test(pathInfo.root)) {
    collectIssue(issueCodes, 'assistant_message_path_absolute', anomalies, { context });
  }
}

function validateUserMessageInfo(info, issueCodes, anomalies, context, expectedSessionId, expectations = {}) {
  if (!isNonEmptyString(info?.id) || !isNonEmptyString(info?.sessionID)) collectIssue(issueCodes, 'user_message_identity_invalid', anomalies, { context });
  if (info?.role !== 'user') collectIssue(issueCodes, 'user_message_role_invalid', anomalies, { context });
  if (expectedSessionId && info?.sessionID !== expectedSessionId) collectIssue(issueCodes, 'user_message_session_id_mismatch', anomalies, { context, messageId: info?.id ?? null });
  if (toNonNegativeInteger(info?.time?.created) === null) collectIssue(issueCodes, 'user_message_time_invalid', anomalies, { context, messageId: info?.id ?? null });
  if (!isNonEmptyString(info?.agent)) collectIssue(issueCodes, 'user_message_agent_invalid', anomalies, { context, messageId: info?.id ?? null });
  if (!isPlainObject(info?.model) || !isNonEmptyString(info.model.providerID) || !isNonEmptyString(info.model.modelID)) collectIssue(issueCodes, 'user_message_model_invalid', anomalies, { context, messageId: info?.id ?? null });
  if (expectations.expectedAgent && info?.agent !== expectations.expectedAgent) collectIssue(issueCodes, 'user_message_agent_mismatch', anomalies, { context, messageId: info?.id ?? null });
  if (expectations.expectedProviderId && info?.model?.providerID !== expectations.expectedProviderId) collectIssue(issueCodes, 'user_message_provider_id_mismatch', anomalies, { context, messageId: info?.id ?? null });
  if (expectations.expectedModelId && info?.model?.modelID !== expectations.expectedModelId) collectIssue(issueCodes, 'user_message_model_id_mismatch', anomalies, { context, messageId: info?.id ?? null });
}

function normalizeTokensShape(tokens) {
  const cache = tokens?.cache ?? {};
  return {
    input: tokens?.input,
    output: tokens?.output,
    reasoning: tokens?.reasoning,
    cacheRead: cache?.read,
    cacheWrite: cache?.write,
    totalPresent: Object.prototype.hasOwnProperty.call(tokens ?? {}, 'total'),
    total: tokens?.total,
  };
}

function normalizedOptionalTotal(tokensShape) {
  return tokensShape.totalPresent ? toNonNegativeInteger(tokensShape.total) : null;
}

function zeroUsage() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, derivedTotal: 0 };
}

function finalizeUsage(usage) {
  return {
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    derivedTotal: usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite,
  };
}

function summarizeSourceArtifact(sourceArtifact) {
  if (!sourceArtifact || typeof sourceArtifact !== 'object') return null;
  const summary = {};
  for (const key of ['id', 'hash', 'bytes']) {
    if (key in sourceArtifact) summary[key] = sourceArtifact[key];
  }
  return Object.keys(summary).length ? summary : null;
}

function collectIssue(set, code, anomalies, details = {}) {
  set.add(code);
  anomalies.push({ code, ...details });
}

function sameStepFingerprint(a, b) {
  return a.reasonPresent === b.reasonPresent
    && a.reason === b.reason
    && a.tokens.input === b.tokens.input
    && a.tokens.output === b.tokens.output
    && a.tokens.reasoning === b.tokens.reasoning
    && a.tokens.cacheRead === b.tokens.cacheRead
    && a.tokens.cacheWrite === b.tokens.cacheWrite
    && a.tokens.totalPresent === b.tokens.totalPresent
    && a.tokens.total === b.tokens.total
    && a.cost === b.cost;
}

function isStepTimingAbsent(part) {
  return !('time' in (part ?? {}))
    && !('startedAt' in (part ?? {}))
    && !('finishedAt' in (part ?? {}))
    && !('startTimeMs' in (part ?? {}))
    && !('endTimeMs' in (part ?? {}));
}

function normalizeExportState(exportStatus, exportErrorCode, issueCodes, anomalies) {
  const status = typeof exportStatus === 'string' && exportStatus.length > 0 ? exportStatus.toUpperCase() : null;
  const controlledStatus = status && CONTROLLED_EXPORT_STATUSES.has(status) ? status : null;
  if (exportStatus === undefined || exportStatus === '') collectIssue(issueCodes, 'export_status_missing', anomalies);
  else if (controlledStatus == null) collectIssue(issueCodes, 'export_status_invalid', anomalies);
  const controlledErrorCode = typeof exportErrorCode === 'string' && CONTROLLED_ERROR_CODE.test(exportErrorCode) ? exportErrorCode : null;
  if (exportErrorCode !== undefined && controlledErrorCode == null) collectIssue(issueCodes, 'export_error_code_invalid', anomalies);
  if (controlledStatus === 'OK' && controlledErrorCode !== null) collectIssue(issueCodes, 'export_ok_error_code_present', anomalies);
  return {
    exportStatus: controlledStatus,
    exportErrorCode: controlledErrorCode,
    failed: controlledStatus === 'FAILED',
    missing: controlledStatus === 'MISSING',
    malformed: controlledStatus === 'MALFORMED',
  };
}

function hasAvailabilityIssue(codes) {
  return codes.some((code) => code.includes('missing_export') || code.includes('malformed_export') || code.includes('failed_export'));
}

function normalizeStepPart(part, issueCodes, anomalies, context) {
  if (!part || part.type !== STEP_FINISH_PART_TYPE) return null;
  const sessionId = isNonEmptyString(part.sessionID) ? part.sessionID : null;
  const messageId = isNonEmptyString(part.messageID) ? part.messageID : null;
  const partId = isNonEmptyString(part.id) ? part.id : null;
  if (!sessionId || !messageId || !partId) {
    collectIssue(issueCodes, 'step_identity_invalid', anomalies, { context });
    return null;
  }
  if (!isNonEmptyString(part.reason)) {
    collectIssue(issueCodes, 'step_reason_invalid', anomalies, { context, step: { sessionId, messageId, partId } });
  }
  const tokensShape = normalizeTokensShape(part.tokens);
  const tokens = {
    input: toNonNegativeInteger(tokensShape.input),
    output: toNonNegativeInteger(tokensShape.output),
    reasoning: toNonNegativeInteger(tokensShape.reasoning),
    cacheRead: toNonNegativeInteger(tokensShape.cacheRead),
    cacheWrite: toNonNegativeInteger(tokensShape.cacheWrite),
    totalPresent: tokensShape.totalPresent,
    total: tokensShape.totalPresent ? toNonNegativeInteger(tokensShape.total) : null,
  };
  if ([tokens.input, tokens.output, tokens.reasoning, tokens.cacheRead, tokens.cacheWrite].some((value) => value === null)) {
    collectIssue(issueCodes, 'step_tokens_invalid', anomalies, { context, step: { sessionId, messageId, partId } });
  }
  if (tokens.totalPresent && tokens.total === null) {
    collectIssue(issueCodes, 'step_reported_total_invalid', anomalies, { context, step: { sessionId, messageId, partId } });
  }
  const cost = toFiniteNonNegativeNumber(part.cost);
  if (cost === null) collectIssue(issueCodes, 'step_cost_invalid', anomalies, { context, step: { sessionId, messageId, partId } });
  if (!isStepTimingAbsent(part)) collectIssue(issueCodes, 'step_timing_fields_present', anomalies, { context, step: { sessionId, messageId, partId } });
  return {
    key: `${sessionId}::${messageId}::${partId}`,
    sessionId,
    messageId,
    partId,
    reasonPresent: Object.prototype.hasOwnProperty.call(part, 'reason'),
    reason: part.reason,
    tokens,
    cost,
  };
}

function validateMessageTime(messageInfo, issueCodes, anomalies, context) {
  const created = toNonNegativeInteger(messageInfo?.time?.created);
  const completed = toNonNegativeInteger(messageInfo?.time?.completed);
  if (created === null || completed === null) {
    collectIssue(issueCodes, 'assistant_message_time_incomplete', anomalies, { context, messageId: messageInfo?.id ?? null });
    return { startMs: null, endMs: null, latencyMs: null };
  }
  if (completed < created) {
    collectIssue(issueCodes, 'assistant_message_time_invalid', anomalies, { context, messageId: messageInfo?.id ?? null });
    return { startMs: null, endMs: null, latencyMs: null };
  }
  return { startMs: created, endMs: completed, latencyMs: completed - created };
}

function exportAssistantMessages(exportJson) {
  return Array.isArray(exportJson?.messages)
    ? exportJson.messages.filter((message) => message?.info?.role === 'assistant')
    : [];
}

function buildExportSession({ exportJson, exportStatus, exportErrorCode, expectedSessionId, expectedParentSessionId, expectedRuntimeVersion, expectedProviderId, expectedModelId, expectedAgent, expectedMode, role, sourceArtifact, enforceNoTopLevelParent = false }) {
  const issueCodes = new Set();
  const anomalies = [];
  const exportState = normalizeExportState(exportStatus, exportErrorCode, issueCodes, anomalies);
  const base = {
    schemaVersion: RUN_TELEMETRY_V2_SCHEMA_VERSION,
    role,
    sessionId: isNonEmptyString(exportJson?.info?.id) ? exportJson.info.id : expectedSessionId ?? null,
    parentSessionId: isNonEmptyString(exportJson?.info?.parentID) ? exportJson.info.parentID : expectedParentSessionId ?? null,
    runtimeVersion: isNonEmptyString(exportJson?.info?.version) ? exportJson.info.version : expectedRuntimeVersion ?? null,
    accountingStatus: 'UNAVAILABLE',
    usageStatus: 'UNAVAILABLE',
    costStatus: 'UNAVAILABLE',
    messageTimingStatus: 'UNAVAILABLE',
    stepTimingStatus: 'UNAVAILABLE',
    counts: { assistantMessages: 0, stepFinishParts: 0 },
    usage: { source: 'export.step-finish', known: zeroUsage(), complete: null },
    cost: { source: 'export.step-finish', known: null, complete: null },
    messageTiming: { source: 'export.messages[].info.time', startMs: null, endMs: null, latencyMs: null },
    stepTiming: { status: 'UNAVAILABLE', reasonCode: 'native_step_time_absent' },
    reconciliation: { rawJsonl: role === 'parent' ? 'UNAVAILABLE' : 'NOT_APPLICABLE', nativeInternal: 'UNAVAILABLE' },
    sourceArtifacts: { export: summarizeSourceArtifact(sourceArtifact) },
    issueCodes: [],
    anomalies,
  };

  if (exportState.failed) collectIssue(issueCodes, 'failed_export_status', anomalies);
  if (exportState.missing) collectIssue(issueCodes, 'missing_export', anomalies);
  if (exportState.malformed) collectIssue(issueCodes, 'malformed_export', anomalies);
  if (exportJson == null && exportState.exportStatus !== 'MALFORMED') collectIssue(issueCodes, 'missing_export', anomalies);
  if (exportJson != null && (typeof exportJson !== 'object' || Array.isArray(exportJson)) && exportState.exportStatus !== 'MISSING') collectIssue(issueCodes, 'malformed_export', anomalies);
  if (!exportJson || typeof exportJson !== 'object' || Array.isArray(exportJson)) {
    base.issueCodes = [...issueCodes].sort();
    base.accountingStatus = 'UNAVAILABLE';
    base.usageStatus = 'UNAVAILABLE';
    base.costStatus = 'UNAVAILABLE';
    base.messageTimingStatus = 'UNAVAILABLE';
    return base;
  }

  const topInfo = exportJson.info ?? {};
  if (!isNonEmptyString(topInfo.id)) collectIssue(issueCodes, 'export_session_id_invalid', anomalies);
  if (!isNonEmptyString(topInfo.projectID)) collectIssue(issueCodes, 'export_project_id_invalid', anomalies);
  if (!isNonEmptyString(topInfo.directory)) collectIssue(issueCodes, 'export_directory_invalid', anomalies);
  if (!isNonEmptyString(topInfo.title)) collectIssue(issueCodes, 'export_title_invalid', anomalies);
  if (!isNonEmptyString(topInfo.version)) collectIssue(issueCodes, 'export_runtime_version_invalid', anomalies);
  validateSessionTime(topInfo, issueCodes, anomalies, { source: 'export-top-info', role });
  if (expectedSessionId && topInfo.id !== expectedSessionId) collectIssue(issueCodes, 'export_session_id_mismatch', anomalies);
  if (expectedRuntimeVersion && topInfo.version !== expectedRuntimeVersion) collectIssue(issueCodes, 'export_runtime_version_mismatch', anomalies);
  if (expectedParentSessionId && topInfo.parentID !== expectedParentSessionId) collectIssue(issueCodes, 'export_parent_session_id_mismatch', anomalies);
  if (!expectedParentSessionId && role === 'parent' && Object.prototype.hasOwnProperty.call(topInfo, 'parentID')) collectIssue(issueCodes, 'parent_export_parent_id_present', anomalies);
  if (enforceNoTopLevelParent && (Object.prototype.hasOwnProperty.call(topInfo, 'parentID') || Object.prototype.hasOwnProperty.call(topInfo, 'parentId'))) {
    collectIssue(issueCodes, 'parent_export_parent_id_present', anomalies);
  }

  const messages = Array.isArray(exportJson.messages) ? exportJson.messages : [];
  const userIds = new Set();
  for (const [messageIndex, message] of messages.entries()) {
    const info = message?.info ?? {};
    if (info.role === 'user') {
      validateUserMessageInfo(info, issueCodes, anomalies, { source: 'export', messageIndex }, expectedSessionId, { expectedProviderId, expectedModelId, expectedAgent });
      if (isNonEmptyString(info.id)) userIds.add(info.id);
    }
  }
  const assistants = exportAssistantMessages(exportJson);
  base.counts.assistantMessages = assistants.length;
  if (!Array.isArray(exportJson.messages)) collectIssue(issueCodes, 'export_messages_missing', anomalies);

  const uniqueKeys = new Map();
  const perMessageFinalTokens = new Map();
  const messageTimings = [];
  const assistantIds = new Set();
  let knownCost = 0;
  const knownUsage = zeroUsage();

  for (const [messageIndex, message] of assistants.entries()) {
    const info = message?.info ?? {};
    const context = { source: 'export', messageIndex };
    const assistantId = isNonEmptyString(info.id) ? info.id : null;
    const assistantSessionId = isNonEmptyString(info.sessionID) ? info.sessionID : null;
    if (!assistantId || !assistantSessionId) collectIssue(issueCodes, 'assistant_message_identity_invalid', anomalies, { context });
    if (assistantId) {
      if (assistantIds.has(assistantId)) collectIssue(issueCodes, 'duplicate_assistant_message_id', anomalies, { context, messageId: assistantId });
      assistantIds.add(assistantId);
    }
    if (info.role !== 'assistant') collectIssue(issueCodes, 'assistant_message_role_invalid', anomalies, { context });
    if (expectedSessionId && info.sessionID !== expectedSessionId) collectIssue(issueCodes, 'assistant_message_session_id_mismatch', anomalies, { context, messageId: info.id ?? null });
    if (expectedParentSessionId && role === 'qa-cr' && info.sessionID !== expectedSessionId) collectIssue(issueCodes, 'assistant_message_child_identity_mismatch', anomalies, { context, messageId: info.id ?? null });
    if (!isNonEmptyString(info.parentID) || !userIds.has(info.parentID)) collectIssue(issueCodes, 'assistant_message_parent_user_link_invalid', anomalies, { context, messageId: info.id ?? null });
    if (expectedProviderId && info.providerID !== expectedProviderId) collectIssue(issueCodes, 'assistant_message_provider_id_mismatch', anomalies, { context, messageId: info.id ?? null });
    if (expectedModelId && info.modelID !== expectedModelId) collectIssue(issueCodes, 'assistant_message_model_id_mismatch', anomalies, { context, messageId: info.id ?? null });
    if (expectedAgent && info.agent !== expectedAgent) collectIssue(issueCodes, 'assistant_message_agent_mismatch', anomalies, { context, messageId: info.id ?? null });
    if (expectedMode && info.mode !== expectedMode) collectIssue(issueCodes, 'assistant_message_mode_mismatch', anomalies, { context, messageId: info.id ?? null });
    if (info.mode !== info.agent) collectIssue(issueCodes, 'assistant_message_mode_agent_conflict', anomalies, { context, messageId: info.id ?? null });
    validatePathInfo(info.path, issueCodes, anomalies, { context, messageId: info.id ?? null });
    if (Object.prototype.hasOwnProperty.call(info, 'error') && info.error != null) collectIssue(issueCodes, 'assistant_message_error_present', anomalies, { context, messageId: info.id ?? null });

    const timing = validateMessageTime(info, issueCodes, anomalies, context);
    if (timing.startMs != null) messageTimings.push(timing);

    const stepParts = Array.isArray(message?.parts) ? message.parts.filter((part) => part?.type === STEP_FINISH_PART_TYPE) : [];
    if (stepParts.length === 0) {
      collectIssue(issueCodes, 'assistant_message_missing_step_finish', anomalies, { context, messageId: info.id ?? null });
      continue;
    }
    base.counts.stepFinishParts += stepParts.length;
    const normalizedSteps = [];
    for (const [partIndex, part] of stepParts.entries()) {
      const step = normalizeStepPart(part, issueCodes, anomalies, { source: 'export', messageIndex, partIndex });
      if (!step) continue;
      if (uniqueKeys.has(step.key)) {
        collectIssue(issueCodes, 'duplicate_step_key', anomalies, { messageId: step.messageId, partId: step.partId });
      } else {
        uniqueKeys.set(step.key, step);
        if ([step.tokens.input, step.tokens.output, step.tokens.reasoning, step.tokens.cacheRead, step.tokens.cacheWrite].every((value) => value != null)) {
          knownUsage.input += step.tokens.input;
          knownUsage.output += step.tokens.output;
          knownUsage.reasoning += step.tokens.reasoning;
          knownUsage.cacheRead += step.tokens.cacheRead;
          knownUsage.cacheWrite += step.tokens.cacheWrite;
        }
        if (step.cost != null) knownCost += step.cost;
      }
      if (step.sessionId !== info.sessionID || step.messageId !== info.id) {
        collectIssue(issueCodes, 'step_identity_conflict', anomalies, { messageId: info.id ?? null, partId: step.partId });
      }
      normalizedSteps.push(step);
    }
    if (normalizedSteps.length === 0) continue;
    const finalStep = normalizedSteps[normalizedSteps.length - 1];
    if (assistantId) perMessageFinalTokens.set(assistantId, finalStep.tokens);
    const messageKnownCost = normalizedSteps.reduce((sum, step) => sum + (step.cost ?? 0), 0);
    if (normalizedSteps.some((step) => step.cost == null)) {
      collectIssue(issueCodes, 'assistant_message_step_cost_invalid', anomalies, { messageId: info.id });
    }
    const assistantCost = toFiniteNonNegativeNumber(info.cost);
    if (assistantCost === null || Math.abs(assistantCost - messageKnownCost) > 1e-9) {
      collectIssue(issueCodes, 'assistant_message_cost_mismatch', anomalies, { messageId: info.id });
    }
    const infoTokens = normalizeTokensShape(info.tokens);
    const finalMatches = infoTokens.input === finalStep.tokens.input
      && infoTokens.output === finalStep.tokens.output
      && infoTokens.reasoning === finalStep.tokens.reasoning
      && infoTokens.cacheRead === finalStep.tokens.cacheRead
      && infoTokens.cacheWrite === finalStep.tokens.cacheWrite
      && infoTokens.totalPresent === finalStep.tokens.totalPresent
      && normalizedOptionalTotal(infoTokens) === finalStep.tokens.total;
    if (!finalMatches) collectIssue(issueCodes, 'assistant_message_latest_tokens_mismatch', anomalies, { messageId: info.id });
  }

  const knownUsageFinal = finalizeUsage(knownUsage);
  base.usage.known = knownUsageFinal;
  base.cost.known = knownCost;

  if (Object.prototype.hasOwnProperty.call(topInfo, 'tokens')) {
    const tokens = normalizeTokensShape(topInfo.tokens);
    const lastAssistant = assistants[assistants.length - 1]?.info?.id ?? null;
    const lastTokens = lastAssistant ? perMessageFinalTokens.get(lastAssistant) : null;
    if (!lastTokens
      || tokens.input !== knownUsageFinal.input
      || tokens.output !== knownUsageFinal.output
      || tokens.reasoning !== knownUsageFinal.reasoning
      || tokens.cacheRead !== knownUsageFinal.cacheRead
      || tokens.cacheWrite !== knownUsageFinal.cacheWrite
      || tokens.totalPresent !== lastTokens.totalPresent
      || normalizedOptionalTotal(tokens) !== lastTokens.total) {
      collectIssue(issueCodes, 'session_export_tokens_mismatch', anomalies);
    }
  }
  if (Object.prototype.hasOwnProperty.call(topInfo, 'cost')) {
    const topLevelSessionCost = toFiniteNonNegativeNumber(topInfo.cost);
    if (topLevelSessionCost === null || Math.abs(topLevelSessionCost - knownCost) > 1e-9) collectIssue(issueCodes, 'session_export_cost_mismatch', anomalies);
  }

  if (base.counts.stepFinishParts === 0) collectIssue(issueCodes, 'missing_step_finish_parts', anomalies);

  if (messageTimings.length) {
    const startMs = Math.min(...messageTimings.map((entry) => entry.startMs));
    const endMs = Math.max(...messageTimings.map((entry) => entry.endMs));
    base.messageTiming = { source: 'export.messages[].info.time', startMs, endMs, latencyMs: endMs - startMs };
  }

  const usageIssues = [...issueCodes].filter((code) => code.startsWith('step_') || code.includes('tokens') || code === 'missing_step_finish_parts' || code === 'duplicate_step_key' || code === 'assistant_message_latest_tokens_mismatch');
  const costIssues = [...issueCodes].filter((code) => code.includes('cost') || code === 'duplicate_step_key' || code === 'missing_step_finish_parts');
  const timeIssues = [...issueCodes].filter((code) => code.includes('time'));
  base.usageStatus = usageIssues.length ? (hasAvailabilityIssue(usageIssues) ? 'PARTIAL' : 'INVALID') : 'COMPLETE';
  base.costStatus = costIssues.length ? (hasAvailabilityIssue(costIssues) ? 'PARTIAL' : 'INVALID') : 'COMPLETE';
  base.messageTimingStatus = timeIssues.length ? (hasAvailabilityIssue(timeIssues) ? 'PARTIAL' : 'INVALID') : (messageTimings.length ? 'COMPLETE' : 'UNAVAILABLE');
  base.reconciliation.nativeInternal = issueCodes.size === 0 ? 'MATCH' : 'MISMATCH';
  base.usage.complete = base.usageStatus === 'COMPLETE' ? knownUsageFinal : null;
  base.cost.complete = base.costStatus === 'COMPLETE' ? knownCost : null;
  base.accountingStatus = (issueCodes.size === 0 && base.usageStatus === 'COMPLETE' && base.costStatus === 'COMPLETE' && base.messageTimingStatus === 'COMPLETE')
    ? 'COMPLETE'
    : [...issueCodes].some((code) => code.includes('missing_export') || code.includes('malformed_export') || code.includes('failed_export'))
      ? 'PARTIAL'
      : 'INVALID';
  base.issueCodes = [...issueCodes].sort();
  return base;
}

function collectRawParentSteps(events, expectedSessionId) {
  const issueCodes = new Set();
  const anomalies = [];
  const sessionIds = new Set();
  const steps = new Map();
  const messageIds = new Set();
  for (const [index, event] of (Array.isArray(events) ? events : []).entries()) {
    const eventSessionId = typeof event?.sessionID === 'string' && event.sessionID ? event.sessionID : null;
    if (eventSessionId) sessionIds.add(eventSessionId);
    if (event?.type !== STEP_FINISH_EVENT_TYPE || event?.part?.type !== STEP_FINISH_PART_TYPE) continue;
    const step = normalizeStepPart(event.part, issueCodes, anomalies, { source: 'parent-jsonl', index });
    if (!step) continue;
    messageIds.add(step.messageId);
    if (eventSessionId && step.sessionId !== eventSessionId) collectIssue(issueCodes, 'raw_step_session_conflict', anomalies, { index, messageId: step.messageId, partId: step.partId });
    if (steps.has(step.key)) collectIssue(issueCodes, 'duplicate_step_key', anomalies, { messageId: step.messageId, partId: step.partId });
    else steps.set(step.key, step);
  }
  const observedSessionIds = [...sessionIds].filter(Boolean);
  if (observedSessionIds.length !== 1) collectIssue(issueCodes, 'raw_parent_session_id_invalid', anomalies);
  if (expectedSessionId && observedSessionIds[0] !== expectedSessionId) collectIssue(issueCodes, 'raw_parent_session_id_mismatch', anomalies);
  return { issueCodes, anomalies, steps, messageIds, sessionId: observedSessionIds.length === 1 ? observedSessionIds[0] : expectedSessionId ?? null };
}

export function collectEmitTimingV2(events) {
  const issueCodes = [];
  const values = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!isPlainObject(event)) {
      issueCodes.push('emit_envelope_invalid');
      continue;
    }
    if (!ALLOWED_ENVELOPE_EVENT_TYPES.has(event.type)) issueCodes.push('emit_event_type_invalid');
    if (!isNonEmptyString(event.sessionID)) issueCodes.push('emit_session_id_invalid');
    const value = toNonNegativeInteger(event.timestamp);
    if (value === null) issueCodes.push('emit_timestamp_invalid');
    else values.push(value);

    if (event.type === ERROR_EVENT_TYPE) {
      if (!isPlainObject(event.error)) issueCodes.push('emit_error_invalid');
      continue;
    }

    const part = event.part;
    if (!isPlainObject(part) || !isNonEmptyString(part.type)) {
      issueCodes.push('emit_part_invalid');
      continue;
    }
    if (!isNonEmptyString(part.id) || !isNonEmptyString(part.sessionID) || !isNonEmptyString(part.messageID)) issueCodes.push('emit_part_identity_invalid');
    if (part.sessionID !== event.sessionID) issueCodes.push('emit_part_session_mismatch');

    if (event.type === STEP_START_EVENT_TYPE) {
      if (part.type !== STEP_START_PART_TYPE) issueCodes.push('emit_part_type_mismatch');
      continue;
    }
    if (event.type === STEP_FINISH_EVENT_TYPE) {
      if (part.type !== STEP_FINISH_PART_TYPE) issueCodes.push('emit_part_type_mismatch');
      if (!isNonEmptyString(part.reason)) issueCodes.push('emit_step_finish_reason_invalid');
      const tokensShape = normalizeTokensShape(part.tokens);
      if ([
        toNonNegativeInteger(tokensShape.input),
        toNonNegativeInteger(tokensShape.output),
        toNonNegativeInteger(tokensShape.reasoning),
        toNonNegativeInteger(tokensShape.cacheRead),
        toNonNegativeInteger(tokensShape.cacheWrite),
      ].some((entry) => entry === null)) issueCodes.push('emit_step_finish_tokens_invalid');
      if (tokensShape.totalPresent && toNonNegativeInteger(tokensShape.total) === null) issueCodes.push('emit_step_finish_total_invalid');
      if (toFiniteNonNegativeNumber(part.cost) === null) issueCodes.push('emit_step_finish_cost_invalid');
      continue;
    }
    if (event.type === TOOL_USE_EVENT_TYPE) {
      if (part.type !== TOOL_PART_TYPE) issueCodes.push('emit_part_type_mismatch');
      if (!isNonEmptyString(part.callID) || !isNonEmptyString(part.tool)) issueCodes.push('emit_tool_identity_invalid');
      if (!isPlainObject(part.state) || (part.state.status !== 'completed' && part.state.status !== 'error')) {
        issueCodes.push('emit_tool_state_invalid');
        continue;
      }
      if (!isPlainObject(part.state.input)) issueCodes.push('emit_tool_input_invalid');
      const start = toNonNegativeInteger(part.state?.time?.start);
      const end = toNonNegativeInteger(part.state?.time?.end);
      if (start === null || end === null || end < start) issueCodes.push('emit_tool_time_invalid');
      if (part.state.status === 'completed') {
        if (!isPlainObject(part.state.metadata)) issueCodes.push('emit_tool_metadata_invalid');
        if (!isNonEmptyString(part.state.output) || !isNonEmptyString(part.state.title)) issueCodes.push('emit_tool_completed_shape_invalid');
      } else if (!isNonEmptyString(part.state.error)) {
        issueCodes.push('emit_tool_error_invalid');
      }
      continue;
    }
    if (event.type === TEXT_EVENT_TYPE || event.type === REASONING_EVENT_TYPE) {
      if (part.type !== event.type) issueCodes.push('emit_part_type_mismatch');
      if (typeof part.text !== 'string') issueCodes.push(event.type === TEXT_EVENT_TYPE ? 'emit_text_invalid' : 'emit_reasoning_invalid');
      const start = toNonNegativeInteger(part.time?.start);
      const end = toNonNegativeInteger(part.time?.end);
      if (start === null || end === null || end < start) issueCodes.push(event.type === TEXT_EVENT_TYPE ? 'emit_text_time_invalid' : 'emit_reasoning_time_invalid');
    }
  }
  let status = 'UNAVAILABLE';
  if (Array.isArray(events) && events.length > 0) status = issueCodes.length ? (values.length ? 'PARTIAL' : 'INVALID') : 'COMPLETE';
  return {
    source: 'cli-envelope.timestamp',
    authority: 'DIAGNOSTIC_ONLY',
    sourceAuthorityBlock: issueCodes.length > 0,
    satisfiesTimingCompleteness: false,
    status,
    eventCount: Array.isArray(events) ? events.length : 0,
    firstEmitMs: values.length ? Math.min(...values) : null,
    lastEmitMs: values.length ? Math.max(...values) : null,
    spanMs: values.length ? Math.max(...values) - Math.min(...values) : null,
    issueCodes: [...new Set(issueCodes)].sort(),
  };
}

export function collectParentSessionTelemetryV2({ events, exportJson, exportStatus, exportErrorCode, expectedSessionId, expectedRuntimeVersion, expectedProviderId = 'cpa', expectedModelId = 'gpt-5.5', expectedAgent = 'qa', expectedMode = 'qa', jsonlSourceArtifact, exportSourceArtifact }) {
  const raw = collectRawParentSteps(events, expectedSessionId);
  const exported = buildExportSession({
    exportJson,
    exportStatus,
    exportErrorCode,
    expectedSessionId,
    expectedParentSessionId: null,
    expectedRuntimeVersion,
    expectedProviderId,
    expectedModelId,
    expectedAgent,
    expectedMode,
    role: 'parent',
    sourceArtifact: exportSourceArtifact,
    enforceNoTopLevelParent: true,
  });

  const issueCodes = new Set([...raw.issueCodes, ...exported.issueCodes]);
  const anomalies = [...raw.anomalies, ...exported.anomalies];
  const rawKeys = [...raw.steps.keys()].sort();
  const exportSteps = new Map();
  const exportAssistantIds = [];
  for (const message of exportAssistantMessages(exportJson)) {
    const info = message?.info ?? {};
    exportAssistantIds.push(info.id);
    const stepParts = Array.isArray(message?.parts) ? message.parts.filter((part) => part?.type === STEP_FINISH_PART_TYPE) : [];
    for (const part of stepParts) {
      const normalized = normalizeStepPart(part, new Set(), [], { source: 'reconcile' });
      if (normalized && !exportSteps.has(normalized.key)) exportSteps.set(normalized.key, normalized);
    }
  }
  const exportKeys = [...exportSteps.keys()].sort();
  if (rawKeys.length !== exportKeys.length || rawKeys.some((key, index) => key !== exportKeys[index])) collectIssue(issueCodes, 'raw_export_step_key_mismatch', anomalies);
  const rawMessageIds = [...raw.messageIds].sort();
  const exportMessageIdList = exportAssistantIds.filter(isNonEmptyString).sort();
  if (rawMessageIds.length !== exportMessageIdList.length || rawMessageIds.some((value, index) => value !== exportMessageIdList[index])) collectIssue(issueCodes, 'raw_export_message_set_mismatch', anomalies);
  for (const key of rawKeys) {
    const rawStep = raw.steps.get(key);
    const exportStep = exportSteps.get(key);
    if (!rawStep || !exportStep) continue;
    if (!sameStepFingerprint(rawStep, exportStep)) collectIssue(issueCodes, 'raw_export_step_value_mismatch', anomalies, { messageId: rawStep.messageId, partId: rawStep.partId });
  }

  const rawUsage = zeroUsage();
  let rawCost = 0;
  for (const step of raw.steps.values()) {
    if ([step.tokens.input, step.tokens.output, step.tokens.reasoning, step.tokens.cacheRead, step.tokens.cacheWrite].every((value) => value != null)) {
      rawUsage.input += step.tokens.input;
      rawUsage.output += step.tokens.output;
      rawUsage.reasoning += step.tokens.reasoning;
      rawUsage.cacheRead += step.tokens.cacheRead;
      rawUsage.cacheWrite += step.tokens.cacheWrite;
    }
    if (step.cost != null) rawCost += step.cost;
  }
  const rawUsageFinal = finalizeUsage(rawUsage);
  if (exported.usage.known.derivedTotal !== rawUsageFinal.derivedTotal
    || exported.usage.known.input !== rawUsageFinal.input
    || exported.usage.known.output !== rawUsageFinal.output
    || exported.usage.known.reasoning !== rawUsageFinal.reasoning
    || exported.usage.known.cacheRead !== rawUsageFinal.cacheRead
    || exported.usage.known.cacheWrite !== rawUsageFinal.cacheWrite) {
    collectIssue(issueCodes, 'raw_export_usage_aggregate_mismatch', anomalies);
  }
  if (exported.cost.known == null || Math.abs(exported.cost.known - rawCost) > 1e-9) collectIssue(issueCodes, 'raw_export_cost_aggregate_mismatch', anomalies);

  return {
    ...exported,
    sessionId: exported.sessionId ?? raw.sessionId,
    reconciliation: {
      rawJsonl: [...issueCodes].some((code) => code.startsWith('raw_') || code.startsWith('raw_export_') || code === 'duplicate_step_key') ? 'MISMATCH' : (rawKeys.length ? 'MATCH' : 'UNAVAILABLE'),
      nativeInternal: exported.reconciliation.nativeInternal,
    },
    sourceArtifacts: { jsonl: summarizeSourceArtifact(jsonlSourceArtifact), export: summarizeSourceArtifact(exportSourceArtifact) },
    issueCodes: [...issueCodes].sort(),
    anomalies,
    accountingStatus: [...issueCodes].length === 0
      ? 'COMPLETE'
      : [...issueCodes].some((code) => code.includes('missing_export') || code.includes('malformed_export') || code.includes('failed_export'))
        ? 'PARTIAL'
        : 'INVALID',
    usageStatus: [...issueCodes].some((code) => code.includes('missing_export') || code.includes('malformed_export') || code.includes('failed_export'))
      ? 'PARTIAL'
      : exported.usageStatus === 'COMPLETE' && ![...issueCodes].some((code) => code.includes('usage') || code.includes('tokens') || code.includes('step') || code.includes('duplicate') || code.includes('assistant_message_latest'))
        ? 'COMPLETE'
        : 'INVALID',
    costStatus: [...issueCodes].some((code) => code.includes('missing_export') || code.includes('malformed_export') || code.includes('failed_export'))
      ? 'PARTIAL'
      : exported.costStatus === 'COMPLETE' && ![...issueCodes].some((code) => code.includes('cost') || code.includes('duplicate') || code.includes('step'))
        ? 'COMPLETE'
        : 'INVALID',
    messageTimingStatus: [...issueCodes].some((code) => code.includes('missing_export') || code.includes('malformed_export') || code.includes('failed_export'))
      ? 'PARTIAL'
      : [...issueCodes].some((code) => code.includes('time')) ? 'INVALID' : exported.messageTimingStatus,
  };
}

export function collectChildSessionTelemetryV2({ exportJson, exportStatus, exportErrorCode, expectedSessionId, expectedParentSessionId, expectedRuntimeVersion, expectedProviderId = 'cpa', expectedModelId = 'gpt-5.5', expectedAgent = 'qa-cr', expectedMode = 'qa-cr', sourceArtifact }) {
  const exported = buildExportSession({
    exportJson,
    exportStatus,
    exportErrorCode,
    expectedSessionId,
    expectedParentSessionId,
    expectedRuntimeVersion,
    expectedProviderId,
    expectedModelId,
    expectedAgent,
    expectedMode,
    role: 'qa-cr',
    sourceArtifact,
    enforceNoTopLevelParent: false,
  });
  return exported;
}

export function aggregateRunTelemetryV2({ parent, children, expectedChildSessionIds }) {
  const issueCodes = new Set();
  const anomalies = [];
  const providedExpectedIds = Array.isArray(expectedChildSessionIds) ? expectedChildSessionIds : [];
  const expectedIds = unique(providedExpectedIds);
  if (expectedIds.length !== providedExpectedIds.length) collectIssue(issueCodes, 'duplicate_expected_child_session_id', anomalies);
  const childCounts = new Map();
  for (const child of Array.isArray(children) ? children : []) {
    if (!child?.sessionId) {
      collectIssue(issueCodes, 'anonymous_child_session', anomalies);
      continue;
    }
    childCounts.set(child.sessionId, (childCounts.get(child.sessionId) ?? 0) + 1);
    if (!expectedIds.includes(child.sessionId)) collectIssue(issueCodes, 'unexpected_child_session', anomalies, { sessionId: child.sessionId });
  }
  for (const [sessionId, count] of childCounts.entries()) {
    if (count > 1) collectIssue(issueCodes, 'duplicate_child_session', anomalies, { sessionId });
  }
  const uniqueChildren = new Map();
  for (const child of Array.isArray(children) ? children : []) {
    if (!child?.sessionId || (childCounts.get(child.sessionId) ?? 0) !== 1) continue;
    uniqueChildren.set(child.sessionId, child);
  }
  for (const id of expectedIds) {
    if (!uniqueChildren.has(id)) collectIssue(issueCodes, 'missing_expected_child_session', anomalies, { sessionId: id });
  }

  const included = [];
  if (!parent || parent.accountingStatus !== 'COMPLETE') collectIssue(issueCodes, 'parent_session_incomplete', anomalies);
  else included.push(parent);
  for (const id of expectedIds) {
    const child = uniqueChildren.get(id);
    if (!child) continue;
    if (child.parentSessionId !== parent?.sessionId) {
      collectIssue(issueCodes, 'child_parent_linkage_mismatch', anomalies, { sessionId: id });
      continue;
    }
    if (child.accountingStatus !== 'COMPLETE') {
      collectIssue(issueCodes, 'child_session_incomplete', anomalies, { sessionId: id });
      continue;
    }
    included.push(child);
  }

  const usage = zeroUsage();
  let cost = 0;
  let assistantMessages = 0;
  let stepFinishParts = 0;
  const starts = [];
  const ends = [];
  for (const session of included) {
    usage.input += session?.usage?.known?.input ?? 0;
    usage.output += session?.usage?.known?.output ?? 0;
    usage.reasoning += session?.usage?.known?.reasoning ?? 0;
    usage.cacheRead += session?.usage?.known?.cacheRead ?? 0;
    usage.cacheWrite += session?.usage?.known?.cacheWrite ?? 0;
    cost += session?.cost?.known ?? 0;
    assistantMessages += session?.counts?.assistantMessages ?? 0;
    stepFinishParts += session?.counts?.stepFinishParts ?? 0;
    if (toNonNegativeInteger(session?.messageTiming?.startMs) != null) starts.push(session.messageTiming.startMs);
    if (toNonNegativeInteger(session?.messageTiming?.endMs) != null) ends.push(session.messageTiming.endMs);
  }
  const usageFinal = finalizeUsage(usage);
  const messageTiming = starts.length && ends.length
    ? { source: 'aggregate.messages.window', startMs: Math.min(...starts), endMs: Math.max(...ends), latencyMs: Math.max(...ends) - Math.min(...starts) }
    : { source: 'aggregate.messages.window', startMs: null, endMs: null, latencyMs: null };
  const complete = issueCodes.size === 0 && included.length === expectedIds.length + 1;
  return {
    schemaVersion: RUN_TELEMETRY_V2_SCHEMA_VERSION,
    role: 'aggregate',
    sessionId: parent?.sessionId ?? null,
    parentSessionId: null,
    runtimeVersion: parent?.runtimeVersion ?? null,
    accountingStatus: complete ? 'COMPLETE' : 'INVALID',
    usageStatus: complete ? 'COMPLETE' : 'INVALID',
    costStatus: complete ? 'COMPLETE' : 'INVALID',
    messageTimingStatus: complete ? 'COMPLETE' : 'INVALID',
    stepTimingStatus: 'UNAVAILABLE',
    counts: { assistantMessages, stepFinishParts },
    usage: { source: 'export.step-finish', known: usageFinal, complete: complete ? usageFinal : null },
    cost: { source: 'export.step-finish', known: cost, complete: complete ? cost : null },
    messageTiming,
    stepTiming: { status: 'UNAVAILABLE', reasonCode: 'native_step_time_absent' },
    reconciliation: { rawJsonl: 'NOT_APPLICABLE', nativeInternal: complete ? 'MATCH' : 'MISMATCH' },
    sourceArtifacts: null,
    issueCodes: [...issueCodes].sort(),
    anomalies,
  };
}
