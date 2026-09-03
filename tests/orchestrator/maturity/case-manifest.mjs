import { createHash } from 'node:crypto';

export const MANIFEST_SCHEMA_VERSION = 'qa-cr-maturity-manifest-v1';

export const QA_CR_CATEGORY_IDS = Object.freeze([
  'CR-C1',
  'CR-C2',
  'CR-C3',
  'CR-C4',
  'CR-C5',
  'CR-C6',
  'CR-C7',
  'CR-C8',
  'CR-C9',
  'CR-C10',
]);

export const ALLOWED_STATUS_GATE_PAIRS = Object.freeze([
  Object.freeze({ status: 'OK', gate: 'continue' }),
  Object.freeze({ status: 'FAIL', gate: 'stop_and_fail' }),
  Object.freeze({ status: 'BLOCKED', gate: 'blocked' }),
  Object.freeze({ status: 'BLOCKED', gate: 'need_e2e' }),
  Object.freeze({ status: 'NEEDS_HUMAN_REVIEW', gate: 'need_human' }),
]);

const CATEGORY_SET = new Set(QA_CR_CATEGORY_IDS);
const ALLOWED_PAIR_SET = new Set(ALLOWED_STATUS_GATE_PAIRS.map((pair) => `${pair.status}::${pair.gate}`));
const CASE_KINDS = new Set(['defect', 'control']);
const CONTROL_TYPES = new Set(['clean', 'fixed', 'ambiguous', 'environment-blocked']);
const COMPLEXITY_TIERS = new Set(['small', 'medium', 'large']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const EVALUATION_MODES = new Set(['autonomous']);
const PARTITIONS = new Set(['development']);
const MANIFEST_KINDS = new Set(['seed']);
const SOURCE_TYPES = new Set(['synthetic', 'project-internal']);
const LICENSE_RE = /^[A-Za-z0-9.+-]+(?:\s+[A-Za-z0-9.+-]+)*$/;
const SAFE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX40_RE = /^[a-f0-9]{40}$/;

function issue(path, code, message) {
  return { path, code, message };
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowedKeys, path, issues) {
  if (!isPlainObject(value)) {
    issues.push(issue(path, 'type', 'must be an object'));
    return false;
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue(`${path}.${key}`, 'unknown_field', 'unknown field is not allowed'));
    }
  }
  for (const key of allowedKeys) {
    if (!(key in value)) {
      issues.push(issue(`${path}.${key}`, 'missing_field', 'required field is missing'));
    }
  }
  return true;
}

function isSafeRefString(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const normalized = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:[\/]/.test(value)) return false;
  if (/^\\\\/.test(value)) return false;
  if (/^file:/i.test(value)) return false;
  if (/^\//.test(normalized)) return false;
  if (normalized.split('/').includes('..')) return false;
  return true;
}

function validateSafeRefString(value, path, issues) {
  if (!isSafeRefString(value)) {
    issues.push(issue(path, 'unsafe_ref', 'must be a non-absolute relative/source identifier without traversal'));
  }
}

function validateString(value, path, issues, { nonEmpty = true } = {}) {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'type', 'must be a string'));
    return false;
  }
  if (nonEmpty && value.trim().length === 0) {
    issues.push(issue(path, 'empty', 'must be a non-empty string'));
    return false;
  }
  return true;
}

function validateArray(value, path, issues) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'type', 'must be an array'));
    return false;
  }
  return true;
}

function validateAllowed(value, allowedSet, path, issues, label) {
  if (!allowedSet.has(value)) {
    issues.push(issue(path, 'invalid_value', `must be one of ${label}`));
  }
}

function validateBoolean(value, path, issues) {
  if (typeof value !== 'boolean') {
    issues.push(issue(path, 'type', 'must be a boolean'));
  }
}

function validateNullableIdentity(value, path, issues) {
  if (value === null) return;
  if (!validateString(value, path, issues)) return;
  if (!isSafeRefString(value)) {
    issues.push(issue(path, 'unsafe_ref', 'must be a safe relative/source identifier when provided'));
  }
}

