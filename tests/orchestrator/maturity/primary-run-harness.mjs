import { validateQaCrMaturityManifest, sha256CanonicalJson } from './case-manifest.mjs';
import { parseJsonlStrict } from '../../functional-validation/harness.mjs';
import { createRedactor, createImmutableRunStore } from './artifact-store.mjs';
import { buildRunIdentity, buildEvidenceEnvelope, replaySealedRun } from './evidence-envelope.mjs';
import { collectParentSessionTelemetry, collectExportedSessionTelemetry, aggregateRunTelemetry } from './collect-run-telemetry.mjs';
import { buildScoreInputFacts, alignObservedChildExports } from './score-input-facts.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';

function requireExactRunSpec(runSpec) {
  const keys = Object.keys(runSpec || {}).sort();
  const expected = ['attempt', 'caseId', 'manifest', 'parentAgentSha256', 'primary', 'promptSha256', 'qaCrAgentSha256', 'retryPolicy', 'runId', 'scopeSha256'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('invalid runSpec keys');
  if (runSpec.primary !== true || runSpec.attempt !== 1 || runSpec.retryPolicy !== 'none') throw new Error('invalid run policy');
}

function pickCase(manifest, caseId) {
  return Array.isArray(manifest?.cases) ? manifest.cases.find((entry) => entry?.id === caseId) ?? null : null;
}

function sanitizeObservation(observation, runSpec) {
  const source = observation && typeof observation === 'object' ? observation : {};
  const terminalSource = source.terminal && typeof source.terminal === 'object' && !Array.isArray(source.terminal) ? source.terminal : null;
  const hasTerminalObject = Boolean(terminalSource);
  const terminalKeys = hasTerminalObject ? Object.keys(terminalSource) : [];
  function fieldPresence(key) {
    return hasTerminalObject && Object.prototype.hasOwnProperty.call(terminalSource, key);
  }
  function fieldType(key) {
    if (!fieldPresence(key)) return 'missing';
    const value = terminalSource[key];
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
  function safeTerminalValue(key) {
    if (!fieldPresence(key)) return null;
    const value = terminalSource[key];
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return { type: 'array' };
    if (typeof value === 'object') return { type: 'object' };
    return { type: typeof value };
  }
  const terminal = {
    exitCode: safeTerminalValue('exitCode'),
    signal: safeTerminalValue('signal'),
    spawnError: safeTerminalValue('spawnError'),
    timedOut: safeTerminalValue('timedOut'),
  };
  return {
    terminal,
    terminalMeta: {
      providedObject: hasTerminalObject,
      exactKeys: JSON.stringify([...terminalKeys].sort()) === JSON.stringify(['exitCode', 'signal', 'spawnError', 'timedOut']),
      presence: {
        exitCode: fieldPresence('exitCode'),
        signal: fieldPresence('signal'),
        spawnError: fieldPresence('spawnError'),
        timedOut: fieldPresence('timedOut'),
      },
      types: {
        exitCode: fieldType('exitCode'),
        signal: fieldType('signal'),
        spawnError: fieldType('spawnError'),
        timedOut: fieldType('timedOut'),
      },
    },
    command: source.command ?? null,
    observed: {
      manifestHash: source.manifestHashObserved ?? null,
      scopeHash: source.scopeHashObserved ?? null,
      caseHash: source.caseHashObserved ?? null,
      promptHash: source.promptHashObserved ?? null,
      qaCrAgentBefore: source.candidateBefore ?? null,
      qaCrAgentAfter: source.candidateAfter ?? null,
      parentAgentBefore: source.parentAgentBefore ?? null,
      parentAgentAfter: source.parentAgentAfter ?? null,
      productBefore: source.productBefore ?? null,
      productAfter: source.productAfter ?? null,
    },
    expected: {
      manifestHash: runSpec.manifestHash,
      scopeHash: runSpec.scopeSha256,
      caseHash: runSpec.caseSha256,
      promptHash: runSpec.promptSha256,
      qaCrAgentSha256: runSpec.qaCrAgentSha256,
      parentAgentSha256: runSpec.parentAgentSha256,
    },
  };
}

function buildObservedChildren({ parentEvents, childExports, parentArtifact, inventory, parentSessionId }) {
  const aligned = alignObservedChildExports({ parentEvents, childExports });
  return aligned.aligned.map((entry) => {
    const matched = entry.matches.length === 1 ? entry.matches[0] : null;
    let exportJson = null;
    try { exportJson = matched ? JSON.parse(String(matched.exportText ?? '')) : null; } catch {}
    const artifact = matched?.__index != null ? inventory.find((item) => item.path === `child-exports/${String(matched.__index).padStart(3, '0')}.json`) ?? null : null;
    return collectExportedSessionTelemetry({
      exportJson,
      exportStatus: matched ? matched.exportStatus : (entry.matches.length > 1 ? 'duplicate_export' : null),
      exportError: matched ? matched.exportError : (entry.matches.length > 1 ? 'duplicate_export' : null),
      expectedSessionId: entry.expectedSessionId,
      expectedParentSessionId: parentSessionId,
      sourceArtifact: artifact,
    });
  });
}

export async function executePrimaryRun({ artifactRoot, runSpec, sensitiveValues = [], runner }) {
  requireExactRunSpec(runSpec);
  const manifestValidation = validateQaCrMaturityManifest(runSpec.manifest);
  if (!manifestValidation.ok) throw new Error('invalid manifest');
  if (runSpec.manifest.scoringEligible !== false) throw new Error('manifest must be scoringEligible=false');
  const caseValue = pickCase(runSpec.manifest, runSpec.caseId);
  if (!caseValue || caseValue.scoringEligible !== false) throw new Error('invalid case');
  const caseSha256 = sha256CanonicalJson(caseValue);
  const manifestHash = manifestValidation.manifestHash;
  const expectedRunId = buildRunIdentity({ manifest: runSpec.manifest, caseId: runSpec.caseId, attempt: 1 });
  if (runSpec.runId !== expectedRunId) throw new Error('runId must match deterministic identity');
  runSpec.manifestHash = manifestHash;
  runSpec.caseSha256 = caseSha256;
  const redactor = createRedactor({ sensitiveValues });
  const store = createImmutableRunStore({ artifactRoot, runId: runSpec.runId, redactor });
  let runnerResult = null;
  let runnerError = null;
  try {
    runnerResult = await runner();
  } catch (error) {
    runnerError = error;
  }

  const parentJsonl = runnerResult?.parentJsonl ?? '';
  const childExports = Array.isArray(runnerResult?.childExports) ? runnerResult.childExports.map((entry, index) => ({ ...entry, __index: index })) : [];
  const observation = sanitizeObservation(runnerResult?.observation, runSpec);
  const parsedParent = parseJsonlStrict(Buffer.from(String(parentJsonl), 'utf8'));

  if (parentJsonl || runnerResult?.parentJsonl != null) store.writeText('parent-events.jsonl', String(parentJsonl), 'parent-jsonl');
  childExports.forEach((entry, index) => {
    store.writeJson(`child-exports/${String(index).padStart(3, '0')}.json`, {
      sessionId: entry?.sessionId ?? null,
      exportStatus: entry?.exportStatus ?? null,
      exportError: entry?.exportError ?? null,
      exportText: entry?.exportText ?? '',
    }, 'child-export');
  });
  store.writeJson('run-observation.json', { observation, runnerError: runnerError ? { message: String(runnerError.message || runnerError.name || 'runner_error') } : null }, 'run-observation');

  const parent = collectParentSessionTelemetry({ events: parsedParent.events, expectedSessionId: null, sourceArtifact: store.inventory().find((item) => item.path === 'parent-events.jsonl') ?? null });
  const observedChildIds = extractQaCrChildSessionIds(parsedParent.events);
  const children = buildObservedChildren({ parentEvents: parsedParent.events, childExports, inventory: store.inventory(), parentSessionId: parent.sessionId });
  const aggregate = aggregateRunTelemetry({ parent, children, expectedChildSessionIds: observedChildIds });
  const telemetry = { parent, children, aggregate };
  store.writeJson('telemetry.json', telemetry, 'telemetry');

  const facts = buildScoreInputFacts({ manifest: { ...runSpec.manifest, manifestHash, scopeSha256: runSpec.scopeSha256 }, caseValue: { ...caseValue, caseSha256, qaCrAgentSha256: runSpec.qaCrAgentSha256, parentAgentSha256: runSpec.parentAgentSha256, promptSha256: runSpec.promptSha256 }, parentEvents: parsedParent.events, jsonlErrors: parsedParent.errors, childExports, telemetry, observation, runnerError: runnerError ? { message: String(runnerError.message || runnerError) } : null });
  store.writeJson('score-input-facts.json', facts, 'score-input-facts');

  const inventory = store.inventory();
  const factsArtifact = inventory.find((item) => item.path === 'score-input-facts.json');
  const telemetryArtifact = inventory.find((item) => item.path === 'telemetry.json');
  const envelope = buildEvidenceEnvelope({
    run: { runId: runSpec.runId },
    provenance: {
      manifestId: runSpec.manifest.manifestId,
      manifestSha256: manifestHash,
      scoringEligible: false,
      scopeVersion: runSpec.manifest.scopeContract.version,
      scopeSha256: runSpec.scopeSha256,
      caseId: runSpec.caseId,
      caseSha256,
      qaCrAgentSha256: runSpec.qaCrAgentSha256,
      parentAgentSha256: runSpec.parentAgentSha256,
      promptSha256: runSpec.promptSha256,
    },
    inventory,
    factsArtifact,
    telemetryArtifact,
    factsStatus: facts.sourceAuthorityStatus,
    telemetryStatus: facts.sourceAuthorityStatus,
    capturedAt: new Date().toISOString(),
    sealedAt: new Date().toISOString(),
  });
  store.writeEnvelope(envelope);
  store.markSealed();
  const replay = replaySealedRun({ runDirectory: store.runDirectory });
  return { runDirectory: store.runDirectory, envelope, facts, replay, runnerError: runnerError ? String(runnerError.message || runnerError) : null };
}
