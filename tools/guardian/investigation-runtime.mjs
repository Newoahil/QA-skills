// Runtime adapter for the investigation coordinator (Phase 9).
// Specialist/model execution is injected; this module owns the production artifact contract.

import { artifactPaths, readArtifact, writeArtifact } from './artifacts.mjs';
import { synthesizeDossier, selectSpecialists } from './investigation-coordinator.mjs';
import { validatePlan } from './plan-validator.mjs';
import { resolveBudgets } from './budgets.mjs';
import { randomUUID } from 'node:crypto';

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

function copyJsonParseDiagnostics(target, source) {
  if (source?.name !== 'InvestigationJsonParseError') return target;
  target.name = source.name;
  for (const key of [
    'json_phase',
    'role',
    'json_source',
    'parse_error_message',
    'output_bytes',
    'output_preview',
    'prompt_response',
    'retry_count',
    'previous_parse_errors',
  ]) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return target;
}

export async function prepareInvestigation({ issue, issueData, repoDir, qaRuntimeDir = repoDir, guardianDir, issueClass, complexity, capabilities, config = {}, agentRegistry, memoryContext = null, runSpecialist, buildPlan, state = null, round = 1, signal = null, now = () => Date.now(), logger = NOOP_LOGGER }) {
  const paths = artifactPaths(guardianDir, issue);
  const budgets = resolveBudgets(config, complexity);
  const investigationId = randomUUID();
  const selectedRoles = selectSpecialists({ issueClass, complexity, capabilities, config, agentRegistry }).slice(0, budgets.max_specialists);
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
  logger.info('investigation.begin', { issue, roles: selectedRoles.join(','), count: selectedRoles.length });
  const settled = await Promise.allSettled(selectedRoles.map(async (role) => {
    const startedAt = now();
    logger.info('specialist.begin', { issue, role, round });
    try {
      const result = await runSpecialist({
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
      logger.info('specialist.ok', { issue, role, duration_ms: now() - startedAt });
      return result;
    } catch (error) {
      logger.warn('specialist.failed', { issue, role, duration_ms: now() - startedAt, error_message: error instanceof Error ? error.message : 'unknown' });
      throw error;
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
    const error = copyJsonParseDiagnostics(new Error(message), reason);
    error.cause = reason;
    error.specialist_failures = failures.map((item) => item.role);
    error.specialist_durations_ms = specialistDurations;
    throw error;
  }
  const results = settled.map((item) => item.value);
  const synthesis = synthesizeDossier({ issue, issueClass, specialistResults: results, capabilities, memoryContext });
  if (!synthesis.validation.valid) {
    throw new Error(`generated dossier is structurally invalid: ${synthesis.validation.errors.join(',')}`);
  }
  const dossier = { ...synthesis.dossier, investigation_id: investigationId };
  writeArtifact(guardianDir, issue, 'dossier', dossier);

  const planStartedAt = now();
  logger.info('plan.begin', { issue });
  const plan = { ...(await buildPlan({ issue, dossier, hypotheses: synthesis.ranked_hypotheses, repoDir, qaRuntimeDir, memoryContext, signal })), investigation_id: investigationId };
  const planDurationMs = now() - planStartedAt;
  const planResult = validatePlan(plan, dossier);
  if (!planResult.valid) {
    // Persist the rejected plan as a diagnostic sidecar so the operator can inspect exactly what the
    // model produced (e.g. test_commands argv) instead of guessing from the error string.
    writeArtifact(guardianDir, issue, 'plan-invalid', plan);
    throw new Error(`generated plan is structurally invalid: ${planResult.errors.join(',')}`);
  }
  logger.info('plan.ok', { issue, duration_ms: planDurationMs, valid: planResult.valid });
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
