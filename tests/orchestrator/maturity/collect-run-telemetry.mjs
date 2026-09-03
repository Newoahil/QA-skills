import { createHash } from 'node:crypto';

export const RUN_TELEMETRY_SCHEMA_VERSION = 'qa-cr-run-telemetry-v1';

const STEP_EVENT_TYPES = new Set(['step_finish', 'step-finish']);
const STEP_PART_TYPE = 'step-finish';
const TOKEN_FIELDS = ['wireInput', 'wireOutput', 'reasoning', 'cacheRead', 'cacheWrite'];

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeValue(value) {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'NaN' };
    if (value === Infinity) return { type: 'Infinity' };
    if (value === -Infinity) return { type: '-Infinity' };
    return { type: 'number', value };
  }
  if (typeof value === 'string') return { type: 'string', length: value.length, sha256: sha256(value) };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  return { type: typeof value };
}

function collectObservedNonEmpty(values) {
  return values.filter((value) => typeof value === 'string' ? value.length > 0 : value != null);
}

function uniqueObserved(values) {
  return [...new Set(collectObservedNonEmpty(values))];
}

function anomaly(code, message, details = {}) {
  return { code, message, ...details };
}

function tokensZero() {
  return { wireInput: 0, wireOutput: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, derivedTotal: 0 };
}

function finalizeTokens(tokens) {
  return {
    wireInput: tokens.wireInput,
    wireOutput: tokens.wireOutput,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    derivedTotal: tokens.wireInput + tokens.wireOutput + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite,
  };
}

function sourceArtifactSummary(sourceArtifact) {
  if (!sourceArtifact || typeof sourceArtifact !== 'object') return null;
  const result = {};
  for (const key of ['id', 'hash', 'bytes']) {
    if (key in sourceArtifact) result[key] = sourceArtifact[key];
  }
  return Object.keys(result).length ? result : null;
}

function toNonNegativeInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

function toFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeTokens(tokens = {}) {
  const cache = tokens?.cache ?? {};
  return {
    wireInput: tokens?.input,
    wireOutput: tokens?.output,
    reasoning: tokens?.reasoning,
    cacheRead: cache?.read,
    cacheWrite: cache?.write,
    reportedTotal: tokens?.total,
  };
}

function parseSessionIdFromText(value) {
  if (typeof value !== 'string') return null;
  const wrapper = value.match(/<task_metadata>[\s\S]*?session_id\s*:\s*(ses_[A-Za-z0-9_-]+)/i)
    ?? value.match(/<session_id>\s*(ses_[A-Za-z0-9_-]+)\s*<\/session_id>/i)
    ?? value.match(/session_id\s*:\s*(ses_[A-Za-z0-9_-]+)/i);
  return wrapper?.[1] ?? null;
}

function exportIdentity(exportJson) {
  return {
    sessionIds: uniqueObserved([exportJson?.info?.id, exportJson?.session?.id, exportJson?.sessionID, exportJson?.sessionId]),
    parentSessionIds: uniqueObserved([exportJson?.info?.parentID, exportJson?.session?.parentID, exportJson?.parentSessionID, exportJson?.parentSessionId]),
  };
}

function messageIdentity(message, envelope) {
  return {
    role: message?.info?.role ?? message?.role ?? null,
    sessionIds: uniqueObserved([message?.info?.sessionID, message?.info?.sessionId, message?.sessionID, message?.sessionId, ...envelope.sessionIds]),
    parentSessionIds: uniqueObserved([message?.info?.parentSessionID, message?.info?.parentSessionId, message?.parentSessionID, message?.parentSessionId, ...envelope.parentSessionIds]),
    messageIds: uniqueObserved([message?.info?.id, message?.messageID, message?.messageId, message?.id]),
    time: message?.info?.time ?? message?.time ?? null,
  };
}

function chooseObservedValue(values) {
  return values.length === 1 ? values[0] : null;
}

