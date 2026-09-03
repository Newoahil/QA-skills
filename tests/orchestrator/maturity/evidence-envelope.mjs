import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalizeJson, sha256CanonicalJson } from './case-manifest.mjs';
import { parseJsonlStrict } from '../../functional-validation/harness.mjs';
import { collectParentSessionTelemetry, collectExportedSessionTelemetry, aggregateRunTelemetry, extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';
import { buildScoreInputFacts, alignObservedChildExports } from './score-input-facts.mjs';
import { verifyArtifactInventory } from './artifact-store.mjs';

export const EVIDENCE_ENVELOPE_SCHEMA_VERSION = 'qa-cr-evidence-envelope-v1';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_RUN_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const SAFE_STATUS_RE = /^(?:AUTHORITATIVE|NON_AUTHORITATIVE)$/;
const ARTIFACT_PATH_RE = /^(?:run-observation\.json|telemetry\.json|score-input-facts\.json)$/;

function fail(code) {
  throw new Error(code);
}

function safeDiagnostic(code) {
  return String(code).replace(/[^a-z0-9_:-]/gi, '_').toLowerCase();
}

function forbidRecursive(value) {
  const banned = /^(?:score|scorecard|weightedscore|level|maturity|g(?:1|2|3|4|5|6|7|8|9|10|11))$/i;
  if (Array.isArray(value)) {
    for (const entry of value) forbidRecursive(entry);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'scoringEligible' && banned.test(key)) fail('forbidden_field');
      if (/^overall status:?$/i.test(key)) fail('forbidden_field');
      forbidRecursive(entry);
    }
  }
  if (typeof value === 'string' && (/overall status:/i.test(value) || /\bweightedscore\b|\bscorecard\b|\blevel\b|\bg(?:1|2|3|4|5|6|7|8|9|10|11)\b/i.test(value))) fail('forbidden_field');
}

