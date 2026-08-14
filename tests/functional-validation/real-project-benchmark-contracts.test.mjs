import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BENCHMARK_RUBRIC,
  compareArmScorecards,
  validateBenchmarkManifest,
  validateScorecard,
} from './real-project-benchmark-contracts.mjs';

const sha40 = '0123456789abcdef0123456789abcdef01234567';
const sha40b = 'abcdef0123456789abcdef0123456789abcdef01';
const hash64 = 'a'.repeat(64);
const hash64b = 'b'.repeat(64);
const validApproval = Object.freeze({ approvedBy: 'qa-benchmark-reviewer', approvedAt: '2026-08-04T00:00:00.000Z' });

function snapshot(id, verdict, path, commitSha = sha40, treeSha256 = hash64) {
  return {
    snapshotId: id,
    commitSha,
    localSnapshot: path,
    treeSha256,
    expectedVerdict: verdict,
    directArgvArrays: [['node', '--test', 'test/fictional-case.test.mjs']],
    prerequisites: ['already-installed-node'],
  };
}

function pair(pairId, stack = 'node', overrides = {}) {
  return {
    pairId,
    caseType: 'real-issue-pre-post',
    repositoryUrl: `https://${pairId}.example.invalid/fictional/project`,
    repositoryLicense: 'MIT',
    publicIssueUrl: `https://${pairId}.example.invalid/issues/123`,
    publicIssueTitle: 'Fictional public issue title',
    request: 'Evaluate the fictional issue fix without changing project files.',
    stack,
    acceptanceEvidence: 'Fictional issue states the failing behavior and the merged fix verifies it.',
    expectedRisks: ['risk-fictional-regression'],
    expectedModules: ['module-fictional-core'],
    expectedFlows: ['flow-fictional-request'],
    prohibitedActions: ['do-not-install-dependencies'],
    preSnapshot: snapshot(`${pairId}-pre`, 'FAIL', `snapshots/${pairId}/pre`, sha40, hash64),
    postSnapshot: snapshot(`${pairId}-post`, 'PASS', `snapshots/${pairId}/post`, sha40b, hash64b),
    syntheticOrFaultInjection: false,
    ...overrides,
  };
}

function manifest(overrides = {}) {
  const runConfig = { model: 'cpa/gpt-5.5', agent: 'general', timeoutMs: 120000, budget: { maxRuns: 2, maxCostUsd: 1 } };
  return {
    schemaVersion: 'phase2-real-project-benchmark-v1',
    status: 'draft',
    runConfig,
    arms: {
      baseline: { armId: 'baseline', skillLoaded: false, primaryRuns: [{ runId: 'run-baseline-primary', primary: true, silentRerun: false, ...runConfig }] },
      skill: { armId: 'skill', skillLoaded: true, primaryRuns: [{ runId: 'run-skill-primary', primary: true, silentRerun: false, ...runConfig }] },
    },
    pairs: [pair('fictional-node-1')],
    ...overrides,
  };
}

function scorecard(overrides = {}) {
  const dimensions = Object.fromEntries(Object.entries(BENCHMARK_RUBRIC).map(([dimension, weight]) => [dimension, { score: weight, evidenceIds: [`E-${dimension}`] }]));
  return {
    armId: 'skill',
    pairId: 'fictional-node-1',
    snapshotId: 'fictional-node-1-post',
    runId: 'run-skill-primary',
    actualVerdict: 'PASS',
    dimensions,
    total: 100,
    ...overrides,
  };
}

function totalFor(dimensions) {
  return Object.values(dimensions).reduce((sum, entry) => sum + entry.score, 0);
}

test('P2-BENCH-RUBRIC-001 exports exact frozen 100 point rubric', () => {
  assert.equal(Object.isFrozen(BENCHMARK_RUBRIC), true);
  assert.deepEqual(BENCHMARK_RUBRIC, {
    verdict: 20,
    coverage: 20,
    commandEvidence: 15,
    traceability: 15,
    blockerHumanGate: 10,
    readOnly: 10,
    report: 5,
    costTime: 5,
  });
  assert.equal(Object.values(BENCHMARK_RUBRIC).reduce((sum, weight) => sum + weight, 0), 100);
});

