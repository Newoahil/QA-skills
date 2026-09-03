import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_STATUS_GATE_PAIRS,
  MANIFEST_SCHEMA_VERSION,
  QA_CR_CATEGORY_IDS,
  canonicalizeJson,
  sha256CanonicalJson,
  summarizeQaCrMaturityManifest,
  validateQaCrMaturityCase,
  validateQaCrMaturityManifest,
} from './case-manifest.mjs';
import {
  RUN_TELEMETRY_SCHEMA_VERSION,
  aggregateRunTelemetry,
  collectExportedSessionTelemetry,
  collectParentSessionTelemetry,
  extractQaCrChildSessionIds,
} from './collect-run-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');
const manifestPath = path.join(root, 'benchmarks', 'qa-cr-maturity', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const secretSentinel = 'SECRET_SENTINEL_123';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parentStep({
  sessionId = 'parent-1',
  messageId,
  input = 1,
  output = 2,
  reasoning = 3,
  cacheRead = 4,
  cacheWrite = 5,
  total,
  cost,
  type = 'step_finish',
  partSessionId,
  partMessageId,
  partTime,
} = {}) {
  const derived = input + output + reasoning + cacheRead + cacheWrite;
  return {
    type,
    sessionID: sessionId,
    messageID: messageId,
    part: {
      type: 'step-finish',
      sessionID: partSessionId ?? sessionId,
      messageID: partMessageId ?? messageId,
      tokens: {
        input,
        output,
        reasoning,
        total: total ?? derived,
        cache: {
          read: cacheRead,
          write: cacheWrite,
        },
      },
      cost,
      ...(partTime ? { time: partTime } : { startedAt: 10, finishedAt: 20 }),
      text: `ignore ${secretSentinel}`,
      toolOutput: `ignore ${secretSentinel}`,
    },
    info: {
      tokens: { total: 999 },
      cost: 999,
    },
  };
}

function childExport({
  sessionId = 'child-1',
  parentSessionId = 'parent-1',
  steps = [],
  extraParts = [],
  infoTokens = 999,
  infoCost = 999,
  useInfoEnvelope = false,
  messages,
} = {}) {
  const defaultMessages = messages ?? [
    {
      role: 'assistant',
      sessionID: sessionId,
      parentSessionID: parentSessionId,
      info: {
        role: 'assistant',
        sessionID: sessionId,
        tokens: { total: infoTokens },
        cost: infoCost,
      },
      parts: [
        ...extraParts,
        ...steps,
      ],
      text: `ignore ${secretSentinel}`,
    },
  ];
  if (useInfoEnvelope) {
    return {
      info: { id: sessionId, parentID: parentSessionId },
      messages: defaultMessages,
    };
  }
  return {
    sessionID: sessionId,
    parentSessionID: parentSessionId,
    messages: defaultMessages,
  };
}

function childStep({
  sessionId = 'child-1',
  parentSessionId = 'parent-1',
  messageId,
  input = 1,
  output = 2,
  reasoning = 3,
  cacheRead = 4,
  cacheWrite = 5,
  total,
  cost,
  time,
  sessionFromMessage = false,
} = {}) {
  const derived = input + output + reasoning + cacheRead + cacheWrite;
  return {
    type: 'step-finish',
    sessionID: sessionId,
    parentSessionID: parentSessionId,
    messageID: messageId,
    tokens: {
      input,
      output,
      reasoning,
      total: total ?? derived,
      cache: {
        read: cacheRead,
        write: cacheWrite,
      },
    },
    cost,
    ...(time ? { time } : { startedAt: 100, finishedAt: 120 }),
    toolInput: `ignore ${secretSentinel}`,
    ...(sessionFromMessage ? { sessionID: undefined, parentSessionID: undefined, messageID: undefined } : {}),
  };
}

test('manifest exports expose frozen schema metadata', () => {
  assert.equal(MANIFEST_SCHEMA_VERSION, 'qa-cr-maturity-manifest-v1');
  assert.equal(RUN_TELEMETRY_SCHEMA_VERSION, 'qa-cr-run-telemetry-v1');
  assert.equal(QA_CR_CATEGORY_IDS.length, 10);
  assert.equal(ALLOWED_STATUS_GATE_PAIRS.length, 5);
});

test('manifest validates committed Phase A seed', () => {
  const result = validateQaCrMaturityManifest(manifest);
  assert.equal(result.ok, true);
  assert.equal(result.stats.caseCount >= 5, true);
  assert.equal(result.stats.scoringEligibleCount, 0);
});

test('manifest rejects duplicate ids', () => {
  const invalid = clone(manifest);
  invalid.cases[1].id = invalid.cases[0].id;
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /duplicate_id/);
});

