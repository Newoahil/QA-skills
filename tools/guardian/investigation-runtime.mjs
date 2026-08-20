// Runtime adapter for the investigation coordinator (Phase 9).
// Specialist/model execution is injected; this module owns the production artifact contract.

import { artifactPaths, readArtifact, writeArtifact } from './artifacts.mjs';
import { synthesizeDossier, selectSpecialists } from './investigation-coordinator.mjs';
import { validatePlan } from './plan-validator.mjs';
import { resolveBudgets } from './budgets.mjs';
import { randomUUID } from 'node:crypto';

export async function prepareInvestigation({ issue, issueData, repoDir, guardianDir, issueClass, complexity, capabilities, config = {}, memoryContext = null, runSpecialist, buildPlan, state = null, round = 1 }) {
  const paths = artifactPaths(guardianDir, issue);
  const budgets = resolveBudgets(config, complexity);
  const investigationId = randomUUID();
  const roles = selectSpecialists({ issueClass, complexity, capabilities, config });
  if (typeof runSpecialist !== 'function') throw new Error('investigation specialist runner is not configured');
  if (typeof buildPlan !== 'function') throw new Error('investigation plan builder is not configured');

  writeArtifact(guardianDir, issue, 'issue-data', {
    issue: Number(issue),
    title: issueData?.title ?? '',
    body: issueData?.body ?? '',
  });
  const results = await Promise.all(roles.slice(0, budgets.max_specialists).map((role) =>
    runSpecialist({
      role,
      issue,
      issueData,
      issueDataPath: paths.issue_data_path,
      repoDir,
      dossierPath: paths.dossier_path,
      timeout_ms: budgets.specialist_timeout_ms,
      state,
      round,
      memoryContext,
    }),
  ));
  const synthesis = synthesizeDossier({ issue, issueClass, specialistResults: results, capabilities, memoryContext });
  const dossier = { ...synthesis.dossier, investigation_id: investigationId };
  writeArtifact(guardianDir, issue, 'dossier', dossier);

  const plan = { ...(await buildPlan({ issue, dossier, hypotheses: synthesis.ranked_hypotheses, memoryContext })), investigation_id: investigationId };
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
    opencode: state?.opencode ?? null,
  };
}

export function investigationArtifactsReady(guardianDir, issue) {
  return Boolean(readArtifact(guardianDir, issue, 'dossier') && readArtifact(guardianDir, issue, 'plan'));
}