function getPartTime(part, messageInfoTime, anomalies, context) {
  const start = toNonNegativeInteger(part?.time?.start)
    ?? toNonNegativeInteger(part?.startedAt)
    ?? toNonNegativeInteger(part?.startTimeMs)
    ?? toNonNegativeInteger(messageInfoTime?.created);
  const end = toNonNegativeInteger(part?.time?.end)
    ?? toNonNegativeInteger(part?.finishedAt)
    ?? toNonNegativeInteger(part?.endTimeMs)
    ?? toNonNegativeInteger(messageInfoTime?.completed);
  if (start !== null && end !== null && end < start) {
    anomalies.push(anomaly('invalid_timing', 'Negative step duration rejected', { context }));
    return { startMs: null, endMs: null, status: 'INVALID' };
  }
  if (start === null && end === null) return { startMs: null, endMs: null, status: 'UNAVAILABLE' };
  if (start === null || end === null) return { startMs: start, endMs: end, status: 'PARTIAL' };
  return { startMs: start, endMs: end, status: 'COMPLETE' };
}

function normalizeCost(costValue, anomalies, context) {
  if (costValue == null) return { present: false, valid: false, value: null, fingerprint: safeValue(costValue) };
  const valid = toFiniteNonNegativeNumber(costValue);
  if (valid !== null) return { present: true, valid: true, value: valid, fingerprint: safeValue(costValue) };
  anomalies.push(anomaly('invalid_cost', 'Invalid cost value', { context, raw: safeValue(costValue) }));
  return { present: true, valid: false, value: null, fingerprint: safeValue(costValue) };
}

function normalizeComponent(rawValue, componentName, anomalies, context) {
  const valid = toNonNegativeInteger(rawValue);
  if (valid !== null) return { value: valid, valid: true, fingerprint: safeValue(rawValue) };
  anomalies.push(anomaly('invalid_token_component', `Invalid ${componentName} token component`, { component: componentName, context, raw: safeValue(rawValue) }));
  return { value: 0, valid: false, fingerprint: safeValue(rawValue) };
}

function resolveIdentity({ part, message, envelope, expectedSessionId, expectedParentSessionId, anomalies, context }) {
  const observedSessionIds = uniqueObserved([part?.sessionID, part?.sessionId, ...message.sessionIds, ...envelope.sessionIds]);
  const observedMessageIds = uniqueObserved([part?.messageID, part?.messageId, ...message.messageIds]);
  const observedParentSessionIds = uniqueObserved([part?.parentSessionID, part?.parentSessionId, ...message.parentSessionIds, ...envelope.parentSessionIds]);
  if (observedSessionIds.length === 0) {
    anomalies.push(anomaly('missing_session_id', 'Missing observed session id on step-finish part', { context }));
    return null;
  }
  if (observedSessionIds.length > 1) {
    anomalies.push(anomaly('session_conflict', 'Observed session ids conflict on step-finish part', { context, observed: observedSessionIds.map(safeValue) }));
    return null;
  }
  if (observedMessageIds.length === 0) {
    anomalies.push(anomaly('missing_message_id', 'Missing observed message id on step-finish part', { context }));
    return null;
  }
  if (observedMessageIds.length > 1) {
    anomalies.push(anomaly('message_id_conflict', 'Observed message ids conflict on step-finish part', { context, observed: observedMessageIds.map(safeValue) }));
    return null;
  }
  if (observedParentSessionIds.length > 1) {
    anomalies.push(anomaly('parent_session_conflict', 'Observed parent session ids conflict on step-finish part', { context, observed: observedParentSessionIds.map(safeValue) }));
    return null;
  }
  const sessionId = chooseObservedValue(observedSessionIds);
  const messageId = chooseObservedValue(observedMessageIds);
  const parentSessionId = chooseObservedValue(observedParentSessionIds);
  if (expectedSessionId && sessionId !== expectedSessionId) {
    anomalies.push(anomaly('session_mismatch', 'Step-finish session id mismatches expected session id', { context, observed: observedSessionIds.map(safeValue) }));
    return null;
  }
  if (expectedParentSessionId) {
    if (observedParentSessionIds.length === 0) {
      anomalies.push(anomaly('missing_parent_session_id', 'Missing observed parent session linkage for expected child session', { context }));
      return null;
    }
    if (parentSessionId !== expectedParentSessionId) {
      anomalies.push(anomaly('parent_session_mismatch', 'Step-finish parent session id mismatches expected parent session id', { context, observed: observedParentSessionIds.map(safeValue) }));
      return null;
    }
  }
  return { sessionId, parentSessionId, messageId, observedSessionIds, observedParentSessionIds };
}

