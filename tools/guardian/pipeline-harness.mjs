// Injected end-to-end pipeline harness (Phase 9).
// Models the control-plane contract without real GitHub/Feishu/opencode side effects.

import { synthesizeDossier } from './investigation-coordinator.mjs';
import { validatePlan } from './plan-validator.mjs';
import { assessFixingEntry } from './plan-gate.mjs';

export async function runInjectedPipeline({ issue, issueClass, specialistResults, plan, qaVerdict, capabilities = {} }) {
  const synthesis = synthesizeDossier({ issue, issueClass, specialistResults, capabilities });
  const planResult = validatePlan(plan, synthesis.dossier);
  const gate = assessFixingEntry({ plan, dossier: synthesis.dossier, investigationMode: 'enforced' });
  if (!gate.allowed) return { stage: 'GATE_1_WAIT', synthesis, planResult, gate, qaVerdict: null, pr: null };
  if (qaVerdict !== 'PASS') return { stage: 'HANDED_BACK', synthesis, planResult, gate, qaVerdict, pr: null };
  return { stage: 'GATE_2_WAIT', synthesis, planResult, gate, qaVerdict, pr: { issue, base: 'dev', merged: false } };
}
