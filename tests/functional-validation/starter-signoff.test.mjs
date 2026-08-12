import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Deterministic end-to-end behavior test for the beginner starter flow and the one-page
// sign-off. It does not call a model. It parses the real template/reference and validates a
// filled sign-off against the load-bearing contract: four canonical statuses only, sign-off
// mirrors the authoritative report's Overall Status, never invents a verdict, no-evidence-no-PASS,
// and the starter flow keeps its 5 steps plus escalation to Full.

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const packRoot = path.join(repositoryRoot, 'qa-skill');
const starterFlowPath = path.join(packRoot, 'references', 'qa-starter-flow.md');
const signoffTemplatePath = path.join(packRoot, 'templates', 'qa-signoff.md');

const CANONICAL_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);

function read(filePath) {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

// --- Lightweight structural parsers (self-contained, deterministic) ----------

function markdownSections(markdown) {
  const sections = new Map();
  let current = null;
  const buffer = [];
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      if (current !== null) sections.set(current, buffer.join('\n').trim());
      current = heading[1].trim();
      buffer.length = 0;
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) sections.set(current, buffer.join('\n').trim());
  return sections;
}

function tableRows(sectionText) {
  return sectionText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|$/.test(line))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
}

function signoffOverallStatus(signoffMarkdown) {
  const sections = markdownSections(signoffMarkdown);
  const summary = sections.get('Summary') || '';
  for (const cells of tableRows(summary)) {
    if (/overall status/i.test(cells[0] || '')) {
      const match = /(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)/.exec(cells[1] || '');
      return match ? match[1] : null;
    }
  }
  return null;
}