function buildStepRecord({ part, message, envelope, expectedSessionId, expectedParentSessionId, anomalies, context }) {
  const identity = resolveIdentity({ part, message, envelope, expectedSessionId, expectedParentSessionId, anomalies, context });
  if (!identity) return null;
  const normalizedTokens = normalizeTokens(part?.tokens);
  const usage = tokensZero();
  const fingerprints = {};
  let usageComplete = true;
  for (const field of TOKEN_FIELDS) {
    const item = normalizeComponent(normalizedTokens[field], field, anomalies, { ...context, key: `${identity.sessionId}::${identity.messageId}` });
    usage[field] = item.value;
    fingerprints[field] = item.fingerprint;
    if (!item.valid) usageComplete = false;
  }
  const reportedTotal = toNonNegativeInteger(normalizedTokens.reportedTotal);
  const reportedTotalComparable = normalizedTokens.reportedTotal == null || reportedTotal !== null;
  if (!reportedTotalComparable) {
    anomalies.push(anomaly('invalid_reported_total', 'Invalid reported total tokens', { context, raw: safeValue(normalizedTokens.reportedTotal) }));
  }
  const timing = getPartTime(part, message.time, anomalies, { ...context, key: `${identity.sessionId}::${identity.messageId}` });
  return {
    key: `${identity.sessionId}::${identity.messageId}`,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
    messageId: identity.messageId,
    usage: finalizeTokens(usage),
    usageComplete,
    tokenFingerprints: { ...fingerprints, reportedTotal: safeValue(normalizedTokens.reportedTotal) },
    reportedTotal,
    reportedTotalComparable,
    cost: normalizeCost(part?.cost, anomalies, { ...context, key: `${identity.sessionId}::${identity.messageId}` }),
    timing,
    observedSessionId: identity.sessionId,
    observedParentSessionId: identity.parentSessionId,
  };
}

function sameTokens(a, b) {
  return TOKEN_FIELDS.every((field) => a.usage[field] === b.usage[field])
    && a.usageComplete === b.usageComplete
    && TOKEN_FIELDS.every((field) => JSON.stringify(a.tokenFingerprints[field]) === JSON.stringify(b.tokenFingerprints[field]));
}

function sameCost(a, b) {
  return a.cost.present === b.cost.present && a.cost.valid === b.cost.valid && a.cost.value === b.cost.value;
}

function sameTiming(a, b) {
  return a.timing.status === b.timing.status && a.timing.startMs === b.timing.startMs && a.timing.endMs === b.timing.endMs;
}

function summarizeTimingRecords(records) {
  const starts = records.map((record) => record.timing.startMs).filter((value) => value !== null);
  const ends = records.map((record) => record.timing.endMs).filter((value) => value !== null);
  const knownTiming = starts.length || ends.length
    ? { startMs: starts.length ? Math.min(...starts) : null, endMs: ends.length ? Math.max(...ends) : null, durationMs: starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null }
    : null;
  const anyInvalid = records.some((record) => record.timing.status === 'INVALID');
  const allComplete = records.length > 0 && records.every((record) => record.timing.status === 'COMPLETE');
  const anyKnown = records.some((record) => record.timing.status !== 'UNAVAILABLE');
  const timingStatus = anyInvalid ? 'INVALID' : !anyKnown ? 'UNAVAILABLE' : allComplete ? 'COMPLETE' : 'PARTIAL';
  return { timingStatus, knownTiming, completeTiming: timingStatus === 'COMPLETE' ? knownTiming : null };
}

