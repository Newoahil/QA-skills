import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
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

  assert.match(skill, /diagnostic runtime evidence before CR/i);
  assert.match(qa, /narrow diagnostic evidence first/i);
  assert.match(qaE2e, /diagnostic evidence does not replace the mandatory CR/i);

  for (const text of [skill, qa, qaE2e]) {
    assert.match(text, /QA_EVIDENCE_RESULT/);
  }
});

test('fail-closed child evidence contract stays enforced without rigid paragraph matching', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const qaCr = read('qa-skill/agents/qa-cr.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  assert.match(skill, /unavailable|refused|times out|fails/i);
  assert.match(skill, /malformed|multiple-block|ambiguous/i);
  assert.match(skill, /evidence-free child result cannot close a required claim or support PASS/i);
  assert.match(skill, /Stop only when completed `qa-cr` returns one trustworthy result/i);
  assert.match(skill, /raw evidence validates a load-bearing contradiction to the oracle/i);

  assert.match(qa, /exactly one complete internally coherent block/i);
  assert.match(qa, /honest scope\/limits and substantive re-checkable evidence/i);
  assert.match(qa, /Refused, timed-out, failed, missing, incomplete, malformed, multiple-block, or evidence-free child output leaves the affected required claim unresolved and cannot support PASS/i);
  assert.match(qa, /`?status: OK`? does not close a claim if the reported scope or limits omit a material part/i);
  assert.match(qa, /Raw failure evidence beats optimistic labels; pessimistic `FAIL` or stop labels without supporting evidence are inconclusive/i);
  assert.match(qa, /failed delegation normally means `BLOCKED` or residual risk for the affected required claim, not product `FAIL`, unless independent raw evidence proves the failure/i);
  assert.match(qa, /Apply this per required claim: an irrelevant optional slice does not blanket-block the whole QA/i);
  assert.match(qa, /Stop only for one completed trustworthy `qa-cr` result with `status: FAIL`, `gate: stop_and_fail`, and validated load-bearing failure evidence/i);

  for (const text of [qaCr, qaE2e]) {
    assert.match(text, /only result block/i);
    assert.match(text, /complete, coherent, honest about scope\/limits/i);
    assert.match(text, /substantive re-checkable evidence rather than placeholder evidence/i);
  }
});