test('manifest rejects unknown top, case, and nested fields', () => {
  const invalid = clone(manifest);
  invalid.extra = true;
  invalid.cases[0].extra = true;
  invalid.cases[0].complexity.extra = true;
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /unknown_field/);
});

test('manifest rejects bad category and illegal disposition', () => {
  const invalid = clone(manifest);
  invalid.cases[0].categories = ['CR-C11'];
  invalid.cases[0].expectedDisposition = {
    ...invalid.cases[0].expectedDisposition,
    status: 'OK',
    gate: 'stop_and_fail',
  };
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /invalid_category/);
  assert.match(JSON.stringify(result.issues), /invalid_disposition/);
});

test('manifest rejects control and disposition mismatches', () => {
  const invalid = clone(manifest);
  invalid.cases[0].controlType = 'clean';
  invalid.cases[1].controlType = null;
  invalid.cases[2].expectedDisposition.gate = 'stop_and_fail';
  invalid.cases[3].expectedDisposition.status = 'OK';
  invalid.cases[4].expectedDisposition.gate = 'continue';
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /control_mismatch/);
  assert.match(JSON.stringify(result.issues), /control_disposition_mismatch/);
});

test('manifest rejects defect case with OK disposition in Phase A seed', () => {
  const invalid = clone(manifest);
  invalid.cases[0].expectedDisposition.status = 'OK';
  invalid.cases[0].expectedDisposition.gate = 'continue';
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /defect_disposition_mismatch/);
});

test('manifest exact-key validation allows null controlType but rejects missing controlType', () => {
  const defectCase = clone(manifest.cases[0]);
  defectCase.controlType = null;
  const validResult = validateQaCrMaturityCase(defectCase, { path: 'case' });
  assert.equal(validResult.ok, true);

  delete defectCase.controlType;
  const invalidResult = validateQaCrMaturityCase(defectCase, { path: 'case' });
  assert.equal(invalidResult.ok, false);
  assert.match(JSON.stringify(invalidResult.issues), /missing_field/);
});

test('manifest rejects invalid control null and invalid control subtype/disposition combinations', () => {
  const invalidNull = clone(manifest.cases[1]);
  invalidNull.controlType = null;
  const nullResult = validateQaCrMaturityCase(invalidNull, { path: 'case' });
  assert.equal(nullResult.ok, false);
  assert.match(JSON.stringify(nullResult.issues), /control_mismatch/);

  const invalidSubtype = clone(manifest.cases[1]);
  invalidSubtype.controlType = 'defect';
  const subtypeResult = validateQaCrMaturityCase(invalidSubtype, { path: 'case' });
  assert.equal(subtypeResult.ok, false);
  assert.match(JSON.stringify(subtypeResult.issues), /invalid_value/);

  const invalidDisposition = clone(manifest.cases[4]);
  invalidDisposition.expectedDisposition.gate = 'continue';
  const dispositionResult = validateQaCrMaturityCase(invalidDisposition, { path: 'case' });
  assert.equal(dispositionResult.ok, false);
  assert.match(JSON.stringify(dispositionResult.issues), /control_disposition_mismatch/);
});