function aggregateStepRecords({ stepRecords, role, source, sessionId, parentSessionId, sourceArtifact, totalTolerance, blockedComplete = false }) {
  const anomalies = [];
  const groups = new Map();
  for (const step of stepRecords) {
    const list = groups.get(step.key) ?? [];
    list.push(step);
    groups.set(step.key, list);
  }

  const knownUsage = tokensZero();
  let reportedTotal = 0;
  let comparable = stepRecords.length > 0;
  let duplicateStepCount = 0;
  let usageHasConflict = false;
  let costHasConflict = false;
  let invalidCostCount = 0;
  let missingCostCount = 0;
  let validCostCount = 0;
  let knownCost = 0;
  const acceptedForTiming = [];
  let timingHasConflict = false;

  for (const [key, records] of groups) {
    const first = records[0];
    let tokenConflict = false;
    let costConflict = false;
    let timingConflict = false;
    let reportedTotalConflict = false;
    let identicalDuplicates = 0;
    for (const record of records.slice(1)) {
      duplicateStepCount += 1;
      const tokensMatch = sameTokens(first, record);
      const costMatch = sameCost(first, record);
      const timingMatch = sameTiming(first, record);
      if (tokensMatch && costMatch && timingMatch && first.reportedTotal === record.reportedTotal && first.reportedTotalComparable === record.reportedTotalComparable) {
        identicalDuplicates += 1;
        continue;
      }
      if (!tokensMatch) tokenConflict = true;
      if (!costMatch) costConflict = true;
      if (tokensMatch && !timingMatch) timingConflict = true;
      if (tokensMatch && !tokenConflict && first.reportedTotalComparable && record.reportedTotalComparable && first.reportedTotal !== record.reportedTotal) reportedTotalConflict = true;
      if (tokensMatch && !tokenConflict && first.reportedTotalComparable !== record.reportedTotalComparable) reportedTotalConflict = true;
    }
    if (identicalDuplicates > 0) {
      anomalies.push(anomaly('duplicate_step_identical', 'Identical duplicate step-finish counted once', { key, count: identicalDuplicates }));
    }
    if (tokenConflict) {
      usageHasConflict = true;
      anomalies.push(anomaly(costConflict ? 'duplicate_step_conflict' : 'duplicate_step_usage_conflict', 'Duplicate step-finish token conflict quarantined', {
        key,
        fingerprints: first.tokenFingerprints,
      }));
    }
    if (costConflict) {
      costHasConflict = true;
      anomalies.push(anomaly(tokenConflict ? 'duplicate_step_conflict_cost' : 'duplicate_step_cost_conflict', 'Duplicate step-finish cost conflict quarantined', {
        key,
        fingerprint: first.cost.fingerprint,
      }));
    }
    if (reportedTotalConflict) {
      anomalies.push(anomaly('duplicate_reported_total_conflict', 'Duplicate step-finish reported total conflict ignored for canonical usage', {
        key,
        fingerprint: first.tokenFingerprints.reportedTotal,
      }));
    }
    if (timingConflict) {
      timingHasConflict = true;
      anomalies.push(anomaly('duplicate_step_timing_conflict', 'Duplicate step-finish timing conflict quarantined', { key }));
    }

    if (!tokenConflict) {
      for (const field of TOKEN_FIELDS) knownUsage[field] += first.usage[field];
      if (!first.usageComplete) usageHasConflict = true;
      if (reportedTotalConflict || first.reportedTotal == null || !first.reportedTotalComparable) comparable = false;
      else reportedTotal += first.reportedTotal;
    } else {
      comparable = false;
    }

    if (!costConflict) {
      if (!first.cost.present) missingCostCount += 1;
      else if (!first.cost.valid) invalidCostCount += 1;
      else {
        validCostCount += 1;
        knownCost += first.cost.value;
      }
    }

    if (!tokenConflict && !timingConflict) acceptedForTiming.push(first);
  }

  const finalizedKnownUsage = finalizeTokens(knownUsage);
  const tolerance = toNonNegativeInteger(totalTolerance) ?? 0;
  const totalCheckComparable = comparable && groups.size > 0;
  const delta = totalCheckComparable ? reportedTotal - finalizedKnownUsage.derivedTotal : null;
  const withinTolerance = totalCheckComparable ? Math.abs(delta) <= tolerance : false;
  if (totalCheckComparable && !withinTolerance) {
    anomalies.push(anomaly('reported_total_out_of_tolerance', 'Reported total differs from derived total beyond tolerance', {
      reportedTotal,
      derivedTotal: finalizedKnownUsage.derivedTotal,
      delta,
      tolerance,
    }));
  }

  const usageStatus = groups.size === 0 ? 'UNAVAILABLE' : (usageHasConflict || blockedComplete) ? 'PARTIAL' : 'COMPLETE';
  let costStatus = 'UNAVAILABLE';
  if (groups.size > 0) {
    if (validCostCount === 0 && missingCostCount === groups.size && invalidCostCount === 0 && !costHasConflict) costStatus = 'UNAVAILABLE';
    else if (costHasConflict || invalidCostCount > 0 || missingCostCount > 0 || blockedComplete) costStatus = 'PARTIAL';
    else costStatus = 'COMPLETE';
  }

  const timingSummary = summarizeTimingRecords(acceptedForTiming);
  let timingStatus = timingSummary.timingStatus;
  if (timingHasConflict && timingStatus === 'UNAVAILABLE') timingStatus = 'PARTIAL';
  else if (timingHasConflict || (blockedComplete && timingSummary.timingStatus === 'COMPLETE')) timingStatus = 'PARTIAL';
  const accountingStatus = groups.size === 0
    ? 'UNAVAILABLE'
    : usageStatus === 'COMPLETE' && costStatus === 'COMPLETE' && timingStatus === 'COMPLETE'
      ? 'COMPLETE'
      : usageStatus === 'UNAVAILABLE' && costStatus === 'UNAVAILABLE' && timingStatus === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'PARTIAL';

  return {
    schemaVersion: RUN_TELEMETRY_SCHEMA_VERSION,
    sessionId: sessionId ?? chooseObservedValue(uniqueObserved(stepRecords.map((record) => record.observedSessionId))) ?? null,
    parentSessionId: parentSessionId ?? chooseObservedValue(uniqueObserved(stepRecords.map((record) => record.observedParentSessionId))) ?? null,
    role,
    source,
    accountingStatus,
    usageStatus,
    costStatus,
    timingStatus,
    assistantMessageCount: null,
    stepFinishCount: groups.size,
    duplicateStepCount,
    tokens: {
      known: finalizedKnownUsage,
      completeUsage: usageStatus === 'COMPLETE' ? finalizedKnownUsage : null,
      reportedTotal: totalCheckComparable ? reportedTotal : null,
      totalCheck: {
        reportedTotal: totalCheckComparable ? reportedTotal : null,
        derivedTotal: finalizedKnownUsage.derivedTotal,
        delta,
        tolerance,
        withinTolerance,
        comparable: totalCheckComparable,
      },
    },
    costs: {
      knownCost: validCostCount > 0 ? knownCost : null,
      completeCost: costStatus === 'COMPLETE' ? knownCost : null,
      validCostCount,
    },
    timing: {
      knownTiming: timingSummary.knownTiming,
      completeTiming: timingStatus === 'COMPLETE' ? timingSummary.completeTiming : null,
    },
    toolUsage: { stepFinishCount: groups.size },
    sourceArtifact: sourceArtifactSummary(sourceArtifact),
    gaps: groups.size === 0 ? ['no-step-finish-parts'] : [],
    anomalies,
  };
}