function validateComplexity(complexity, path, issues) {
  if (!assertExactKeys(complexity, ['tier', 'facts', 'rationale'], path, issues)) return;
  if (validateString(complexity.tier, `${path}.tier`, issues)) {
    validateAllowed(complexity.tier, COMPLEXITY_TIERS, `${path}.tier`, issues, 'small, medium, large');
  }
  if (validateArray(complexity.facts, `${path}.facts`, issues)) {
    if (complexity.facts.length === 0) {
      issues.push(issue(`${path}.facts`, 'empty', 'must include at least one fact'));
    }
    complexity.facts.forEach((fact, index) => {
      validateString(fact, `${path}.facts[${index}]`, issues);
    });
  }
  validateString(complexity.rationale, `${path}.rationale`, issues);
}

function validateOracle(oracle, path, issues) {
  if (!assertExactKeys(oracle, ['authority', 'summary', 'sourceRef'], path, issues)) return;
  validateString(oracle.authority, `${path}.authority`, issues);
  validateString(oracle.summary, `${path}.summary`, issues);
  if (validateString(oracle.sourceRef, `${path}.sourceRef`, issues)) {
    validateSafeRefString(oracle.sourceRef, `${path}.sourceRef`, issues);
  }
}

function validateExpectedDisposition(expectedDisposition, path, issues) {
  if (!assertExactKeys(expectedDisposition, ['status', 'gate', 'rationale', 'primaryFindingId'], path, issues)) return;
  const statusOk = validateString(expectedDisposition.status, `${path}.status`, issues);
  const gateOk = validateString(expectedDisposition.gate, `${path}.gate`, issues);
  validateString(expectedDisposition.rationale, `${path}.rationale`, issues);
  if (validateString(expectedDisposition.primaryFindingId, `${path}.primaryFindingId`, issues) && !SAFE_ID_RE.test(expectedDisposition.primaryFindingId)) {
    issues.push(issue(`${path}.primaryFindingId`, 'invalid_id', 'must be a safe lowercase hyphenated identifier'));
  }
  if (statusOk && gateOk && !ALLOWED_PAIR_SET.has(`${expectedDisposition.status}::${expectedDisposition.gate}`)) {
    issues.push(issue(path, 'invalid_disposition', 'status/gate pair is not allowed'));
  }
}

function validateProvenance(provenance, path, issues) {
  if (!assertExactKeys(provenance, ['sourceType', 'sourceRef', 'license', 'commitIdentity', 'treeIdentity'], path, issues)) return;
  if (validateString(provenance.sourceType, `${path}.sourceType`, issues)) {
    validateAllowed(provenance.sourceType, SOURCE_TYPES, `${path}.sourceType`, issues, 'synthetic, project-internal');
  }
  if (validateString(provenance.sourceRef, `${path}.sourceRef`, issues)) {
    validateSafeRefString(provenance.sourceRef, `${path}.sourceRef`, issues);
  }
  if (validateString(provenance.license, `${path}.license`, issues) && !LICENSE_RE.test(provenance.license)) {
    issues.push(issue(`${path}.license`, 'invalid_license', 'must be a compact non-empty license identifier'));
  }
  validateNullableIdentity(provenance.commitIdentity, `${path}.commitIdentity`, issues);
  validateNullableIdentity(provenance.treeIdentity, `${path}.treeIdentity`, issues);
}

function dispositionPair(caseValue) {
  return `${caseValue.expectedDisposition?.status}::${caseValue.expectedDisposition?.gate}`;
}

