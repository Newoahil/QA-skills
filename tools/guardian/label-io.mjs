// Scheduler-owned GitHub label projection. Labels are a visible projection only; JSON state is
// authoritative. Optional projection failures never block the Guardian workflow.

import { spawnSync } from 'node:child_process';
import { assertActorMayPerform, EFFECTS } from './actor-routing.mjs';
import { ACTIVE_STATES } from './state.mjs';

export const PROJECTED_LABELS = Object.freeze([
  'qa-guardian:bug',
  'qa-guardian:request',
  'qa-guardian:doing',
  'qa-guardian:risk-high',
  'qa-guardian:risk-low',
  'qa-guardian:gate-1',
  'qa-guardian:gate-2',
  'qa-guardian:handed-back',
]);

export function labelsForState(record) {
  const labels = [];
  if (record?.issue_class === 'bug') labels.push('qa-guardian:bug');
  if (record?.issue_class === 'request') labels.push('qa-guardian:request');
  if (ACTIVE_STATES.includes(record?.state)) labels.push('qa-guardian:doing');
  if (record?.risk === 'HIGH') labels.push('qa-guardian:risk-high');
  if (record?.risk === 'LOW') labels.push('qa-guardian:risk-low');
  if (record?.state === 'GATE_1_WAIT') labels.push('qa-guardian:gate-1');
  if (record?.state === 'GATE_2_WAIT') labels.push('qa-guardian:gate-2');
  if (record?.state === 'HANDED_BACK') labels.push('qa-guardian:handed-back');
  return labels;
}

export function projectLabels(repoDir, issue, record, run = spawnSync, actor) {
  assertActorMayPerform(actor, EFFECTS.LABEL);
  const desired = new Set(labelsForState(record));
  const add = [...desired];
  const remove = PROJECTED_LABELS.filter((label) => !desired.has(label));
  const errors = [];

  for (const label of add) {
    const result = run('gh', ['issue', 'edit', String(issue), '--add-label', label], {
      cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
    });
    if (result.status !== 0) errors.push({ operation: 'add', label, error: result.stderr || 'failed' });
  }
  for (const label of remove) {
    const result = run('gh', ['issue', 'edit', String(issue), '--remove-label', label], {
      cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
    });
    // Missing labels are non-fatal: projection is best effort.
    if (result.status !== 0 && !String(result.stderr).toLowerCase().includes('not found')) {
      errors.push({ operation: 'remove', label, error: result.stderr || 'failed' });
    }
  }
  return { add, remove, errors };
}