function sanitizeExportFailure(exportStatus, exportError) {
  return {
    exportStatus: safeValue(exportStatus),
    exportError: safeValue(exportError),
  };
}

function isExplicitExportFailure(exportStatus) {
  if (exportStatus == null || exportStatus === 0) return false;
  if (typeof exportStatus === 'number') return exportStatus !== 0;
  if (typeof exportStatus === 'string') return !new Set(['ok', 'success', 'complete', 'completed']).has(exportStatus.toLowerCase());
  return true;
}

export function extractQaCrChildSessionIds(parentEvents) {
  const result = [];
  const seen = new Set();
  for (const event of Array.isArray(parentEvents) ? parentEvents : []) {
    if (event?.type !== 'tool_use') continue;
    if (event?.part?.tool !== 'task') continue;
    if (event?.part?.state?.status !== 'completed') continue;
    const input = event?.part?.state?.input;
    if ((input?.subagent_type ?? input?.subagentType) !== 'qa-cr') continue;
    const metadata = event?.part?.state?.metadata ?? {};
    const childSessionId = metadata.sessionId
      ?? metadata.sessionID
      ?? metadata.taskSessionId
      ?? metadata.taskSessionID
      ?? parseSessionIdFromText(event?.part?.state?.output);
    if (!childSessionId || seen.has(childSessionId)) continue;
    seen.add(childSessionId);
    result.push(childSessionId);
  }
  return result;
}

