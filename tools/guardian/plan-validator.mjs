// Decision-complete implementation plan validator (Phase 2).
// Pure gate between investigation artifacts and any write-capable FIXING phase.

import { isDecisionReady, validateDossier } from './evidence.mjs';

const REQUIRED_PLAN_FIELDS = Object.freeze([
  'root_cause',
  'affected_files',
  'non_goals',
  'test_plan',
  'acceptance_criteria',
  'rollback_plan',
  'risk',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Validate a plan against a dossier. Structural errors always block. Unresolved facts force
 * Gate 1 rather than pretending the plan is autonomous-ready. LOW requires full readiness;
 * HIGH plans may be structurally complete but still require human approval.
 */
export function validatePlan(plan, dossier) {
  const errors = [];
  const p = plan ?? {};
  const d = dossier ?? {};
  const dossierResult = validateDossier(d);
  if (!dossierResult.valid) errors.push(...dossierResult.errors.map((e) => `dossier:${e}`));

  for (const field of REQUIRED_PLAN_FIELDS) {
    const value = p[field];
    const valid = field === 'risk' ? value === 'LOW' || value === 'HIGH' : nonEmptyArray(value) || nonEmpty(value);
    if (!valid) errors.push(`plan:missing-${field}`);
  }

  if (p.risk !== 'LOW' && p.risk !== 'HIGH') errors.push('plan:invalid-risk');
  if (p.risk === 'LOW' && d.issue_class === 'request') errors.push('plan:request-cannot-autonomously-low');
  if (p.evidence_ids && Array.isArray(d.evidence)) {
    const known = new Set(d.evidence.map((e) => e.id));
    for (const id of p.evidence_ids) if (!known.has(id)) errors.push(`plan:unknown-evidence:${id}`);
  } else if (!nonEmptyArray(p.evidence_ids)) {
    errors.push('plan:missing-evidence_ids');
  }

  const readiness = isDecisionReady(d);
  const gateRequired = p.risk === 'HIGH' || !readiness.ready || errors.length > 0;
  return {
    valid: errors.length === 0,
    autonomousReady: errors.length === 0 && p.risk === 'LOW' && readiness.ready,
    gateRequired,
    errors,
  };
}

export function canEnterFixing(plan, dossier) {
  const result = validatePlan(plan, dossier);
  return result.autonomousReady || (result.valid && result.gateRequired === false);
}