function assertExactKeys(value, keys, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid_keys:${where}`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`invalid_keys:${where}`);
}

function assertHash(value, where) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) fail(`invalid_hash:${where}`);
}

function assertString(value, where) {
  if (typeof value !== 'string' || value.length === 0) fail(`invalid_string:${where}`);
}

function assertArtifactRef(value, where) {
  assertExactKeys(value, ['path', 'sha256', 'status'], where);
  if (!ARTIFACT_PATH_RE.test(value.path)) fail(`invalid_artifact_path:${where}`);
  assertHash(value.sha256, `${where}.sha256`);
  if (!SAFE_STATUS_RE.test(value.status)) fail(`invalid_status:${where}`);
}

export function buildRunIdentity({ manifest, caseId, attempt = 1 }) {
  const manifestId = manifest?.manifestId ?? 'manifest';
  return `${manifestId}-${caseId}-attempt-${attempt}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function buildEvidenceEnvelope({ run, provenance, inventory, factsArtifact, telemetryArtifact, factsStatus = 'NON_AUTHORITATIVE', telemetryStatus = 'NON_AUTHORITATIVE', capturedAt, sealedAt }) {
  const stable = {
    run: { runId: run.runId, primary: true, attempt: 1, retryPolicy: 'none' },
    provenance,
    inventory: [...inventory].sort((a, b) => a.path.localeCompare(b.path)),
    facts: { path: factsArtifact.path, sha256: factsArtifact.sha256, status: factsStatus },
    telemetry: { path: telemetryArtifact.path, sha256: telemetryArtifact.sha256, status: telemetryStatus },
  };
  forbidRecursive(stable);
  const seal = { sha256: sha256CanonicalJson(stable) };
  return { schemaVersion: EVIDENCE_ENVELOPE_SCHEMA_VERSION, stable, volatile: { capturedAt, sealedAt }, seal };
}

function validateEnvelopeShape(envelope) {
  assertExactKeys(envelope, ['schemaVersion', 'stable', 'volatile', 'seal'], 'envelope');
  if (envelope.schemaVersion !== EVIDENCE_ENVELOPE_SCHEMA_VERSION) fail('invalid_schema');
  assertExactKeys(envelope.stable, ['facts', 'inventory', 'provenance', 'run', 'telemetry'], 'stable');
  assertExactKeys(envelope.stable.run, ['attempt', 'primary', 'retryPolicy', 'runId'], 'stable.run');
  assertExactKeys(envelope.stable.provenance, ['caseId', 'caseSha256', 'manifestId', 'manifestSha256', 'parentAgentSha256', 'promptSha256', 'qaCrAgentSha256', 'scopeSha256', 'scopeVersion', 'scoringEligible'], 'stable.provenance');
  assertExactKeys(envelope.volatile, ['capturedAt', 'sealedAt'], 'volatile');
  assertExactKeys(envelope.seal, ['sha256'], 'seal');
  if (envelope.stable.run.primary !== true || envelope.stable.run.attempt !== 1 || envelope.stable.run.retryPolicy !== 'none') fail('invalid_run_policy');
  if (typeof envelope.stable.run.runId !== 'string' || !SAFE_RUN_ID_RE.test(envelope.stable.run.runId)) fail('invalid_run_id');
  if (envelope.stable.provenance.scoringEligible !== false) fail('invalid_provenance');
  for (const field of ['caseId', 'manifestId', 'scopeVersion']) assertString(envelope.stable.provenance[field], `stable.provenance.${field}`);
  for (const field of ['caseSha256', 'manifestSha256', 'parentAgentSha256', 'promptSha256', 'qaCrAgentSha256', 'scopeSha256']) assertHash(envelope.stable.provenance[field], `stable.provenance.${field}`);
  if (typeof envelope.volatile.capturedAt !== 'string' || typeof envelope.volatile.sealedAt !== 'string') fail('invalid_volatile');
  assertHash(envelope.seal.sha256, 'seal.sha256');
  assertArtifactRef(envelope.stable.facts, 'stable.facts');
  assertArtifactRef(envelope.stable.telemetry, 'stable.telemetry');
  if (envelope.stable.facts.path !== 'score-input-facts.json') fail('required_artifact_missing');
  if (envelope.stable.telemetry.path !== 'telemetry.json') fail('required_artifact_missing');
  forbidRecursive(envelope);
}

export function verifyEvidenceEnvelope({ runDirectory }) {
  const envelopePath = path.join(runDirectory, 'envelope.json');
  if (!existsSync(envelopePath)) fail('envelope_missing');
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
  } catch {
    fail('envelope_malformed');
  }
  validateEnvelopeShape(envelope);
  if (sha256CanonicalJson(envelope.stable) !== envelope.seal.sha256) fail('seal_mismatch');
  verifyArtifactInventory({ runDirectory, inventory: envelope.stable.inventory });
  const inventoryPaths = new Set(envelope.stable.inventory.map((entry) => entry.path));
  if (!inventoryPaths.has('run-observation.json') || !inventoryPaths.has('telemetry.json') || !inventoryPaths.has('score-input-facts.json')) fail('required_artifact_missing');
  if (inventoryPaths.has('envelope.json')) fail('invalid_schema');
  const factsInventory = envelope.stable.inventory.find((entry) => entry.path === envelope.stable.facts.path);
  const telemetryInventory = envelope.stable.inventory.find((entry) => entry.path === envelope.stable.telemetry.path);
  if (!factsInventory || factsInventory.sha256 !== envelope.stable.facts.sha256) fail('required_artifact_missing');
  if (!telemetryInventory || telemetryInventory.sha256 !== envelope.stable.telemetry.sha256) fail('required_artifact_missing');
  return envelope;
}

function readInventoryFile(runDirectory, inventory, relativePath) {
  const entry = inventory.find((item) => item.path === relativePath);
  if (!entry) return null;
  return { entry, bytes: readFileSync(path.join(runDirectory, ...relativePath.split('/'))) };
}

function safeReplayFailure(code, facts = null) {
  return { authorityStatus: 'NON_AUTHORITATIVE', replayStatus: 'BLOCKED', facts, diagnostics: [safeDiagnostic(code)] };
}

