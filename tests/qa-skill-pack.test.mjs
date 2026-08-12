import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.dirname(path.dirname(testFile));
const packRoot = path.join(repositoryRoot, 'qa-skill');

const rootRouterFiles = Object.freeze([
  'SKILL.md',
]);

const phase1SkillNames = ['using-qa', 'qa-plan', 'qa-execute', 'qa-conclude'];
const phase2M1SkillNames = ['using-project-qa'];
const phase2M2SkillNames = ['project-qa-plan'];
const phase2M3SkillNames = ['project-qa-execute', 'project-qa-conclude'];
const phase2M4SkillNames = ['project-qa-repair'];
const qaLiteSkillNames = ['qa-triage', 'qa-lite'];
const requiredSkillNames = [...phase1SkillNames, ...phase2M1SkillNames, ...phase2M2SkillNames, ...phase2M3SkillNames, ...phase2M4SkillNames, ...qaLiteSkillNames];

const phase1CoreFiles = Object.freeze([
  'using-qa/SKILL.md',
  'qa-plan/SKILL.md',
  'qa-execute/SKILL.md',
  'qa-conclude/SKILL.md',
  'references/qa-principles.md',
  'references/risk-checklist.md',
  'references/applicability-rubric.md',
  'references/qa-profiles.md',
  'references/evidence-guide.md',
  'references/finding-classification.md',
  'references/human-gates.md',
  'schemas/qa-plan.schema.json',
  'tools/validate-qa-plan.mjs',
  'templates/qa-report.md',
]);

const phase2M1ExtensionFiles = Object.freeze([
  'using-project-qa/SKILL.md',
  'references/project-qa-run-contract.md',
  'templates/project-qa-report.md',
]);

const phase2M2ExtensionFiles = Object.freeze([
  'project-qa-plan/SKILL.md',
  'references/project-risk-classification.md',
]);

const phase2M3ExtensionFiles = Object.freeze([
  'project-qa-execute/SKILL.md',
  'project-qa-conclude/SKILL.md',
  'references/project-evidence-guide.md',
]);

const phase2M4ExtensionFiles = Object.freeze([
  'project-qa-repair/SKILL.md',
  'references/generated-test-validation.md',
]);

const phase2M5ExtensionFiles = Object.freeze([
  'references/project-run-recovery.md',
]);

const phase2M6ExtensionFiles = Object.freeze([
  'references/project-capability-discovery.md',
  'references/module-resource-scheduling.md',
]);

const phase2ExtensionFiles = Object.freeze([
  ...phase2M1ExtensionFiles,
  ...phase2M2ExtensionFiles,
  ...phase2M3ExtensionFiles,
  ...phase2M4ExtensionFiles,
  ...phase2M5ExtensionFiles,
  ...phase2M6ExtensionFiles,
]);

const phase3MinimalExtensionFiles = Object.freeze([
  'project-qa-context/SKILL.md',
  'references/qa_planning_inputs.md',
]);

const phase4MinimalExtensionFiles = Object.freeze([
  'project-qa-memory/SKILL.md',
  'references/project-qa-workspace.md',
  'tools/match-memory.mjs',
]);

const requiredProductFiles = Object.freeze([
  ...phase1CoreFiles,
  ...phase2ExtensionFiles,
  ...phase3MinimalExtensionFiles,
  ...phase4MinimalExtensionFiles,
]);

const qaLiteFiles = Object.freeze([
  'qa-triage/SKILL.md',
  'qa-lite/SKILL.md',
  'references/qa-lite-triage.md',
  'templates/qa-lite-report.md',
]);

const beginnerSignoffFiles = Object.freeze([
  'references/qa-starter-flow.md',
  'templates/qa-signoff.md',
]);

const requiredAllProductFiles = Object.freeze([
  ...rootRouterFiles,
  ...requiredProductFiles,
  ...qaLiteFiles,
  ...beginnerSignoffFiles,
]);

const requiredSkillFiles = requiredSkillNames.map((skillName) => `${skillName}/SKILL.md`);

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join('/');
}

function regularFilesUnder(root) {
  if (!existsSync(root)) return [];

  const entries = [];
  const pending = [''];

  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);

    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(root, relativePath);

      if (entry.isDirectory()) {
        pending.push(relativePath);
      } else if (entry.isFile()) {
        entries.push(normalizeRelative(relativePath));
      } else {
        entries.push(`${normalizeRelative(relativePath)} <non-regular>`);
      }
    }
  }

  return entries.sort((left, right) => left.localeCompare(right));
}

function readRequiredMarkdown(relativePath, testId) {
  const absolutePath = path.join(packRoot, relativePath);
  assert.ok(
    existsSync(absolutePath),
    `${testId}: missing required file ${relativePath}`,
  );
  assert.ok(
    statSync(absolutePath).isFile(),
    `${testId}: required path is not a regular file ${relativePath}`,
  );
  return readFileSync(absolutePath, 'utf8');
}

function parseFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== '---') return null;

  const metadata = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '---') return metadata;

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) {
      const [, key, rawValue] = match;
      metadata[key] = rawValue.replace(/^['"]|['"]$/g, '').trim();
    }
  }

  return null;
}

function corpusFromRequiredFiles(testId, relativePaths = phase1CoreFiles) {
  return relativePaths
    .map((relativePath) => `\n--- ${relativePath} ---\n${readRequiredMarkdown(relativePath, testId)}`)
    .join('\n');
}

function assertAnchorGroup(corpus, testId, label, patterns) {
  const missingPatterns = patterns
    .filter((pattern) => !pattern.test(corpus))
    .map((pattern) => pattern.source);

  assert.deepEqual(
    missingPatterns,
    [],
    `${testId}: missing semantic anchor group ${label}: ${missingPatterns.join(', ')}`,
  );
}

function assertNoSemanticFailures(testId, failures) {
  assert.deepEqual(
    failures,
    [],
    `${testId}: file-specific semantic policy regressions:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
  );
}

function containsAllPriorityNames(markdown) {
  return [
    'Must Verify',
    'Should Verify',
    'Optional',
    'Explicitly Not Verified',
  ].every((value) => markdown.includes(value));
}

function containsAllLayerNames(markdown) {
  return [
    'Static/unit',
    'API/integration',
    'E2E/system',
    'Specialist non-functional',
    'Manual acceptance',
  ].every((value) => markdown.includes(value));
}

const canonicalQaApplicabilityCategories = Object.freeze([
  'Static/build',
  'Unit',
  'Integration',
  'Contract/API',
  'E2E',
  'Database/migration',
  'Security',
  'Performance',
  'Compatibility',
  'Accessibility/visual',
  'Regression',
]);

const canonicalQaApplicabilityAssessments = Object.freeze([
  'Required',
  'Recommended',
  'Not Applicable',
  'Blocked',
  'Deferred',
]);

const canonicalQaExecutionStatuses = Object.freeze([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NEEDS_HUMAN_REVIEW',
]);

function missingLiteralValues(markdown, values) {
  return values.filter((value) => !markdown.includes(value));
}

function recordMissingPattern(failures, markdown, relativePath, label, pattern) {
  if (!pattern.test(markdown)) {
    failures.push(`${relativePath} must define ${label}`);
  }
}

function markdownTableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|$/.test(line))
    .map((line) => line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replace(/^`|`$/g, '')));
}

function extractRelativeMarkdownLinks(markdown) {
  const links = [];
  const linkPattern = /(?<!!)[^\[]*\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;

  while ((match = linkPattern.exec(markdown)) !== null) {
    const target = match[1].trim();
    const withoutAnchor = target.split('#')[0];
    if (
      withoutAnchor.length > 0
      && !/^https?:\/\//i.test(withoutAnchor)
      && withoutAnchor.toLowerCase().endsWith('.md')
    ) {
      links.push(withoutAnchor);
    }
  }

  return links;
}

function resolveRealPathIfPresent(targetPath) {
  return existsSync(targetPath) ? realpathSync(targetPath) : path.resolve(targetPath);
}

function parseJsonFromStdout(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with balanced extraction for CLIs that wrap JSON in log lines.
  }

  const candidates = [];
  for (let start = 0; start < stdout.length; start += 1) {
    const opener = stdout[start];
    if (opener !== '{' && opener !== '[') continue;

    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < stdout.length; end += 1) {
      const character = stdout[end];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === opener) {
        depth += 1;
      } else if (character === closer) {
        depth -= 1;
        if (depth === 0) {
          candidates.push(stdout.slice(start, end + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates.reverse()) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function flattenDiscoveryEntries(value) {
  if (Array.isArray(value)) return value.flatMap(flattenDiscoveryEntries);
  if (value && typeof value === 'object') {
    const nestedKeys = ['skills', 'items', 'data', 'result', 'available'];
    const nested = nestedKeys
      .filter((key) => key in value)
      .flatMap((key) => flattenDiscoveryEntries(value[key]));

    return nested.length > 0 ? nested : [value];
  }

  return [];
}

function discoveryName(entry) {
  return entry.name ?? entry.id ?? entry.skill ?? entry.title;
}

function discoveryLocation(entry) {
  return entry.location ?? entry.path ?? entry.file ?? entry.source ?? entry.directory;
}

test('P1-STRUCT-001 exposes exactly the required QA skill pack files', () => {
  const testId = 'P1-STRUCT-001';
  assert.ok(existsSync(packRoot), `${testId}: missing qa-skill directory at ${packRoot}`);
  assert.ok(statSync(packRoot).isDirectory(), `${testId}: qa-skill is not a directory at ${packRoot}`);

  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase1CoreFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing required Phase 1 core file ${relativePath}`);
  }

  assert.deepEqual(
    actualFiles,
    [...requiredAllProductFiles].sort((left, right) => left.localeCompare(right)),
    `${testId}: qa-skill must contain exactly the root router, Phase 1 core, Phase 2 M1-M6 files, Phase 3/4 extension files, and the additive QA-Lite files, with no extras`,
  );
});

test('P0-ROUTER-001 exposes a root QA skill router that selects Diff QA vs Project QA', () => {
  const testId = 'P0-ROUTER-001';
  const rootRouter = readRequiredMarkdown('SKILL.md', testId);

  const requiredPatterns = [
    [/name:\s*qa-skill/i, 'root skill frontmatter name'],
    [/entry\s+router\s+only|root\s+skill\s+router/i, 'router only boundary'],
    [/whole-project\s+QA[\s\S]{0,180}using-project-qa/i, 'whole-project QA routes to using-project-qa'],
    [/(?:Single\s+)?Diff[\s\S]{0,120}requirement[\s\S]{0,120}fix[\s\S]{0,180}using-qa/i, 'bounded Diff/requirement/fix routes to using-qa'],
    [/Ambiguous\s+scope[\s\S]{0,160}clarification/i, 'ambiguous scope asks clarification'],
    [/qa-lite[\s\S]{0,120}not\s+a\s+top-level\s+route/i, 'qa-lite is not top-level'],
    [/Never\s+call[\s\S]{0,80}qa-lite[\s\S]{0,80}directly/i, 'do not call qa-lite directly'],
    [/selected\s+only\s+by[\s\S]{0,80}qa-triage/i, 'qa-lite selected by qa-triage only'],
    [/Project\s+QA[\s\S]{0,120}never\s+uses\s+`?qa-lite`?/i, 'Project QA never uses Lite'],
    [/using-project-qa[\s\S]{0,80}project-qa-plan[\s\S]{0,80}project-qa-execute[\s\S]{0,80}project-qa-conclude/i, 'Project QA core path'],
    [/project-qa-context[\s\S]{0,120}GitHub[\s\S]{0,120}qa_planning_inputs[\s\S]{0,80}No/i, 'context optional planning-only module'],
    [/project-qa-memory[\s\S]{0,120}\.qa\/memory\/index\.yaml[\s\S]{0,120}qa_planning_inputs[\s\S]{0,80}No/i, 'memory optional planning-only module'],
    [/Planning\s+inputs[\s\S]{0,160}never\s+PASS\s+evidence/i, 'planning inputs never PASS evidence'],
    [/PASS[\s\S]{0,80}FAIL[\s\S]{0,80}BLOCKED[\s\S]{0,80}NEEDS_HUMAN_REVIEW/i, 'canonical statuses'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(rootRouter, pattern, `${testId}: missing ${label}`);
  }
});

test('P0-STARTER-002 exposes a beginner starter flow and one-page sign-off wired from the router and Diff entry', () => {
  const testId = 'P0-STARTER-002';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of beginnerSignoffFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing beginner/sign-off file ${relativePath}`);
  }

  const starterFlow = readRequiredMarkdown('references/qa-starter-flow.md', testId);
  const signoff = readRequiredMarkdown('templates/qa-signoff.md', testId);
  const rootRouter = readRequiredMarkdown('SKILL.md', testId);
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);

  const starterPatterns = [
    [/\*\*Scope\*\*[\s\S]{0,400}\*\*Risk\*\*[\s\S]{0,400}\*\*Checks\*\*[\s\S]{0,400}\*\*Evidence\*\*[\s\S]{0,400}\*\*Verdict\*\*/i, '5-step starter flow'],
    [/No\s+evidence,?\s+no\s+PASS/i, 'no evidence no PASS'],
    [/read-only/i, 'read-only rule'],
    [/BLOCKED\s+is\s+not\s+FAIL/i, 'blocked is not fail'],
    [/PASS[\s\S]{0,60}FAIL[\s\S]{0,60}BLOCKED[\s\S]{0,60}NEEDS_HUMAN_REVIEW/i, 'four statuses'],
    [/escalate\s+to\s+Full|graduate\s+to\s+Full|Full\s+QA/i, 'escalate to Full'],
  ];
  for (const [pattern, label] of starterPatterns) {
    assert.match(starterFlow, pattern, `${testId}: starter flow missing ${label}`);
  }

  const signoffPatterns = [
    [/one[\s-]page/i, 'one-page framing'],
    [/Tested\s+vs\s+Not\s+Tested|Tested\?/i, 'tested vs not tested section'],
    [/Residual\s+Risk/i, 'residual risk section'],
    [/Recommendation[\s\S]{0,80}Not\s+A\s+Decision|recommendation\s+only/i, 'recommendation not a release decision'],
    [/never\s+invents?\s+a\s+verdict|mirrors\s+the\s+authoritative\s+report/i, 'mirrors authoritative report, no invented verdict'],
    [/PASS[\s\S]{0,60}FAIL[\s\S]{0,60}BLOCKED[\s\S]{0,60}NEEDS_HUMAN_REVIEW/i, 'four statuses'],
  ];
  for (const [pattern, label] of signoffPatterns) {
    assert.match(signoff, pattern, `${testId}: sign-off missing ${label}`);
  }

  assert.match(rootRouter, /qa-starter-flow\.md/i, `${testId}: router must link the starter flow`);
  assert.match(rootRouter, /qa-signoff\.md/i, `${testId}: router must link the sign-off template`);
  assert.match(usingQa, /qa-starter-flow\.md/i, `${testId}: using-qa must link the starter flow`);
  assert.match(usingQa, /qa-signoff\.md/i, `${testId}: using-qa must link the sign-off template`);
});

test('P1-STRUCT-LITE-002 adds required QA-Lite artifacts to the same closed pack manifest', () => {
  const testId = 'P1-STRUCT-LITE-002';
  const actualFiles = regularFilesUnder(packRoot);
  const presentLiteFiles = actualFiles.filter((relativePath) => qaLiteFiles.includes(relativePath));

  assert.deepEqual(
    presentLiteFiles.sort((left, right) => left.localeCompare(right)),
    [...qaLiteFiles].sort((left, right) => left.localeCompare(right)),
    `${testId}: qa-skill must contain exactly the additive QA-Lite artifact subset`,
  );
});

test('P2-M1-STRUCT-001 preserves the declared Phase 2 M1 extension files', () => {
  const testId = 'P2-M1-STRUCT-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase2M1ExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared M1 extension file ${relativePath}`);
  }
});