function authoritativeOverallStatus(reportMarkdown) {
  const match = /^Overall Status:\s*(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\s*$/m.exec(reportMarkdown);
  return match ? match[1] : null;
}

// Validate a filled sign-off against a filled authoritative report.
function validateSignoff({ signoff, authoritativeReport }) {
  const issues = [];
  const sections = markdownSections(signoff);

  const requiredSections = ['Summary', 'Tested vs Not Tested', 'Findings', 'Residual Risk', 'Recommendation (Not A Decision)', 'Integrity'];
  for (const name of requiredSections) {
    if (!sections.has(name)) issues.push(`missing section: ${name}`);
  }

  const signoffStatus = signoffOverallStatus(signoff);
  const reportStatus = authoritativeOverallStatus(authoritativeReport);
  if (!signoffStatus) issues.push('sign-off has no canonical Overall status');
  if (!reportStatus) issues.push('authoritative report has no canonical Overall Status');
  if (signoffStatus && !CANONICAL_STATUSES.includes(signoffStatus)) issues.push(`non-canonical sign-off status ${signoffStatus}`);
  if (signoffStatus && reportStatus && signoffStatus !== reportStatus) {
    issues.push(`sign-off status ${signoffStatus} does not mirror authoritative ${reportStatus}`);
  }

  // no-evidence-no-PASS: a PASS sign-off must show at least one Tested=Yes row with an evidence ref.
  if (signoffStatus === 'PASS') {
    const tested = tableRows(sections.get('Tested vs Not Tested') || '');
    const passEvidenceRow = tested.some((cells) => /^yes$/i.test(cells[1] || '') && /\S/.test(cells[2] || '') && !/^n\/?a$/i.test(cells[2] || ''));
    if (!passEvidenceRow) issues.push('PASS sign-off must cite at least one tested row with a real evidence reference');
  }

  // recommendation must not be a release decision
  const recommendation = sections.get('Recommendation (Not A Decision)') || '';
  if (/\b(approve release|release approved|ship it now|final release decision by qa|qa approves release)\b/i.test(recommendation)) {
    issues.push('recommendation must not act as a release decision');
  }

  return { ok: issues.length === 0, issues, signoffStatus, reportStatus };
}

// --- Fixtures ----------------------------------------------------------------

const authoritativeFailReport = `# QA Report

Some content.

Overall Status: FAIL
`;

const goodFailSignoff = `# QA Sign-Off (One Page)

## Summary

| Field | Record |
|---|---|
| Product target | src/order |
| Scope | order status update path |
| Out of scope | unrelated UI |
| Overall status | FAIL |

## Tested vs Not Tested

| Area | Tested? | Evidence reference | Note |
|---|---|---|---|
| order status persistence | Yes | E-001 | value written correctly |
| cache refresh after update | Yes | E-002 | cache still stale |

## Findings

| Finding ID | Severity | Status | Evidence reference | One-line summary |
|---|---|---|---|---|
| F-001 | high | FAIL | E-002 | cache returns stale status after update |

## Residual Risk

| Residual risk | Why it remains | Suggested follow-up |
|---|---|---|
| concurrency | not covered | add concurrent update test |

## Recommendation (Not A Decision)

- Hold until the cache regression is fixed. This is a recommendation only; the owner decides release.

## Integrity

- Overall status here matches the authoritative report.
`;

const authoritativePassReport = `# QA Report

Overall Status: PASS
`;

const passSignoffNoEvidence = goodFailSignoff
  .replace('| Overall status | FAIL |', '| Overall status | PASS |')
  .replace('| order status persistence | Yes | E-001 | value written correctly |', '| order status persistence | Yes |  | claimed fine |')
  .replace('| cache refresh after update | Yes | E-002 | cache still stale |', '| cache refresh after update | No | N/A | not run |');

// --- Tests -------------------------------------------------------------------

test('SS-STARTER-001 starter flow keeps the 5 steps, hard rules, and escalation', () => {
  const flow = read(starterFlowPath);
  assert.match(flow, /\*\*Scope\*\*[\s\S]{0,400}\*\*Risk\*\*[\s\S]{0,400}\*\*Checks\*\*[\s\S]{0,400}\*\*Evidence\*\*[\s\S]{0,400}\*\*Verdict\*\*/, 'missing 5-step flow');
  assert.match(flow, /No\s+evidence,?\s+no\s+PASS/i, 'missing no-evidence-no-PASS');
  assert.match(flow, /read-only/i, 'missing read-only rule');
  assert.match(flow, /BLOCKED\s+is\s+not\s+FAIL/i, 'missing BLOCKED vs FAIL');
  for (const status of CANONICAL_STATUSES) assert.match(flow, new RegExp(status), `missing status ${status}`);
  assert.match(flow, /escalate\s+to\s+Full|graduate\s+to\s+Full|Full\s+QA/i, 'missing escalation to Full');
});

test('SS-SIGNOFF-002 template exposes the required sign-off sections and boundaries', () => {
  const template = read(signoffTemplatePath);
  const sections = markdownSections(template);
  for (const name of ['Summary', 'Tested vs Not Tested', 'Findings', 'Residual Risk', 'Recommendation (Not A Decision)', 'Integrity']) {
    assert.ok(sections.has(name), `template missing section ${name}`);
  }
  assert.match(template, /never invents a verdict/i, 'template must forbid inventing a verdict');
  assert.match(template, /not a release decision|recommendation only/i, 'template must state recommendation is not a release decision');
  assert.match(template, /must match the authoritative report/i, 'template must require mirroring the authoritative report');
});

test('SS-SIGNOFF-003 a well-formed sign-off mirrors the authoritative FAIL report', () => {
  const result = validateSignoff({ signoff: goodFailSignoff, authoritativeReport: authoritativeFailReport });
  assert.deepEqual(result.issues, [], `unexpected issues: ${result.issues.join('; ')}`);
  assert.equal(result.ok, true);
  assert.equal(result.signoffStatus, 'FAIL');
  assert.equal(result.reportStatus, 'FAIL');
});

test('SS-SIGNOFF-004 a mismatched verdict is rejected (no invented verdict)', () => {
  const mismatched = goodFailSignoff.replace('| Overall status | FAIL |', '| Overall status | PASS |');
  const result = validateSignoff({ signoff: mismatched, authoritativeReport: authoritativeFailReport });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /does not mirror authoritative/.test(i)), `expected mirror mismatch, got: ${result.issues.join('; ')}`);
});

test('SS-SIGNOFF-005 a PASS sign-off without cited evidence is rejected (no-evidence-no-PASS)', () => {
  const result = validateSignoff({ signoff: passSignoffNoEvidence, authoritativeReport: authoritativePassReport });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /must cite at least one tested row/.test(i)), `expected evidence requirement, got: ${result.issues.join('; ')}`);
});

test('SS-SIGNOFF-006 a recommendation acting as a release decision is rejected', () => {
  const releasing = goodFailSignoff.replace(
    '- Hold until the cache regression is fixed. This is a recommendation only; the owner decides release.',
    '- QA approves release and ship it now.',
  );
  const result = validateSignoff({ signoff: releasing, authoritativeReport: authoritativeFailReport });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /must not act as a release decision/.test(i)), `expected release-decision rejection, got: ${result.issues.join('; ')}`);
});
