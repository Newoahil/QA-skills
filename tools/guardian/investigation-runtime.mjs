// Runtime adapter for the investigation coordinator (Phase 9).
// Specialist/model execution is injected; this module owns the production artifact contract.

import { artifactPaths, readArtifact, writeArtifact } from './artifacts.mjs';
import { synthesizeDossier, selectSpecialists } from './investigation-coordinator.mjs';
import { validatePlan } from './plan-validator.mjs';
import { resolveBudgets } from './budgets.mjs';
import { randomUUID } from 'node:crypto';

export async function prepareInvestigation({ issue, repoDir, guardianDir, issueClass, complexity, capabilities, config = {}, runSpecialist, buildPlan }) {
  const paths = artifactPaths(guardianDir, issue);
  const budgets = resolveBudgets(config, complexity);
  const investigationId = randomUUID();
  const roles = selectSpecialists({ issueClass, complexity, capabilities });
  if (typeof runSpecialist !== 'function') throw new Error('investigation specialist runner is not configured');
  if (typeof buildPlan !== 'function') throw new Error('investigation plan builder is not configured');

  const results = await Promise.all(roles.slice(0, budgets.max_specialists).map((role) =>
    runSpecialist({ role, issue, repoDir, dossierPath: paths.dossier_path, timeout_ms: budgets.specialist_timeout_ms }),
  ));
  const synthesis = synthesizeDossier({ issue, issueClass, specialistResults: results, capabilities });
  const dossier = { ...synthesis.dossier, investigation_id: investigationId };
  writeArtifact(guardianDir, issue, 'dossier', dossier);

  const plan = { ...(await buildPlan({ issue, dossier, hypotheses: synthesis.ranked_hypotheses })), investigation_id: investigationId };
  const planResult = validatePlan(plan, dossier);
  writeArtifact(guardianDir, issue, 'plan', plan);

  return {
    ...synthesis,
    dossier,
    plan,
    planResult,
    artifact_paths: paths,
    budgets,
    specialists: roles,
  };
}

export function investigationArtifactsReady(guardianDir, issue) {
  return Boolean(readArtifact(guardianDir, issue, 'dossier') && readArtifact(guardianDir, issue, 'plan'));
}
