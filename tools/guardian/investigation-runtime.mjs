// Runtime adapter for the investigation coordinator (Phase 9).
// Specialist/model execution is injected; this module owns the production artifact contract.

import { artifactPaths, readArtifact, writeArtifact } from './artifacts.mjs';
import { synthesizeDossier, selectSpecialists } from './investigation-coordinator.mjs';
import { validatePlan } from './plan-validator.mjs';
import { resolveBudgets } from './budgets.mjs';
import { randomUUID } from 'node:crypto';

export async function prepareInvestigation({ issue, issueData, repoDir, qaRuntimeDir = repoDir, guardianDir, issueClass, complexity, capabilities, config = {}, memoryContext = null, runSpecialist, buildPlan, state = null, round = 1, signal = null, now = () => Date.now() }) {
  const paths = artifactPaths(guardianDir, issue);
  const budgets = resolveBudgets(config, complexity);
  const investigationId = randomUUID();
  const selectedRoles = selectSpecialists({ issueClass, complexity, capabilities, config }).slice(0, budgets.max_specialists);
  if (typeof runSpecialist !== 'function') throw new Error('investigation specialist runner is not configured');
  if (typeof buildPlan !== 'function') throw new Error('investigation plan builder is not configured');

  writeArtifact(guardianDir, issue, 'issue-data', {
    issue: Number(issue),
    title: issueData?.title ?? '',
    body: issueData?.body ?? '',
  });

  // Telemetry, not a limit: record how long the investigation actually takes so future tuning is
  // evidence-based. No time budget is enforced here (budgets default to unlimited).
  const investigationStartedAt = now();
  const specialistDurations = {};
  const settled = await Promise.allSettled(selectedRoles.map(async (role) => {
    const startedAt = now();
    try {
      return await runSpecialist({
        role,
        issue,
        issueData,
        issueDataPath: paths.issue_data_path,
        repoDir,
        qaRuntimeDir,
        dossierPath: paths.dossier_path,
        timeout_ms: budgets.specialist_timeout_ms,
        state,
        round,
        memoryContext,
        signal,
      });
    } finally {
      specialistDurations[role] = now() - startedAt;
    }
  }));
  const failures = settled
    .map((result, index) => ({ result, role: selectedRoles[index] }))
    .filter((item) => item.result.status === 'rejected');
  if (failures.length > 0) {
    const first = failures[0];
    const reason = first.result.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'specialist failed');
    const error = new Error(message);
    error.cause = reason;
    error.specialist_failures = failures.map((item) => item.role);
    error.specialist_durations_ms = specialistDurations;
    throw error;
  }
  const results = settled.map((item) => item.value);
  const synthesis = synthesizeDossier({ issue, issueClass, specialistResults: results, capabilities, memoryContext });
  const dossier = { ...synthesis.dossier, investigation_id: investigationId };
  writeArtifact(guardianDir, issue, 'dossier', dossier);

  const planStartedAt = now();
  const plan = { ...(await buildPlan({ issue, dossier, hypotheses: synthesis.ranked_hypotheses, repoDir, qaRuntimeDir, memoryContext, signal })), investigation_id: investigationId };
  const planDurationMs = now() - planStartedAt;
  const planResult = validatePlan(plan, dossier);
  writeArtifact(guardianDir, issue, 'plan', plan);
  const investigationCompletedAt = now();

  return {
    ...synthesis,
    dossier,
    plan,
    planResult,
    artifact_paths: paths,
    budgets,
    specialists: selectedRoles,
    opencode: state?.opencode ?? null,
    timing: {
      investigation_started_at: new Date(investigationStartedAt).toISOString(),
      investigation_completed_at: new Date(investigationCompletedAt).toISOString(),
      investigation_duration_ms: investigationCompletedAt - investigationStartedAt,
      plan_duration_ms: planDurationMs,
      specialist_durations_ms: specialistDurations,
    },
  };
}

export function investigationArtifactsReady(guardianDir, issue) {
  return Boolean(readArtifact(guardianDir, issue, 'dossier') && readArtifact(guardianDir, issue, 'plan'));
}
