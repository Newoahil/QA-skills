// QA Guardian — risk grading (§5A)
//
// The safety hinge: LOW lets an issue skip Gate 1 (no human sees the plan before code
// changes), so grading is conservative by construction. This is a PURE function over a
// structured "assessment" the guardian agent produces from its diagnosis. The agent does
// the judgment; this function mechanically enforces the fail-safe so a LOW verdict is only
// possible when EVERY whitelist clause is explicitly satisfied.
//
// Design invariants (must hold, verified by tests):
//   - uncertain / insufficient info / ambiguous → HIGH (fail-safe, §5A.3.1)
//   - any whitelist clause not explicitly true → HIGH
//   - LOW only when all clauses true AND no high-risk signal AND not uncertain

export const RISK = Object.freeze({ LOW: 'LOW', HIGH: 'HIGH' });

// The high-danger surfaces a LOW fix must NOT touch (§5A.2). Presence of ANY forces HIGH.
export const HIGH_RISK_SURFACES = Object.freeze([
  'money-billing',
  'authn-authz-permission',
  'personal-data-privacy',
  'data-migration-schema',
  'core-business-flow',
  'cross-service-boundary',
  'concurrency-state',
  'build-release-config',
]);

// Default diff line budget for LOW (§5A.2 "small diff"; configurable).
export const DEFAULT_MAX_LOW_DIFF_LINES = 40;

/**
 * Grade an assessment. Returns { risk, reasons, matchedClauses, excludedSignals }.
 *
 * assessment fields (all must be explicitly provided for a LOW; missing/undefined → treated
 * as NOT satisfied → HIGH):
 *   - certain: boolean            // agent is confident in diagnosis + grading (else fail-safe HIGH)
 *   - lowDangerSurfaceOnly: bool  // fix lands only on copy/comments/docs/log-text/tests/isolated non-core util
 *   - touchedSurfaces: string[]   // any HIGH_RISK_SURFACES present → HIGH
 *   - localImpact: boolean        // concentrated, bounded blast radius, no cross-module spread
 *   - diffLines: number           // must be ≤ maxLowDiffLines
 *   - reproducibleOracle: boolean // bug reproduces, expected behavior clear, not business/subjective
 *   - scopeExpansionRequested: bool // issue text asked to widen scope → never LOW (§12 injection)
 *
 * @param {object} assessment
 * @param {object} [opts] { maxLowDiffLines }
 */
export function gradeRisk(assessment, opts = {}) {
  const maxLowDiffLines = opts.maxLowDiffLines ?? DEFAULT_MAX_LOW_DIFF_LINES;
  const reasons = [];
  const a = assessment ?? {};

  // Fail-safe: if the agent is not explicitly certain, or the assessment is missing, HIGH.
  if (a.certain !== true) {
    return high(['uncertain-or-insufficient-info']);
  }

  const excludedSignals = [];
  const matchedClauses = [];

  // Clause: only low-danger surface.
  if (a.lowDangerSurfaceOnly === true) matchedClauses.push('low-danger-surface-only');
  else reasons.push('not-low-danger-surface-only');

  // Clause: does not touch any high-risk surface.
  const touched = Array.isArray(a.touchedSurfaces) ? a.touchedSurfaces : [];
  const hitHigh = touched.filter((s) => HIGH_RISK_SURFACES.includes(s));
  if (hitHigh.length === 0) {
    matchedClauses.push('no-high-risk-surface');
    for (const s of HIGH_RISK_SURFACES) excludedSignals.push(s);
  } else {
    for (const s of hitHigh) reasons.push(`touches-high-risk-surface:${s}`);
  }

  // Clause: local impact.
  if (a.localImpact === true) matchedClauses.push('local-impact');
  else reasons.push('not-local-impact');

  // Clause: small diff.
  if (typeof a.diffLines === 'number' && a.diffLines <= maxLowDiffLines) {
    matchedClauses.push(`diff-within-budget(${a.diffLines}<=${maxLowDiffLines})`);
  } else {
    reasons.push(`diff-over-budget(${a.diffLines}>${maxLowDiffLines})`);
  }

  // Clause: reproducible, unambiguous oracle.
  if (a.reproducibleOracle === true) matchedClauses.push('reproducible-oracle');
  else reasons.push('no-reproducible-oracle');

  // Clause: issue text did NOT ask to widen scope (injection guard, §12).
  if (a.scopeExpansionRequested === true) reasons.push('issue-requested-scope-expansion');
  else matchedClauses.push('no-scope-expansion');

  if (reasons.length > 0) {
    return { risk: RISK.HIGH, reasons, matchedClauses, excludedSignals };
  }
  return {
    risk: RISK.LOW,
    reasons: ['all-whitelist-clauses-satisfied'],
    matchedClauses,
    excludedSignals,
  };

  function high(rs) {
    return { risk: RISK.HIGH, reasons: rs, matchedClauses: [], excludedSignals: [] };
  }
}