export function validateQaCrMaturityCase(caseValue, context = {}) {
  const issues = [];
  const path = context.path ?? 'case';
  const seenIds = context.seenIds ?? new Set();

  if (!assertExactKeys(caseValue, [
    'id',
    'title',
    'caseKind',
    'controlType',
    'partition',
    'evaluationMode',
    'scoringEligible',
    'complexity',
    'categories',
    'severity',
    'oracle',
    'expectedDisposition',
    'provenance',
  ], path, issues)) {
    return { ok: false, issues };
  }

  if (validateString(caseValue.id, `${path}.id`, issues)) {
    if (!SAFE_ID_RE.test(caseValue.id)) {
      issues.push(issue(`${path}.id`, 'invalid_id', 'must be a safe lowercase hyphenated identifier'));
    } else if (seenIds.has(caseValue.id)) {
      issues.push(issue(`${path}.id`, 'duplicate_id', 'case id must be unique'));
    } else {
      seenIds.add(caseValue.id);
    }
  }
  validateString(caseValue.title, `${path}.title`, issues);
  if (validateString(caseValue.caseKind, `${path}.caseKind`, issues)) {
    validateAllowed(caseValue.caseKind, CASE_KINDS, `${path}.caseKind`, issues, 'defect, control');
  }
  if (caseValue.controlType !== null) {
    if (validateString(caseValue.controlType, `${path}.controlType`, issues)) {
      validateAllowed(caseValue.controlType, CONTROL_TYPES, `${path}.controlType`, issues, 'clean, fixed, ambiguous, environment-blocked');
    }
  }
  if (validateString(caseValue.partition, `${path}.partition`, issues)) {
    validateAllowed(caseValue.partition, PARTITIONS, `${path}.partition`, issues, 'development');
  }
  if (validateString(caseValue.evaluationMode, `${path}.evaluationMode`, issues)) {
    validateAllowed(caseValue.evaluationMode, EVALUATION_MODES, `${path}.evaluationMode`, issues, 'autonomous');
  }
  validateBoolean(caseValue.scoringEligible, `${path}.scoringEligible`, issues);
  if (caseValue.scoringEligible !== false) {
    issues.push(issue(`${path}.scoringEligible`, 'invalid_value', 'Phase A seed cases must be scoringEligible=false'));
  }

  validateComplexity(caseValue.complexity, `${path}.complexity`, issues);

  if (validateArray(caseValue.categories, `${path}.categories`, issues)) {
    if (caseValue.categories.length === 0) {
      issues.push(issue(`${path}.categories`, 'empty', 'must include at least one category'));
    }
    const seenCategories = new Set();
    caseValue.categories.forEach((category, index) => {
      if (!validateString(category, `${path}.categories[${index}]`, issues)) return;
      if (!CATEGORY_SET.has(category)) {
        issues.push(issue(`${path}.categories[${index}]`, 'invalid_category', 'category must be one of CR-C1..CR-C10'));
      }
      if (seenCategories.has(category)) {
        issues.push(issue(`${path}.categories[${index}]`, 'duplicate_category', 'duplicate category is not allowed'));
      }
      seenCategories.add(category);
    });
  }

  if (validateString(caseValue.severity, `${path}.severity`, issues)) {
    validateAllowed(caseValue.severity, SEVERITIES, `${path}.severity`, issues, 'critical, high, medium, low');
  }

  validateOracle(caseValue.oracle, `${path}.oracle`, issues);
  validateExpectedDisposition(caseValue.expectedDisposition, `${path}.expectedDisposition`, issues);
  validateProvenance(caseValue.provenance, `${path}.provenance`, issues);

  const pair = dispositionPair(caseValue);
  if (caseValue.caseKind === 'defect') {
    if (caseValue.controlType !== null) {
      issues.push(issue(path, 'control_mismatch', 'defect cases must set controlType=null'));
    }
    if (pair !== 'FAIL::stop_and_fail') {
      issues.push(issue(`${path}.expectedDisposition`, 'defect_disposition_mismatch', 'defect cases must be FAIL/stop_and_fail in the Phase A seed'));
    }
  }
  if (caseValue.caseKind === 'control') {
    if (caseValue.controlType === null) {
      issues.push(issue(path, 'control_mismatch', 'control cases must set a non-null controlType'));
    }
  }
  if (caseValue.controlType === 'clean' || caseValue.controlType === 'fixed') {
    if (pair !== 'OK::continue') {
      issues.push(issue(`${path}.expectedDisposition`, 'control_disposition_mismatch', 'clean and fixed controls must be OK/continue'));
    }
  }
  if (caseValue.controlType === 'ambiguous' && pair !== 'NEEDS_HUMAN_REVIEW::need_human') {
    issues.push(issue(`${path}.expectedDisposition`, 'control_disposition_mismatch', 'ambiguous controls must be NEEDS_HUMAN_REVIEW/need_human'));
  }
  if (caseValue.controlType === 'environment-blocked' && !new Set(['BLOCKED::blocked', 'BLOCKED::need_e2e']).has(pair)) {
    issues.push(issue(`${path}.expectedDisposition`, 'control_disposition_mismatch', 'environment-blocked controls must be BLOCKED/blocked or BLOCKED/need_e2e'));
  }
  if (caseValue.caseKind === 'control' && caseValue.controlType !== null && !CONTROL_TYPES.has(caseValue.controlType)) {
    issues.push(issue(path, 'control_mismatch', 'control cases must use a recognized control subtype'));
  }

  return { ok: issues.length === 0, issues };
}