test('P2-M2-STRUCT-001 exposes exactly the declared Phase 2 extension files through M6', () => {
  const testId = 'P2-M2-STRUCT-001';
  const actualFiles = regularFilesUnder(packRoot);
  const phase2Files = actualFiles.filter((relativePath) => !rootRouterFiles.includes(relativePath) && !phase1CoreFiles.includes(relativePath) && !qaLiteFiles.includes(relativePath) && !beginnerSignoffFiles.includes(relativePath) && !phase3MinimalExtensionFiles.includes(relativePath) && !phase4MinimalExtensionFiles.includes(relativePath));

  assert.deepEqual(
    phase2Files,
    [...phase2ExtensionFiles].sort((left, right) => left.localeCompare(right)),
      `${testId}: only the declared using-project-qa entry, project planning/execution/conclusion/repair skills, project references, recovery/capability/scheduling references, and report template may extend Phase 1 through M6`,
  );
});

test('P2-M3-STRUCT-001 exposes exactly the declared M3 project execution extension files', () => {
  const testId = 'P2-M3-STRUCT-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase2M3ExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared M3 extension file ${relativePath}`);
  }
});

test('P2-M4-STRUCT-001 exposes exactly the declared M4 generated-test and repair extension files', () => {
  const testId = 'P2-M4-STRUCT-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase2M4ExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared M4 extension file ${relativePath}`);
  }

  const repairSkill = readRequiredMarkdown('project-qa-repair/SKILL.md', testId);
  const generatedReference = readRequiredMarkdown('references/generated-test-validation.md', testId);
  const projectRunContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${repairSkill}\n${generatedReference}\n${projectRunContract}\n${reportTemplate}`;

  const requiredPatterns = [
    [/explicit,?\s+recorded\s+user\s+authorization[\s\S]{0,220}`?PROJECT_FIX_AND_RERUN`?/i, 'recorded authorization repair mode'],
    [/host\s+(?:Main|Implementation)\s+Agent[\s\S]{0,220}only\s+writer[\s\S]{0,220}isolated\s+workspace/i, 'host writer isolated workspace boundary'],
    [/original\s+target[\s\S]{0,180}(?:never|must\s+not|cannot)\s+(?:be\s+)?(?:written|modified|synced)/i, 'original target never written or synced'],
    [/pre-existing\s+acceptance[\s\S]{0,120}risk[\s\S]{0,120}verification\s+IDs/i, 'pre-existing generated-test IDs'],
    [/generated\s+asset\s+metadata[\s\S]{0,180}SHA-256[\s\S]{0,120}byte\s+count[\s\S]{0,180}validation\s+artifact/i, 'generated asset and validation artifact metadata'],
    [/no\s+vacuity[\s\S]{0,120}no\s+circular\s+self-proof[\s\S]{0,120}no\s+weak\s+matching/i, 'generated-test anti-vacuity checks'],
    [/immutable\s+original\s+failure\s+evidence[\s\S]{0,220}minimal\s+diff[\s\S]{0,180}(?:own\s+path|path)[\s\S]{0,120}SHA-256[\s\S]{0,120}byte\s+count[\s\S]{0,180}before\s+SHA-256[\s\S]{0,120}after\s+SHA-256/i, 'repair trace and diff metadata'],
    [/max(?:imum)?\s+three\s+repair\s+rounds[\s\S]{0,180}(?:refuse|refuses|refused)\s+(?:a\s+)?fourth/i, 'three-round repair limit'],
    [/consecutive\s+repeated\s+non-empty\s+normalized\s+diff\s+fingerprint[\s\S]{0,220}NEEDS_HUMAN_REVIEW/i, 'no-progress human gate'],
    [/cleanup\s+failure\s+blocks\s+`?PASS`?/i, 'cleanup failure blocks PASS'],
    [/(?:commit|push|PR|release\s+approval)[\s\S]{0,220}(?:forbidden|must\s+not|cannot|deferred)/i, 'forbidden delivery actions'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M5-STRUCT-001 exposes exactly the declared M5 recovery reference and anchors recovery semantics', () => {
  const testId = 'P2-M5-STRUCT-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase2M5ExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared M5 extension file ${relativePath}`);
  }

  const recoveryReference = readRequiredMarkdown('references/project-run-recovery.md', testId);
  const projectRunContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const executeSkill = readRequiredMarkdown('project-qa-execute/SKILL.md', testId);
  const concludeSkill = readRequiredMarkdown('project-qa-conclude/SKILL.md', testId);
  const repairSkill = readRequiredMarkdown('project-qa-repair/SKILL.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${recoveryReference}\n${projectRunContract}\n${usingProjectQa}\n${executeSkill}\n${concludeSkill}\n${repairSkill}\n${reportTemplate}`;

  const requiredPatterns = [
    [/Run-state\s+authority\s+subdomain[\s\S]{0,220}not\s+a\s+fifth\s+authority[\s\S]{0,120}status/i, 'run-state-only recovery authority'],
    [/`qa_session_id`[\s\S]{0,180}stable[\s\S]{0,180}resume[\s\S]{0,220}new\s+`?run_id`?[\s\S]{0,220}`parent_run_id`[\s\S]{0,220}immediate[\s\S]{0,120}same-session/i, 'resume identity lineage'],
    [/compatible\s+prior-history\s+run[\s\S]{0,180}separate[\s\S]{0,160}`?parent_run_id`?/i, 'history separate from parent lineage'],
    [/checkpoint[\s\S]{0,260}schema\s+version[\s\S]{0,160}checkpoint\s+ID[\s\S]{0,160}originating\s+session[\s\S]{0,120}run/i, 'checkpoint identity fields'],
    [/per-module[\s\S]{0,160}dependency-closure\s+fingerprints[\s\S]{0,220}actual\s+SHA-256[\s\S]{0,120}bytes[\s\S]{0,120}provenance/i, 'checkpoint artifact integrity fields'],
    [/corrupt[\s\S]{0,80}truncated[\s\S]{0,80}missing[\s\S]{0,80}unsupported[\s\S]{0,80}hash[\s\S]{0,80}byte[\s\S]{0,80}reference\s+mismatch[\s\S]{0,180}`?BLOCKED`?/i, 'corrupt checkpoint blocks'],
    [/unchanged\s+reuse[\s\S]{0,220}exact\s+target\s+scope\s+identity[\s\S]{0,220}dependency-closure\s+fingerprint[\s\S]{0,220}source\s+run[\s\S]{0,120}provenance/i, 'unchanged reuse exact tuple'],
    [/changed\s+module[\s\S]{0,180}invalidates\s+itself[\s\S]{0,200}dependent\s+modules[\s\S]{0,120}key\s+flows[\s\S]{0,120}coverage[\s\S]{0,180}dependency\s+edges/i, 'stale dependency invalidation'],
    [/stale\s+evidence[\s\S]{0,140}historical[\s\S]{0,120}diagnostic[\s\S]{0,160}cannot\s+support\s+current\s+`?PASS`?/i, 'stale evidence cannot pass'],
    [/conflict\s+detection[\s\S]{0,120}stop\s+only[\s\S]{0,180}not\s+successful\s+sync/i, 'conflict stop only'],
    [/repair-start[\s\S]{0,120}original-target[\s\S]{0,160}per-path\s+bytes[\s\S]{0,80}hash\s+baseline[\s\S]{0,220}emit\s+no\s+copy[\s\S]{0,80}merge[\s\S]{0,80}sync[\s\S]{0,80}back-propagation/i, 'conflict baseline and no sync actions'],
    [/stable\s+finding\s+identity[\s\S]{0,180}canonical\s+SHA-256[\s\S]{0,220}category[\s\S]{0,80}kind[\s\S]{0,120}module\/flow\s+scope[\s\S]{0,120}verification/i, 'stable finding identity'],
    [/`?NEW`?[\s\S]{0,80}`?PERSISTENT`?[\s\S]{0,80}`?RESOLVED`?[\s\S]{0,80}`?NO_LONGER_APPLICABLE`?/i, 'history classification labels'],
    [/RESOLVED[\s\S]{0,180}affirmative\s+current\s+`?PASS`?\s+evidence[\s\S]{0,180}absence\s+alone\s+never\s+resolves/i, 'resolved requires affirmative pass'],
    [/prior\s+`?PASS`?[\s\S]{0,120}history[\s\S]{0,180}comparison\s+context\s+only[\s\S]{0,220}current\s+objective\s+`?FAIL`?[\s\S]{0,160}project\s+`?FAIL`?/i, 'current failure precedence'],
    [/history\s+never\s+enters\s+Evidence\s+authority[\s\S]{0,180}overrides\s+four-status\s+reconciliation/i, 'history cannot override authority'],
    [/\.qa\/runs\/<run_id>\/[\s\S]{0,200}already\s+ignored\s+or\s+local-excluded[\s\S]{0,220}host-owned\s+external/i, 'existing storage decision only'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M6-STRUCT-001 exposes exactly the declared M6 capability and scheduling references', () => {
  const testId = 'P2-M6-STRUCT-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase2M6ExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared M6 extension file ${relativePath}`);
  }

  const capabilityReference = readRequiredMarkdown('references/project-capability-discovery.md', testId);
  const schedulingReference = readRequiredMarkdown('references/module-resource-scheduling.md', testId);
  const projectRunContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const projectPlan = readRequiredMarkdown('project-qa-plan/SKILL.md', testId);
  const executeSkill = readRequiredMarkdown('project-qa-execute/SKILL.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${capabilityReference}\n${schedulingReference}\n${projectRunContract}\n${usingProjectQa}\n${projectPlan}\n${executeSkill}\n${reportTemplate}`;

  assert.equal(requiredProductFiles.length, 32, `${testId}: physical product file count should be 32 through M6 plus the Phase 1 Planner contract, the Phase 3 context skill and shared planning-inputs reference, and the Phase 4 memory skill, workspace reference, and executable memory matcher tool`);

  const requiredPatterns = [
    [/bounded\s+static\s+capability\s+evidence/i, 'bounded static capability evidence'],
    [/fixed\s+recognized\s+artifact\s+allowlist[\s\S]{0,220}`?package\.json`?[\s\S]{0,120}`?pyproject\.toml`?[\s\S]{0,120}`?go\.mod`?[\s\S]{0,120}`?pom\.xml`?[\s\S]{0,120}OpenAPI/i, 'recognized artifact allowlist'],
    [/source\s+path[\s\S]{0,160}actual\s+SHA-256[\s\S]{0,120}byte\s+count[\s\S]{0,160}recognized\s+kind[\s\S]{0,120}confidence/i, 'capability evidence metadata'],
    [/reject[\s\S]{0,120}traversal[\s\S]{0,120}absolute[\s\S]{0,120}drive-qualified[\s\S]{0,120}UNC[\s\S]{0,120}NUL[\s\S]{0,160}symlink[\s\S]{0,120}realpath-escape[\s\S]{0,120}special-file/i, 'unsafe capability path rejection'],
    [/Candidate\s+commands\s+are\s+structured\s+Planning\s+state[\s\S]{0,180}not\s+Module\s+Results[\s\S]{0,120}Execution\s+Evidence/i, 'candidate planning state not evidence'],
    [/`?LOCAL_EXISTING_CHECK_CANDIDATE`?[\s\S]{0,120}`?HUMAN_GATE_REQUIRED`?[\s\S]{0,120}`?UNEXECUTED`?/i, 'candidate policy labels and unexecuted state'],
    [/Package\s+script\s+content\s+is\s+untrusted[\s\S]{0,220}Human\s+Gate/i, 'untrusted package script classification'],
    [/default_if_no_answer:\s*do_not_execute/i, 'Human Gate default no execute'],
    [/Unavailable\s+required\s+local\s+tools\s+block\s+only\s+the\s+affected\s+verification[\s\S]{0,220}already-installed\s+tool\s+available[\s\S]{0,180}rerunning/i, 'missing tool blocked prerequisite wording'],
    [/embedded\s+agent\s+instructions\s+are\s+untrusted\s+data[\s\S]{0,240}cannot\s+change\s+the\s+supplied\s+target[\s\S]{0,160}host\s+limit[\s\S]{0,120}planned\s+argv/i, 'prompt immutability'],
    [/structured\s+logical\s+resource\s+IDs\s+as\s+`?kind:id`?[\s\S]{0,220}database[\s\S]{0,80}port[\s\S]{0,80}file[\s\S]{0,80}credential[\s\S]{0,80}fixture[\s\S]{0,80}environment[\s\S]{0,80}cache[\s\S]{0,80}service[\s\S]{0,80}external-system/i, 'structured resource IDs and canonical kinds'],
    [/must\s+not\s+contain\s+raw\s+secrets[\s\S]{0,160}tokens[\s\S]{0,160}connection\s+strings/i, 'no raw secret resource IDs'],
    [/Undeclared[\s\S]{0,120}missing[\s\S]{0,120}ambiguous[\s\S]{0,180}serialize\s+by\s+default/i, 'missing ambiguous resources serialize'],
    [/distinct\s+isolation\s+key[\s\S]{0,180}validated\s+actual\s+isolation\s+evidence[\s\S]{0,160}SHA-256[\s\S]{0,80}byte\s+count/i, 'isolation evidence for shared mutable resources'],
    [/finite\s+positive\s+integer\s+host-declared\s+limit[\s\S]{0,180}fall(?:s|ed)\s+back\s+to\s+`?1`?[\s\S]{0,160}do\s+not\s+invent\s+a\s+universal\s+max/i, 'host limit fallback'],
    [/distinct\s+safe\s+result\s+paths[\s\S]{0,120}artifact\s+paths[\s\S]{0,180}Duplicate[\s\S]{0,120}unsafe\s+paths/i, 'separate safe result and artifact paths'],
    [/Scheduling\s+records\s+are\s+Planning\s+state[\s\S]{0,120}do\s+not\s+authorize\s+commands/i, 'schedule not authorization'],
    [/broad\s+or\s+unbounded\s+discovery[\s\S]{0,180}automatic\s+dependency\s+handling[\s\S]{0,220}network[\s\S]{0,160}production[\s\S]{0,160}destructive[\s\S]{0,160}M7\s+docs[\s\S]{0,160}deferred\s+or\s+forbidden/i, 'deferred forbidden scope'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P3-CONTEXT-001 exposes the shared planning-inputs reference and anchors bounded change-intent extraction', () => {
  const testId = 'P3-CONTEXT-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase3MinimalExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared Phase 3 extension file ${relativePath}`);
  }

  const contextSkill = readRequiredMarkdown('project-qa-context/SKILL.md', testId);
  const planningInputs = readRequiredMarkdown('references/qa_planning_inputs.md', testId);
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${contextSkill}\n${planningInputs}\n${usingProjectQa}\n${reportTemplate}`;

  const requiredPatterns = [
    [/GitHub-only|GitHub\s+only/i, 'GitHub-only scope'],
    [/explicit\s+refs?\s+only|explicit\s+references?\s+only/i, 'explicit refs only'],
    [/no\s+search|do\s+not\s+search/i, 'no search'],
    [/one-hop|one\s+hop/i, 'one-hop boundary'],
    [/`?gh`?\s+preferred|`?gh`?\s+CLI/i, 'gh preferred'],
    [/qa_planning_inputs/i, 'feeds qa_planning_inputs'],
    [/planning_only|planning-only/i, 'planning-only use limit'],
    [/never\s+PASS\s+evidence|not\s+PASS\s+evidence/i, 'never PASS evidence'],
    [/provenance/i, 'requires provenance'],
    [/no\s+provenance[\s\S]{0,120}discard|without\s+provenance[\s\S]{0,120}discard/i, 'no provenance discard'],
    [/intent[\s\S]{0,120}acceptance_criteria[\s\S]{0,120}repro_steps[\s\S]{0,120}risk_hypothesis[\s\S]{0,120}contradiction[\s\S]{0,120}unusable_context/i, 'structured extraction categories'],
    [/stated|intended/i, 'stated/intended phrasing'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P4-MEMORY-001 exposes the minimal Phase 4 memory skill and anchors planning-hint-only semantics', () => {
  const testId = 'P4-MEMORY-001';
  const actualFiles = regularFilesUnder(packRoot);

  for (const relativePath of phase4MinimalExtensionFiles) {
    assert.ok(actualFiles.includes(relativePath), `${testId}: missing declared Phase 4 memory extension file ${relativePath}`);
  }

  const memorySkill = readRequiredMarkdown('project-qa-memory/SKILL.md', testId);
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const planningInputs = readRequiredMarkdown('references/qa_planning_inputs.md', testId);
  const workspaceReference = readRequiredMarkdown('references/project-qa-workspace.md', testId);
  const combined = `${memorySkill}\n${usingProjectQa}\n${reportTemplate}\n${planningInputs}\n${workspaceReference}`;

  const requiredPatterns = [
    [/planning\s+hint\s+only/i, 'memory is a planning hint only'],
    [/never\s+PASS\s+evidence|not\s+PASS\s+evidence/i, 'memory is never PASS evidence'],
    [/only\s+current\s+execution\s+evidence[\s\S]{0,220}(?:support|write)[\s\S]{0,160}memory/i, 'only execution evidence supports memory writes'],
    [/GitHub\s+external\s+context\s+alone[\s\S]{0,220}(?:never|not)[\s\S]{0,160}memory\s+evidence/i, 'GitHub external context alone is never memory evidence'],
    [/explicit\s+human\s+approval|explicit\s+user\s+confirmation/i, 'default memory write requires human approval'],
    [/Reusable\s+Learning\s*\/\s*Memory/i, 'report exposes a Reusable Learning / Memory section'],
    [/Approved\s+Memory\s+Structure/i, 'approved memory structure section'],
    [/Admission\s*\/\s*Write\s+Gate|admission\s+checklist|Admission\s+Checklist/i, 'memory admission/write gate'],
    [/retrieval\s+rules|Retrieval\s+Rules/i, 'memory retrieval rules'],
    [/staleness|stale|under_review/i, 'staleness and review policy'],
    [/reject\s+generic\s+memory|generic\s+memory/i, 'reject generic memory'],
    [/scope\/trigger|scope[\s\S]{0,80}trigger/i, 'scope/trigger based retrieval'],
    [/evidence-backed[\s\S]{0,160}(?:human-approved|human\s+approval|user-confirmed)|(?:human-approved|human\s+approval|user-confirmed)[\s\S]{0,160}evidence-backed/i, 'evidence-backed human-approved writes'],
    [/qa_planning_inputs/i, 'memory feeds qa_planning_inputs'],
    [/planning_only|planning-only/i, 'planning-only use limit'],
    [/\.qa\/\s*opt-in|opt-in|local-first/i, '.qa opt-in local-first policy'],
    [/decision\s+order|priority\s+order/i, 'workspace decision order'],
    [/gitignored|local-excluded|local-exclude/i, 'gitignore/local-exclude policy'],
    [/no\s+silent|silent\s+(?:repository\s+)?pollution|do\s+not\s+silently/i, 'no silent creation'],
    [/host\s+(?:-|–)?owned\s+external\s+storage[\s\S]{0,120}default|external\s+storage\s+default/i, 'host external fallback default'],
    [/planning\/history\s+only|planning\/history|planning\s+or\s+history\s+only/i, 'planning/history only'],
    [/memory\/index\.yaml[\s\S]{0,160}memory\/rules\/[\s\S]{0,160}memory\/patterns\/[\s\S]{0,160}memory\/feedback\/[\s\S]{0,160}memory\/rejected\//i, 'workspace memory layout paths'],
    [/user\s+(?:explicitly\s+)?authoriz|explicit\s+user\s+authorization/i, 'user authorization for creation/gitignore/persistent memory'],
    [/\.qa\/memory/i, 'preferred durable memory location .qa/memory'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P4-MEMORY-002 anchors the lightweight memory folders, templates, index source of truth, and 0-3 retrieval cap', () => {
  const testId = 'P4-MEMORY-002';
  const memorySkill = readRequiredMarkdown('project-qa-memory/SKILL.md', testId);
  const workspaceReference = readRequiredMarkdown('references/project-qa-workspace.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${memorySkill}\n${workspaceReference}\n${reportTemplate}`;

  const requiredPatterns = [
    [/\.qa\/memory\/[\s\S]{0,160}index\.yaml[\s\S]{0,160}rules\/[\s\S]{0,160}patterns\/[\s\S]{0,160}feedback\/[\s\S]{0,160}rejected\//i, 'approved folder architecture'],
    [/rules\/<module>\.yaml|rules\/order\.yaml/i, 'rule card template path'],
    [/patterns\/<pattern>\.yaml|patterns\/cache-inconsistency\.yaml/i, 'pattern card template path'],
    [/feedback\/QA-001\.md/i, 'raw human feedback template path'],
    [/rejected\/rejected-rules\.yaml/i, 'rejected candidate template path'],
    [/id[\s\S]{0,80}type[\s\S]{0,80}scope[\s\S]{0,80}trigger[\s\S]{0,80}rule[\s\S]{0,80}checks[\s\S]{0,80}source[\s\S]{0,80}confidence[\s\S]{0,80}last_verified_at[\s\S]{0,80}times_applied[\s\S]{0,80}times_confirmed/i, 'lightweight rule card fields'],
    [/feedback\/[\s\S]{0,120}raw\s+provenance[\s\S]{0,160}(?:must\s+not|not)\s+directly\s+drive\s+(?:QA\s+)?planning/i, 'feedback is raw provenance not planning input'],
    [/QA\s*->[\s\S]{0,80}find\s+issue[\s\S]{0,80}human\s+feedback[\s\S]{0,80}feedback\/QA-001\.md[\s\S]{0,120}human\s+approval[\s\S]{0,80}rules\/order\.yaml[\s\S]{0,80}index\.yaml[\s\S]{0,80}next\s+QA\s+retrieval/i, 'approved feedback-to-rule workflow'],
    [/index\.yaml[\s\S]{0,220}source\s+of\s+truth/i, 'index.yaml is source of truth'],
    [/opened\s+only\s+when[\s\S]{0,120}referenced\s+by\s+`?index\.yaml`?/i, 'items opened only when referenced by index.yaml'],
    [/at\s+most\s+3|max(?:imum)?\s+0[\s-]?3|0[\s-]?3\s+entries|cap(?:ped)?\s+at\s+0[\s-]?3/i, '0-3 retrieval cap'],
    [/scope\/trigger|scope[\s\S]{0,80}trigger/i, 'scope/trigger matching'],
    [/stale[\s\S]{0,120}under_review[\s\S]{0,120}surface[\s\S]{0,120}review/i, 'stale/under_review skipped for planning and surfaced for review'],
    [/more\s+than\s+3|top\s+3|remaining[\s\S]{0,120}surface[\s\S]{0,120}review/i, '>3 relevant entries select top 3 and surface rest'],
    [/dangling[\s\S]{0,120}mismatch[\s\S]{0,120}unsafe[\s\S]{0,120}(?:review\s+items?[\s\S]{0,120}not\s+crashes?|surfaced\s+for\s+review[\s\S]{0,120}does\s+not\s+stop\s+planning)/i, 'dangling/mismatch/unsafe IDs are review items not crashes'],
    [/no\s+benchmark\s+seed|benchmark\s+seed|no\s+auto[\s-]?memory|auto[\s-]?written/i, 'no benchmark seed auto-memory'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P4-MEMORY-003 anchors the feedback->rule->match->regression-check closed loop', () => {
  const testId = 'P4-MEMORY-003';
  const memorySkill = readRequiredMarkdown('project-qa-memory/SKILL.md', testId);
  const planningInputs = readRequiredMarkdown('references/qa_planning_inputs.md', testId);
  const projectPlan = readRequiredMarkdown('project-qa-plan/SKILL.md', testId);

  const memoryPatterns = [
    [/Match\s+And\s+Regression-Check\s+Generation/i, 'closed-loop section'],
    [/match:[\s\S]{0,200}paths:[\s\S]{0,200}symbols:[\s\S]{0,200}keywords:/i, 'rule match block with paths/symbols/keywords'],
    [/applies_when[\s\S]{0,200}do_not_apply_when/i, 'applicability gate fields'],
    [/checks:[\s\S]{0,120}must:[\s\S]{0,200}should:/i, 'typed must/should checks'],
    [/changed\s+files\/paths[\s\S]{0,160}changed\s+symbols[\s\S]{0,160}touched\s+key\s+flows|change\s+surface/i, 'collects current change surface'],
    [/memory_regression_check/i, 'emits memory_regression_check planning inputs'],
    [/never\s+auto-?PASS|never\s+support[\s\S]{0,80}PASS\s+by\s+(?:itself|themselves)/i, 'generated checks never auto-PASS'],
    [/Match\s+Safety[\s\S]{0,260}(?:\.\.|traversal)[\s\S]{0,200}(?:reject|surface)/i, 'match path safety rejects traversal/absolute'],
    [/Counter\s+Update[\s\S]{0,260}times_applied[\s\S]{0,200}times_confirmed/i, 'counter update rules'],
    [/Counter\s+Update[\s\S]{0,600}(?:human\s+approval|Admission\s*\/\s*Write\s+Gate)/i, 'counter updates require human approval'],
  ];
  for (const [pattern, label] of memoryPatterns) {
    assert.match(memorySkill, pattern, `${testId}: memory skill missing ${label}`);
  }

  assert.match(planningInputs, /memory_regression_check/i, `${testId}: planning-inputs contract must define memory_regression_check`);
  assert.match(planningInputs, /Memory\s+Rule\/Pattern\s+Mapping/i, `${testId}: planning-inputs contract must map memory rules to planning inputs`);
  assert.match(planningInputs, /source_type[\s\S]{0,40}`?memory`?/i, `${testId}: memory mapping sets source_type memory`);

  assert.match(projectPlan, /qa_planning_inputs/i, `${testId}: project-qa-plan must consume qa_planning_inputs`);
  assert.match(projectPlan, /memory_regression_check[\s\S]{0,220}(?:adopt|Must\s+Verify|Should\s+Verify)/i, `${testId}: project-qa-plan must decide adoption of memory regression checks`);
  assert.match(projectPlan, /never\s+satisfies\s+a\s+`?Must\s+Verify`?\s+item\s+by\s+itself|never\s+substitutes\s+for\s+current\s+execution\s+evidence/i, `${testId}: adopted memory check never substitutes for current evidence`);
});

test('P4-MEMORY-004 ships the executable memory matcher wired into the closed loop', () => {
  const testId = 'P4-MEMORY-004';
  const actualFiles = regularFilesUnder(packRoot);
  assert.ok(actualFiles.includes('tools/match-memory.mjs'), `${testId}: missing tools/match-memory.mjs`);

  const tool = readRequiredMarkdown('tools/match-memory.mjs', testId);
  const memorySkill = readRequiredMarkdown('project-qa-memory/SKILL.md', testId);

  const toolPatterns = [
    [/index\.yaml/i, 'reads index.yaml'],
    [/qa_planning_inputs/i, 'emits qa_planning_inputs'],
    [/memory_regression_check/i, 'emits memory_regression_check'],
    [/planning_only/i, 'planning_only use limit'],
    [/isSafeRelativeMemoryPath|\.\.|traversal/i, 'path safety handling'],
    [/RETRIEVAL_CAP\s*=\s*3|slice\(0,\s*RETRIEVAL_CAP\)/i, '0-3 retrieval cap'],
    [/applies_when|do_not_apply_when/i, 'applicability gate fields'],
    [/export function matchMemory/i, 'exports matchMemory for testing'],
    [/export function cli/i, 'exports cli for testing'],
    [/export function parseGitDiffToChangeSurface/i, 'exports git diff change-surface derivation'],
    [/--diff|--base|--head/i, 'supports diff/base/head change-surface modes'],
    [/looksLikeGitRef|Unsafe\s+git\s+ref/i, 'validates git refs before running git'],
    [/git\s+diff|['"]diff['"]/i, 'derives surface from git diff read-only'],
    [/export function defaultReadCardsForIndex/i, 'default disk card loader'],
    [/memoryRoot\s*=\s*dirname\(resolve\(indexPath\)\)/i, 'card loader roots at dirname(index)'],
    [/__parseError/i, 'malformed cards become review items not crashes'],
  ];
  for (const [pattern, label] of toolPatterns) {
    assert.match(tool, pattern, `${testId}: match-memory.mjs missing ${label}`);
  }

  const forbidden = [
    [/\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(/i, 'file writes'],
    [/\bfetch\s*\(|node:https?\b/i, 'network access'],
  ];
  for (const [pattern, label] of forbidden) {
    assert.ok(!pattern.test(tool), `${testId}: match-memory.mjs must not perform ${label}`);
  }

  assert.match(memorySkill, /match-memory\.mjs/i, `${testId}: memory skill must reference the executable matcher`);
  assert.match(memorySkill, /Executable\s+Matcher/i, `${testId}: memory skill must document the executable matcher`);
});

test('P1-FRONTMATTER-002 gives every skill matching minimal YAML metadata', () => {
  const testId = 'P1-FRONTMATTER-002';

  for (const relativePath of requiredSkillFiles) {
    const skillName = relativePath.split('/')[0];
    const frontmatter = parseFrontmatter(readRequiredMarkdown(relativePath, testId));

    assert.ok(frontmatter, `${testId}: ${relativePath} must start with a simple --- YAML frontmatter block`);
    assert.equal(frontmatter.name, skillName, `${testId}: ${relativePath} frontmatter name must match its folder`);
    assert.ok(frontmatter.description, `${testId}: ${relativePath} frontmatter description must be non-empty`);
  }
});

test('P1-SEMANTICS-003 preserves required Phase 1 semantic anchors', () => {
  const testId = 'P1-SEMANTICS-003';
  const corpus = corpusFromRequiredFiles(testId);
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const evidenceGuide = readRequiredMarkdown('references/evidence-guide.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const riskChecklist = readRequiredMarkdown('references/risk-checklist.md', testId);
  const qaExecute = readRequiredMarkdown('qa-execute/SKILL.md', testId);
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const qaPrinciples = readRequiredMarkdown('references/qa-principles.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const contractText = `${usingQa}\n${qaPlan}\n${qaExecute}\n${qaConclude}\n${qaPrinciples}\n${evidenceGuide}\n${qaReportTemplate}`;

  const semanticAnchorGroups = [
    ['manual trigger and one dedicated/reused QA subagent', [/manual(?:ly)?\s+(?:trigger|invoke|load|start)/i, /(?:one|single|dedicated|reused|same)\s+.*qa\s+subagent/i]],
    ['main-agent handoff of repository/target scope and user context', [/main\s+agent/i, /main\s+agent[^\n]{0,220}(?:scope|repository|target|user\s+context)/i, /handover|hands\s+off|handoff|pass(?:es)?\s+off/i]],
    ['QA subagent independently inspects the available Diff in qa-plan', [/`?qa\-?plan`?.{0,140}\bindependently\b/i, /`?actual\s+available\s+diff`?/i]],
    ['qa-plan records Repository Preflight before Diff inspection and Change Intake', [/Repository\s+Preflight/i, /before\s+Diff\s+inspection\s+and\s+Change\s+Intake/i, /\bindependently\b.{0,80}\b(?:read|reads|inspect|inspects|review|reviews)\b/, /actual\s+available\s+diff/i, /then\s+records\s+the\s+named\s+`?Change\s+Intake`?/i, /before\s+risk\s+planning/i]],
    ['named Change Intake', [/named\s+Change\s+Intake/i]],
    ['required intake fields', [/Observed\s+Facts/i, /Inferred\s+Intent/i, /Authoritative\s+Acceptance\s+Criteria/i, /Unresolved\s+Questions/i]],
    ['continuously maintained Markdown report', [/continuously|throughout|maintain/i, /markdown\s+report|qa-report\.md/i]],
    ['plan gate', [/plan\s+gate|planning\s+gate|gate\s+before\s+(?:execution|execute)/i]],
    ['targeted question or BLOCKED for missing critical context', [/targeted\s+question/i, /BLOCKED/i, /missing\s+critical\s+context/i]],
    ['risk priorities and five selectable validation layers', [/risk\s+priorit(?:y|ies)|P0|P1|P2/i, /five\s+(?:selectable\s+)?validation\s+layers|5\s+(?:selectable\s+)?validation\s+layers/i]],
    ['technology neutrality', [/technology\s+neutral|tool\s+agnostic|language\s+agnostic/i]],
    ['actual evidence', [/actual\s+evidence|observed\s+evidence|concrete\s+evidence/i]],
    ['six finding categories', [/six\s+finding\s+categories|6\s+finding\s+categories/i]],
    ['four statuses', [/four\s+statuses|4\s+statuses/i]],
    ['no-evidence-no-PASS', [/no\s+evidence\s*,?\s*no\s+PASS|without\s+evidence\s+.*not\s+PASS/i]],
    ['visible omissions/blockers', [/visible\s+(?:omissions|blockers)|omissions\s+.*blockers|blockers\s+.*omissions/i]],
    ['explicit read-only policy and writable surfaces', [/read\s*[-\s]?only/i, /qa\s+report|temporary\s+artifacts?/i]],
    ['verification traceability with status', [/risk[\s\S]{0,160}verification[\s\S]{0,160}evidence[\s\S]{0,160}status/i]],
    ['finding traceability when present', [/finding[\s\S]{0,160}risk[\s\S]{0,160}verification[\s\S]{0,160}evidence/i]],
    ['no test edits/read-only', [/must\s+not|do\s+not|never/i, /edit|change|modify|touch|write/i, /test\s+files?|tests?\b/i, /read\s*[-\s]?only|read\s+only/i]],
    ['rerun evidence', [/rerun\s+evidence|evidence\s+from\s+rerun/i]],
    ['human gate', [/human\s+gate|human\s+review|NEEDS_HUMAN_REVIEW/i]],
    ['no final release decision', [/no\s+final\s+release\s+decision|must\s+not\s+make\s+(?:the\s+)?final\s+release\s+decision/i]],
    ['residual risk', [/residual\s+risk/i]],
  ];

  for (const [label, patterns] of semanticAnchorGroups) {
    assertAnchorGroup(corpus, testId, label, patterns);
  }

  const fileSpecificFailures = [];

  const readOnlyProhibitions = [
    /(?:must\s+not|do\s+not|never|cannot)\s+(?:edit|change|modify|touch|write)\s+[\s\S]{0,220}(?:product\s+source|product\s+tests?|product\s+test\s+files?|project\s+files?|fixtures?|snapshots?|configuration|documentation)/i,
  ];

  for (const pattern of readOnlyProhibitions) {
    if (!pattern.test(contractText)) {
      fileSpecificFailures.push('workflow documentation must explicitly prohibit edits to product/project files');
      break;
    }
  }

  if (!/only\s+the\s+qa\s+report|qa\s+report\s+and\s+approved\s+temporary\s+artifacts?/i.test(contractText)) {
    fileSpecificFailures.push('workflow should identify the QA report and approved temporary artifacts as writable QA outputs');
  }

  if (!/Change\s+Intake/i.test(corpus)) {
    fileSpecificFailures.push('workflow contract must include a named Change Intake record');
  }

  const intakeFieldPatterns = [
    [/Observed\s+Facts/i, 'Observed Facts'],
    [/Inferred\s+Intent/i, 'Inferred Intent'],
    [/Authoritative\s+Acceptance\s+Criteria/i, 'Authoritative Acceptance Criteria'],
    [/Unresolved\s+Questions/i, 'Unresolved Questions'],
  ];

  for (const [pattern, label] of intakeFieldPatterns) {
    if (!pattern.test(qaReportTemplate)) {
      fileSpecificFailures.push(`workflow contract must include intake field: ${label}`);
    }
  }

  if (!/Inferred\s+Intent[\s\S]{0,220}Confidence[\s\S]{0,220}Basis/i.test(qaReportTemplate)) {
    fileSpecificFailures.push('Inferred Intent record must include both Confidence and Basis');
  }

  if (!/Authoritative\s+Acceptance\s+Criteria[\s\S]{0,220}Criterion[\s\S]{0,220}(?:Source\s+or\s+owner|Source\/owner)/i.test(qaReportTemplate)) {
    fileSpecificFailures.push('Authoritative Acceptance Criteria must include Criterion and Source or owner');
  }

  const findingHeadersPresent = [
    /\|\s*Risk\s+IDs\s*\|/i,
    /\|\s*Verification\s+IDs\s*\|/i,
    /\|\s*Evidence\s+reference\s*\|/i,
  ].every((pattern) => pattern.test(qaReportTemplate));
  if (!findingHeadersPresent) {
    fileSpecificFailures.push('Findings table must expose explicit Risk IDs, Verification IDs, and Evidence reference columns');
  }

  if (!containsAllLayerNames(riskChecklist)) {
    fileSpecificFailures.push('references/risk-checklist.md must expose exact validation layers: Static/unit, API/integration, E2E/system, Specialist non-functional, Manual acceptance');
  }

  if (!containsAllLayerNames(qaPlan)) {
    fileSpecificFailures.push('qa-plan/SKILL.md must expose exact validation layers: Static/unit, API/integration, E2E/system, Specialist non-functional, Manual acceptance');
  }

  if (!containsAllLayerNames(qaReportTemplate)) {
    fileSpecificFailures.push('templates/qa-report.md must expose exact validation layers: Static/unit, API/integration, E2E/system, Specialist non-functional, Manual acceptance');
  }

  if (!/(?:must\s+not|do\s+not|never|cannot)\s+(?:edit|change|modify|touch|write)\s+[^.\n]{0,260}(?:product\s+source|product\s+tests?|product\s+test\s+files?|project\s+files?|fixtures?|snapshots?|configuration|documentation)/i.test(contractText)) {
    fileSpecificFailures.push('workflow must define read-only restrictions for product source, product tests, fixtures, snapshots, configuration, and documentation');
  }

  if (!/missing\s+or\s+contradictory\s+objective\s+acceptance\s+prerequisite[\s\S]{0,220}PLAN\s+GATE[\s\S]{0,80}BLOCKED/i.test(contractText)) {
    fileSpecificFailures.push('unresolved critical or contradictory criteria must keep the Plan Gate as BLOCKED');
  }

  if (!/qa\s+subagent\s+[\s\S]{0,320}(?:independently\s+)?(?:reads?|inspects?|reviews?)\s+[\s\S]{0,320}diff/i.test(contractText)) {
    fileSpecificFailures.push('QA subagent must independently inspect the available Diff');
  }

  const legacyContractPatterns = [
    [/guarded\s+(?:Diff-related\s+)?stale\s+test/i, 'guarded stale-test update permission'],
    [/guarded\s+test\s+asset/i, 'guarded test-asset update permission'],
    [/product\s+source\s+hash/i, 'product-source hash protocol language'],
    [/stable\s+manifest/i, 'stable manifest protocol language'],
    [/product\s+source\s+hash[\s\S]{0,200}(?:exact\s+)?(?:hash\s+)?command\s+or\s+tool/i, 'exact hash command or tool protocol language'],
    [/same\s+(?:path\s+set|file\s+set)[\s\S]{0,200}(?:algorithm|ordering|procedure)[\s\S]{0,200}before\s+and\s+after/i, 'before/after hash scope and procedure language'],
    [/product\s+source\s+hash\s+before\s+and\s+after/i, 'product-source before/after hash language'],
  ];

  for (const relativePath of phase1CoreFiles) {
    const markdown = readRequiredMarkdown(relativePath, testId);

    for (const [pattern, label] of legacyContractPatterns) {
      if (pattern.test(markdown)) {
        fileSpecificFailures.push(`${relativePath} still contains legacy ${label}`);
      }
    }
  }

  if (!containsAllPriorityNames(qaPlan)) {
    fileSpecificFailures.push('qa-plan/SKILL.md must expose all four risk priorities: Must Verify, Should Verify, Optional, Explicitly Not Verified');
  }

  if (!containsAllPriorityNames(qaReportTemplate)) {
    fileSpecificFailures.push('templates/qa-report.md must expose all four risk priorities: Must Verify, Should Verify, Optional, Explicitly Not Verified');
  }

  assertNoSemanticFailures(testId, fileSpecificFailures);
});

test('P1-ROUTING-009 requires one-child triage-first routing with deterministic Full fallback', () => {
  const testId = 'P1-ROUTING-009';
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const qaTriage = readRequiredMarkdown('qa-triage/SKILL.md', testId);
  const qaLite = readRequiredMarkdown('qa-lite/SKILL.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const qaExecute = readRequiredMarkdown('qa-execute/SKILL.md', testId);
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const contractText = `${usingQa}\n${qaTriage}\n${qaLite}\n${qaPlan}\n${qaExecute}\n${qaConclude}`;

  const requiredPatterns = [
    [/one\s+dedicated\s+QA\s+subagent\s+session/i, 'one child/session route owner'],
    [/reuses?\s+that\s+same\s+session/i, 'same QA session across the route'],
    [/using-qa[\s\S]{0,240}qa-triage/i, 'using-qa routes to qa-triage first'],
    [/qa-triage[\s\S]{0,220}(?:`?qa-lite`?|`?qa-plan`?)[\s\S]{0,220}`?qa-execute`?[\s\S]{0,220}`?qa-conclude`?/i, 'triage routes through qa-lite or qa-plan then execute and conclude'],
    [/(?:`?qa-plan`?\s*→\s*`?qa-execute`?\s*→\s*`?qa-conclude`?|`?qa-plan`?[\s\S]{0,220}`?qa-execute`?[\s\S]{0,220}`?qa-conclude`?)/i, 'exact full route remains plan->execute->conclude'],
    [/(?:re-evaluate|escalat|fallback|route[s]?) to Full/i, 'explicit escalation action'],
    [/ambiguous[\s\S]{0,260}(?:must|should|routes?|reroute|redirect|escalat)[\s\S]{0,260}`?qa-plan`?/i, 'ambiguous cases escalate to Full'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(contractText, pattern, `${testId}: missing ${label}`);
  }
});

test('P1-LITE-SEMANTICS-010 enforces Lite eligibility, escalation, and evidence integrity', () => {
  const testId = 'P1-LITE-SEMANTICS-010';
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const qaTriage = readRequiredMarkdown('qa-triage/SKILL.md', testId);
  const qaLite = readRequiredMarkdown('qa-lite/SKILL.md', testId);
  const qaLiteTriageReference = readRequiredMarkdown('references/qa-lite-triage.md', testId);
  const qaLiteReport = readRequiredMarkdown('templates/qa-lite-report.md', testId);
  const contractText = `${usingQa}\n${qaTriage}\n${qaLite}\n${qaLiteTriageReference}\n${qaLiteReport}`;

  const routeEscalationPatterns = [
    [/cross-module[\s\S]{0,220}(?:architecture|scope|risk)[\s\S]{0,220}(?:escalat|route|forward|redirect)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'cross-module/architecture escalation'],
    [/(?:security|privacy)[\s\S]{0,220}(?:issue|concern|constraint|scope|gap)[\s\S]{0,220}(?:escalat|forward|route)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'security/privacy escalation'],
    [/data\s+migration[\s\S]{0,220}(?:risk|impact|scope)[\s\S]{0,220}(?:escalat|forward|route)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'data migration escalation'],
    [/(?:permissions?|release|authorization)[\s\S]{0,220}(?:risk|constraint|request|scope)[\s\S]{0,220}(?:escalat|route|escalates?)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'permissions/release escalation'],
    [/(?:environment|tool|data)\s+uncertainty[\s\S]{0,220}Must\s+Verify[\s\S]{0,220}(?:escalat|route)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'environment/tool/data uncertainty escalation for Must Verify'],
    [/(?:generated\s+validation|generated\s+checks|generated\s+tests|`?generated`?)[\s\S]{0,220}(?:escalat|remain|route)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'generated validation escalation'],
    [/(?:repair|recovery|history|capability\s+scheduling)[\s\S]{0,220}(?:escalat|remain|route)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'repair/recovery/history/capability scheduling escalation'],
    [/(?:explicit\s+full|whole-?project|project\-?wide|audit)[\s\S]{0,220}(?:request|mode|goal|run)[\s\S]{0,220}(?:escalat|route|falls?\s+back)[\s\S]{0,220}(?:to\s+`?qa-plan`?|to\s+Full)/i, 'explicit Full/whole-project/audit request escalation'],
  ];

  const liteSemanticPatterns = [
    [/explicit\s+product\s+target/i, 'Lite route preserves explicit product target'],
    [/(?:preflight\s+[\s\S]{0,220}before\s+[\s\S]{0,220}(?:actual\s+)?Diff|preflight\s+[\s\S]{0,220}(?:Diff|source))/i, 'Lite runs preflight before Diff/source inspection'],
    [/(?:must\s+not|do\s+not|never)\s+(?:edit|change|modify|touch|write)\s+[\s\S]{0,220}(?:product\s+source|product\s+target|product\s+tests?|fixtures?|snapshots?|configuration|documentation)/i, 'Lite keeps read-only boundaries'],
    [/(?:no\s+evidence|without\s+evidence)[\s\S]{0,220}(?:must not|cannot|never|->)\s+PASS/i, 'Lite keeps no-evidence no-PASS'],
    [/four\s+statuses|4\s+statuses/i, 'Lite exposes exactly four statuses'],
    [/Overall\s+Status:\s*PASS\/FAIL\/BLOCKED\/NEEDS_HUMAN_REVIEW/i, 'Lite report exposes canonical overall status line'],
    [/Risk\s*(?:-|→)\s*Verification\s*(?:-|→)\s*Evidence/i, 'Lite output uses traceability chain'],
    [/human\s+gate|NEEDS_HUMAN_REVIEW/i, 'Lite keeps Human Gate semantics'],
    [/fresh\s+rerun\s+evidence/i, 'Lite reruns tracked after external repair'],
    [/(?:exact\s+relay|authoritative\s+report|child-report-relay-evidence|report-source)/i, 'Lite exact relay delivery'],
  ];

  const failures = [];
  for (const [pattern, label] of routeEscalationPatterns) {
    if (!pattern.test(contractText)) {
      failures.push(`qa-lite routing must enforce ${label}`);
    }
  }

  for (const [pattern, label] of liteSemanticPatterns) {
    if (!pattern.test(contractText)) {
      failures.push(`qa-lite contract missing ${label}`);
    }
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-APPLICABILITY-011 defines the mandatory QA applicability matrix taxonomy', () => {
  const testId = 'P1-APPLICABILITY-011';
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const qaTriage = readRequiredMarkdown('qa-triage/SKILL.md', testId);
  const qaLite = readRequiredMarkdown('qa-lite/SKILL.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const qaExecute = readRequiredMarkdown('qa-execute/SKILL.md', testId);
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const qaPrinciples = readRequiredMarkdown('references/qa-principles.md', testId);
  const riskChecklist = readRequiredMarkdown('references/risk-checklist.md', testId);
  const qaLiteTriageReference = readRequiredMarkdown('references/qa-lite-triage.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const qaLiteReportTemplate = readRequiredMarkdown('templates/qa-lite-report.md', testId);
  const governingContractText = `${usingQa}\n${qaTriage}\n${qaLite}\n${qaPlan}\n${qaExecute}\n${qaConclude}\n${qaPrinciples}\n${riskChecklist}\n${qaLiteTriageReference}\n${qaReportTemplate}\n${qaLiteReportTemplate}`;
  const failures = [];

  for (const category of missingLiteralValues(governingContractText, canonicalQaApplicabilityCategories)) {
    failures.push(`Phase 1 governing workflow/reference/templates must expose QA applicability category: ${category}`);
  }

  for (const assessment of missingLiteralValues(governingContractText, canonicalQaApplicabilityAssessments)) {
    failures.push(`Phase 1 governing workflow/reference/templates must expose QA applicability assessment: ${assessment}`);
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-APPLICABILITY-012 keeps applicability assessments distinct from execution statuses', () => {
  const testId = 'P1-APPLICABILITY-012';
  const overlappingLabels = canonicalQaApplicabilityAssessments.filter((assessment) => canonicalQaExecutionStatuses.includes(assessment));

  assert.deepEqual(
    overlappingLabels,
    [],
    `${testId}: applicability assessments must not reuse canonical execution statuses PASS, FAIL, BLOCKED, NEEDS_HUMAN_REVIEW`,
  );
});

test('P1-APPLICABILITY-013 requires Full and Lite reports to carry every matrix category', () => {
  const testId = 'P1-APPLICABILITY-013';
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const qaLiteReportTemplate = readRequiredMarkdown('templates/qa-lite-report.md', testId);
  const failures = [];

  for (const [relativePath, markdown] of [
    ['templates/qa-report.md', qaReportTemplate],
    ['templates/qa-lite-report.md', qaLiteReportTemplate],
  ]) {
    for (const category of missingLiteralValues(markdown, canonicalQaApplicabilityCategories)) {
      failures.push(`${relativePath} must not silently omit QA applicability category: ${category}`);
    }
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-APPLICABILITY-014 gates Full and Lite execution on complete category applicability assessment', () => {
  const testId = 'P1-APPLICABILITY-014';
  const qaTriage = readRequiredMarkdown('qa-triage/SKILL.md', testId);
  const qaLite = readRequiredMarkdown('qa-lite/SKILL.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const qaLiteTriageReference = readRequiredMarkdown('references/qa-lite-triage.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const qaLiteReportTemplate = readRequiredMarkdown('templates/qa-lite-report.md', testId);
  const fullPlanContract = `${qaPlan}\n${qaReportTemplate}`;
  const liteContract = `${qaTriage}\n${qaLite}\n${qaLiteTriageReference}\n${qaLiteReportTemplate}`;
  const failures = [];

  recordMissingPattern(
    failures,
    fullPlanContract,
    'qa-plan/SKILL.md|templates/qa-report.md',
    'Full QA Plan Gate requires the QA applicability matrix to assess all 11 categories before opening',
    /QA\s+Plan\s+Gate[\s\S]{0,360}(?:applicability\s+matrix|QA\s+applicability)[\s\S]{0,220}(?:all\s+11|11\s+categories|every\s+category)[\s\S]{0,160}(?:assessed|assessment|row)/i,
  );
  recordMissingPattern(
    failures,
    fullPlanContract,
    'qa-plan/SKILL.md|templates/qa-report.md',
    'Full route records one applicability row for every canonical category',
    /(?:one\s+row|row\s+for\s+each|every\s+row)[\s\S]{0,220}(?:Static\/build|Contract\/API)[\s\S]{0,220}(?:Accessibility\/visual|Regression)/i,
  );
  recordMissingPattern(
    failures,
    liteContract,
    'qa-triage/qa-lite/references/qa-lite-triage.md|templates/qa-lite-report.md',
    'Lite assesses all 11 categories within its bounded profile or escalates to Full',
    /Lite[\s\S]{0,260}(?:applicability\s+matrix|QA\s+applicability)[\s\S]{0,260}(?:all\s+11|11\s+categories|every\s+category)[\s\S]{0,260}(?:escalat|route|fallback)[\s\S]{0,160}Full/i,
  );
  recordMissingPattern(
    failures,
    liteContract,
    'qa-triage/qa-lite/references/qa-lite-triage.md|templates/qa-lite-report.md',
    'Lite escalation when bounded-profile evidence cannot justify category assessments',
    /bounded\s+profile[\s\S]{0,260}(?:cannot|can\s+not|unable|insufficient)[\s\S]{0,220}(?:justify|support)[\s\S]{0,180}(?:applicability\s+assessment|category\s+assessment|matrix)[\s\S]{0,220}(?:escalat|route|fallback)[\s\S]{0,160}Full/i,
  );

  assertNoSemanticFailures(testId, failures);
});

test('P1-APPLICABILITY-015 blocks Conclusion Gate on incomplete or unsupported applicability rows', () => {
  const testId = 'P1-APPLICABILITY-015';
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const qaLiteReportTemplate = readRequiredMarkdown('templates/qa-lite-report.md', testId);
  const conclusionContract = `${qaConclude}\n${qaReportTemplate}\n${qaLiteReportTemplate}`;
  const failures = [];

  const conclusionGateRules = [
    ['missing QA applicability matrix rows block the QA Conclusion Gate', /QA\s+Conclusion\s+Gate[\s\S]{0,360}(?:missing\s+rows?|omitted\s+rows?|missing\s+applicability)[\s\S]{0,180}BLOCKED/i],
    ['unjustified Not Applicable rows block the QA Conclusion Gate', /Not\s+Applicable[\s\S]{0,220}(?:justification|reason|rationale)[\s\S]{0,220}(?:missing|absent|required)[\s\S]{0,220}BLOCKED/i],
    ['Deferred rows require an owner and trigger before completion', /Deferred[\s\S]{0,220}(?:owner|responsible)[\s\S]{0,220}(?:trigger|resume|revisit|rerun)[\s\S]{0,220}(?:missing|absent|required|ownerless|triggerless)[\s\S]{0,220}BLOCKED/i],
    ['unresolved Required work blocks completion', /Required[\s\S]{0,220}(?:unresolved|incomplete|open|not\s+done)[\s\S]{0,220}(?:QA\s+Conclusion\s+Gate|completion|COMPLETE)[\s\S]{0,160}BLOCKED/i],
    ['Required work needs satisfactory evidence before PASS or completion', /Required[\s\S]{0,220}(?:satisfactory\s+)?evidence[\s\S]{0,220}(?:missing|absent|without|no\s+evidence)[\s\S]{0,220}(?:BLOCKED|cannot\s+complete|must\s+not\s+complete|not\s+PASS)/i],
    ['Blocked applicability rows record missing prerequisites and rerun conditions', /Blocked[\s\S]{0,220}missing\s+prerequisites?[\s\S]{0,220}rerun\s+conditions?/i],
  ];

  for (const [label, pattern] of conclusionGateRules) {
    recordMissingPattern(failures, conclusionContract, 'qa-conclude/SKILL.md|templates/qa-report.md|templates/qa-lite-report.md', label, pattern);
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-APPLICABILITY-016 risk checklist defines default selection signals for every canonical category', () => {
  const testId = 'P1-APPLICABILITY-016';
  const riskChecklist = readRequiredMarkdown('references/risk-checklist.md', testId);
  const rows = markdownTableRows(riskChecklist);
  const failures = [];
  const requiredSignalPatterns = new Map([
    ['Static/build', /source|config|schema|dependency|generated|build|type|lint/i],
    ['Unit', /local\s+logic|branches|calculations|error\s+handling/i],
    ['Integration', /component\s+collaboration|persistence|service|queue|cache|external\s+boundar/i],
    ['Contract/API', /HTTP|RPC|event|CLI|schema|public\s+format/i],
    ['E2E', /critical\s+(?:user|system)\s+flows?|supported\s+boundar/i],
    ['Database/migration', /schema|query|persistence|data\s+conversion|migration|rollback|recovery/i],
    ['Security', /auth|authz|input-output|secrets|privacy|sensitive\s+data|dependencies/i],
    ['Performance', /query|algorithmic\s+cost|latency|throughput|retry|memory|limits/i],
    ['Compatibility', /public\s+contracts|platform|version|browser|data\s+format|upgrade-downgrade/i],
    ['Accessibility/visual', /UI|interaction|layout|text|design\s+system|visible\s+workflows/i],
    ['Regression', /every\s+changed\s+behavior|configuration|affected|adjacent/i],
  ]);

  recordMissingPattern(
    failures,
    riskChecklist,
    'references/risk-checklist.md',
    'default signals are applicability defaults rather than automatic execution mandates',
    /defaults?[\s\S]{0,220}(?:not\s+automatic|not\s+execution\s+mandates|execution\s+mandates?)[\s\S]{0,220}(?:Not\s+Applicable|factual\s+evidence)/i,
  );

  for (const category of canonicalQaApplicabilityCategories) {
    const categoryRows = rows.filter((cells) => cells.includes(category));
    if (categoryRows.length !== 1) {
      failures.push(`references/risk-checklist.md must contain exactly one structured default signal row for ${category}`);
      continue;
    }

    const rowText = categoryRows[0].join(' | ');
    const signalPattern = requiredSignalPatterns.get(category);
    assert.ok(signalPattern, `${testId}: missing test signal pattern for ${category}`);
    if (!signalPattern.test(rowText)) {
      failures.push(`references/risk-checklist.md default signal row for ${category} is missing required change/project signals`);
    }
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-PLANNER-017 ships a read-only two-stage Planner artifact and deterministic validator contract', () => {
  const testId = 'P1-PLANNER-017';
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const qaTriage = readRequiredMarkdown('qa-triage/SKILL.md', testId);
  const qaLite = readRequiredMarkdown('qa-lite/SKILL.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const rubric = readRequiredMarkdown('references/applicability-rubric.md', testId);
  const profiles = readRequiredMarkdown('references/qa-profiles.md', testId);
  const fullReport = readRequiredMarkdown('templates/qa-report.md', testId);
  const liteReport = readRequiredMarkdown('templates/qa-lite-report.md', testId);
  const validator = readRequiredMarkdown('tools/validate-qa-plan.mjs', testId);
  const schemaText = readRequiredMarkdown('schemas/qa-plan.schema.json', testId);
  const schema = JSON.parse(schemaText);
  const workflow = `${usingQa}\n${qaTriage}\n${qaLite}\n${qaPlan}\n${qaConclude}\n${rubric}\n${profiles}\n${fullReport}\n${liteReport}`;
  const failures = [];

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', `${testId}: schema must publish the Draft 2020-12 dialect`);
  assert.equal(schema.$id, 'https://qa-skills.local/schemas/qa-plan.schema.json', `${testId}: schema must publish the stable QA plan ID`);
  assert.equal(schema.additionalProperties, false, `${testId}: top-level QA plan object must be closed`);
  assert.deepEqual(schema.properties.profile.enum, ['Lite', 'Full'], `${testId}: Audit must not become a third route profile`);
  assert.deepEqual(schema.$defs.rigor.properties.level.enum, ['Standard', 'Audit'], `${testId}: Audit belongs to Full-route rigor metadata`);
  assert.ok(schema.$defs.changeIntake.required.includes('observedFacts'), `${testId}: structured Change Intake must include Observed Facts`);
  assert.ok(schema.$defs.changeIntake.required.includes('inferredIntent'), `${testId}: structured Change Intake must include Inferred Intent`);
  assert.equal(schema.$defs.conclusion.properties.releaseDecision.const, 'none', `${testId}: structured conclusion must not grant release approval`);
  assert.deepEqual(schema.$defs.evidence.allOf[0].then.required, ['command', 'exitCode'], `${testId}: command evidence alone must require command and exitCode`);

  const requiredPatterns = [
    [/qa-plan\/v1/i, 'versioned Planner artifact'],
    [/Planner[\s\S]{0,220}(?:creates?|maintains?|updates?)[\s\S]{0,220}(?:JSON|artifact)/i, 'same QA subagent owns the Planner artifact'],
    [/Markdown\s+report[\s\S]{0,220}authoritative/i, 'Markdown report remains authoritative'],
    [/not\s+product\s+QA\s+evidence|never\s+product\s+evidence/i, 'Planner artifact is not product evidence'],
    [/validate-qa-plan\.mjs[\s\S]{0,220}--json/i, 'plan-stage deterministic validator invocation'],
    [/--require-conclusion/i, 'conclusion-stage deterministic validation'],
    [/actual\s+(?:status|statuses)[\s\S]{0,180}evidence\s+refs?[\s\S]{0,180}(?:after\s+execution|conclusion)/i, 'execution results are added only after planning'],
    [/Node\s+is\s+unavailable[\s\S]{0,220}(?:do\s+not\s+install|without\s+install|manual)/i, 'Node-unavailable manual fallback without install'],
    [/Lite[\s\S]{0,220}(?:no|must\s+have\s+no|does\s+not\s+allow)[\s\S]{0,120}`?Blocked`?[\s\S]{0,80}`?Deferred`?/i, 'Lite forbids Blocked and Deferred matrix rows'],
    [/Audit[\s\S]{0,180}Full[\s\S]{0,180}approvalRef/i, 'Audit remains approved Full-route rigor'],
    [/validation\s+success[\s\S]{0,180}(?:planning\s+consistency|consistency\s+only)[\s\S]{0,180}(?:not\s+evidence|never\s+evidence)/i, 'validator success is consistency rather than evidence'],
  ];
  for (const [pattern, label] of requiredPatterns) {
    recordMissingPattern(failures, workflow, 'Phase 1 Planner workflow/references/templates', label, pattern);
  }

  const forbiddenValidatorPatterns = [
    [/node:child_process|\bspawn(?:Sync)?\s*\(|\bexec(?:File|FileSync|Sync)?\s*\(/i, 'command execution'],
    [/\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(/i, 'file writes'],
    [/\bfetch\s*\(|node:https?|node:http/i, 'network access'],
  ];
  for (const [pattern, label] of forbiddenValidatorPatterns) {
    if (pattern.test(validator)) failures.push(`tools/validate-qa-plan.mjs must not perform ${label}`);
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-POLICY-006 keeps status precedence, evidence safety, gates, and taxonomy consistent', () => {
  const testId = 'P1-POLICY-006';
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const qaExecute = readRequiredMarkdown('qa-execute/SKILL.md', testId);
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const qaPrinciples = readRequiredMarkdown('references/qa-principles.md', testId);
  const riskChecklist = readRequiredMarkdown('references/risk-checklist.md', testId);
  const evidenceGuide = readRequiredMarkdown('references/evidence-guide.md', testId);
  const findingClassification = readRequiredMarkdown('references/finding-classification.md', testId);
  const humanGates = readRequiredMarkdown('references/human-gates.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const policyContractText = `${usingQa}\n${qaPlan}\n${qaExecute}\n${qaConclude}\n${qaPrinciples}\n${evidenceGuide}\n${qaReportTemplate}`;
  const failures = [];

  const canonicalCategories = [
    'product defect',
    'test or verification issue',
    'environment/data/permission/dependency/tooling issue',
    'requirement or acceptance-criteria issue',
    'needs-human-judgment issue',
    'temporarily unconfirmed issue',
  ];

  for (const [relativePath, markdown] of [
    ['references/finding-classification.md', findingClassification],
    ['references/qa-principles.md', qaPrinciples],
    ['qa-execute/SKILL.md', qaExecute],
    ['qa-conclude/SKILL.md', qaConclude],
    ['templates/qa-report.md', qaReportTemplate],
  ]) {
    for (const category of canonicalCategories) {
      if (!markdown.toLowerCase().includes(category)) {
        failures.push(`${relativePath} must use canonical finding category: ${category}`);
      }
    }
  }

  const canonicalPriorities = [
    'Must Verify',
    'Should Verify',
    'Optional',
    'Explicitly Not Verified',
  ];

  for (const [relativePath, markdown] of [
    ['qa-plan/SKILL.md', qaPlan],
    ['references/risk-checklist.md', riskChecklist],
    ['templates/qa-report.md', qaReportTemplate],
  ]) {
    for (const priority of canonicalPriorities) {
      if (!markdown.includes(priority)) {
        failures.push(`${relativePath} must use canonical risk priority: ${priority}`);
      }
    }
  }

  for (const [relativePath, markdown] of [
    ['qa-plan/SKILL.md', qaPlan],
    ['references/risk-checklist.md', riskChecklist],
    ['templates/qa-report.md', qaReportTemplate],
  ]) {
    if (!containsAllLayerNames(markdown)) {
      failures.push(`${relativePath} must expose exact validation layers: Static/unit, API/integration, E2E/system, Specialist non-functional, Manual acceptance`);
    }
  }

  const policyRequirements = [
    [policyContractText, 'using-qa/qa-principles/qa-plan', 'main-agent handoff to QA subagent and user context', /main\s+agent\s+(?:owns|hands\s+off|hands?)\s+.*(?:scope|repository|target|user\s+context)/i],
    [policyContractText, 'using-qa/qa-execute', 'independent Diff review by subagent', /qa\s+subagent\s+[\s\S]{0,240}independently\s+[\s\S]{0,240}(?:reads?|inspects?|reviews?)\s+[\s\S]{0,240}diff/i],
    [qaReportTemplate, 'templates/qa-report.md', 'named Change Intake record', /Change\s+Intake/],
    [qaReportTemplate, 'templates/qa-report.md', 'observed facts field', /Observed\s+Facts/i],
    [qaReportTemplate, 'templates/qa-report.md', 'inferred intent with confidence and basis', /Inferred\s+Intent[\s\S]{0,260}Confidence[\s\S]{0,260}Basis/i],
    [qaReportTemplate, 'templates/qa-report.md', 'authoritative acceptance criteria criterion', /Authoritative\s+Acceptance\s+Criteria[\s\S]{0,260}Criterion/i],
    [qaReportTemplate, 'templates/qa-report.md', 'authoritative acceptance criteria source or owner', /Authoritative\s+Acceptance\s+Criteria[\s\S]{0,260}Source\s+or\s+owner/i],
    [qaReportTemplate, 'templates/qa-report.md', 'unresolved questions field', /Unresolved\s+Questions/i],
    [policyContractText, 'all policy files', 'read-only workflow boundaries', /(?:must\s+not|do\s+not|never)\s+(?:edit|change|modify|touch|write)\s+(?:the\s+)?(?:product\s+source|product\s+tests?|fixtures?|snapshots?|configuration|documentation)/i],
    [policyContractText, 'using-qa/SKILL.md|qa-report.md', 'writable outputs', /qa\s+report|approved\s+temporary\s+artifact/i],
    [policyContractText, 'qa-conclude/templates', 'required verification traceability', /risk[\s\S]{0,120}verification[\s\S]{0,120}evidence[\s\S]{0,120}status/i],
    [policyContractText, 'qa-conclude/templates', 'finding traceability when present', /finding[\s\S]{0,120}risk[\s\S]{0,120}(?:\/|\s+)verification[\s\S]{0,120}evidence/i],
    [policyContractText, 'using-qa', 'Plan Gate remains BLOCKED when objective conditions are missing or contradictory', /missing\s+or\s+contradictory\s+objective\s+acceptance\s+prerequisite[\s\S]{0,220}PLAN\s+GATE[\s\S]{0,120}BLOCKED/i],
    [findingClassification, 'references/finding-classification.md', 'missing objective prerequisite', /missing\s+or\s+contradictory\s+objective\s+acceptance\s+prerequisite/i],
    [findingClassification, 'references/finding-classification.md', 'BLOCKED precedence', /affected\s+verification\s+and\s+overall\s+status[\s\S]{0,160}\bBLOCKED\b/i],
    [findingClassification, 'references/finding-classification.md', 'subjective human-review distinction', /(?:objective\s+evidence[\s\S]{0,160}subjective[\s\S]{0,160}NEEDS_HUMAN_REVIEW|NEEDS_HUMAN_REVIEW[\s\S]{0,160}objective\s+evidence[\s\S]{0,160}subjective)/i],
    [humanGates, 'references/human-gates.md', 'human-gate objective prerequisite rule', /missing\s+or\s+contradictory\s+objective\s+acceptance\s+prerequisite[\s\S]{0,160}\bBLOCKED\b/i],
    [humanGates, 'references/human-gates.md', 'human-gate status precedence', /when\s+both\s+apply[\s\S]{0,200}\bBLOCKED\b/i],
    [usingQa, 'using-qa/SKILL.md', 'entry status precedence', /status\s+precedence/i],
    [qaPlan, 'qa-plan/SKILL.md', 'planning status precedence', /status\s+precedence/i],
    [qaReportTemplate, 'templates/qa-report.md', 'QA Plan Gate placeholder', /QA\s+Plan\s+Gate:\s*OPEN\/BLOCKED/i],
    [qaReportTemplate, 'templates/qa-report.md', 'QA Conclusion Gate placeholder', /QA\s+Conclusion\s+Gate:\s*COMPLETE\/BLOCKED/i],
    [evidenceGuide, 'references/evidence-guide.md', 'evidence minimization and redaction', /minimi[sz](?:e|ation)[\s\S]{0,160}redact[\s\S]{0,200}(?:credentials?|tokens?|secrets?)/i],
    [evidenceGuide, 'references/evidence-guide.md', 'personal and production data redaction', /(?:personal\s+data|PII)[\s\S]{0,160}production\s+data/i],
    [evidenceGuide, 'references/evidence-guide.md', 'untrusted evidence inputs', /requirements?[\s\S]{0,160}Diffs?[\s\S]{0,160}logs?[\s\S]{0,160}test\s+output[\s\S]{0,200}untrusted\s+data/i],
    [evidenceGuide, 'references/evidence-guide.md', 'embedded instructions forbidden', /(?:do\s+not|never)\s+(?:follow|execute)[\s\S]{0,120}embedded\s+instructions?/i],
    [evidenceGuide, 'references/evidence-guide.md', 'risky command approval', /human\s+approval[\s\S]{0,200}(?:install|update)[\s\S]{0,200}(?:network|external\s+services?)[\s\S]{0,240}(?:production|sensitive)[\s\S]{0,240}(?:destructive|irreversible)/i],
    [findingClassification, 'references/finding-classification.md', 'generic unavailable runner rule', /unavailable\s+required\s+runner[\s\S]{0,160}(?:tool|dependency|environment)/i],
    [qaReportTemplate, 'templates/qa-report.md', 'generic runner example', /unavailable\s+required\s+runner[\s\S]{0,160}missing-qa-runner/i],
  ];

  for (const [markdown, relativePath, label, pattern] of policyRequirements) {
    if (!pattern.test(markdown)) {
      failures.push(`${relativePath} is missing ${label}`);
    }
  }

  const usingQaOwnershipPatterns = [
    /one dedicated QA subagent session/i,
    /reuses?\s+that same session/i,
    /`?qa\-?plan`?\s*→\s*`?qa\-?execute`?\s*→\s*`?qa\-?conclude`?/i,
    /`?qa\-?plan`?.{0,260}\bindependently\b.{0,160}(?:read|reads?|reading|inspect|inspecting|review|reviews|reviewing).{0,120}`?actual\s+available\s+diff`?/i,
  ];
  const usingQaDiffOrderPattern = /`?qa\-?plan`?.{0,220}\s+begins\s+by.{0,220}(?:read|reads?|reading|inspect|inspecting|review|reviews|reviewing).{0,260}`?actual\s+available\s+diff`?.{0,260}then\s+records\s+the\s+named\s+`?Change\s+Intake`?.{0,120}before\s+risk\s+planning/i;

  for (const pattern of usingQaOwnershipPatterns) {
    if (!pattern.test(usingQa)) {
      failures.push(`using-qa/SKILL.md must include qa-plan ownership and workflow pattern: ${pattern.source}`);
    }
  }

  const orderedPolicyAnchorPatterns = [
    ['Repository Preflight', /Repository\s+Preflight/i],
    ['independent actual available Diff inspection', /independently[\s\S]{0,220}(?:reads?|reading|inspect|inspecting|review|reviews|reviewing)[\s\S]{0,260}actual\s+available\s+Diff/i],
    ['named Change Intake', /named\s+`?Change\s+Intake`?/i],
    ['Objective and Scope', /`?Objective\s+and\s+Scope`?/i],
    ['Risk Analysis', /Risk\s+Analysis/i],
  ];
  let policySearchOffset = 0;
  let policyOrderValid = true;

  for (const [, pattern] of orderedPolicyAnchorPatterns) {
    const match = pattern.exec(qaPlan.slice(policySearchOffset));
    if (!match) {
      policyOrderValid = false;
      break;
    }
    policySearchOffset += match.index + match[0].length;
  }

  if (!policyOrderValid) {
    failures.push('qa-plan/SKILL.md must order: Repository Preflight -> independent actual available Diff inspection -> named Change Intake -> Objective and Scope -> Risk Analysis');
  }

  const usingQaDiffOrderByOrder = /`?qa\-?plan`?[\s\S]{0,320}actual\s+available\s+diff[\s\S]{0,320}named\s+`?change\s+intake`?/i.test(usingQa) && /before\s+risk\s+planning/i.test(usingQa);
  const usingQaDiffOrderFallbackPattern = /`?qa\-?plan`?.{0,220}\s+begins\s+by.{0,220}(?:read|reads?|reading|inspect|inspecting|review|reviews|reviewing).{0,260}`?actual\s+available\s+diff`?.{0,260}then\s+records\s+the\s+named\s+`?Change\s+Intake`?.{0,120}before\s+risk\s+planning/i;
  if (!usingQaDiffOrderPattern.test(usingQa) && !usingQaDiffOrderByOrder && !usingQaDiffOrderFallbackPattern.test(usingQa)) {
    failures.push('using-qa/SKILL.md must require qa-plan to inspect diff before recording Change Intake (before risk planning)');
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-PREFLIGHT-007 requires repository preflight before Diff-dependent QA', () => {
  const testId = 'P1-PREFLIGHT-007';
  const usingQa = readRequiredMarkdown('using-qa/SKILL.md', testId);
  const qaPlan = readRequiredMarkdown('qa-plan/SKILL.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const contractText = `${usingQa}\n${qaPlan}\n${qaReportTemplate}`;
  const rolesSection = usingQa.match(/##\s+Roles([\s\S]*?)##\s+Required\s+Run/i)?.[1] || '';
  const requiredRunSection = usingQa.match(/##\s+Required\s+Run([\s\S]*?)##\s+Stop\s+Conditions/i)?.[1] || '';
  const failures = [];

  const requiredPatterns = [
    [rolesSection, 'using-qa/SKILL.md Roles', 'separate skill source and product target handoff with no target inference', /^- The main agent hands off[\s\S]{0,260}skill\s+source\s+path[\s\S]{0,180}product\s+target\s+path[\s\S]{0,260}(?:never|must\s+not|do\s+not)\s+infer[\s\S]{0,140}product\s+target[\s\S]{0,180}(?:skill\s+(?:source\s+)?path|skill\s+location|cwd|current\s+working\s+directory)/im],
    [rolesSection, 'using-qa/SKILL.md Roles', 'explicit target-only QA and self-test boundary', /^- The QA subagent validates only the explicit product target[\s\S]{0,600}(?:pack|skill-pack)\s+self-tests?[\s\S]{0,180}(?:not|never)[\s\S]{0,160}product\s+QA\s+evidence/im],
    [requiredRunSection, 'using-qa/SKILL.md Required Run', 'four separate supplied and resolved paths', /1\.[\s\S]{0,220}supplied\s+skill\s+source\s+path[\s\S]{0,120}resolved\s+skill\s+source\s+path[\s\S]{0,120}supplied\s+product\s+target\s+path[\s\S]{0,120}resolved\s+product\s+target\s+path/i],
    [requiredRunSection, 'using-qa/SKILL.md Required Run', 'multiple paths are distinguished without guessing', /multiple\s+paths[\s\S]{0,180}explicitly\s+distinguish[\s\S]{0,220}(?:do\s+not|never)\s+guess[\s\S]{0,120}BLOCKED/i],
    [requiredRunSection, 'using-qa/SKILL.md Required Run', 'minimal Repository Preflight precedes Diff inspection and Change Intake', /3\.[\s\S]{0,280}minimal\s+Repository\s+Preflight[\s\S]{0,260}(?:then|before)[\s\S]{0,180}(?:actual\s+available\s+)?Diff[\s\S]{0,180}Change\s+Intake/i],
    [qaPlan, 'qa-plan/SKILL.md', 'explicit target, separate paths, no inference, and literal Git scope', /explicit\s+product\s+target[\s\S]{0,260}separate\s+supplied\/resolved\s+skill\s+source\s+and\s+product\s+target\s+paths[\s\S]{0,260}never\s+infer\s+product\s+target[\s\S]{0,320}untrusted\s+literal\s+values[\s\S]{0,240}preserve\s+target\s+paths?\s+as\s+literal\s+scope[\s\S]{0,160}Git\s+operations/i],
    [qaPlan, 'qa-plan/SKILL.md', 'ambiguity missing or unreadable blocks with no fallback', /(?:ambiguous|missing|unreadable)[\s\S]{0,180}BLOCKED[\s\S]{0,180}(?:no\s+fallback|do\s+not\s+fall\s+back)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'Git context uses target probing without repository-configured helper execution', /(?:Git\s+(?:root|context)|repository\/worktree\s+root)[\s\S]{0,180}probing[\s\S]{0,160}target(?:\s+directory|\s+path)?[\s\S]{0,180}containing\s+directory[\s\S]{0,100}file\s+target[\s\S]{0,220}(?:must\s+not|do\s+not|cannot)\s+execute[\s\S]{0,160}repository-configured\s+(?:executable\s+)?helpers[\s\S]{0,260}(?:human\s+approval|BLOCKED)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'does not use .git presence detection', /(?:do\s+not|never|must\s+not)[\s\S]{0,120}\.git[\s\S]{0,120}(?:presence|existence|directory|folder)[\s\S]{0,120}(?:detect|detection|prove|identify)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'ancestor repo is not a valid baseline for untracked/no-history target', /ancestor\s+repo(?:sitory)?[\s\S]{0,180}(?:not|insufficient|invalid)[\s\S]{0,180}baseline[\s\S]{0,180}(?:untracked|no-history|no\s+history)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'only Diff-dependent checks blocked while non-Diff verification continues', /only\s+Diff-dependent\s+checks[\s\S]{0,180}BLOCKED[\s\S]{0,220}(?:continue|continues)[\s\S]{0,180}non-Diff\s+verification/i],
    [qaReportTemplate, 'templates/qa-report.md', 'Repository Preflight section before Change Intake', /##\s+Repository\s+Preflight[\s\S]*##\s+Change\s+Intake/i],
  ];

  for (const [markdown, relativePath, label, pattern] of requiredPatterns) {
    if (!pattern.test(markdown)) {
      failures.push(`${relativePath} is missing ${label}`);
    }
  }

  const preflightSection = qaReportTemplate.match(/##\s+Repository\s+Preflight([\s\S]*?)##\s+Change\s+Intake/i)?.[1] || '';
  const preflightFields = [...preflightSection.matchAll(/^\|\s*([^|-][^|]*?)\s*\|/gm)]
    .map((match) => match[1].trim())
    .filter((field) => field !== 'Repository Preflight field');
  assert.deepEqual(
    preflightFields,
    [
      'Skill source path',
      'Product target path',
      'Target decision',
      'Git context',
      'Target scope',
      'Baseline and scoped Diff',
      'Blocked reason and rerun condition',
      'Non-Diff limitations',
    ],
    `${testId}: templates/qa-report.md Repository Preflight must contain exactly the compact eight fields`,
  );

  const prohibitedPatterns = [
    [/Test-Path\s+\.git/i, 'Test-Path .git repository detection'],
    [/\bgit\s+-C\b/i, 'prescribed git -C command recipe'],
    [/(?:use|check|test|rely\s+on)[\s\S]{0,80}\.git\s+(?:directory|folder)?\s*(?:exists|existence)|\.git\s+(?:directory|folder)?\s*(?:exists|existence)[\s\S]{0,80}(?:means|proves|detects)/i, 'affirmative .git existence repository detection'],
    [/(?:pack\s+self-tests?|skill\s+self-tests?|discovery\s+checks)[\s\S]{0,160}(?:may|can|should)\s+(?:substitute|replace|stand\s+in)[\s\S]{0,160}product\s+QA/i, 'affirmative skill self-test substitution for product QA'],
    [/--literal-pathspecs/i, 'hardened pathspec command tutorial'],
    [/core\.fsmonitor=false/i, 'fsmonitor hardening tutorial'],
    [/<validated-commit-oid>|resolved\s+commit\s+OID/i, 'OID-specific baseline tutorial'],
    [/Git\s+worktree\s+topology|linked\s+worktree/i, 'worktree topology classification tutorial'],
  ];

  for (const [pattern, label] of prohibitedPatterns) {
    if (pattern.test(contractText)) {
      failures.push(`contract must prohibit ${label}`);
    }
  }

  assertNoSemanticFailures(testId, failures);
});

test('P1-OUTPUT-008 requires standalone canonical overall status marker in concluded reports', () => {
  const testId = 'P1-OUTPUT-008';
  const qaConclude = readRequiredMarkdown('qa-conclude/SKILL.md', testId);
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);
  const overallStatusLinePattern = /^Overall Status: PASS\/FAIL\/BLOCKED\/NEEDS_HUMAN_REVIEW$/m;

  assert.match(
    qaReportTemplate,
    overallStatusLinePattern,
    `${testId}: templates/qa-report.md must expose a standalone Overall Status placeholder line`,
  );

  assert.match(
    qaReportTemplate,
    /QA\s+Conclusion\s+Gate:\s*COMPLETE\/BLOCKED\s*\n\s*Overall Status: PASS\/FAIL\/BLOCKED\/NEEDS_HUMAN_REVIEW/i,
    `${testId}: Overall Status placeholder must be visibly next to the Conclusion Gate`,
  );

  const conclusionOutputRequirements = [
    [/standalone\s+`?Overall Status:/i, 'requires a standalone Overall Status marker'],
    [/replace[\s\S]{0,160}`?Overall Status: PASS\/FAIL\/BLOCKED\/NEEDS_HUMAN_REVIEW`?/i, 'requires replacing the template placeholder'],
    [/exactly\s+one[\s\S]{0,120}`?(?:PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)/i, 'requires exactly one canonical status'],
    [/own\s+line/i, 'requires the marker on its own line'],
    [/match(?:es)?[\s\S]{0,160}(?:traceability\s+table|summary\/traceability\s+table)[\s\S]{0,160}conclusion/i, 'requires consistency with traceability and conclusion'],
    [/(?:must\s+not|do\s+not|cannot)[\s\S]{0,180}(?:omitted|omit|implied\s+by\s+prose|only\s+implied|table)/i, 'prohibits omission or table/prose-only implication'],
    [/(?:conflict|missing\s+marker)[\s\S]{0,180}blocks?\s+completion[\s\S]{0,120}output\s+contract/i, 'blocks completion on missing or conflicting marker'],
  ];

  for (const [pattern, label] of conclusionOutputRequirements) {
    assert.match(qaConclude, pattern, `${testId}: qa-conclude/SKILL.md ${label}`);
  }
});

test('P2-M1-ENTRY-002 gives using-project-qa ownership of explicit whole-project QA only', () => {
  const testId = 'P2-M1-ENTRY-002';
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);

  const frontmatter = parseFrontmatter(usingProjectQa);
  assert.ok(frontmatter, `${testId}: using-project-qa must start with YAML frontmatter`);
  assert.equal(frontmatter.name, 'using-project-qa', `${testId}: frontmatter name must match the skill folder`);
  assert.match(frontmatter.description, /whole-project|project-wide|current project/i, `${testId}: description must advertise whole-project QA`);

  const requiredPatterns = [
    [/explicit\s+whole-project\s+QA\s+request/i, 'explicit whole-project QA trigger'],
    [/(?:must\s+not|do\s+not|never)[\s\S]{0,220}(?:broaden|overload|replace)[\s\S]{0,180}`?using-qa`?/i, 'does not overload using-qa'],
    [/Phase\s+1[\s\S]{0,160}`?using-qa`?[\s\S]{0,180}(?:requirement|fix|Diff)/i, 'Phase 1 remains the requirement/fix/Diff route'],
    [/Project\s+QA\s+Coordinator/i, 'Project QA Coordinator role'],
    [/Module\s+QA\s+Agents?[\s\S]{0,160}read-only/i, 'future Module QA Agents remain read-only'],
    [/project-qa-report\.md/i, 'project report template link'],
    [/project-qa-run-contract\.md/i, 'run contract link'],
    [/(?:absent|missing|ambiguous|unavailable|unsafe)[\s\S]{0,220}product\s+target[\s\S]{0,120}BLOCKED/i, 'BLOCKED on absent, ambiguous, unavailable, or unsafe target'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(usingProjectQa, pattern, `${testId}: using-project-qa/SKILL.md is missing ${label}`);
  }

  if (/qa-lite/i.test(usingProjectQa)) {
    assert.match(
      usingProjectQa,
      /`?qa-lite`?\s*(?:is|serves|acts|belongs|remains|works|is\s+not)?[\s\S]{0,220}(?:not|never|must\s+not)\s+(?:a|an|the)?[\s\S]{0,140}(?:project|project-?wide)[\s\S]{0,120}(?:mode|direct\s+route)/i,
      `${testId}: using-project-qa/SKILL.md is missing QA-Lite is explicitly not a project mode/direct route`,
    );
  }
});

test('P2-M1-MODE-003 defaults to PROJECT_QA_ONLY and requires explicit repair authorization', () => {
  const testId = 'P2-M1-MODE-003';
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${usingProjectQa}\n${reportTemplate}`;

  const requiredPatterns = [
    [/default(?:s)?\s+(?:mode\s+)?(?:is|to)\s+`?PROJECT_QA_ONLY`?/i, 'default PROJECT_QA_ONLY mode'],
    [/PROJECT_FIX_AND_RERUN[\s\S]{0,220}explicit\s+user\s+request/i, 'repair mode requires explicit user request'],
    [/(?:repair|fix-and-rerun)[\s\S]{0,220}recorded\s+user\s+authorization/i, 'repair requires recorded M4 authorization'],
    [/(?:must\s+not|do\s+not|never|cannot)[\s\S]{0,180}(?:infer|imply|auto-start|start)[\s\S]{0,180}(?:repair|PROJECT_FIX_AND_RERUN)/i, 'repair cannot be inferred'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M1-TARGET-004 requires explicit product target values without path fallback', () => {
  const testId = 'P2-M1-TARGET-004';
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);

  const requiredPatterns = [
    [/supplied\s+skill\s+source\s+path[\s\S]{0,180}resolved\s+skill\s+source\s+path/i, 'supplied and resolved skill source paths'],
    [/supplied\s+product\s+target\s+path[\s\S]{0,180}resolved\s+product\s+target\s+path/i, 'supplied and resolved product target paths'],
    [/(?:separate|distinct)\s+values/i, 'skill and product paths are separate values'],
    [/(?:must\s+not|do\s+not|never)\s+infer[\s\S]{0,220}product\s+target[\s\S]{0,220}(?:skill\s+(?:source\s+)?path|skill\s+location|cwd|current\s+working\s+directory|ancestor\s+repository)/i, 'no target inference from skill path, cwd, or ancestor repository'],
    [/current\s+actual\s+project\s+state[\s\S]{0,160}uncommitted\s+changes/i, 'snapshot includes current uncommitted state'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(usingProjectQa, pattern, `${testId}: using-project-qa/SKILL.md is missing ${label}`);
  }

  const snapshotIdentitySection = reportTemplate.match(/##\s+Project\s+Snapshot\s+Identity([\s\S]*?)##\s+Storage\s+Decision/i)?.[1] || '';
  const pathIdentityFields = [...snapshotIdentitySection.matchAll(/^\|\s*([^|-][^|]*?path)\s*\|/gmi)]
    .map((match) => match[1].trim());
  assert.deepEqual(
    pathIdentityFields,
    [
      'Supplied skill source path',
      'Resolved skill source path',
      'Supplied product target path',
      'Resolved product target path',
      'Target path',
    ],
    `${testId}: project report snapshot identity must record all four separate skill/product path identity values plus target path`,
  );
});

test('P2-M1-INTAKE-005 defines the required Project Intake fields', () => {
  const testId = 'P2-M1-INTAKE-005';
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const projectIntakeSection = reportTemplate.match(/##\s+Project\s+Intake([\s\S]*?)##\s+Scope\s+and\s+Non-goals/i)?.[1] || '';

  assert.ok(projectIntakeSection, `${testId}: project report must contain Project Intake before Scope and Non-goals`);
  for (const field of ['Observed Facts', 'Inferred Intent', 'Authoritative Acceptance Criteria', 'Unresolved Questions']) {
    assert.match(projectIntakeSection, new RegExp(field.replaceAll(' ', '\\s+'), 'i'), `${testId}: Project Intake missing ${field}`);
  }
  assert.match(projectIntakeSection, /Inferred\s+Intent[\s\S]{0,220}Confidence[\s\S]{0,220}Basis/i, `${testId}: Inferred Intent must record confidence and basis`);
  assert.match(projectIntakeSection, /Authoritative\s+Acceptance\s+Criteria[\s\S]{0,260}Criterion[\s\S]{0,260}Source\s+or\s+owner/i, `${testId}: acceptance criteria must record criterion and source or owner`);
});

test('P2-M1-SNAPSHOT-006 defines project QA snapshot identity fields', () => {
  const testId = 'P2-M1-SNAPSHOT-006';
  const runContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${runContract}\n${reportTemplate}`;

  const requiredPatterns = [
    [/qa_session_id[\s\S]{0,180}stable\s+logical\s+QA\s+session/i, 'qa_session_id stable logical session'],
    [/run_id[\s\S]{0,180}(?:one|single)\s+concrete\s+execution\s+attempt/i, 'run_id concrete attempt'],
    [/parent_run_id[\s\S]{0,180}optional\s+link/i, 'optional parent_run_id link'],
    [/target\s+path/i, 'target path'],
    [/snapshot\s+time/i, 'snapshot time'],
    [/Git\s*\/\s*working-tree\s+state|Git\s+and\s+working-tree\s+state/i, 'Git/working-tree state'],
    [/isolation-workspace\s+reference|isolation\s+workspace\s+reference/i, 'isolation workspace reference'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M1-STORAGE-007 requires ignored .qa storage or host-external fallback', () => {
  const testId = 'P2-M1-STORAGE-007';
  const runContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${runContract}\n${reportTemplate}`;

  const requiredPatterns = [
    [/\.qa\/runs\/<run_id>\//i, '.qa/runs/<run_id>/ path'],
    [/(?:ignored|local-excluded)[\s\S]{0,220}(?:without|no)[\s\S]{0,160}tracked-file\s+changes/i, 'local storage only when ignored/local-excluded with no tracked-file changes'],
    [/(?:otherwise|if\s+not)[\s\S]{0,180}host-owned\s+external\s+storage|host-external\s+storage[\s\S]{0,180}mandatory/i, 'host-external fallback'],
    [/(?:must\s+not|do\s+not|never)[\s\S]{0,180}(?:create|modify|touch)[\s\S]{0,180}tracked\s+files/i, 'no tracked-file mutation'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M1-AUTHORITY-008 separates authority domains and blocks PASS on mismatch', () => {
  const testId = 'P2-M1-AUTHORITY-008';
  const runContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${runContract}\n${reportTemplate}`;

  for (const domain of ['Evidence authority', 'Report-semantic authority', 'Run-state authority', 'Delivery authority']) {
    assert.match(combined, new RegExp(domain.replace('-', '[-\\s]'), 'i'), `${testId}: missing ${domain}`);
  }

  const requiredPatterns = [
    [/unexplained\s+mismatch[\s\S]{0,160}(?:prevents|prohibits|blocks)\s+`?PASS`?/i, 'unexplained mismatch prevents PASS'],
    [/SHA-256[\s\S]{0,160}byte\s+count/i, 'SHA-256 and byte count references'],
    [/completed-result\s+delivery|completed\s+result\s+delivery/i, 'completed-result delivery'],
    [/mirror-equality|mirror\s+equality/i, 'mirror equality'],
    [/atomic-write[\s\S]{0,220}(?:required|requirement)[\s\S]{0,220}isolated\s+workspace/i, 'M4 atomic-write requirement'],
    [/read-only[\s\S]{0,160}approval-required\s+permission\s+profiles/i, 'read-only and approval-required permission profiles'],
    [/Infrastructure-integrity[\s\S]{0,180}(?:blocks|prohibits|prevents)\s+`?PASS`?/i, 'infrastructure integrity blocks PASS'],
    [/objective\s+infrastructure-integrity\s+failure[\s\S]{0,180}maps\s+to\s+`?BLOCKED`?/i, 'objective infrastructure-integrity failure maps to BLOCKED'],
    [/subjective\s+decision[\s\S]{0,180}Human\s+Gate[\s\S]{0,180}`?BLOCKED`?\s+retains\s+precedence/i, 'subjective decision may be a Human Gate while BLOCKED retains precedence'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M1-REPORT-009 preserves canonical statuses and M3 execution labels', () => {
  const testId = 'P2-M1-REPORT-009';
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const statuses = ['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW'];

  assert.match(
    reportTemplate,
    /^Overall Status: PASS\/FAIL\/BLOCKED\/NEEDS_HUMAN_REVIEW$/m,
    `${testId}: project report must expose only the four canonical project statuses`,
  );
  assert.match(
    reportTemplate,
    /^Project QA Plan Gate: OPEN\/BLOCKED\/NEEDS_HUMAN_REVIEW$/m,
    `${testId}: project report must expose the three-state M2 Project QA Plan Gate placeholder`,
  );
  assert.ok(!/^Overall Status:.*\bSKIP\b/im.test(reportTemplate), `${testId}: SKIP must not be a project conclusion`);

  for (const status of statuses) {
    assert.match(reportTemplate, new RegExp(`\\b${status}\\b`), `${testId}: missing canonical status ${status}`);
  }

  const requiredSections = [
    'Run Identity',
    'Project Snapshot Identity',
    'Storage Decision',
    'Project Intake',
    'Scope and Non-goals',
    'Project Inventory',
    'Risk and Verification Plan',
    'Project QA Plan Gate',
    'Module Results',
    'Execution Evidence',
    'Authority and Manifest Integrity',
    'Findings',
    'Unverified and Blocked Items',
    'Human Review Items',
    'Cleanup/Retention',
    'Residual Risk',
    'Project QA Conclusion Gate',
    'Delivery Authority',
  ];

  for (const section of requiredSections) {
    assert.match(reportTemplate, new RegExp(`^##\\s+${section.replace(/[/-]/g, (match) => `\\${match}`)}$`, 'mi'), `${testId}: missing section ${section}`);
  }

  for (const activeLabel of ['Module Results', 'Execution Evidence']) {
    assert.doesNotMatch(reportTemplate, new RegExp(`${activeLabel}[\\s\\S]{0,120}deferred\\s+(?:until\\s+M3|through\\s+M2)`, 'i'), `${testId}: ${activeLabel} must be active in M3 rather than an M2 deferred placeholder`);
  }

  for (const activeLabel of ['Generated tests', 'repair']) {
    assert.match(reportTemplate, new RegExp(`${activeLabel}[\\s\\S]{0,220}active\\s+in\\s+M4`, 'i'), `${testId}: ${activeLabel} must be active in M4 under explicit boundaries`);
  }

  for (const deferredLabel of ['resume', 'history comparison']) {
    assert.match(reportTemplate, new RegExp(`${deferredLabel}[\\s\\S]{0,220}deferred\\s+(?:until\\s+later\\s+milestones|or\\s+forbidden\\s+in\\s+M4)`, 'i'), `${testId}: ${deferredLabel} must remain labeled deferred beyond M4`);
  }

  assert.doesNotMatch(reportTemplate, /Project\s+Inventory[\s\S]{0,120}Deferred\s+in\s+M1/i, `${testId}: Project Inventory must no longer be an M1-only deferred placeholder`);
  assert.doesNotMatch(reportTemplate, /Risk\s+and\s+Verification\s+Plan[\s\S]{0,120}Deferred\s+in\s+M1/i, `${testId}: Risk and Verification Plan must no longer be an M1-only deferred placeholder`);

  const failClosedContract = `${readRequiredMarkdown('using-project-qa/SKILL.md', testId)}\n${reportTemplate}`;
  assert.match(
    failClosedContract,
    /Project\s+`?PASS`?\s+is\s+permitted\s+only\s+when[\s\S]{0,260}every\s+important\s+module\/key\s+flow[\s\S]{0,220}Must\s+Verify[\s\S]{0,220}current\s+evidence/i,
    `${testId}: M3 must replace the M2 implementation-prerequisite block with current-evidence PASS rules`,
  );
});

test('P2-M2-ENTRY-002 routes the same Coordinator through project-qa-plan after setup', () => {
  const testId = 'P2-M2-ENTRY-002';
  const usingProjectQa = readRequiredMarkdown('using-project-qa/SKILL.md', testId);
  const projectPlan = readRequiredMarkdown('project-qa-plan/SKILL.md', testId);
  const combined = `${usingProjectQa}\n${projectPlan}`;

  const requiredPatterns = [
    [/same\s+Project\s+QA\s+Coordinator[\s\S]{0,260}project-qa-plan/i, 'same Coordinator reaches project-qa-plan'],
    [/after\s+intake,\s+snapshot,\s+and\s+storage\s+setup/i, 'route happens after intake, snapshot, and storage setup'],
    [/(?:do\s+not|never|must\s+not)[\s\S]{0,180}parallel\s+planning\s+pipeline/i, 'no parallel planning pipeline'],
    [/Project\s+Intake[\s\S]{0,260}(?:does\s+not\s+require|without)\s+(?:a\s+)?Diff/i, 'Project Intake without Diff'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }
});

test('P2-M2-SEMANTICS-003 covers inventory classification flow gate and M3 handoff semantics', () => {
  const testId = 'P2-M2-SEMANTICS-003';
  const projectPlan = readRequiredMarkdown('project-qa-plan/SKILL.md', testId);
  const riskReference = readRequiredMarkdown('references/project-risk-classification.md', testId);
  const runContract = readRequiredMarkdown('references/project-qa-run-contract.md', testId);
  const reportTemplate = readRequiredMarkdown('templates/project-qa-report.md', testId);
  const combined = `${projectPlan}\n${riskReference}\n${runContract}\n${reportTemplate}`;

  const requiredPatterns = [
    [/Project\s+Inventory[\s\S]{0,220}modules?[\s\S]{0,160}entries[\s\S]{0,160}tests[\s\S]{0,160}shared\s+dependenc/i, 'inventory fields'],
    [/important[\s\S]{0,180}Must\s+Verify[\s\S]{0,180}(?:reason|basis)[\s\S]{0,180}source/i, 'important/Must Verify reason and source'],
    [/Flow\s+ID[\s\S]{0,120}Entry[\s\S]{0,120}Dependencies[\s\S]{0,120}Expected\s+result[\s\S]{0,120}Verification\s+intent[\s\S]{0,120}Sources[\s\S]{0,120}Affected\s+modules/i, 'generic Key Flow fields'],
    [/missing\s+objective\s+prerequisite[\s\S]{0,220}BLOCKED[\s\S]{0,220}rerun\s+condition/i, 'objective missing prerequisite blocks with rerun condition'],
    [/subjective[\s\S]{0,200}NEEDS_HUMAN_REVIEW[\s\S]{0,200}(?:not|never)[\s\S]{0,120}(?:BLOCKED|FAIL)/i, 'subjective decision classification'],
    [/(?:no|without)\s+forced\s+(?:Web|browser|Playwright)/i, 'no forced browser checks'],
    [/Project\s+QA\s+Plan\s+Gate[\s\S]{0,220}`?OPEN`?[\s\S]{0,220}project-qa-execute/i, 'M3 OPEN-only execution handoff rule'],
  ];

  for (const [pattern, label] of requiredPatterns) {
    assert.match(combined, pattern, `${testId}: missing ${label}`);
  }

  for (const fixtureOnlyTerm of ['KF-AUTH-BILLING-SHARED', 'src/auth/login.mjs', 'AC-BILLING-TOTAL', 'docs-format-helper']) {
    assert.ok(!combined.includes(fixtureOnlyTerm), `${testId}: product Markdown leaked fixture-only term ${fixtureOnlyTerm}`);
  }
});

test('P1-LINKS-004 resolves all in-pack relative Markdown references', () => {
  const testId = 'P1-LINKS-004';
  const realPackRoot = resolveRealPathIfPresent(packRoot);

  for (const relativePath of requiredAllProductFiles) {
    const markdown = readRequiredMarkdown(relativePath, testId);
    const sourceDirectory = path.dirname(path.join(packRoot, relativePath));

    for (const target of extractRelativeMarkdownLinks(markdown)) {
      const resolvedTarget = path.resolve(sourceDirectory, target);
      const realTarget = resolveRealPathIfPresent(resolvedTarget);
      const relativeToPackRoot = path.relative(realPackRoot, realTarget);

      assert.ok(
        relativeToPackRoot === '' || (!relativeToPackRoot.startsWith('..') && !path.isAbsolute(relativeToPackRoot)),
        `${testId}: ${relativePath} link ${target} resolves outside qa-skill`,
      );
      assert.ok(existsSync(resolvedTarget), `${testId}: ${relativePath} link ${target} target does not exist`);
    }
  }
});

test('P1-DISCOVERY-005 discovers all declared QA skills through isolated OpenCode', () => {
  const testId = 'P1-DISCOVERY-005';
  const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'qa-skill-opencode-'));

  try {
    const configRoot = path.join(isolatedRoot, 'config');
    const dataRoot = path.join(isolatedRoot, 'data');
    const stateRoot = path.join(isolatedRoot, 'state');
    const cacheRoot = path.join(isolatedRoot, 'cache');

    const opencodeCommand = process.platform === 'win32' ? 'opencode.cmd debug skill' : 'opencode';
    const opencodeArgs = process.platform === 'win32' ? [] : ['debug', 'skill'];
    const result = spawnSync(opencodeCommand, opencodeArgs, {
      cwd: isolatedRoot,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        OPENCODE_TEST_HOME: isolatedRoot,
        HOME: isolatedRoot,
        XDG_CONFIG_HOME: configRoot,
        XDG_DATA_HOME: dataRoot,
        XDG_STATE_HOME: stateRoot,
        XDG_CACHE_HOME: cacheRoot,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [packRoot] } }),
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        OPENCODE_PURE: '1',
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_DISABLE_AUTOCOMPACT: '1',
        OPENCODE_DISABLE_MODELS_FETCH: '1',
        OPENCODE_AUTH_CONTENT: '{}',
        OPENCODE_DISABLE_SKILL_WARNINGS: '1',
        OPENCODE_DISABLE_DISCOVERY_WARNINGS: '1',
      },
      encoding: 'utf8',
    });

    assert.equal(
      result.status,
      0,
      `${testId}: opencode debug skill must exit 0; error: ${result.error?.message || 'none'}; stderr: ${(result.stderr || '').trim()}`,
    );

    const parsed = parseJsonFromStdout(result.stdout || '');
    assert.ok(parsed, `${testId}: opencode debug skill stdout must contain JSON; stdout: ${(result.stdout || '').slice(0, 500)}`);

    const entries = flattenDiscoveryEntries(parsed);
    const entriesByName = new Map(entries.map((entry) => [discoveryName(entry), entry]));
    const discoveredNames = [...entriesByName.keys()].filter(Boolean).sort((left, right) => left.localeCompare(right));
    const missingNames = requiredSkillNames.filter((skillName) => !entriesByName.has(skillName));

    assert.deepEqual(
      missingNames,
      [],
      `${testId}: missing discovered QA skill names ${missingNames.join(', ')}; discovered: ${discoveredNames.join(', ')}`,
    );

    const realPackRoot = realpathSync(packRoot);
    for (const skillName of requiredSkillNames) {
      const entry = entriesByName.get(skillName);
      const rawLocation = discoveryLocation(entry);
      assert.ok(rawLocation, `${testId}: discovered skill ${skillName} must include a location path`);

      const absoluteLocation = path.isAbsolute(rawLocation)
        ? rawLocation
        : path.resolve(repositoryRoot, rawLocation);
      const realLocation = realpathSync(absoluteLocation);
      const relativeLocation = path.relative(realPackRoot, realLocation);

      assert.ok(
        relativeLocation === '' || (!relativeLocation.startsWith('..') && !path.isAbsolute(relativeLocation)),
        `${testId}: discovered skill ${skillName} location must resolve under qa-skill: ${rawLocation}`,
      );
    }
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
});
