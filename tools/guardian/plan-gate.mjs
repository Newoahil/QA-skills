// Phase 8 plan gate adapter. Pure decision layer before a write-capable FIXING run.

import { validatePlan } from './plan-validator.mjs';

export function assessFixingEntry({
  plan, dossier, investigationMode = 'legacy', humanApproved = false,
  currentPlanHash = null, currentPlanRevision = null,
  approvedPlanHash = null, approvedPlanRevision = null,
}) {
  if (investigationMode === 'legacy') return { allowed: true, reason: 'legacy-mode' };
  const result = validatePlan(plan, dossier);
  if (investigationMode === 'shadow') {
    return { allowed: true, shadow: true, plan_valid: result.valid, plan_result: result };
  }
  const approvalMatches = Boolean(
    humanApproved
    && currentPlanHash
    && currentPlanRevision
    && approvedPlanHash === currentPlanHash
    && approvedPlanRevision === currentPlanRevision,
  );
  if (result.autonomousReady) {
    return { allowed: true, shadow: false, plan_result: result };
  }
  if (result.valid && humanApproved && !approvalMatches) {
    return { allowed: false, shadow: false, reason: 'gate1-approval-mismatch', plan_result: result };
  }
  if (result.valid && approvalMatches) {
    return { allowed: true, shadow: false, human_approved: true, plan_result: result };
  }
  if (!result.valid || !result.autonomousReady) {
    return { allowed: false, reason: 'plan-not-autonomous-ready', plan_result: result };
  }
  return { allowed: true, shadow: false, plan_result: result };
}

export function fixingPromptContext({ plan, dossier, mode }) {
  const gate = assessFixingEntry({ plan, dossier, investigationMode: mode });
  return {
    gate,
    can_edit: gate.allowed && gate.shadow !== true,
    requires_gate1: !gate.allowed || gate.shadow === true,
  };
}
