import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('QA reports distinguish required outcomes from evidence gaps and optional repair advice', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');

  assert.match(skill, /inspected source or SQL may directly establish a behavior or defect/i);
  assert.match(skill, /inspected source\/SQL that directly establishes the claim/i);
  assert.match(skill, /reproduced behavior or relevant inspected source\/SQL/i);
  assert.match(skill, /unrun test as passing evidence/i);
  assert.match(skill, /required behavior failures with concrete trigger, evidence, and impact/i);
  assert.match(skill, /evidence gaps and repair directions separate/i);
  assert.match(skill, /Severity follows impact and likelihood/i);
  assert.match(skill, /missing queue, lease, framework, or abstraction alone is not `FAIL`/i);
  assert.match(skill, /strong static source\/SQL evidence can establish a real safety, concurrency, or data-integrity defect/i);
  assert.match(skill, /without runtime repro or explicit PRD implementation detail/i);
  assert.match(skill, /Preserve genuine security guards/i);
  assert.match(skill, /Repair directions are optional examples/i);
  assert.match(skill, /smallest sufficient existing-boundary remedy/i);
  assert.match(skill, /Do not mandate architecture unless approved or its necessity is proven/i);
  assert.match(skill, /proven defect needs no proposed remedy/i);
  assert.match(qa, /reports behavior-focused/i);
  assert.match(qa, /named mechanism's absence alone as `FAIL`/i);
});

test('QA handoff and retest boundaries retain the main facet contract', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const facet = read('qa-skill/agents/qa-facet.md');

  assert.match(skill, /cannot expand scope, remove approved requirements, or preserve obsolete mechanisms/i);
  assert.match(skill, /broader changes need user\/caller approval/i);
  assert.match(skill, /QA does not decide shipment/i);
  assert.match(skill, /final implementation against relevant commitments and risks, not historical test counts or superseded mechanisms/i);
  assert.match(skill, /load-bearing DB concurrency or migrations/i);
  assert.match(skill, /evidence gaps or environment failures alone are not product `FAIL`/i);

  assert.match(skill, /^name: qa-skill$/m);
  assert.match(qa, /^mode: all$/m);
  assert.match(qa, /^temperature: 0\.1$/m);
  assert.doesNotMatch(qa, /^model:/m);
  assert.match(qa, /edit:\s*[\s\S]*?"\*": deny/);
  assert.match(qa, /^  webfetch: deny$/m);
  assert.match(qa, /^  websearch: deny$/m);
  assert.match(qa, /"git commit\*": deny/);
  assert.match(qa, /"npm install\*": deny/);

  const taskSection = /task:\s*([\s\S]*?)---/.exec(qa)?.[1] ?? '';
  const taskAllow = [...taskSection.matchAll(/"([^"]+)":\s*allow/g)].map((match) => match[1]);
  assert.deepEqual(taskAllow, ['qa-facet']);
  assert.doesNotMatch(`${skill}\n${qa}`, /qa-(?:cr|api|e2e)/i);

  assert.match(facet, /^mode: subagent$/m);
  assert.match(facet, /^hidden: true$/m);
  assert.match(facet, /^temperature: 0\.1$/m);
  assert.match(facet, /^  edit: deny$/m);
  assert.match(facet, /^  task: deny$/m);
  assert.match(facet, /^QA_FACET_RESULT$/m);
  assert.match(facet, /^END_QA_FACET_RESULT$/m);
  for (const field of ['facet', 'scope', 'status', 'evidence', 'findings', 'limits', 'suggested_next']) {
    assert.match(facet, new RegExp(`^${field}:`, 'm'));
  }
  assert.doesNotMatch(facet, /^Overall Status:/m);
});