test('manifest rejects missing severity, oracle, provenance, and complexity rationale', () => {
  const invalid = clone(manifest);
  delete invalid.cases[0].severity;
  delete invalid.cases[1].oracle;
  delete invalid.cases[2].provenance;
  invalid.cases[3].complexity.rationale = '';
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /missing_field|empty/);
});

test('manifest rejects scoring true, retry not none, and primary attempt not 1', () => {
  const invalid = clone(manifest);
  invalid.scoringEligible = true;
  invalid.cases[0].scoringEligible = true;
  invalid.runPolicy.retryPolicy = 'diagnostic';
  invalid.runPolicy.primaryAttempt = 2;
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /scoringEligible/);
  assert.match(JSON.stringify(result.issues), /retryPolicy/);
  assert.match(JSON.stringify(result.issues), /primaryAttempt/);
});

test('manifest rejects absolute paths and traversal refs', () => {
  const invalid = clone(manifest);
  invalid.scopeContract.path = 'C:/absolute/path.md';
  invalid.target.agentPath = '../qa-skill/agents/qa-cr.md';
  invalid.cases[0].oracle.sourceRef = 'file:///tmp/oracle';
  invalid.cases[1].provenance.sourceRef = '\\\\server\\share';
  const result = validateQaCrMaturityManifest(invalid);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /unsafe_ref/);
});

test('canonical hash is stable across object key order', () => {
  const a = { b: 1, a: { y: 2, x: 3 } };
  const b = { a: { x: 3, y: 2 }, b: 1 };
  assert.equal(canonicalizeJson(a), canonicalizeJson(b));
  assert.equal(sha256CanonicalJson(a), sha256CanonicalJson(b));
});

test('manifest stats include all tiers and control kinds with zero scoring eligible count', () => {
  const stats = summarizeQaCrMaturityManifest(manifest);
  assert.equal(stats.scoringEligibleCount, 0);
  assert.equal(stats.defectCount, 2);
  assert.equal(stats.controlCount, 4);
  assert.equal(Object.keys(stats.complexityCounts).sort().join(','), 'large,medium,small');
  assert.equal(Object.keys(stats.controlTypeCounts).includes('environment-blocked'), true);
  assert.equal(Object.keys(stats.controlTypeCounts).includes('defect'), false);
  assert.deepEqual(stats.controlTypeCounts, { clean: 1, fixed: 1, ambiguous: 1, 'environment-blocked': 1 });
  assert.equal(Object.keys(stats.categoryCounts).length, 10);
});

test('single-case validator returns fail-closed issues', () => {
  const invalid = clone(manifest.cases[0]);
  invalid.categories = ['CR-C1', 'CR-C1'];
  const result = validateQaCrMaturityCase(invalid, { path: 'case' });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /duplicate_category/);
});

test('extractQaCrChildSessionIds uses canonical metadata/output extraction and ignores false positives', () => {
  const ids = extractQaCrChildSessionIds([
    { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr', session_id: 'input-child-ignored' }, metadata: { sessionId: 'ses_meta_1' } } } },
    { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: '<task_metadata>session_id: ses_out_2</task_metadata>' } } },
    { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: '<session_id>ses_out_3</session_id>' } } },
    { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, output: 'session_id: ses_out_2' } } },
    { type: 'tool_use', part: { tool: 'task', state: { status: 'running', input: { subagent_type: 'qa-cr' }, metadata: { sessionId: 'ses_skip_running' } } } },
    { type: 'tool_use', part: { tool: 'other', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, metadata: { sessionId: 'ses_skip_tool' } } } },
    { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-e2e' }, metadata: { sessionId: 'ses_skip_type' } } } },
    { type: 'message', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'qa-cr' }, metadata: { sessionId: 'ses_skip_event' } } } },
  ]);
  assert.deepEqual(ids, ['ses_meta_1', 'ses_out_2', 'ses_out_3']);
});

