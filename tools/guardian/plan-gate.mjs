// Phase 8 plan gate adapter. Pure decision layer before a write-capable FIXING run.

import { validatePlan } from './plan-validator.mjs';

export function assessFixingEntry({ plan, dossier, investigationMode = 'legacy' }) {
  if (investigationMode === 'legacy') return { allowed: true, reason: 'legacy-mode' };
  const result = validatePlan(plan, dossier);
  if (investigationMode === 'shadow') {
    return { allowed: true, shadow: true, plan_valid: result.valid, plan_result: result };
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
