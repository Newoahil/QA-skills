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

const phase1SkillNames = ['using-qa', 'qa-plan', 'qa-execute', 'qa-conclude'];
const phase2M1SkillNames = ['using-project-qa'];
const phase2M2SkillNames = ['project-qa-plan'];
const phase2M3SkillNames = ['project-qa-execute', 'project-qa-conclude'];
const phase2M4SkillNames = ['project-qa-repair'];
const requiredSkillNames = [...phase1SkillNames, ...phase2M1SkillNames, ...phase2M2SkillNames, ...phase2M3SkillNames, ...phase2M4SkillNames];

const phase1CoreFiles = Object.freeze([
  'using-qa/SKILL.md',
  'qa-plan/SKILL.md',
  'qa-execute/SKILL.md',
  'qa-conclude/SKILL.md',
  'references/qa-principles.md',
  'references/risk-checklist.md',
  'references/evidence-guide.md',
  'references/finding-classification.md',
  'references/human-gates.md',
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

const requiredProductFiles = Object.freeze([
  ...phase1CoreFiles,
  ...phase2ExtensionFiles,
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
    [...requiredProductFiles].sort((left, right) => left.localeCompare(right)),
    `${testId}: qa-skill must contain exactly the Phase 1 core plus declared Phase 2 M1-M6 files and no extras`,
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
  const phase2Files = actualFiles.filter((relativePath) => !phase1CoreFiles.includes(relativePath));

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

  assert.equal(requiredProductFiles.length, 23, `${testId}: physical product file count should be 23 through M6`);

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

  for (const relativePath of requiredProductFiles) {
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
      cwd: repositoryRoot,
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