test('parent telemetry sums multiple unique step-finish parts', () => {
  const telemetry = collectParentSessionTelemetry({
    events: [
      parentStep({ messageId: 'm1', input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, cost: 0.1 }),
      parentStep({ messageId: 'm2', input: 2, output: 3, reasoning: 4, cacheRead: 5, cacheWrite: 6, cost: 0.2, type: 'step-finish' }),
      { type: 'step_finish', sessionID: 'parent-1', part: { type: 'not-step-finish' } },
    ],
    expectedSessionId: 'parent-1',
    sourceArtifact: { id: 'parent-jsonl', hash: 'abc', bytes: 10 },
  });
  assert.equal(telemetry.stepFinishCount, 2);
  assert.equal(telemetry.tokens.known.derivedTotal, 35);
  assert.ok(Math.abs(telemetry.costs.completeCost - 0.3) < 1e-12);
});

test('child telemetry uses real export info/messages envelope and ignores user message', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      sessionId: 'child-1',
      parentSessionId: 'parent-1',
      useInfoEnvelope: true,
      messages: [
        {
          info: { role: 'assistant', sessionID: 'child-1', id: 'assistant-message-1', time: { created: 100, completed: 120 }, tokens: { total: 999 }, cost: 999 },
          parts: [
            { type: 'text', text: 'ignored text' },
            childStep({ messageId: 'm1', cost: 0.4, sessionFromMessage: true }),
          ],
        },
        {
          info: { role: 'user', sessionID: 'child-1', id: 'user-message-1' },
          parts: [childStep({ messageId: 'user-step', cost: 9 })],
        },
      ],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
    sourceArtifact: { id: 'child-export', hash: 'def', bytes: 20 },
  });
  assert.equal(telemetry.stepFinishCount, 1);
  assert.equal(telemetry.tokens.known.derivedTotal, 15);
  assert.equal(telemetry.costs.completeCost, 0.4);
  assert.equal(telemetry.accountingStatus, 'COMPLETE');
});

test('export envelope vs part session conflict quarantines part', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      useInfoEnvelope: true,
      messages: [{
        info: { role: 'assistant', sessionID: 'child-1', id: 'm1', time: { created: 10, completed: 20 } },
        parts: [childStep({ sessionId: 'other-child', parentSessionId: 'parent-1', messageId: 'm1', cost: 0.1 })],
      }],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.notEqual(telemetry.accountingStatus, 'COMPLETE');
  assert.equal(telemetry.stepFinishCount, 0);
  assert.match(JSON.stringify(telemetry.anomalies), /session_conflict/);
});

test('part vs message message-id conflict quarantines part', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      useInfoEnvelope: true,
      messages: [{
        info: { role: 'assistant', sessionID: 'child-1', id: 'msg-info-1', time: { created: 10, completed: 20 } },
        parts: [childStep({ messageId: 'msg-part-2', cost: 0.1, sessionFromMessage: false })],
      }],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.notEqual(telemetry.accountingStatus, 'COMPLETE');
  assert.equal(telemetry.stepFinishCount, 0);
  assert.match(JSON.stringify(telemetry.anomalies), /message_id_conflict/);
});

test('missing observed parent with expected parent does not complete', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: {
      info: { id: 'child-1' },
      messages: [{
        info: { role: 'assistant', sessionID: 'child-1', id: 'm1', time: { created: 10, completed: 20 } },
        parts: [{ type: 'step-finish', sessionID: 'child-1', messageID: 'm1', tokens: { input: 1, output: 2, reasoning: 3, total: 15, cache: { read: 4, write: 5 } }, cost: 0.1 }],
      }],
    },
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.notEqual(telemetry.accountingStatus, 'COMPLETE');
  assert.equal(telemetry.stepFinishCount, 0);
  assert.match(JSON.stringify(telemetry.anomalies), /missing_parent_session_id/);
});

