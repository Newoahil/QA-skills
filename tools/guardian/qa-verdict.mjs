// Machine-readable independent QA verdict contract.
// The read-only qa agent's prose remains human-readable; the Guardian must materialize the
// exact Overall Status into this artifact before it is allowed to describe a PR as QA-approved.

import crypto from 'node:crypto';

export const QA_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);

export function hashQaReport(report) {
  return `sha256:${crypto.createHash('sha256').update(String(report), 'utf8').digest('hex')}`;
}

export function buildQaVerdict(report, context = {}) {
  return {
    issue: Number(context.issue),
    branch: context.branch ?? null,
    status: parseOverallStatus(report) ?? 'NEEDS_HUMAN_REVIEW',
    verified_at: context.verified_at ?? new Date().toISOString(),
    report_hash: hashQaReport(report),
    evidence_summary: context.evidence_summary ?? null,
    ...(context.plan_hash ? { plan_hash: context.plan_hash } : {}),
    ...(context.plan_revision ? { plan_revision: context.plan_revision } : {}),
  };
}

export function parseOverallStatus(report) {
  if (typeof report !== 'string') return null;
  const match = report.match(/^\s*Overall Status:\s*(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\s*$/im);
  return match ? match[1] : null;
}

export function validateQaVerdict(verdict, expected = {}) {
  const errors = [];
  if (!verdict || typeof verdict !== 'object') return { valid: false, errors: ['verdict-not-object'] };
  if (!QA_STATUSES.includes(verdict.status)) errors.push('invalid-status');
  if (verdict.issue !== Number(expected.issue)) errors.push('issue-mismatch');
  if (expected.branch && verdict.branch !== expected.branch) errors.push('branch-mismatch');
  if (!verdict.verified_at) errors.push('missing-verified-at');
  if (verdict.status === 'PASS' && !verdict.report_hash) errors.push('pass-missing-report-hash');
  return { valid: errors.length === 0, errors };
}

export function canOpenPr(verdict, expected = {}) {
  const result = validateQaVerdict(verdict, expected);
  return result.valid && verdict.status === 'PASS';
}

export function auditQaVerdict(verdict, expected = {}) {
  if (!verdict) return { approved: false, reason: 'missing-qa-verdict', validation: { valid: false, errors: ['missing-verdict'] } };
  const validation = validateQaVerdict(verdict, expected);
  if (!validation.valid) return { approved: false, reason: 'invalid-qa-verdict', validation };
  if (verdict.status !== 'PASS') return { approved: false, reason: `qa-status-${verdict.status}`, validation };
  return { approved: true, reason: 'qa-pass', validation };
}