export function collectParentSessionTelemetry({ events, expectedSessionId, sourceArtifact, totalTolerance = 0 }) {
  const anomalies = [];
  const tolerance = toNonNegativeInteger(totalTolerance);
  if (tolerance === null) anomalies.push(anomaly('invalid_tolerance', 'Invalid total tolerance; defaulted to 0', { raw: safeValue(totalTolerance) }));
  const stepRecords = [];
  for (const [index, event] of (Array.isArray(events) ? events : []).entries()) {
    if (!STEP_EVENT_TYPES.has(event?.type)) continue;
    if (event?.part?.type !== STEP_PART_TYPE) continue;
    const step = buildStepRecord({
      part: event.part,
      message: messageIdentity(event, { sessionIds: uniqueObserved([event?.sessionID, event?.sessionId]), parentSessionIds: uniqueObserved([event?.parentSessionID, event?.parentSessionId]) }),
      envelope: { sessionIds: uniqueObserved([event?.sessionID, event?.sessionId]), parentSessionIds: uniqueObserved([event?.parentSessionID, event?.parentSessionId]) },
      expectedSessionId,
      expectedParentSessionId: null,
      anomalies,
      context: { source: 'parent-jsonl', index },
    });
    if (step) stepRecords.push(step);
  }
  const summary = aggregateStepRecords({
    stepRecords,
    role: 'parent',
    source: 'parent-jsonl',
    sessionId: null,
    parentSessionId: null,
    sourceArtifact,
    totalTolerance: tolerance ?? 0,
  });
  if (!summary.sessionId && summary.accountingStatus === 'UNAVAILABLE') summary.expectedSessionId = expectedSessionId ?? null;
  summary.anomalies = [...summary.anomalies, ...anomalies];
  return summary;
}

export function collectExportedSessionTelemetry({ exportJson, exportStatus, exportError, expectedSessionId, expectedParentSessionId, sourceArtifact, totalTolerance = 0 }) {
  const anomalies = [];
  const tolerance = toNonNegativeInteger(totalTolerance);
  if (tolerance === null) anomalies.push(anomaly('invalid_tolerance', 'Invalid total tolerance; defaulted to 0', { raw: safeValue(totalTolerance) }));
  const exportFailed = isExplicitExportFailure(exportStatus);
  const sanitizedFailure = sanitizeExportFailure(exportStatus, exportError);

  if (!exportJson || typeof exportJson !== 'object') {
    return {
      schemaVersion: RUN_TELEMETRY_SCHEMA_VERSION,
      sessionId: null,
      parentSessionId: null,
      role: 'child',
      source: 'session-export',
      accountingStatus: 'UNAVAILABLE',
      usageStatus: 'UNAVAILABLE',
      costStatus: 'UNAVAILABLE',
      timingStatus: 'UNAVAILABLE',
      assistantMessageCount: 0,
      stepFinishCount: 0,
      duplicateStepCount: 0,
      tokens: { known: tokensZero(), completeUsage: null, reportedTotal: null, totalCheck: { reportedTotal: null, derivedTotal: 0, delta: null, tolerance: tolerance ?? 0, withinTolerance: false, comparable: false } },
      costs: { knownCost: null, completeCost: null, validCostCount: 0 },
      timing: { knownTiming: null, completeTiming: null },
      toolUsage: { stepFinishCount: 0 },
      sourceArtifact: sourceArtifactSummary(sourceArtifact),
      gaps: ['missing-export-json'],
      expectedSessionId: expectedSessionId ?? null,
      expectedParentSessionId: expectedParentSessionId ?? null,
      anomalies: [anomaly('missing_export', 'Child export JSON is unavailable', sanitizedFailure), ...anomalies],
    };
  }

  const envelope = exportIdentity(exportJson);
  const messages = Array.isArray(exportJson.messages) ? exportJson.messages : [];
  const stepRecords = [];
  let assistantMessageCount = 0;
  let invalidIdentitySeen = false;
  for (const [messageIndex, message] of messages.entries()) {
    const messageInfo = messageIdentity(message, envelope);
    if (messageInfo.role !== 'assistant') continue;
    assistantMessageCount += 1;
    for (const [partIndex, part] of (Array.isArray(message?.parts) ? message.parts : []).entries()) {
      if (part?.type !== STEP_PART_TYPE) continue;
      const before = anomalies.length;
      const step = buildStepRecord({
        part,
        message: messageInfo,
        envelope,
        expectedSessionId,
        expectedParentSessionId,
        anomalies,
        context: { source: 'session-export', messageIndex, partIndex },
      });
      if (anomalies.length > before && !step) invalidIdentitySeen = true;
      if (step) stepRecords.push(step);
    }
  }

  const summary = aggregateStepRecords({
    stepRecords,
    role: 'child',
    source: 'session-export',
    sessionId: chooseObservedValue(envelope.sessionIds),
    parentSessionId: chooseObservedValue(envelope.parentSessionIds),
    sourceArtifact,
    totalTolerance: tolerance ?? 0,
    blockedComplete: exportFailed || invalidIdentitySeen,
  });
  summary.assistantMessageCount = assistantMessageCount;
  if (!summary.sessionId && summary.accountingStatus === 'UNAVAILABLE') summary.expectedSessionId = expectedSessionId ?? null;
  if (!summary.parentSessionId && summary.accountingStatus === 'UNAVAILABLE') summary.expectedParentSessionId = expectedParentSessionId ?? null;
  if (exportFailed) anomalies.push(anomaly('export_failure', 'Export status indicates failure; completeness lowered', sanitizedFailure));
  summary.anomalies = [...summary.anomalies, ...anomalies];
  return summary;
}

