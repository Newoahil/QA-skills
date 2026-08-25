// Decision-complete implementation plan validator (Phase 2).
// Pure gate between investigation artifacts and any write-capable FIXING phase.

import { isDecisionReady, validateDossier } from './evidence.mjs';
import { gradeRisk, RISK } from './risk.mjs';
import { parseValidatedTestPlan } from './supervisor-exec.mjs';

const REQUIRED_PLAN_FIELDS = Object.freeze([
  'root_cause',
  'affected_files',
  'non_goals',
  'test_plan',
  'test_commands',
  'acceptance_criteria',
  'rollback_plan',
  'risk',
]);

const SAFE_RELATIVE_PATH_RE = /^[A-Za-z0-9._/@+-][A-Za-z0-9._/@+\\-]*$/;

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

  let normalizedTestCommands = p.test_commands;
  let normalizedScope = null;
  if (p.test_commands !== undefined) {
    try {
      normalizedTestCommands = parseValidatedTestPlan(p.test_commands);
      normalizedScope = normalizePlanScope(p, normalizedTestCommands);
    } catch (error) {
      errors.push(`plan:test_commands:${error instanceof Error ? error.message : 'invalid'}`);
    }
  }
  for (const error of validateDeclaredFiles('primary_files', p.primary_files)) errors.push(error);
  for (const error of validateDeclaredFiles('affected_files', p.affected_files)) errors.push(error);

  const readiness = isDecisionReady(d);
  const mechanicalRisk = gradeRisk(p.risk_assessment);
  const riskMismatch = p.risk === 'LOW' && mechanicalRisk.risk !== RISK.LOW;
  const riskErrors = riskMismatch
    ? mechanicalRisk.reasons.map((reason) => `plan:risk-assessment-not-low:${reason}`)
    : [];
  const gateRequired = p.risk === 'HIGH' || riskMismatch || !readiness.ready || errors.length > 0;
  return {
    valid: errors.length === 0,
    autonomousReady: errors.length === 0 && p.risk === 'LOW' && mechanicalRisk.risk === RISK.LOW && readiness.ready,
    gateRequired,
    errors: [...errors, ...riskErrors],
    mechanicalRisk,
    plan: errors.length === 0 ? { ...p, ...(normalizedTestCommands ? { test_commands: normalizedTestCommands } : {}), ...(normalizedScope ? { affected_files: normalizedScope } : {}) } : null,
  };
}

function normalizePlanScope(plan, testCommands) {
  const files = [];
  for (const value of [...pathList(plan.affected_files), ...pathList(plan.primary_files), ...testFilesFromCommands(testCommands)]) {
    if (!files.includes(value)) files.push(value);
  }
  return files;
}

function pathList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    const candidate = item.path ?? item.file ?? item.file_path;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }).filter(Boolean);
}

function testFilesFromCommands(commands) {
  const files = [];
  for (const command of Array.isArray(commands) ? commands : []) {
    for (let index = 1; index < command.length; index += 1) {
      const arg = command[index];
      if (typeof arg === 'string' && (arg.endsWith('.test.mjs') || arg.endsWith('.test.js') || arg.endsWith('.js'))) files.push(arg);
    }
  }
  return files;
}

function validateDeclaredFiles(field, value) {
  return pathList(value)
    .filter((item) => !isSafeRelativePath(item))
    .map((item) => `plan:unsafe-${field}:${item}`);
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('..')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && SAFE_RELATIVE_PATH_RE.test(value);
}

export function canEnterFixing(plan, dossier) {
  const result = validatePlan(plan, dossier);
  return result.autonomousReady || (result.valid && result.gateRequired === false);
}
