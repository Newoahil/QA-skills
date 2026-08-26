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

// Reject NUL/control chars, DEL, and any whitespace (anti-prose + anti-ambiguity). Allows CJK/Unicode letters.
const UNSAFE_PATH_CHAR_RE = /[\u0000-\u001F\u007F\s]/u;
// Shell/glob metacharacters that a legitimate repo path never needs. Paths are passed as argv (not a
// shell string), but plan data can appear in logs/errors and future commands, so keep them out.
const UNSAFE_PATH_METACHAR_RE = /[<>"'`|;&$!*?[\]{}()]/u;
// "Looks like a path": contains a directory separator OR ends with a file extension. This is what
// distinguishes a real declared file (docs/短信/....md) from CJK prose masquerading as a path.
const PATH_LIKE_EXTENSION_RE = /\.[^./]+$/u;

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
  const primaryFiles = declaredPathList(p.primary_files);
  if (p.test_commands !== undefined) {
    try {
      normalizedTestCommands = parseValidatedTestPlan(p.test_commands);
      normalizedScope = normalizePlanScope(p, normalizedTestCommands, primaryFiles);
    } catch (error) {
      errors.push(`plan:test_commands:${error instanceof Error ? error.message : 'invalid'}`);
    }
  }
  for (const error of validateDeclaredFiles('primary_files', primaryFiles)) errors.push(error);
  const affectedFiles = declaredPathList(p.affected_files);
  for (const error of validateDeclaredFiles('affected_files', affectedFiles)) errors.push(error);

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

function normalizePlanScope(plan, testCommands, primaryFiles = declaredPathList(plan.primary_files)) {
  const files = [];
  for (const value of [...declaredPathList(plan.affected_files), ...primaryFiles, ...testFilesFromCommands(testCommands)]) {
    if (!files.includes(value)) files.push(value);
  }
  return files;
}

export function declaredPathList(value) {
  return pathList(value).map(normalizeDeclaredPath).filter(Boolean);
}

function normalizeDeclaredPath(value) {
  return value
    .split('（', 1)[0]
    .split('(', 1)[0]
    .split('：', 1)[0]
    .split(': ', 1)[0]
    .trim();
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
  if (typeof value !== 'string') return false;
  const path = value.trim().replaceAll('\\', '/');
  if (path.length === 0) return false;
  // Absolute paths and Windows drive paths (check the raw value for the drive form).
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  // Segment-based traversal / empty-segment rejection (stricter than substring `..`:
  // `docs/v1..notes.md` is a valid filename, while `../x` and `a/../x` are traversal).
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  // Reject control chars, DEL, whitespace, and shell/glob metacharacters (allows CJK/Unicode letters).
  if (UNSAFE_PATH_CHAR_RE.test(path)) return false;
  if (UNSAFE_PATH_METACHAR_RE.test(path)) return false;
  // Must look like a repo path, not prose: either has a separator or a file extension.
  if (!path.includes('/') && !PATH_LIKE_EXTENSION_RE.test(path)) return false;
  return true;
}

export function canEnterFixing(plan, dossier) {
  const result = validatePlan(plan, dossier);
  return result.autonomousReady || (result.valid && result.gateRequired === false);
}