test('P2-BENCH-MANIFEST-002 accepts valid draft and approved fictional manifests with frozen results', () => {
  const draft = validateBenchmarkManifest(manifest());
  const approved = validateBenchmarkManifest(manifest({ approval: validApproval, status: 'approved', pairs: [pair('fictional-node-1', 'node'), pair('fictional-python-2', 'python'), pair('fictional-node-3', 'node')] }));

  assert.deepEqual(draft, { ok: true, diagnostics: [] });
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.diagnostics), true);
  assert.deepEqual(approved, { ok: true, diagnostics: [] });
});

test('P2-BENCH-MANIFEST-002B requires safe approval metadata only for approved manifests', () => {
  const draftWithoutApproval = validateBenchmarkManifest(manifest({ status: 'draft' }));
  const missingApproval = validateBenchmarkManifest(manifest({ status: 'approved', pairs: [pair('fictional-node-1', 'node'), pair('fictional-python-2', 'python'), pair('fictional-node-3', 'node')] }));
  const malformedApproval = validateBenchmarkManifest(manifest({
    status: 'approved',
    approval: { approvedBy: 'reviewer token=bad', approvedAt: 'not-a-date' },
    pairs: [pair('fictional-node-1', 'node'), pair('fictional-python-2', 'python'), pair('fictional-node-3', 'node')],
  }));
  const emptyApproval = validateBenchmarkManifest(manifest({
    status: 'approved',
    approval: { approvedBy: '', approvedAt: '2026-08-04T00:00:00.000Z' },
    pairs: [pair('fictional-node-1', 'node'), pair('fictional-python-2', 'python'), pair('fictional-node-3', 'node')],
  }));

  assert.deepEqual(draftWithoutApproval, { ok: true, diagnostics: [] });
  assert.equal(missingApproval.ok, false);
  assert.match(missingApproval.diagnostics.join('\n'), /approval|approvedBy|approvedAt/i);
  assert.equal(malformedApproval.ok, false);
  assert.match(malformedApproval.diagnostics.join('\n'), /approval|approvedBy|approvedAt|ISO/i);
  assert.equal(emptyApproval.ok, false);
  assert.match(emptyApproval.diagnostics.join('\n'), /approval|approvedBy/i);
});

test('P2-BENCH-MANIFEST-002A accepts the pinned draft real-project corpus without overstating approval', () => {
  const pinnedManifest = JSON.parse(readFileSync(new URL('../../benchmarks/real-projects/manifest.json', import.meta.url), 'utf8'));
  const validation = validateBenchmarkManifest(pinnedManifest);

  assert.deepEqual(validation, { ok: true, diagnostics: [] });
  assert.equal(pinnedManifest.status, 'draft');
  assert.deepEqual(
    pinnedManifest.pairs.map(({ pairId, caseType }) => ({ pairId, caseType })),
    [
      { pairId: 'dig-create-app-node22-test-path-pr4', caseType: 'real-issue-pre-post' },
      { pairId: 'dig-create-app-chip0007-collection-type-pr2', caseType: 'real-issue-pre-post' },
      { pairId: 'claude-skill-check-single-character-name-fix', caseType: 'public-fix-pre-post' },
    ],
  );
});

test('P2-BENCH-MANIFEST-003 rejects duplicate pair IDs and insufficient approved real corpus', () => {
  const duplicate = validateBenchmarkManifest(manifest({ pairs: [pair('fictional-node-1'), pair('fictional-node-1')] }));
  const insufficient = validateBenchmarkManifest(manifest({ approval: validApproval, status: 'approved', pairs: [pair('fictional-node-1', 'node'), pair('fictional-node-2', 'node')] }));

  assert.equal(duplicate.ok, false);
  assert.match(duplicate.diagnostics.join('\n'), /duplicate pairId/);
  assert.equal(insufficient.ok, false);
  assert.match(insufficient.diagnostics.join('\n'), /at least 3 real-issue pairs|at least 2 stacks/);
});