test('missing message id does not complete', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      useInfoEnvelope: true,
      messages: [{
        info: { role: 'assistant', sessionID: 'child-1', time: { created: 10, completed: 20 } },
        parts: [{ type: 'step-finish', sessionID: 'child-1', parentSessionID: 'parent-1', tokens: { input: 1, output: 2, reasoning: 3, total: 15, cache: { read: 4, write: 5 } }, cost: 0.1 }],
      }],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.notEqual(telemetry.accountingStatus, 'COMPLETE');
  assert.equal(telemetry.stepFinishCount, 0);
  assert.match(JSON.stringify(telemetry.anomalies), /missing_message_id/);
});

test('identical duplicate step is counted once', () => {
  const step = parentStep({ messageId: 'm1', cost: 0.5 });
  const telemetry = collectParentSessionTelemetry({ events: [step, clone(step)], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.stepFinishCount, 1);
  assert.equal(telemetry.duplicateStepCount, 1);
  assert.match(JSON.stringify(telemetry.anomalies), /duplicate_step_identical/);
});

test('token conflict excludes first known tokens from summary', () => {
  const a = parentStep({ messageId: 'm1', input: 1, cost: 0.1 });
  const b = parentStep({ messageId: 'm1', input: 9, cost: 0.1 });
  const telemetry = collectParentSessionTelemetry({ events: [a, b], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.usageStatus, 'PARTIAL');
  assert.equal(telemetry.tokens.completeUsage, null);
  assert.equal(telemetry.tokens.known.derivedTotal, 0);
});

test('same tokens but different cost keeps tokens and excludes first cost', () => {
  const a = parentStep({ messageId: 'm1', cost: 0.1 });
  const b = parentStep({ messageId: 'm1', cost: 0.2 });
  const telemetry = collectParentSessionTelemetry({ events: [a, b], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.usageStatus, 'COMPLETE');
  assert.notEqual(telemetry.tokens.completeUsage, null);
  assert.equal(telemetry.costStatus, 'PARTIAL');
  assert.equal(telemetry.costs.completeCost, null);
  assert.equal(telemetry.costs.knownCost, null);
});

test('both token and cost conflict exclude both from known summaries', () => {
  const a = parentStep({ messageId: 'm1', input: 1, cost: 0.1 });
  const b = parentStep({ messageId: 'm1', input: 9, cost: 0.2 });
  const telemetry = collectParentSessionTelemetry({ events: [a, b], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.tokens.known.derivedTotal, 0);
  assert.equal(telemetry.costs.knownCost, null);
});

test('same components but different reported total keeps canonical usage once', () => {
  const a = parentStep({ messageId: 'm1', total: 15, cost: 0.1 });
  const b = parentStep({ messageId: 'm1', total: 17, cost: 0.1 });
  const telemetry = collectParentSessionTelemetry({ events: [a, b], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.usageStatus, 'COMPLETE');
  assert.equal(telemetry.tokens.known.derivedTotal, 15);
  assert.equal(telemetry.tokens.totalCheck.comparable, false);
  assert.match(JSON.stringify(telemetry.anomalies), /duplicate_reported_total_conflict/);
});

test('same canonical tokens and cost but different timing quarantines timing only', () => {
  const a = parentStep({ messageId: 'm1', cost: 0.1, partTime: { start: 10, end: 20 } });
  const b = parentStep({ messageId: 'm1', cost: 0.1, partTime: { start: 12, end: 24 } });
  const telemetry = collectParentSessionTelemetry({ events: [a, b], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.usageStatus, 'COMPLETE');
  assert.equal(telemetry.costStatus, 'COMPLETE');
  assert.equal(telemetry.timingStatus, 'PARTIAL');
  assert.equal(telemetry.timing.knownTiming, null);
  assert.equal(telemetry.timing.completeTiming, null);
  assert.match(JSON.stringify(telemetry.anomalies), /duplicate_step_timing_conflict/);
});

test('same canonical tokens with different cost and timing quarantines both independently', () => {
  const a = parentStep({ messageId: 'm1', cost: 0.1, partTime: { start: 10, end: 20 } });
  const b = parentStep({ messageId: 'm1', cost: 0.2, partTime: { start: 12, end: 24 } });
  const telemetry = collectParentSessionTelemetry({ events: [a, b], expectedSessionId: 'parent-1' });
  assert.equal(telemetry.usageStatus, 'COMPLETE');
  assert.deepEqual(telemetry.tokens.known, {
    wireInput: 1,
    wireOutput: 2,
    reasoning: 3,
    cacheRead: 4,
    cacheWrite: 5,
    derivedTotal: 15,
  });
  assert.deepEqual(telemetry.tokens.completeUsage, telemetry.tokens.known);
  assert.equal(telemetry.costStatus, 'PARTIAL');
  assert.equal(telemetry.costs.knownCost, null);
  assert.equal(telemetry.costs.completeCost, null);
  assert.equal(telemetry.timingStatus, 'PARTIAL');
  assert.equal(telemetry.timing.knownTiming, null);
  assert.equal(telemetry.timing.completeTiming, null);
  const serialized = JSON.stringify(telemetry.anomalies);
  assert.match(serialized, /duplicate_step_cost_conflict/);
  assert.match(serialized, /duplicate_step_timing_conflict/);
});

test('wireInput wireOutput reasoning cache schema matches exact known token fields', () => {
  const telemetry = collectParentSessionTelemetry({
    events: [parentStep({ messageId: 'm1', input: 2, output: 3, reasoning: 4, cacheRead: 5, cacheWrite: 6, cost: 0 })],
    expectedSessionId: 'parent-1',
  });
  assert.deepEqual(telemetry.tokens.known, {
    wireInput: 2,
    wireOutput: 3,
    reasoning: 4,
    cacheRead: 5,
    cacheWrite: 6,
    derivedTotal: 20,
  });
});

test('reported total check respects tolerance and out-of-tolerance anomaly', () => {
  const inTolerance = collectParentSessionTelemetry({
    events: [parentStep({ messageId: 'm1', total: 16, cost: 0 })],
    expectedSessionId: 'parent-1',
    totalTolerance: 1,
  });
  assert.equal(inTolerance.tokens.totalCheck.withinTolerance, true);

  const outTolerance = collectParentSessionTelemetry({
    events: [parentStep({ messageId: 'm1', total: 20, cost: 0 })],
    expectedSessionId: 'parent-1',
    totalTolerance: 1,
  });
  assert.equal(outTolerance.tokens.totalCheck.withinTolerance, false);
  assert.match(JSON.stringify(outTolerance.anomalies), /reported_total_out_of_tolerance/);
});

test('negative string Infinity NaN and missing components are anomalous and never produce NaN totals', () => {
  const telemetry = collectParentSessionTelemetry({
    events: [{
      type: 'step_finish',
      sessionID: 'parent-1',
      part: {
        type: 'step-finish',
        sessionID: 'parent-1',
        messageID: 'm1',
        tokens: { input: -1, output: '4', reasoning: Infinity, total: NaN, cache: { read: undefined, write: 1 } },
        cost: 'bad',
      },
    }],
    expectedSessionId: 'parent-1',
  });
  assert.equal(Number.isNaN(telemetry.tokens.known.derivedTotal), false);
  assert.equal(telemetry.usageStatus, 'PARTIAL');
  assert.equal(telemetry.costStatus, 'PARTIAL');
  assert.match(JSON.stringify(telemetry.anomalies), /invalid_token_component/);
});

test('step cost sum uses only part.cost and invalid-only cost keeps knownCost null', () => {
  const withCost = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'm1', cost: 1 })], expectedSessionId: 'parent-1' });
  assert.equal(withCost.costs.completeCost, 1);

  const noCost = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'm1', cost: undefined })], expectedSessionId: 'parent-1' });
  assert.equal(noCost.costStatus, 'UNAVAILABLE');
  assert.equal(noCost.costs.completeCost, null);

  const invalidOnly = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'm1', cost: 'bad' })], expectedSessionId: 'parent-1' });
  assert.equal(invalidOnly.costStatus, 'PARTIAL');
  assert.equal(invalidOnly.costs.knownCost, null);
});

