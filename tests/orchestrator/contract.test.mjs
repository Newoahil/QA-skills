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

function assertHasCompactMarkers(text) {
  assert.match(text, /start with a line `QA_EVIDENCE_RESULT`/i);
  assert.match(text, /end with a line `END_QA_EVIDENCE_RESULT`/i);
  assert.match(text, /only outer block/i);
}

test('qa/qa-cr stay mechanically no-shell, qa task allowlist stays exact, and workers keep bounded permissions', () => {
  const qa = read('qa-skill/agents/qa.md');
  const qaApi = read('qa-skill/agents/qa-api.md');
  const qaCr = read('qa-skill/agents/qa-cr.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  const taskSection = /task:\s*([\s\S]*?)---/.exec(qa)?.[1] ?? '';
  const taskAllow = [...taskSection.matchAll(/"([^"]+)":\s*allow/g)].map((match) => match[1]).sort();
  assert.deepEqual(taskAllow, ['qa-api', 'qa-cr', 'qa-e2e']);
  assert.match(qa, /bash:\s*deny/);
  assert.match(qaCr, /bash:\s*deny/);

  assert.match(qaApi, /hidden:\s*true/);
  assert.match(qaApi, /task:\s*deny/);
  assert.match(qaApi, /edit:\s*[\s\S]*?"\*": deny/);
  assert.match(qaApi, /bash:/);
  assert.match(qaApi, /npm i\*/i);
  assert.match(qaApi, /npm ci\*/i);
  assert.match(qaApi, /git commit\*/i);
  assert.match(qaApi, /npm install\*|pnpm install\*|yarn install\*|bun install\*|pip install\*/i);
  assert.match(qaApi, /webfetch:\s*deny/);
  assert.match(qaApi, /websearch:\s*deny/);

  assert.match(qaCr, /task:\s*deny/);
  assert.match(qaCr, /edit:\s*deny/);
  assert.match(qaCr, /never runs shell|No shell/i);
  assert.match(qaE2e, /task:\s*deny/);
  assert.match(qaE2e, /"\*": deny/);
  assert.match(qaE2e, /git add\*/i);
  assert.match(qaE2e, /npm ci\*/i);
  assert.match(qaE2e, /never edits product code/i);
  assert.match(qaE2e, /webfetch:\s*deny/);
  assert.match(qaE2e, /websearch:\s*deny/);
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
    read('qa-skill/agents/qa-api.md'),
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

test('qa, qa-api, qa-e2e, and skill stay consistent on bounded pre-CR diagnostic and QA_EVIDENCE_RESULT contract', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const qaApi = read('qa-skill/agents/qa-api.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  assert.match(skill, /diagnostic/i);
  assert.match(skill, /before CR|come earlier/i);
  assert.match(qa, /diagnostic/i);
  assert.match(qa, /first/i);
  assert.match(qaE2e, /diagnostic/i);
  assert.match(qaE2e, /does not replace/i);
  assert.match(qaE2e, /mandatory CR/i);

  for (const text of [skill, qa, qaApi, qaE2e]) {
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
  assert.match(qaApi, /required core fields/i);
  assertHasCoreFields(qaApi);

  assert.match(qaE2e, /required core fields/i);
  assertHasCoreFields(qaE2e);
});

test('compact worker contracts require explicit QA_EVIDENCE_RESULT start and end markers', () => {
  const qaApi = read('qa-skill/agents/qa-api.md');
  const qaCr = read('qa-skill/agents/qa-cr.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  for (const text of [qaApi, qaCr, qaE2e]) {
    assertHasCompactMarkers(text);
    assert.match(text, /keep the compact contract only/i);
    assert.match(text, /optional auxiliaries/i);
    assert.match(text, /findings/i);
    assert.match(text, /recommended_next/i);
    assert.match(text, /confidence/i);
    assertHasCoreFields(text);
  }
});

test('qa-api/qa-e2e contracts anchor activation boundaries, worker safety, and truthful policy-vs-mechanism wording', () => {
  const qa = read('qa-skill/agents/qa.md');
  const skill = read('qa-skill/SKILL.md');
  const qaApi = read('qa-skill/agents/qa-api.md');
  const qaE2e = read('qa-skill/agents/qa-e2e.md');

  assert.match(qa, /bounded runtime HTTP\/API\/integration evidence/i);
  assert.match(qa, /Names, OpenAPI terms, route labels, or auth vocabulary alone do not activate `qa-api`/i);
  assert.match(qa, /Default ordering is CR first/i);
  assert.match(qa, /`qa-api` only if the API claim remains open/i);
  assert.match(qa, /then `qa-e2e` only if a browser-mediated claim remains/i);
  assert.match(qa, /Final CR remains mandatory for code changes/i);
  assert.match(qa, /parallel only when their checks are independent and do not share mutable state/i);

  assert.match(skill, /local\/loopback project service access is allowed/i);
  assert.match(skill, /External or production targets still require explicit human approval/i);
  assert.match(skill, /bounded runtime HTTP\/API\/integration behavior/i);
  assert.match(skill, /Expected negative `4xx` responses may support `OK`/i);
  assert.match(skill, /Mutations require explicit method\+endpoint approval/i);
  assert.match(skill, /Default ordering is CR first/i);
  assert.match(skill, /does not replace the mandatory CR for code changes/i);

  assert.match(qaApi, /default allowed targets are loopback\/local test services only/i);
  assert.match(qaApi, /cannot mechanically enforce loopback-only targeting or repository read-only/i);
  assert.match(qaApi, /policy boundaries/i);
  assert.match(qaApi, /External targets require explicit human approval and a supplied test identity/i);
  assert.match(qaApi, /Refuse redirects from local to external targets/i);
  assert.match(qaApi, /Redact `Authorization`, `Cookie`, `Set-Cookie`/i);
  assert.match(qaApi, /Default to safe observation methods such as `GET`, `HEAD`, or `OPTIONS`/i);
  assert.match(qaApi, /Mutating requests require explicit method \+ endpoint approval/i);
  assert.match(qaApi, /Non-idempotent requests are never auto-retried/i);
  assert.match(qaApi, /timeout, request-count, and body-size limits/i);
  assert.match(qaApi, /transport unavailable, connect failure, or timeout \(`BLOCKED`\)/i);
  assert.match(qaApi, /HTTP `4xx`\/`5xx` are observations, not automatic task failure/i);

  assert.match(qaE2e, /cannot mechanically enforce repository read-only\s+or local-only targeting/i);
  assert.match(qaE2e, /hard policy boundaries/i);
  assert.match(qaE2e, /do not install or upgrade application dependencies/i);
});

test('qa evidence schema stays six-core-fields only and qa remains sole Overall Status owner', () => {
  const corpus = [
    read('qa-skill/SKILL.md'),
    read('qa-skill/agents/qa.md'),
    read('qa-skill/agents/qa-api.md'),
    read('qa-skill/agents/qa-cr.md'),
    read('qa-skill/agents/qa-e2e.md'),
  ];

  for (const text of corpus) {
    assertHasCoreFields(text);
  }

  for (const text of corpus.slice(2)) {
    assert.doesNotMatch(text, /^Overall Status:/im);
  }
});

test('fail-closed child evidence contract stays enforced without rigid paragraph matching', () => {
  const skill = read('qa-skill/SKILL.md');
  const qa = read('qa-skill/agents/qa.md');
  const qaApi = read('qa-skill/agents/qa-api.md');
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

  for (const text of [qaApi, qaCr, qaE2e]) {
    assert.match(text, /only result block/i);
    assertHasCompactMarkers(text);
    assert.match(text, /complete|coherent|honest about scope\/limits/i);
    assert.match(text, /substantive re-checkable evidence/i);
    assert.match(text, /placeholder evidence/i);
    assert.match(text, /required core fields/i);
    assertHasCoreFields(text);
  }
});