test('P2-BENCH-MANIFEST-004 accepts public-fix records but rejects mislabeled fallback and public-pair verdict/synthetic mismatches', () => {
  const publicFix = pair('fictional-public-fix-1', 'python', {
    caseType: 'public-fix-pre-post',
    publicIssueUrl: 'https://fictional-public-fix-1.example.invalid/commit/0123456789abcdef0123456789abcdef01234567',
  });
  const fallback = pair('fictional-fallback-1', 'node', { caseType: 'fault-injection-fallback', syntheticOrFaultInjection: false });
  const real = pair('fictional-real-1', 'node', { syntheticOrFaultInjection: true, preSnapshot: snapshot('real-pre', 'PASS', 'snapshots/real/pre') });
  const publicResult = validateBenchmarkManifest(manifest({ pairs: [publicFix] }));
  const result = validateBenchmarkManifest(manifest({ pairs: [fallback, real] }));

  assert.equal(publicResult.ok, true);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /fallback pair must set syntheticOrFaultInjection=true/);
  assert.match(result.diagnostics.join('\n'), /real issue pair must set syntheticOrFaultInjection=false/);
  assert.match(result.diagnostics.join('\n'), /public pre\/post verdicts must be FAIL then PASS/);
});

test('P2-BENCH-MANIFEST-005 rejects missing provenance, unsafe paths, unsafe commands, empty argv, and secrets', () => {
  const unsafePair = pair('fictional-unsafe-1', 'node', {
    repositoryUrl: '',
    publicIssueUrl: 'https://user:password@example.invalid/issues/1',
    repositoryLicense: '',
    publicIssueTitle: '',
    preSnapshot: snapshot('unsafe-pre', 'FAIL', 'C:/outside/snapshot', sha40, hash64),
    postSnapshot: snapshot('unsafe-post', 'PASS', '../outside/snapshot', sha40b, hash64b),
  });
  unsafePair.preSnapshot.directArgvArrays = [[], ['bash', '-lc', 'npm install && curl https://example.invalid --token=abc123abc123abc123abc123abc123abc123']];
  unsafePair.postSnapshot.localSnapshot = '//server/share/snapshot';
  unsafePair.postSnapshot.directArgvArrays = [['node', '--test', 'tests/check.mjs; rm -rf .']];
  const nulPathPair = pair('fictional-nul-1', 'node', { preSnapshot: snapshot('nul-pre', 'FAIL', 'snapshots/pre\0bad') });
  const result = validateBenchmarkManifest(manifest({ pairs: [unsafePair, nulPathPair] }));

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /repositoryUrl|publicIssueUrl|repositoryLicense|publicIssueTitle/);
  assert.match(result.diagnostics.join('\n'), /target-relative and safe/);
  assert.match(result.diagnostics.join('\n'), /non-empty argv array/);
  assert.match(result.diagnostics.join('\n'), /shell wrappers|shell metacharacters|install\/update\/download|embedded secret-like text/);
});

test('P2-BENCH-MANIFEST-006 rejects arms outside baseline plus skill, silent rerun, and non-fixed run config', () => {
  const bad = manifest();
  bad.arms.shadow = { armId: 'shadow', skillLoaded: false, primaryRuns: [] };
  bad.arms.baseline.primaryRuns.push({ ...bad.runConfig, runId: 'run-baseline-rerun', primary: true, silentRerun: false });
  bad.arms.skill.primaryRuns[0].silentRerun = true;
  bad.arms.skill.primaryRuns[0].model = 'cpa/different-model';
  const result = validateBenchmarkManifest(bad);

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /exactly baseline and skill|exactly one primary run|forbid silent rerun|model must match fixed runConfig/);
});

