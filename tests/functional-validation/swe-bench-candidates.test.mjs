import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sha1Pattern = /^[a-f0-9]{40}$/;
const allowedStacks = new Set(['node', 'python']);

function readCandidates() {
  return JSON.parse(readFileSync(new URL('../../benchmarks/swe-bench-verified/candidates.json', import.meta.url), 'utf8'));
}

test('P3-SWE-CANDIDATES-001 records real Phase 3 candidates without pretending snapshots are frozen', () => {
  const corpus = readCandidates();

  assert.equal(corpus.schemaVersion, 'phase3-swe-bench-candidates-v1');
  assert.equal(corpus.status, 'needs-snapshot-freeze');
  assert.match(corpus.promotionRule, /treeSha256/i);
  assert.equal(Array.isArray(corpus.candidates), true);
  assert.equal(corpus.candidates.length, 3);

  const ids = new Set();
  const stacks = new Set();
  for (const candidate of corpus.candidates) {
    assert.match(candidate.candidateId, /^[a-z0-9_.-]+$/);
    assert.equal(ids.has(candidate.candidateId), false, `duplicate candidateId ${candidate.candidateId}`);
    ids.add(candidate.candidateId);

    assert.match(candidate.repositoryUrl, /^https:\/\/github\.com\//);
    assert.match(candidate.publicIssueUrl, /^https:\/\/github\.com\//);
    assert.equal(candidate.caseType, 'real-issue-pre-post');
    assert.equal(allowedStacks.has(candidate.stack), true);
    stacks.add(candidate.stack);
    assert.match(candidate.preCommitSha, sha1Pattern);
    assert.match(candidate.postCommitSha, sha1Pattern);
    assert.notEqual(candidate.preCommitSha, candidate.postCommitSha);
    assert.equal(candidate.expectedPreVerdict, 'FAIL');
    assert.equal(candidate.expectedPostVerdict, 'PASS');
    assert.equal(candidate.snapshotFreezeRequired, true);
    assert.equal('treeSha256' in candidate, false, 'candidate records must not fabricate frozen snapshot hashes');
    assert.ok(candidate.acceptanceEvidence.length > 40);
    assert.ok(candidate.expectedRisks.length > 0);
    assert.ok(candidate.expectedModules.length > 0);
    assert.ok(candidate.expectedFlows.length > 0);
    assert.ok(candidate.prerequisites.some((entry) => /no dependency installation or network access/i.test(entry)));
    assert.ok(candidate.draftDirectArgvArrays.length > 0);
  }

  assert.deepEqual([...stacks].sort(), ['node', 'python']);
});