export function summarizeQaCrMaturityManifest(manifest) {
  const stats = {
    caseCount: 0,
    defectCount: 0,
    controlCount: 0,
    scoringEligibleCount: 0,
    complexityCounts: { small: 0, medium: 0, large: 0 },
    controlTypeCounts: { clean: 0, fixed: 0, ambiguous: 0, 'environment-blocked': 0 },
    caseKindCounts: { defect: 0, control: 0 },
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    partitionCounts: { development: 0 },
    evaluationModeCounts: { autonomous: 0 },
    statusCounts: { OK: 0, FAIL: 0, BLOCKED: 0, NEEDS_HUMAN_REVIEW: 0 },
    gateCounts: { continue: 0, stop_and_fail: 0, blocked: 0, need_e2e: 0, need_human: 0 },
    categoryCounts: Object.fromEntries(QA_CR_CATEGORY_IDS.map((id) => [id, 0])),
  };

  if (!isPlainObject(manifest) || !Array.isArray(manifest.cases)) return stats;
  for (const caseValue of manifest.cases) {
    stats.caseCount += 1;
    if (caseValue?.caseKind === 'defect') stats.defectCount += 1;
    if (caseValue?.caseKind === 'control') stats.controlCount += 1;
    if (caseValue?.scoringEligible === true) stats.scoringEligibleCount += 1;
    if (caseValue?.complexity?.tier in stats.complexityCounts) stats.complexityCounts[caseValue.complexity.tier] += 1;
    if (caseValue?.controlType in stats.controlTypeCounts) stats.controlTypeCounts[caseValue.controlType] += 1;
    if (caseValue?.caseKind in stats.caseKindCounts) stats.caseKindCounts[caseValue.caseKind] += 1;
    if (caseValue?.severity in stats.severityCounts) stats.severityCounts[caseValue.severity] += 1;
    if (caseValue?.partition in stats.partitionCounts) stats.partitionCounts[caseValue.partition] += 1;
    if (caseValue?.evaluationMode in stats.evaluationModeCounts) stats.evaluationModeCounts[caseValue.evaluationMode] += 1;
    if (caseValue?.expectedDisposition?.status in stats.statusCounts) stats.statusCounts[caseValue.expectedDisposition.status] += 1;
    if (caseValue?.expectedDisposition?.gate in stats.gateCounts) stats.gateCounts[caseValue.expectedDisposition.gate] += 1;
    if (Array.isArray(caseValue?.categories)) {
      for (const category of caseValue.categories) {
        if (category in stats.categoryCounts) stats.categoryCounts[category] += 1;
      }
    }
  }
  return stats;
}