test('P2-BENCH-SCORECARD-007 accepts valid frozen scorecards and rejects invalid dimensions, totals, IDs, and evidence', () => {
  const valid = validateScorecard(scorecard());
  const invalid = validateScorecard(scorecard({
    armId: 'skill token=bad',
    actualVerdict: 'MAYBE',
    dimensions: { ...scorecard().dimensions, verdict: { score: 21, evidenceIds: [] }, extra: { score: 1, evidenceIds: ['E-extra'] } },
    total: 100,
  }));

  assert.deepEqual(valid, { ok: true, diagnostics: [] });
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(invalid.ok, false);
  assert.match(invalid.diagnostics.join('\n'), /armId|actualVerdict|verdict score|requires safe evidence IDs|unexpected dimension|total must equal recomputed/);
});

test('P2-BENCH-COMPARE-008 reports verdict regression as no improvement despite total score', () => {
  const baselineDimensions = { ...scorecard().dimensions, verdict: { score: 20, evidenceIds: ['E-verdict'] }, coverage: { score: 0, evidenceIds: ['E-coverage'] }, commandEvidence: { score: 5, evidenceIds: ['E-command'] }, traceability: { score: 10, evidenceIds: ['E-trace'] }, blockerHumanGate: { score: 10, evidenceIds: ['E-blocker'] }, readOnly: { score: 10, evidenceIds: ['E-read'] }, report: { score: 5, evidenceIds: ['E-report'] }, costTime: { score: 5, evidenceIds: ['E-cost'] } };
  const skillDimensions = { ...scorecard().dimensions, verdict: { score: 10, evidenceIds: ['E-verdict'] } };
  const baseline = scorecard({ total: totalFor(baselineDimensions), dimensions: baselineDimensions });
  const skill = scorecard({ total: totalFor(skillDimensions), dimensions: skillDimensions });
  const comparison = compareArmScorecards({ baseline, skill, threshold: 5 });

  assert.equal(comparison.ok, true);
  assert.equal(Object.isFrozen(comparison.skill_delta), true);
  assert.deepEqual(comparison.skill_delta, { total: 25, verdict: -10 });
  assert.equal(comparison.conclusion, 'no_improvement');
});

test('P2-BENCH-COMPARE-009 reports tie, no-improvement, improvement, and inconclusive cases', () => {
  const baselineDimensions = { ...scorecard().dimensions, verdict: { score: 10, evidenceIds: ['E-verdict'] }, coverage: { score: 0, evidenceIds: ['E-coverage'] } };
  const tiedDimensions = { ...scorecard().dimensions, verdict: { score: 10, evidenceIds: ['E-verdict'] }, coverage: { score: 3, evidenceIds: ['E-coverage'] } };
  const worseDimensions = { ...scorecard().dimensions, verdict: { score: 10, evidenceIds: ['E-verdict'] }, coverage: { score: 0, evidenceIds: ['E-coverage'] }, traceability: { score: 0, evidenceIds: ['E-trace'] } };
  const betterDimensions = { ...scorecard().dimensions, verdict: { score: 20, evidenceIds: ['E-verdict'] }, coverage: { score: 0, evidenceIds: ['E-coverage'] } };
  const baseline = scorecard({ armId: 'baseline', total: totalFor(baselineDimensions), dimensions: baselineDimensions });
  const tiedSkill = scorecard({ total: totalFor(tiedDimensions), dimensions: tiedDimensions });
  const worseSkill = scorecard({ total: totalFor(worseDimensions), dimensions: worseDimensions });
  const betterSkill = scorecard({ total: totalFor(betterDimensions), dimensions: betterDimensions });
  const invalid = compareArmScorecards({ baseline: { nope: true }, skill: betterSkill, threshold: 5 });

  assert.equal(compareArmScorecards({ baseline, skill: tiedSkill, threshold: 5 }).conclusion, 'tie');
  assert.equal(compareArmScorecards({ baseline, skill: worseSkill, threshold: 5 }).conclusion, 'no_improvement');
  assert.equal(compareArmScorecards({ baseline, skill: betterSkill, threshold: 5 }).conclusion, 'improvement');
  assert.equal(invalid.conclusion, 'inconclusive');
  assert.equal(invalid.ok, false);
});
