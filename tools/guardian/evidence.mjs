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

export const ISSUE_CLASSES = Object.freeze(['bug', 'request']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
