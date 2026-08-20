// QA Guardian — Supervisor verdict-comment builder (§3A comment protocol, pure).
//
// The Supervisor is the SOLE writer of the [QA_VERIFIED] / [QA_FAILED] verification comment
// (docs/qa-guardian-role-architecture.md §3). QA produces only a local qa-verdict.json; the Fixer
// writes fix-trace comments but NEVER the verdict comment. This module builds the exact wire format:
// a marker line + human-readable QA acceptance details + a fenced JSON metadata envelope with
// allow-listed keys only (no code, no diffs, no secrets — only a report_hash fingerprint).
//
// Everything here is PURE (string in → string out); delivery lives in the scheduler via an injected
// gh-comment channel, exactly like notify.mjs vs notify-io.mjs.

import crypto from 'node:crypto';

export const PROTOCOL = 'qa-guardian/v1';

// Marker vocabulary (§3A.1). Only QA_VERIFIED / QA_FAILED are emitted in Phase 2, and only by the
// Supervisor. FIXER_* markers are RESERVED for Phase 3 and must not be emitted by Phase 2 code.
export const MARKERS = Object.freeze({
  QA_VERIFIED: 'QA_VERIFIED',
  QA_FAILED: 'QA_FAILED',
});

export const RESERVED_MARKERS = Object.freeze(['FIXER_PR_OPENED']);

// Keys allowed in the JSON metadata envelope. Anything else is a leak risk and is rejected.
const ALLOWED_META_KEYS = Object.freeze([
  'protocol', 'marker', 'agent', 'issue', 'status', 'branch', 'pr_url',
  'run_id', 'attempt', 'report_hash', 'verified_at',
]);

const HUMAN_LINE = Object.freeze({
  QA_VERIFIED: (issue) => `QA Guardian: issue #${issue} 独立 QA 通过，已开 PR 待人工评审。`,
  QA_FAILED: (issue, reason) =>
    `QA Guardian: issue #${issue} 独立 QA 未通过（${reason ?? 'unapproved'}），未开 PR。`,
});

function detailLines(marker, args) {
  if (typeof args.qaAcceptanceMarkdown === 'string' && args.qaAcceptanceMarkdown.trim().length > 0) {
    return ['', args.qaAcceptanceMarkdown.trim()];
  }
  const status = args.status ?? 'UNKNOWN';
  const branch = args.branch ?? 'unknown';
  const attempt = Number.isInteger(args.attempt) ? args.attempt : 1;
  if (marker === MARKERS.QA_VERIFIED) {
    return [
      '',
      '## QA 验收结论',
      '',
      `- 状态：Overall Status: ${status}`,
      `- PR：${args.prUrl ?? 'missing'}`,
      `- PR 标题：${args.prTitle ?? '未提供'}`,
      `- 分支：${branch}`,
      `- 验收轮次：${attempt}`,
      `- QA 报告指纹：${args.reportHash ?? 'missing'}`,
      '',
      '## 下一步',
      '',
      '- 请人工评审 PR；QA Guardian 不会自动合并、关闭 issue 或执行发布。',
      '- 如需返工，请由可信维护者在 issue 中发起 rework 流程。',
    ];
  }
  return [
    '',
    '## QA 验收结论',
    '',
    `- 状态：Overall Status: ${status}`,
    `- 分支：${branch}`,
    `- 验收轮次：${attempt}`,
    `- 未开 PR，原因：${args.reason ?? 'unapproved'}`,
    `- QA 报告指纹：${args.reportHash ?? 'missing'}`,
  ];
}

/**
 * Map an audited qa-verdict status/outcome to the protocol marker.
 * PASS-and-approved → QA_VERIFIED; everything else (FAIL/BLOCKED/NHR/missing/invalid) → QA_FAILED.
 */
export function markerForApproval(approved) {
  return approved ? MARKERS.QA_VERIFIED : MARKERS.QA_FAILED;
}

/**
 * Build a Supervisor verdict comment.
 * @param {object} args
 *   marker      'QA_VERIFIED' | 'QA_FAILED'
 *   issue       number
 *   status      one of the qa-verdict statuses (PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW) or null
 *   branch      fix branch or null
 *   prUrl       PR url (QA_VERIFIED) or null
 *   prTitle     PR title for the human-readable section only; not persisted in metadata
 *   qaAcceptanceMarkdown  agent-written Chinese QA acceptance text for the human-readable section
 *   runId       correlation id or null
 *   attempt     fix round / attempt number (default 1)
 *   reportHash  qa report hash fingerprint (sha256:…) or null
 *   verifiedAt  ISO timestamp (default now)
 *   reason      short reason keyword for QA_FAILED (never free-form human text)
 * @returns {string} the full comment body (marker line + human-readable details + fenced JSON)
 */
export function buildVerdictComment(args) {
  const marker = args.marker;
  if (marker !== MARKERS.QA_VERIFIED && marker !== MARKERS.QA_FAILED) {
    throw new Error(`buildVerdictComment: unsupported marker ${JSON.stringify(marker)}`);
  }
  const issue = Number(args.issue);
  if (!Number.isInteger(issue)) throw new Error('buildVerdictComment: issue must be an integer');

  const meta = {
    protocol: PROTOCOL,
    marker,
    agent: 'guardian-supervisor',
    issue,
    status: args.status ?? null,
    branch: args.branch ?? null,
    pr_url: args.prUrl ?? null,
    run_id: args.runId ?? null,
    attempt: Number.isInteger(args.attempt) ? args.attempt : 1,
    report_hash: args.reportHash ?? null,
    verified_at: args.verifiedAt ?? new Date().toISOString(),
  };
  assertSafeMeta(meta);

  const sentence = marker === MARKERS.QA_VERIFIED
    ? HUMAN_LINE.QA_VERIFIED(issue)
    : HUMAN_LINE.QA_FAILED(issue, args.reason);

  const humanDetails = detailLines(marker, args).join('\n');
  const body = `[${marker}]\n${sentence}${humanDetails}\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n`;

  // Defense in depth: a verdict comment must never be re-parsable as a /guardian authorization
  // command (§3A.3). Assert it here so a malformed builder change fails loudly, not silently.
  assertMarkerIsNotCommand(body);
  return body;
}

// Guard against leaking anything beyond the allow-listed metadata keys (mirrors notify.assertSafeBody).
export function assertSafeMeta(meta) {
  const extra = Object.keys(meta).filter((k) => !ALLOWED_META_KEYS.includes(k));
  if (extra.length > 0) {
    throw new Error(`verdict metadata has disallowed keys: ${extra.join(', ')}`);
  }
  return true;
}

// The /guardian command grammar (commands.mjs LINE_RE) matches, per line:
//   ^\s*/guardian\s+(<verb>)\b ...
// A protocol comment must contain NO such line, so a status fact can never be re-parsed as an
// authorization command. This is a self-check for the builder output (§3A.3).
const GUARDIAN_COMMAND_LINE = /^\s*\/guardian\s+\S/i;
export function assertMarkerIsNotCommand(commentBody) {
  if (typeof commentBody !== 'string') throw new Error('assertMarkerIsNotCommand: body must be a string');
  for (const line of commentBody.split(/\r?\n/)) {
    if (GUARDIAN_COMMAND_LINE.test(line)) {
      throw new Error('verdict comment contains a /guardian command line (injection-safety violation)');
    }
  }
  return true;
}

// Stable hash of a comment body for idempotency (last_verdict_comment_hash).
export function hashVerdictComment(body) {
  return `sha256:${crypto.createHash('sha256').update(String(body), 'utf8').digest('hex')}`;
}