test('missing child export is UNAVAILABLE not zero and failure details are sanitized', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: null,
    exportStatus: 'missing',
    exportError: `${secretSentinel} not found`,
    expectedSessionId: 'child-missing',
    expectedParentSessionId: 'parent-1',
  });
  assert.equal(telemetry.accountingStatus, 'UNAVAILABLE');
  assert.equal(telemetry.costs.knownCost, null);
  assert.doesNotMatch(JSON.stringify(telemetry), new RegExp(secretSentinel));
});

test('identity mismatch mixed with valid part lowers status', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      sessionId: 'child-1',
      parentSessionId: 'parent-1',
      steps: [childStep({ messageId: 'm1', cost: 1 }), childStep({ sessionId: 'other-child', messageId: 'm2', cost: 2 })],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.equal(telemetry.stepFinishCount, 1);
  assert.equal(telemetry.accountingStatus, 'PARTIAL');
  assert.match(JSON.stringify(telemetry.anomalies), /session_conflict/);
});

test('aggregate quarantines duplicate child session from known usage cost and timing', () => {
  const parent = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'pm1', cost: 0.1, partTime: { start: 10, end: 20 } })], expectedSessionId: 'parent-1' });
  const child = collectExportedSessionTelemetry({
    exportJson: childExport({ sessionId: 'child-1', parentSessionId: 'parent-1', steps: [childStep({ messageId: 'cm1', cost: 0.2, time: { start: 100, end: 140 } })] }),
    expectedSessionId: 'child-1', expectedParentSessionId: 'parent-1',
  });
  const aggregate = aggregateRunTelemetry({ parent, children: [child, child], expectedChildSessionIds: ['child-1'] });
  assert.equal(aggregate.tokens.known.derivedTotal, 15);
  assert.equal(aggregate.costs.knownCost, 0.1);
  assert.deepEqual(aggregate.timing.knownTiming, { startMs: 10, endMs: 20, durationMs: 10 });
  assert.equal(aggregate.accountingStatus, 'INVALID');
});

