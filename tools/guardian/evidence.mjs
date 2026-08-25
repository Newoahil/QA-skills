// Evidence contract for unattended investigation (Phase 1).
// Pure data validation/scoring only. It does not decide business truth; it makes provenance,
// competing hypotheses, and unresolved facts explicit enough for a later plan validator.

export const EVIDENCE_STRENGTH = Object.freeze({
  runtime_reproduction: 4,
  regression_test: 4,
  source_invariant: 3,
  git_history: 3,
  official_docs: 3,
  codegraph: 2,
  static_search: 1,
  issue_assertion: 0,
});

export const EVIDENCE_KIND_ALIASES = Object.freeze({
  'issue-data': 'issue_assertion',
  grep: 'static_search',
  source: 'source_invariant',
  'test-inventory': 'static_search',
});

export const ISSUE_CLASSES = Object.freeze(['bug', 'request']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalEvidenceKind(kind) {
  if (!isNonEmptyString(kind)) return null;
  const trimmed = kind.trim();
  if (trimmed === 'tool-observation') return null;
  return EVIDENCE_KIND_ALIASES[trimmed] ?? trimmed;
}

function inferEvidenceKind(item) {
  const tool = isNonEmptyString(item?.tool) ? item.tool.trim().toLowerCase() : null;
  if (tool === 'context7') return 'official_docs';
  if (tool === 'codegraph') return 'codegraph';

  const metadata = [item?.source, item?.provenance, item?.command, item?.tool]
    .filter(isNonEmptyString)
    .join(' ')
    .toLowerCase();
  if (/\bcodegraph\b/.test(metadata)) return 'codegraph';
  if (/\bcontext7\b|official\s+docs?/.test(metadata)) return 'official_docs';
  if (/\bgit\s+(?:log|show|blame|diff|history)\b|reflog|commit\s+[0-9a-f]{7,}/.test(metadata)) return 'git_history';
  if (/\b(?:playwright|runtime|reproduc|browser|curl|http)\b/.test(metadata)) return 'runtime_reproduction';
  if (/\b(?:test|npm\s+(?:run\s+)?test|node\s+--test)\b/.test(metadata) && /(?:pass|fail|exit[_ -]?code|executed|ran|运行)/.test(metadata)) return 'regression_test';
  if (/\b(?:grep|rg|search|glob|inventory)\b|全文搜索|内容搜索/.test(metadata)) return 'static_search';
  if (/\bissue(?:-data)?\b|issue\s*#?\d+|authoritative\s+snapshot/.test(metadata)) return 'issue_assertion';
  if (/\b(?:read|source|file)\b|\.[a-z0-9]+:\d+|[\\/][^\\/]+\.[a-z0-9]+/.test(metadata)) return 'source_invariant';
  return null;
}

function normalizeStringArray(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return value;
  return value.map((item) => (typeof item === 'string' ? item.trim() : item));
}

function invalidEvidenceError(code, item) {
  const detail = item && typeof item === 'object' && isNonEmptyString(item.id) ? `:${item.id.trim()}` : '';
  return new Error(`${code}${detail}`);
}

export function normalizeEvidenceItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidEvidenceError('evidence-not-object', item);

  const id = isNonEmptyString(item.id) ? item.id.trim() : null;
  if (!id) throw invalidEvidenceError('missing-id', item);

  const kind = canonicalEvidenceKind(item.kind) ?? inferEvidenceKind(item);
  if (!isNonEmptyString(kind) || !(kind in EVIDENCE_STRENGTH)) throw invalidEvidenceError('invalid-kind', { id });

  const normalized = {
    id,
    kind,
    source: [item.source, item.provenance, item.command, item.tool].find(isNonEmptyString)?.trim(),
    observation: isNonEmptyString(item.observation) ? item.observation.trim() : item.observation,
    supports: normalizeStringArray(item.supports),
    contradicts: normalizeStringArray(item.contradicts),
  };

  const errors = validateEvidenceItem(normalized);
  if (errors.length > 0) throw invalidEvidenceError(errors[0], { id });
  return normalized;
}

export function normalizeSpecialistResult(result, options = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;

  const seenEvidenceIds = options.seenEvidenceIds instanceof Set ? options.seenEvidenceIds : new Set();
  const canonicalSpecialist = isNonEmptyString(options.canonicalRole) ? options.canonicalRole.trim() : null;
  const specialist = canonicalSpecialist ?? (isNonEmptyString(result.specialist) ? result.specialist.trim() : 'specialist');
  const evidence = Array.isArray(result.evidence) ? result.evidence.map((item) => {
    const normalized = normalizeEvidenceItem(item);
    if (!seenEvidenceIds.has(normalized.id)) {
      seenEvidenceIds.add(normalized.id);
      return normalized;
    }
    let suffix = 1;
    let namespacedId = `${specialist}:${normalized.id}`;
    while (seenEvidenceIds.has(namespacedId)) {
      suffix += 1;
      namespacedId = `${specialist}:${normalized.id}:${suffix}`;
    }
    seenEvidenceIds.add(namespacedId);
    return { ...normalized, id: namespacedId };
  }) : [];

  return {
    ...result,
    specialist,
    evidence,
  };
}

export function validateEvidenceItem(item) {
  const errors = [];
  if (!item || typeof item !== 'object') return ['evidence-not-object'];
  if (!isNonEmptyString(item.id)) errors.push('missing-id');
  if (!isNonEmptyString(item.kind) || !(item.kind in EVIDENCE_STRENGTH)) errors.push('invalid-kind');
  if (!isNonEmptyString(item.source)) errors.push('missing-source');
  if (!isNonEmptyString(item.observation)) errors.push('missing-observation');
  if (!Array.isArray(item.supports) || item.supports.some((id) => !isNonEmptyString(id))) errors.push('invalid-supports');
  if (!Array.isArray(item.contradicts) || item.contradicts.some((id) => !isNonEmptyString(id))) errors.push('invalid-contradicts');
  return errors;
}

export function scoreHypothesis(hypothesis, evidence) {
  const items = Array.isArray(evidence) ? evidence : [];
  return items.reduce((score, item) => {
    const strength = EVIDENCE_STRENGTH[item.kind] ?? 0;
    if (item.supports?.includes(hypothesis.id)) return score + strength;
    if (item.contradicts?.includes(hypothesis.id)) return score - strength;
    return score;
  }, 0);
}

export function rankHypotheses(hypotheses, evidence) {
  return (Array.isArray(hypotheses) ? hypotheses : [])
    .map((hypothesis) => ({ ...hypothesis, score: scoreHypothesis(hypothesis, evidence) }))
    .sort((a, b) => b.score - a.score);
}

export function validateDossier(dossier) {
  const errors = [];
  if (!dossier || typeof dossier !== 'object') return { valid: false, errors: ['dossier-not-object'] };
  if (!Number.isInteger(Number(dossier.issue)) || Number(dossier.issue) <= 0) errors.push('invalid-issue');
  if (!ISSUE_CLASSES.includes(dossier.issue_class)) errors.push('invalid-issue-class');
  if (!Array.isArray(dossier.hypotheses) || dossier.hypotheses.length === 0) errors.push('missing-hypotheses');
  if (!Array.isArray(dossier.evidence)) errors.push('missing-evidence');
  else dossier.evidence.forEach((item) => errors.push(...validateEvidenceItem(item).map((e) => `evidence:${e}`)));
  if (!Array.isArray(dossier.unresolved_facts)) errors.push('missing-unresolved-facts');
  if (dossier.issue_class === 'request' && (!Array.isArray(dossier.acceptance_criteria) || dossier.acceptance_criteria.length === 0)) {
    errors.push('request-missing-acceptance-criteria');
  }
  if (!isNonEmptyString(dossier.selected_hypothesis)) errors.push('missing-selected-hypothesis');
  if (Array.isArray(dossier.hypotheses) && dossier.selected_hypothesis && !dossier.hypotheses.some((h) => h.id === dossier.selected_hypothesis)) {
    errors.push('selected-hypothesis-not-found');
  }
  return { valid: errors.length === 0, errors };
}

export function isDecisionReady(dossier) {
  const validation = validateDossier(dossier);
  if (!validation.valid) return { ready: false, reasons: validation.errors };
  const ranked = rankHypotheses(dossier.hypotheses, dossier.evidence);
  const selected = ranked.find((h) => h.id === dossier.selected_hypothesis);
  if (!selected || selected.score <= 0) return { ready: false, reasons: ['selected-hypothesis-has-no-positive-evidence'] };
  if ((dossier.unresolved_facts ?? []).length > 0) return { ready: false, reasons: ['unresolved-facts'] };
  return { ready: true, reasons: [], selected_score: selected.score };
}