export function validateQaCrMaturityManifest(manifest) {
  const issues = [];
  if (!assertExactKeys(manifest, [
    'schemaVersion',
    'manifestId',
    'manifestKind',
    'scoringEligible',
    'scopeContract',
    'target',
    'runPolicy',
    'holdoutPolicy',
    'cases',
  ], 'manifest', issues)) {
    return { ok: false, issues, manifestHash: null, stats: summarizeQaCrMaturityManifest({}) };
  }

  if (validateString(manifest.schemaVersion, 'manifest.schemaVersion', issues) && manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    issues.push(issue('manifest.schemaVersion', 'invalid_value', `must equal ${MANIFEST_SCHEMA_VERSION}`));
  }
  if (validateString(manifest.manifestId, 'manifest.manifestId', issues) && manifest.manifestId !== 'qa-cr-phase-a-seed-v1') {
    issues.push(issue('manifest.manifestId', 'invalid_value', 'must equal qa-cr-phase-a-seed-v1'));
  }
  if (validateString(manifest.manifestKind, 'manifest.manifestKind', issues)) {
    validateAllowed(manifest.manifestKind, MANIFEST_KINDS, 'manifest.manifestKind', issues, 'seed');
  }
  validateBoolean(manifest.scoringEligible, 'manifest.scoringEligible', issues);
  if (manifest.scoringEligible !== false) {
    issues.push(issue('manifest.scoringEligible', 'invalid_value', 'Phase A seed manifest must be scoringEligible=false'));
  }

  if (assertExactKeys(manifest.scopeContract, ['version', 'path'], 'manifest.scopeContract', issues)) {
    if (validateString(manifest.scopeContract.version, 'manifest.scopeContract.version', issues) && manifest.scopeContract.version !== 'qa-cr-maturity-scope-v1') {
      issues.push(issue('manifest.scopeContract.version', 'invalid_value', 'must equal qa-cr-maturity-scope-v1'));
    }
    if (validateString(manifest.scopeContract.path, 'manifest.scopeContract.path', issues)) {
      validateSafeRefString(manifest.scopeContract.path, 'manifest.scopeContract.path', issues);
    }
  }

  if (assertExactKeys(manifest.target, ['agent', 'agentPath', 'baseCommit'], 'manifest.target', issues)) {
    if (validateString(manifest.target.agent, 'manifest.target.agent', issues) && manifest.target.agent !== 'qa-cr') {
      issues.push(issue('manifest.target.agent', 'invalid_value', 'must equal qa-cr'));
    }
    if (validateString(manifest.target.agentPath, 'manifest.target.agentPath', issues)) {
      validateSafeRefString(manifest.target.agentPath, 'manifest.target.agentPath', issues);
    }
    if (validateString(manifest.target.baseCommit, 'manifest.target.baseCommit', issues) && manifest.target.baseCommit !== '801cd123afcf569d6564fc6c57128ad96f7af97e') {
      issues.push(issue('manifest.target.baseCommit', 'invalid_value', 'must equal the frozen Phase A base commit'));
    }
    if (typeof manifest.target.baseCommit === 'string' && !HEX40_RE.test(manifest.target.baseCommit)) {
      issues.push(issue('manifest.target.baseCommit', 'invalid_commit', 'must be a 40-character lowercase hex commit id'));
    }
  }

  if (assertExactKeys(manifest.runPolicy, ['primaryAttempt', 'retryPolicy', 'retainPrimaryEvidence'], 'manifest.runPolicy', issues)) {
    if (manifest.runPolicy.primaryAttempt !== 1) {
      issues.push(issue('manifest.runPolicy.primaryAttempt', 'invalid_value', 'must equal 1'));
    }
    if (manifest.runPolicy.retryPolicy !== 'none') {
      issues.push(issue('manifest.runPolicy.retryPolicy', 'invalid_value', 'must equal none'));
    }
    if (manifest.runPolicy.retainPrimaryEvidence !== true) {
      issues.push(issue('manifest.runPolicy.retainPrimaryEvidence', 'invalid_value', 'must equal true'));
    }
  }

  if (assertExactKeys(manifest.holdoutPolicy, ['requiredForGraduation', 'minimumRatio', 'enforcedForThisSeed'], 'manifest.holdoutPolicy', issues)) {
    validateBoolean(manifest.holdoutPolicy.requiredForGraduation, 'manifest.holdoutPolicy.requiredForGraduation', issues);
    if (manifest.holdoutPolicy.minimumRatio !== 0.2) {
      issues.push(issue('manifest.holdoutPolicy.minimumRatio', 'invalid_value', 'must equal 0.2'));
    }
    if (manifest.holdoutPolicy.enforcedForThisSeed !== false) {
      issues.push(issue('manifest.holdoutPolicy.enforcedForThisSeed', 'invalid_value', 'must equal false for the public seed'));
    }
  }

  if (validateArray(manifest.cases, 'manifest.cases', issues)) {
    if (manifest.cases.length < 5) {
      issues.push(issue('manifest.cases', 'too_small', 'must contain at least five seed cases'));
    }
    const seenIds = new Set();
    manifest.cases.forEach((caseValue, index) => {
      const result = validateQaCrMaturityCase(caseValue, { path: `manifest.cases[${index}]`, seenIds });
      issues.push(...result.issues);
    });
  }

  const stats = summarizeQaCrMaturityManifest(manifest);
  const manifestHash = issues.length === 0 ? sha256CanonicalJson(manifest) : null;
  return { ok: issues.length === 0, issues, manifestHash, stats };
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortCanonical(value[key])]));
  }
  return value;
}

export function canonicalizeJson(value) {
  return JSON.stringify(sortCanonical(value));
}

export function sha256CanonicalJson(value) {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex');
}
