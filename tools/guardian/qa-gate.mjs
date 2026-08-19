// Pre-PR QA gate. The PR creator must call this contract after independent qa has produced
// qa-verdict.json; missing/stale/mismatched/non-PASS verdicts are never shippable.

import { auditQaVerdict } from './qa-verdict.mjs';

export function canCreatePr({ verdict, issue, branch, planHash, expectedPlanHash, expectedPlanRevision }) {
  const audit = auditQaVerdict(verdict, { issue, branch });
  const errors = [...audit.validation.errors];
  if (expectedPlanHash && verdict?.plan_hash !== expectedPlanHash) errors.push('plan-hash-mismatch');
  if (expectedPlanRevision && verdict?.plan_revision !== expectedPlanRevision) errors.push('plan-revision-mismatch');
  return {
    allowed: audit.approved && errors.length === 0,
    errors,
    reason: errors.length > 0 ? 'qa-gate-rejected' : 'qa-pass',
  };
}