export function aggregateRunTelemetry({ parent, children, expectedChildSessionIds }) {
  const anomalies = [];
  const expectedIds = Array.isArray(expectedChildSessionIds) ? [...new Set(expectedChildSessionIds.filter(Boolean))] : [];
  const counts = new Map();
  for (const child of Array.isArray(children) ? children : []) {
    const id = child?.sessionId ?? null;
    if (!id) {
      anomalies.push(anomaly('missing_child_session', 'Child summary is missing session id'));
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const duplicateSessionIds = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicateSessionIds.length) anomalies.push(anomaly('duplicate_child_session', 'Duplicate child session ids quarantined from aggregate', { sessionIds: duplicateSessionIds }));

  const childMap = new Map();
  for (const child of Array.isArray(children) ? children : []) {
    const id = child?.sessionId ?? null;
    if (!id || duplicateSessionIds.includes(id)) continue;
    childMap.set(id, child);
  }

  const missingChildSessionIds = expectedIds.filter((id) => !childMap.has(id));
  if (missingChildSessionIds.length) anomalies.push(anomaly('missing_expected_child', 'Expected child sessions are missing from aggregate', { sessionIds: missingChildSessionIds }));

  const knownUsage = tokensZero();
  let anyUsageKnown = parent?.usageStatus && parent.usageStatus !== 'UNAVAILABLE';
  let anyCostKnown = parent?.costStatus && parent.costStatus !== 'UNAVAILABLE';
  let anyTimingKnown = parent?.timingStatus && parent.timingStatus !== 'UNAVAILABLE';
  let usageComplete = parent?.usageStatus === 'COMPLETE';
  let costComplete = parent?.costStatus === 'COMPLETE';
  let timingComplete = parent?.timingStatus === 'COMPLETE';
  let knownCost = typeof parent?.costs?.knownCost === 'number' ? parent.costs.knownCost : 0;
  const timingEntries = [];

  if (parent?.tokens?.known) for (const field of TOKEN_FIELDS) knownUsage[field] += parent.tokens.known[field] ?? 0;
  if (parent?.timing?.knownTiming) timingEntries.push(parent.timing.knownTiming);

  const linkageMismatches = [];
  for (const [sessionId, child] of childMap) {
    if (parent?.sessionId && child?.parentSessionId && child.parentSessionId !== parent.sessionId) {
      linkageMismatches.push(sessionId);
      usageComplete = false;
      costComplete = false;
      timingComplete = false;
      continue;
    }
    if (child?.tokens?.known) {
      for (const field of TOKEN_FIELDS) knownUsage[field] += child.tokens.known[field] ?? 0;
      anyUsageKnown = anyUsageKnown || child.usageStatus !== 'UNAVAILABLE';
    }
    if (typeof child?.costs?.knownCost === 'number') {
      knownCost += child.costs.knownCost;
      anyCostKnown = true;
    }
    if (child?.timing?.knownTiming) {
      timingEntries.push(child.timing.knownTiming);
      anyTimingKnown = true;
    }
    usageComplete = usageComplete && child?.usageStatus === 'COMPLETE';
    costComplete = costComplete && child?.costStatus === 'COMPLETE';
    timingComplete = timingComplete && child?.timingStatus === 'COMPLETE';
  }
  if (linkageMismatches.length) anomalies.push(anomaly('child_linkage_mismatch', 'Child parent session linkage mismatch detected', { sessionIds: linkageMismatches }));

  const finalizedKnownUsage = finalizeTokens(knownUsage);
  const blockedComplete = missingChildSessionIds.length > 0 || duplicateSessionIds.length > 0 || linkageMismatches.length > 0;
  const starts = timingEntries.map((entry) => entry?.startMs).filter((value) => value != null);
  const ends = timingEntries.map((entry) => entry?.endMs).filter((value) => value != null);
  const knownTiming = starts.length || ends.length ? { startMs: starts.length ? Math.min(...starts) : null, endMs: ends.length ? Math.max(...ends) : null, durationMs: starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null } : null;
  const timingStatus = !anyTimingKnown ? 'UNAVAILABLE' : blockedComplete || !timingComplete ? 'PARTIAL' : 'COMPLETE';

  return {
    schemaVersion: RUN_TELEMETRY_SCHEMA_VERSION,
    sessionId: parent?.sessionId ?? null,
    parentSessionId: null,
    role: 'aggregate',
    source: 'aggregate',
    accountingStatus: duplicateSessionIds.length || linkageMismatches.length ? 'INVALID' : blockedComplete || !usageComplete || !costComplete || timingStatus !== 'COMPLETE' ? 'PARTIAL' : 'COMPLETE',
    usageStatus: !anyUsageKnown ? 'UNAVAILABLE' : blockedComplete || !usageComplete ? 'PARTIAL' : 'COMPLETE',
    costStatus: !anyCostKnown ? 'UNAVAILABLE' : blockedComplete || !costComplete ? 'PARTIAL' : 'COMPLETE',
    timingStatus,
    assistantMessageCount: null,
    stepFinishCount: (parent?.stepFinishCount ?? 0) + [...childMap.values()].reduce((sum, child) => sum + (child?.stepFinishCount ?? 0), 0),
    duplicateStepCount: (parent?.duplicateStepCount ?? 0) + [...childMap.values()].reduce((sum, child) => sum + (child?.duplicateStepCount ?? 0), 0),
    tokens: {
      known: finalizedKnownUsage,
      completeUsage: !anyUsageKnown || blockedComplete || !usageComplete ? null : finalizedKnownUsage,
      reportedTotal: null,
      totalCheck: { reportedTotal: null, derivedTotal: finalizedKnownUsage.derivedTotal, delta: null, tolerance: 0, withinTolerance: false, comparable: false },
    },
    costs: {
      knownCost: anyCostKnown ? knownCost : null,
      completeCost: !anyCostKnown || blockedComplete || !costComplete ? null : knownCost,
      validCostCount: null,
    },
    timing: {
      knownTiming,
      completeTiming: !anyTimingKnown || blockedComplete || !timingComplete ? null : knownTiming,
    },
    toolUsage: { stepFinishCount: (parent?.stepFinishCount ?? 0) + [...childMap.values()].reduce((sum, child) => sum + (child?.stepFinishCount ?? 0), 0) },
    sourceArtifact: null,
    gaps: missingChildSessionIds.map((id) => `missing-child:${id}`),
    anomalies,
    missingChildSessionIds,
  };
}
