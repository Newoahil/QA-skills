import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function assertHasCoreFields(text) {
  for (const field of ['agent', 'scope', 'status', 'gate', 'evidence', 'limits']) {
    assert.match(text, new RegExp(`\\b${field}\\b`, 'i'));
  }
}

test('qa task allowlist stays limited to qa-cr and qa-e2e and both remain leaf read-only agents', () => {
  const qa = read('qa-skill/agents/qa.md');
  const qaCr = read('qa-skill/agents/qa-cr.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  const taskSection = /task:\s*([\s\S]*?)---/.exec(qa)?.[1] ?? '';
  const taskAllow = [...taskSection.matchAll(/"([^"]+)":\s*allow/g)].map((match) => match[1]).sort();
  assert.deepEqual(taskAllow, ['qa-cr', 'qa-e2e']);

  assert.match(qaCr, /task:\s*deny/);
  assert.match(qaCr, /edit:\s*deny/);
  assert.match(qaCr, /never runs shell|No shell/i);
  assert.match(qaE2e, /task:\s*deny/);
  assert.match(qaE2e, /"\*": deny/);
  assert.match(qaE2e, /never edits product code/i);
});

test('core files describe evidence-driven expansion, no fixed hop, pre-CR diagnostic, report evidence summary, and .git worktree boundary', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const qaCr = read('qa-skill/agents/qa-cr.md');

  assert.match(skill, /oracle plus the actual change surface/i);
  assert.match(skill, /propagation path, shared contract, runtime signal/i);
  assert.match(skill, /bounded diagnostic evidence first/i);
  assert.match(skill, /final report cannot consist of only that status line/i);

  assert.match(qa, /Do not directly traverse `\.git`, gitdir indirections, or inaccessible external worktree metadata/i);
  assert.match(qa, /runtime observation is the minimum needed to establish the oracle, trigger, or bounded CR scope/i);
  assert.match(qa, /run independent checks in parallel/i);
  assert.match(qaCr, /There is no fixed hop limit/i);
  assert.match(qaCr, /A name or label match alone does not/i);
});

test('core prompts avoid forbidden rigid planner phrases and fixed edge lists', () => {
  const corpus = [
    read('qa-skill/SKILL.md'),
    read('qa-skill/agents/qa.md'),
    read('qa-skill/agents/qa-cr.md'),
    read('qa-skill/agents/qa-e2e.md'),
  ].join('\n');

  for (const forbidden of [
    /currently_inactive/i,
    /one primary \+ one helper/i,
    /at most one helper/i,
  ]) {
    assert.doesNotMatch(corpus, forbidden);
  }

  assert.doesNotMatch(
    corpus,
    /call[\s\S]{0,120}data[\s\S]{0,120}state[\s\S]{0,120}selector[\s\S]{0,120}event[\s\S]{0,120}network[\s\S]{0,120}schema[\s\S]{0,120}config/i,
  );
});

test('qa, qa-e2e, and skill stay consistent on bounded pre-CR diagnostic and QA_EVIDENCE_RESULT contract', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  assert.match(skill, /diagnostic/i);
  assert.match(skill, /before CR|come earlier/i);
  assert.match(qa, /diagnostic/i);
  assert.match(qa, /first/i);
  assert.match(qaE2e, /diagnostic/i);
  assert.match(qaE2e, /does not replace/i);
  assert.match(qaE2e, /mandatory CR/i);

  for (const text of [skill, qa, qaE2e]) {
    assert.match(text, /QA_EVIDENCE_RESULT/);
  }

  assert.match(skill, /sole verdict owner|children return evidence only/i);
  assert.match(skill, /never emit `Overall Status:`|never decide PASS/i);
  assert.match(qa, /exactly one/i);
  assert.match(qa, /outer `QA_EVIDENCE_RESULT` block/i);
  assert.match(qa, /required core fields/i);
  assertHasCoreFields(qa);
  assert.match(qa, /findings/i);
  assert.match(qa, /recommended_next/i);
  assert.match(qa, /confidence/i);
  assert.match(qa, /encouraged|useful/i);
  assert.match(qa, /omission alone/i);
  assert.match(qa, /trustworthy evidence unusable/i);
  assert.match(qaE2e, /required core fields/i);
  assertHasCoreFields(qaE2e);
});

test('fail-closed child evidence contract stays enforced without rigid paragraph matching', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const qaCr = read('qa-skill/agents/qa-cr.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  assert.match(skill, /refused|timed-out|failed|missing/i);
  assert.match(skill, /malformed|multiple-block|evidence-free/i);
  assert.match(skill, /cannot close/i);
  assert.match(skill, /required claim/i);
  assert.match(skill, /PASS/i);
  assert.match(skill, /raw observations/i);
  assert.match(skill, /guide more investigation|support FAIL/i);
  assert.match(skill, /`qa` can validate|validate them itself/i);
  assert.match(skill, /status:\s*FAIL/i);
  assert.match(skill, /gate:\s*stop_and_fail/i);
  assert.match(skill, /raw evidence validates/i);
  assert.match(skill, /contradiction to the oracle/i);

  assert.match(qa, /exactly one/i);
  assert.match(qa, /outer `QA_EVIDENCE_RESULT` block/i);
  assert.match(qa, /inspect raw evidence/i);
  assert.match(qa, /PASS\/FAIL reasoning/i);
  assert.match(qa, /refused|timed-out|failed|missing|incomplete|malformed|multiple-block|evidence-free/i);
  assert.match(qa, /required claim unresolved|cannot support PASS/i);
  assert.match(qa, /Malformed|multiple-block/i);
  assert.match(qa, /cannot close a required claim for PASS/i);
  assert.match(qa, /raw observations/i);
  assert.match(qa, /guide more investigation|support FAIL/i);
  assert.match(qa, /validate them yourself/i);
  assert.match(qa, /status:\s*OK/i);
  assert.match(qa, /does not close a claim/i);
  assert.match(qa, /scope or limits omit a material part/i);
  assert.match(qa, /Raw failure evidence/i);
  assert.match(qa, /optimistic labels/i);
  assert.match(qa, /failed delegation/i);
  assert.match(qa, /`BLOCKED`|residual risk/i);
  assert.match(qa, /per required claim/i);
  assert.match(qa, /completed trustworthy `qa-cr` result/i);
  assert.match(qa, /status:\s*FAIL/i);
  assert.match(qa, /gate:\s*stop_and_fail/i);
  assert.match(qa, /validated load-bearing failure evidence/i);

  for (const text of [qaCr, qaE2e]) {
    assert.match(text, /only result block/i);
    assert.match(text, /complete|coherent|honest about scope\/limits/i);
    assert.match(text, /substantive re-checkable evidence/i);
    assert.match(text, /placeholder evidence/i);
    assert.match(text, /required core fields/i);
    assertHasCoreFields(text);
  }
});