test('aggregate retains known sums while missing expected child nulls completeness', () => {
  const parent = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'pm1', cost: 0.1 })], expectedSessionId: 'parent-1' });
  const child = collectExportedSessionTelemetry({
    exportJson: childExport({ sessionId: 'child-1', parentSessionId: 'parent-1', steps: [childStep({ messageId: 'cm1', cost: 0.2 })] }),
    expectedSessionId: 'child-1', expectedParentSessionId: 'parent-1',
  });
  const aggregate = aggregateRunTelemetry({ parent, children: [child], expectedChildSessionIds: ['child-1', 'child-2'] });
  assert.equal(aggregate.tokens.known.derivedTotal, 30);
  assert.equal(aggregate.tokens.completeUsage, null);
  assert.equal(aggregate.costs.completeCost, null);
  assert.deepEqual(aggregate.missingChildSessionIds, ['child-2']);
});

test('aggregate flags linkage mismatch child session invalid once', () => {
  const parent = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'pm1', cost: 0.1 })], expectedSessionId: 'parent-1' });
  const child = collectExportedSessionTelemetry({
    exportJson: childExport({ sessionId: 'child-1', parentSessionId: 'wrong-parent', steps: [childStep({ parentSessionId: 'wrong-parent', messageId: 'cm1', cost: 0.2 })] }),
    expectedSessionId: 'child-1', expectedParentSessionId: 'wrong-parent',
  });
  const aggregate = aggregateRunTelemetry({ parent, children: [child], expectedChildSessionIds: ['child-1'] });
  assert.equal(aggregate.accountingStatus, 'INVALID');
  assert.match(JSON.stringify(aggregate.anomalies), /child_linkage_mismatch/);
});

