export const BENCHMARK_SCHEMA_VERSION = 'phase2-real-project-benchmark-v1';

export const BENCHMARK_RUBRIC = deepFreeze({
  verdict: 20,
  coverage: 20,
  commandEvidence: 15,
  traceability: 15,
  blockerHumanGate: 10,
  readOnly: 10,
  report: 5,
  costTime: 5,
});

const allowedStatuses = new Set(['draft', 'approved']);
const allowedCaseTypes = new Set(['real-issue-pre-post', 'public-fix-pre-post', 'fault-injection-fallback']);
const allowedVerdicts = new Set(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const requiredArmIds = Object.freeze(['baseline', 'skill']);
const requiredRunFields = Object.freeze(['model', 'agent', 'timeoutMs', 'budget']);
const requiredPairFields = Object.freeze([
  'pairId',
  'caseType',
  'repositoryUrl',
  'repositoryLicense',
  'publicIssueUrl',
  'publicIssueTitle',
  'request',
  'stack',
  'acceptanceEvidence',
  'expectedRisks',
  'expectedModules',
  'expectedFlows',
  'prohibitedActions',
  'preSnapshot',
  'postSnapshot',
  'syntheticOrFaultInjection',
]);
const shellWrappers = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const shellMetacharacters = /[;&|`$<>]/;
const unsafeCommandWords = /\b(?:install|update|download|curl|wget|fetch|network|credential|credentials|secret|token|password|api[_-]?key|apikey|bearer|production|prod|deploy|migration|migrate|rm|rmdir|del|erase|destroy|drop|delete|clone|pull|push|fetch)\b/i;
const secretLike = /(?:secret|token|password|credential|api[_-]?key|apikey|bearer)\s*(?:=|:)|https?:\/\/[^\s/@]+:[^\s/@]+@/i;
const safeLogicalIdPattern = /^[A-Za-z0-9_.-]+$/;
const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function validateBenchmarkManifest(manifest) {
  const diagnostics = [];
  if (!isPlainRecord(manifest)) return result(false, ['manifest must be an object']);

  requireEqual(manifest.schemaVersion, BENCHMARK_SCHEMA_VERSION, 'schemaVersion', diagnostics);
  if (!allowedStatuses.has(manifest.status)) diagnostics.push('status must be draft or approved');
  validateApproval(manifest, diagnostics);
  validateNoSecretText(manifest, 'manifest', diagnostics);
  validateRunConfig(manifest.runConfig, diagnostics);
  validateArms(manifest, diagnostics);
  validatePairs(manifest, diagnostics);

  return result(diagnostics.length === 0, diagnostics);
}

function validateApproval(manifest, diagnostics) {
  if (manifest.status !== 'approved') return;
  const approval = manifest.approval;
  if (!isPlainRecord(approval)) {
    diagnostics.push('approved manifests require approval metadata');
    return;
  }
  if (!nonEmptySafeString(approval.approvedBy)) diagnostics.push('approval.approvedBy must be a non-empty safe string');
  if (!canonicalUtcTimestamp(approval.approvedAt)) diagnostics.push('approval.approvedAt must be a canonical ISO-8601 UTC timestamp');
}

function canonicalUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function validateScorecard(scorecard) {
  const diagnostics = [];
  if (!isPlainRecord(scorecard)) return result(false, ['scorecard must be an object']);

  for (const field of ['armId', 'pairId', 'snapshotId', 'runId']) {
    if (!safeLogicalId(scorecard[field])) diagnostics.push(`${field} is required and must be a safe identifier`);
  }
  if (!allowedVerdicts.has(scorecard.actualVerdict)) diagnostics.push('actualVerdict must be a benchmark verdict');
  if (!isPlainRecord(scorecard.dimensions)) diagnostics.push('dimensions must be an object');

  let recomputedTotal = 0;
  for (const [dimension, weight] of Object.entries(BENCHMARK_RUBRIC)) {
    const entry = scorecard.dimensions?.[dimension];
    if (!isPlainRecord(entry)) {
      diagnostics.push(`dimension ${dimension} is required`);
      continue;
    }
    if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > weight) diagnostics.push(`dimension ${dimension} score must be an integer from 0 to ${weight}`);
    if (!Array.isArray(entry.evidenceIds) || entry.evidenceIds.length === 0 || !entry.evidenceIds.every(safeLogicalId)) diagnostics.push(`dimension ${dimension} requires safe evidence IDs`);
    if (Number.isInteger(entry.score)) recomputedTotal += entry.score;
  }
  for (const dimension of Object.keys(scorecard.dimensions ?? {})) {
    if (!(dimension in BENCHMARK_RUBRIC)) diagnostics.push(`unexpected dimension ${dimension}`);
  }
  if (scorecard.total !== recomputedTotal) diagnostics.push(`total must equal recomputed rubric score ${recomputedTotal}`);

  return result(diagnostics.length === 0, diagnostics);
}

export function compareArmScorecards({ baseline, skill, threshold } = {}) {
  const diagnostics = [];
  const baselineValidation = validateScorecard(baseline);
  const skillValidation = validateScorecard(skill);
  if (!baselineValidation.ok) diagnostics.push(...baselineValidation.diagnostics.map((diagnostic) => `baseline ${diagnostic}`));
  if (!skillValidation.ok) diagnostics.push(...skillValidation.diagnostics.map((diagnostic) => `skill ${diagnostic}`));
  if (!Number.isInteger(threshold) || threshold < 0) diagnostics.push('threshold must be a non-negative integer');

  if (diagnostics.length > 0) {
    return deepFreeze({ ok: false, diagnostics: Object.freeze(diagnostics), skill_delta: null, conclusion: 'inconclusive' });
  }

  const skillDelta = deepFreeze({
    total: skill.total - baseline.total,
    verdict: skill.dimensions.verdict.score - baseline.dimensions.verdict.score,
  });
  let conclusion = 'tie';
  if (skillDelta.verdict < 0) conclusion = 'no_improvement';
  else if (skillDelta.total >= threshold && skillDelta.verdict > 0) conclusion = 'improvement';
  else if (skillDelta.total > 0 && skillDelta.total >= threshold && skillDelta.verdict === 0) conclusion = 'no_improvement';
  else if (skillDelta.total < 0) conclusion = 'no_improvement';

  return deepFreeze({ ok: true, diagnostics: Object.freeze([]), skill_delta: skillDelta, conclusion });
}

function validateRunConfig(runConfig, diagnostics) {
  if (!isPlainRecord(runConfig)) {
    diagnostics.push('runConfig is required');
    return;
  }
  for (const field of requiredRunFields) {
    if (!(field in runConfig)) diagnostics.push(`runConfig.${field} is required`);
  }
  if (!nonEmptySafeString(runConfig.model)) diagnostics.push('runConfig.model must be fixed and safe');
  if (!nonEmptySafeString(runConfig.agent)) diagnostics.push('runConfig.agent must be fixed and safe');
  if (!Number.isInteger(runConfig.timeoutMs) || runConfig.timeoutMs <= 0) diagnostics.push('runConfig.timeoutMs must be a positive integer');
  if (!isPlainRecord(runConfig.budget)) diagnostics.push('runConfig.budget must be a fixed object');
}

function validateArms(manifest, diagnostics) {
  if (!isPlainRecord(manifest.arms)) {
    diagnostics.push('arms object is required');
    return;
  }
  const armKeys = Object.keys(manifest.arms).sort();
  if (armKeys.join(',') !== requiredArmIds.join(',')) diagnostics.push('arms must be exactly baseline and skill');
  for (const armId of requiredArmIds) {
    const arm = manifest.arms[armId];
    if (!isPlainRecord(arm)) {
      diagnostics.push(`arm ${armId} is required`);
      continue;
    }
    if (arm.armId !== armId) diagnostics.push(`arm ${armId} armId must match key`);
    if (armId === 'baseline' && arm.skillLoaded !== false) diagnostics.push('baseline arm must not load Skill');
    if (armId === 'skill' && arm.skillLoaded !== true) diagnostics.push('skill arm must load Skill');
    if (!Array.isArray(arm.primaryRuns) || arm.primaryRuns.length !== 1) diagnostics.push(`arm ${armId} must define exactly one primary run`);
    const primaryRun = arm.primaryRuns?.[0];
    if (isPlainRecord(primaryRun)) validatePrimaryRun(primaryRun, manifest.runConfig, armId, diagnostics);
  }
}

function validatePrimaryRun(primaryRun, runConfig, armId, diagnostics) {
  if (!safeLogicalId(primaryRun.runId)) diagnostics.push(`arm ${armId} primary run requires a safe runId`);
  if (primaryRun.primary !== true) diagnostics.push(`arm ${armId} run must be marked primary`);
  if (primaryRun.silentRerun !== false) diagnostics.push(`arm ${armId} must forbid silent rerun`);
  for (const field of requiredRunFields) {
    if (!(field in primaryRun)) diagnostics.push(`arm ${armId} primary run ${field} is required`);
    if (runConfig && field in runConfig && JSON.stringify(primaryRun[field]) !== JSON.stringify(runConfig[field])) diagnostics.push(`arm ${armId} primary run ${field} must match fixed runConfig`);
  }
}

function validatePairs(manifest, diagnostics) {
  if (!Array.isArray(manifest.pairs)) {
    diagnostics.push('pairs array is required');
    return;
  }
  const seenPairIds = new Set();
  const realIssuePairs = [];
  const realIssueStacks = new Set();
  for (const [index, pair] of manifest.pairs.entries()) {
    validatePair(pair, index, seenPairIds, diagnostics);
    if (pair?.caseType === 'real-issue-pre-post') {
      realIssuePairs.push(pair);
      if (nonEmptySafeString(pair.stack)) realIssueStacks.add(pair.stack);
    }
  }
  if (manifest.status === 'approved') {
    if (realIssuePairs.length < 3) diagnostics.push('approved manifests require at least 3 real-issue pairs');
    if (realIssueStacks.size < 2) diagnostics.push('approved manifests require real-issue pairs across at least 2 stacks');
  }
}

function validatePair(pair, index, seenPairIds, diagnostics) {
  const prefix = `pair ${index + 1}`;
  if (!isPlainRecord(pair)) {
    diagnostics.push(`${prefix} must be an object`);
    return;
  }
  for (const field of requiredPairFields) {
    if (!(field in pair)) diagnostics.push(`${prefix}.${field} is required`);
  }
  if (!safeLogicalId(pair.pairId)) diagnostics.push(`${prefix}.pairId must be unique and safe`);
  else if (seenPairIds.has(pair.pairId)) diagnostics.push(`duplicate pairId ${pair.pairId}`);
  else seenPairIds.add(pair.pairId);
  if (!allowedCaseTypes.has(pair.caseType)) diagnostics.push(`${prefix}.caseType is invalid`);
  if (pair.caseType === 'real-issue-pre-post' && pair.syntheticOrFaultInjection !== false) diagnostics.push(`${prefix} real issue pair must set syntheticOrFaultInjection=false`);
  if (pair.caseType === 'public-fix-pre-post' && pair.syntheticOrFaultInjection !== false) diagnostics.push(`${prefix} public fix pair must set syntheticOrFaultInjection=false`);
  if (pair.caseType === 'fault-injection-fallback' && pair.syntheticOrFaultInjection !== true) diagnostics.push(`${prefix} fallback pair must set syntheticOrFaultInjection=true`);
  validateProvenance(pair, prefix, diagnostics);
  for (const field of ['request', 'stack', 'acceptanceEvidence']) {
    if (!nonEmptyString(pair[field])) diagnostics.push(`${prefix}.${field} must be non-empty`);
  }
  for (const field of ['expectedRisks', 'expectedModules', 'expectedFlows', 'prohibitedActions']) {
    if (!nonEmptySafeStringArray(pair[field])) diagnostics.push(`${prefix}.${field} must be a non-empty safe array`);
  }
  const pre = validateSnapshot(pair.preSnapshot, `${prefix}.preSnapshot`, diagnostics);
  const post = validateSnapshot(pair.postSnapshot, `${prefix}.postSnapshot`, diagnostics);
  if (pre && post) {
    if (pre.localSnapshot === post.localSnapshot) diagnostics.push(`${prefix} pre/post snapshot paths must differ`);
    if (pre.treeSha256 === post.treeSha256) diagnostics.push(`${prefix} pre/post tree hashes must differ`);
    if ((pair.caseType === 'real-issue-pre-post' || pair.caseType === 'public-fix-pre-post') && (pre.expectedVerdict !== 'FAIL' || post.expectedVerdict !== 'PASS')) diagnostics.push(`${prefix} public pre/post verdicts must be FAIL then PASS`);
  }
}

function validateProvenance(pair, prefix, diagnostics) {
  if (!safeUrl(pair.repositoryUrl)) diagnostics.push(`${prefix}.repositoryUrl must be a safe URL`);
  if (!safeUrl(pair.publicIssueUrl)) diagnostics.push(`${prefix}.publicIssueUrl must be a safe URL`);
  if (!nonEmptyString(pair.repositoryLicense)) diagnostics.push(`${prefix}.repositoryLicense is required`);
  if (!nonEmptyString(pair.publicIssueTitle)) diagnostics.push(`${prefix}.publicIssueTitle is required`);
}

function validateSnapshot(snapshot, prefix, diagnostics) {
  if (!isPlainRecord(snapshot)) {
    diagnostics.push(`${prefix} must be an object`);
    return null;
  }
  if (!safeLogicalId(snapshot.snapshotId)) diagnostics.push(`${prefix}.snapshotId must be safe`);
  if (!sha1Pattern.test(snapshot.commitSha ?? '')) diagnostics.push(`${prefix}.commitSha must be a 40-hex commit SHA`);
  if (!safeTargetRelativePath(snapshot.localSnapshot)) diagnostics.push(`${prefix}.localSnapshot must be target-relative and safe`);
  if (!sha256Pattern.test(snapshot.treeSha256 ?? '')) diagnostics.push(`${prefix}.treeSha256 must be a 64-hex SHA-256`);
  if (!allowedVerdicts.has(snapshot.expectedVerdict)) diagnostics.push(`${prefix}.expectedVerdict is invalid`);
  if (!Array.isArray(snapshot.directArgvArrays) || snapshot.directArgvArrays.length === 0) diagnostics.push(`${prefix}.directArgvArrays must be a non-empty array`);
  for (const [index, argv] of (snapshot.directArgvArrays ?? []).entries()) validateArgv(argv, `${prefix}.directArgvArrays[${index}]`, diagnostics);
  if (!nonEmptySafeStringArray(snapshot.prerequisites)) diagnostics.push(`${prefix}.prerequisites must be a non-empty safe array`);
  return snapshot;
}

function validateArgv(argv, prefix, diagnostics) {
  if (!Array.isArray(argv) || argv.length === 0) {
    diagnostics.push(`${prefix} must be a non-empty argv array`);
    return;
  }
  const command = String(argv[0]).toLowerCase();
  if (shellWrappers.has(command)) diagnostics.push(`${prefix} must not use shell wrappers`);
  const text = argv.map((part) => String(part)).join(' ');
  if (argv.some((part) => typeof part !== 'string' || part.length === 0)) diagnostics.push(`${prefix} must contain only non-empty strings`);
  if (shellMetacharacters.test(text)) diagnostics.push(`${prefix} must not contain shell metacharacters`);
  if (unsafeCommandWords.test(text)) diagnostics.push(`${prefix} contains install/update/download/network/credential/production/deploy/migration/destructive command text`);
  if (secretLike.test(text)) diagnostics.push(`${prefix} contains embedded secret-like text`);
}

function validateNoSecretText(value, label, diagnostics) {
  const text = JSON.stringify(value);
  if (secretLike.test(text)) diagnostics.push(`${label} contains embedded secret-like text`);
}

function safeTargetRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:/.test(normalized)) return false;
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  return parts.length > 0 && parts.every((part) => part !== '..' && !secretLike.test(part));
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || secretLike.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 && !secretLike.test(value);
}

function nonEmptySafeString(value) {
  return nonEmptyString(value) && !shellMetacharacters.test(value);
}

function nonEmptySafeStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptySafeString);
}

function safeLogicalId(value) {
  return typeof value === 'string' && safeLogicalIdPattern.test(value) && !secretLike.test(value);
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireEqual(actual, expected, label, diagnostics) {
  if (actual !== expected) diagnostics.push(`${label} must equal ${expected}`);
}

function result(ok, diagnostics) {
  return deepFreeze({ ok, diagnostics: Object.freeze([...diagnostics]) });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