export function replaySealedRun({ runDirectory }) {
  let envelope;
  try {
    envelope = verifyEvidenceEnvelope({ runDirectory });
  } catch (error) {
    return safeReplayFailure(error?.message || 'invalid_schema');
  }

  try {
    const parentArtifact = readInventoryFile(runDirectory, envelope.stable.inventory, 'parent-events.jsonl');
    const observationArtifact = readInventoryFile(runDirectory, envelope.stable.inventory, 'run-observation.json');
    const telemetryArtifact = readInventoryFile(runDirectory, envelope.stable.inventory, 'telemetry.json');
    const factsArtifact = readInventoryFile(runDirectory, envelope.stable.inventory, 'score-input-facts.json');
    if (!observationArtifact || !telemetryArtifact || !factsArtifact) return safeReplayFailure('required_artifact_missing');

    let observationRecord;
    try {
      observationRecord = JSON.parse(observationArtifact.bytes.toString('utf8'));
    } catch {
      return safeReplayFailure('envelope_malformed');
    }

    const parentParsed = parentArtifact ? parseJsonlStrict(parentArtifact.bytes) : { events: [], errors: [{ line: 0, message: 'missing' }] };
    const childArtifacts = envelope.stable.inventory.filter((item) => item.path.startsWith('child-exports/') && item.path.endsWith('.json'));
    const childExports = childArtifacts.map((item, index) => {
      const text = readFileSync(path.join(runDirectory, ...item.path.split('/')), 'utf8');
      try {
        const parsed = JSON.parse(text);
        return { sessionId: parsed.sessionId ?? null, exportStatus: parsed.exportStatus ?? null, exportError: parsed.exportError ?? null, exportText: parsed.exportText ?? '', __index: index };
      } catch {
        return { sessionId: null, exportStatus: 'malformed', exportError: 'malformed_json', exportText: text, __index: index };
      }
    });

    const parent = collectParentSessionTelemetry({ events: parentParsed.events, expectedSessionId: null, sourceArtifact: parentArtifact?.entry ?? null });
    const observedChildIds = extractQaCrChildSessionIds(parentParsed.events);
    const aligned = alignObservedChildExports({ parentEvents: parentParsed.events, childExports });
    const children = aligned.aligned.map((entry) => {
      const matched = entry.matches.length === 1 ? entry.matches[0] : null;
      let exportJson = null;
      try { exportJson = matched ? JSON.parse(matched.exportText) : null; } catch {}
      return collectExportedSessionTelemetry({
        exportJson,
        exportStatus: matched ? matched.exportStatus : (entry.matches.length > 1 ? 'duplicate_export' : null),
        exportError: matched ? matched.exportError : (entry.matches.length > 1 ? 'duplicate_export' : null),
        expectedSessionId: entry.expectedSessionId,
        expectedParentSessionId: parent.sessionId,
        sourceArtifact: matched?.__index != null ? childArtifacts[matched.__index] ?? null : null,
      });
    });
    const telemetry = { parent, children, aggregate: aggregateRunTelemetry({ parent, children, expectedChildSessionIds: observedChildIds }) };
    const facts = buildScoreInputFacts({
      manifest: { manifestHash: envelope.stable.provenance.manifestSha256, scopeSha256: envelope.stable.provenance.scopeSha256 },
      caseValue: {
        caseSha256: envelope.stable.provenance.caseSha256,
        qaCrAgentSha256: envelope.stable.provenance.qaCrAgentSha256,
        parentAgentSha256: envelope.stable.provenance.parentAgentSha256,
        promptSha256: envelope.stable.provenance.promptSha256,
      },
      parentEvents: parentParsed.events,
      jsonlErrors: parentParsed.errors,
      childExports,
      telemetry,
      observation: observationRecord.observation ?? null,
      runnerError: observationRecord.runnerError ?? null,
    });

    const diagnostics = [];
    if (!parentArtifact && envelope.stable.facts.status === 'AUTHORITATIVE') diagnostics.push('required_artifact_missing');
    if (parentParsed.errors.length) diagnostics.push('parent_jsonl_malformed');
    if (childExports.some((entry) => entry.exportStatus === 'malformed')) diagnostics.push('child_export_malformed');

    let storedTelemetry;
    let storedFacts;
    try { storedTelemetry = JSON.parse(telemetryArtifact.bytes.toString('utf8')); } catch { return safeReplayFailure('telemetry_drift', facts); }
    try { storedFacts = JSON.parse(factsArtifact.bytes.toString('utf8')); } catch { return safeReplayFailure('facts_drift', facts); }
    if (canonicalizeJson(storedTelemetry) !== canonicalizeJson(telemetry)) diagnostics.push('telemetry_drift');
    if (canonicalizeJson(storedFacts) !== canonicalizeJson(facts)) diagnostics.push('facts_drift');
    if (envelope.stable.facts.status !== facts.sourceAuthorityStatus || envelope.stable.telemetry.status !== facts.sourceAuthorityStatus) diagnostics.push('source_authority_mismatch');
    if (facts.sourceAuthorityStatus === 'AUTHORITATIVE' && diagnostics.length) return safeReplayFailure(diagnostics[0], facts);
    if (facts.sourceAuthorityStatus !== 'AUTHORITATIVE' || diagnostics.length) {
      return { authorityStatus: 'NON_AUTHORITATIVE', replayStatus: 'BLOCKED', facts, diagnostics: [...new Set(diagnostics.map(safeDiagnostic))] };
    }
    return { authorityStatus: 'AUTHORITATIVE', replayStatus: 'OK', facts, diagnostics: [] };
  } catch (error) {
    return safeReplayFailure(error?.message || 'invalid_schema');
  }
}