test('export failure status lowers completeness even with json present', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({ steps: [childStep({ messageId: 'm1', cost: 0.1 })] }),
    exportStatus: 2,
    exportError: `${secretSentinel} exploded`,
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.notEqual(telemetry.accountingStatus, 'COMPLETE');
  assert.doesNotMatch(JSON.stringify(telemetry), new RegExp(secretSentinel));
});

test('child timing uses message.info fallback and aggregate known complete timing', () => {
  const child = collectExportedSessionTelemetry({
    exportJson: childExport({
      useInfoEnvelope: true,
      messages: [{
        info: { role: 'assistant', sessionID: 'child-1', parentSessionID: 'parent-1', id: 'm1', time: { created: 500, completed: 575 } },
        parts: [{ type: 'step-finish', tokens: { input: 1, output: 2, reasoning: 3, total: 15, cache: { read: 4, write: 5 } }, cost: 0.1 }],
      }],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.deepEqual(child.timing.knownTiming, { startMs: 500, endMs: 575, durationMs: 75 });
  assert.deepEqual(child.timing.completeTiming, { startMs: 500, endMs: 575, durationMs: 75 });

  const parent = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'pm1', cost: 0.1, partTime: { start: 100, end: 200 } })], expectedSessionId: 'parent-1' });
  const aggregate = aggregateRunTelemetry({ parent, children: [child], expectedChildSessionIds: ['child-1'] });
  assert.deepEqual(aggregate.timing.knownTiming, { startMs: 100, endMs: 575, durationMs: 475 });
  assert.deepEqual(aggregate.timing.completeTiming, { startMs: 100, endMs: 575, durationMs: 475 });
});

test('secret-safe anomalies omit raw exportError malformed token and cost strings and ignored payload fields', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      messages: [{
        info: { role: 'assistant', sessionID: 'child-1', parentSessionID: 'parent-1', id: 'm1', tokens: { total: secretSentinel }, cost: secretSentinel },
        parts: [{
          type: 'step-finish',
          messageID: 'm1',
          sessionID: 'child-1',
          parentSessionID: 'parent-1',
          tokens: { input: 1, output: 'bad-token', reasoning: 3, total: 'bad-total', cache: { read: 4, write: 5 } },
          cost: 'bad-cost',
          text: secretSentinel,
          toolInput: secretSentinel,
          toolOutput: secretSentinel,
        }],
      }],
    }),
    exportStatus: 'failed',
    exportError: secretSentinel,
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  const serialized = JSON.stringify(telemetry);
  assert.doesNotMatch(serialized, new RegExp(secretSentinel));
  assert.match(serialized, /sha256/);
});

test('message.info tokens and cost are ignored', () => {
  const telemetry = collectExportedSessionTelemetry({
    exportJson: childExport({
      infoTokens: 123456,
      infoCost: 123456,
      steps: [childStep({ messageId: 'm1', cost: 0.25, input: 1, output: 1, reasoning: 1, cacheRead: 1, cacheWrite: 1 })],
    }),
    expectedSessionId: 'child-1',
    expectedParentSessionId: 'parent-1',
  });
  assert.equal(telemetry.tokens.known.derivedTotal, 5);
  assert.equal(telemetry.costs.knownCost, 0.25);
});

test('telemetry output excludes raw secret sentinel from serialized summary', () => {
  const parent = collectParentSessionTelemetry({ events: [parentStep({ messageId: 'm1', cost: 0.1 })], expectedSessionId: 'parent-1' });
  const serialized = JSON.stringify(parent);
  assert.doesNotMatch(serialized, new RegExp(secretSentinel));
});
