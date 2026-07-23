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

const requiredSkillNames = ['using-qa', 'qa-plan', 'qa-execute', 'qa-conclude'];

const requiredProductFiles = Object.freeze([
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

function corpusFromRequiredFiles(testId) {
  return requiredProductFiles
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

test('P1-STRUCT-001 exposes exactly the required Phase 1 pack files', () => {
  const testId = 'P1-STRUCT-001';
  assert.ok(existsSync(packRoot), `${testId}: missing qa-skill directory at ${packRoot}`);
  assert.ok(statSync(packRoot).isDirectory(), `${testId}: qa-skill is not a directory at ${packRoot}`);

  assert.deepEqual(
    regularFilesUnder(packRoot),
    [...requiredProductFiles].sort((left, right) => left.localeCompare(right)),
    `${testId}: qa-skill must contain exactly the ten required regular files and no extras`,
  );
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
    ['qa-plan records Change Intake after inspecting Diff', [/`?qa\-?plan`?\s+begins\s+by/i, /\bindependently\b.{0,80}\b(?:read|reads|inspect|inspects|review|reviews)\b/, /actual\s+available\s+diff/i, /then\s+records\s+the\s+named\s+`?Change\s+Intake`?/i, /before\s+risk\s+planning/i]],
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

  for (const relativePath of requiredProductFiles) {
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

  const qaPlanLower = qaPlan.toLowerCase();
  const qaPlanDiffInspectIndex = qaPlanLower.search(/independently[\s\S]{0,220}(?:reads?|reading|inspect|inspecting|review|reviews|reviewing)[\s\S]{0,260}actual\s+available\s+diff/i);
  const qaPlanChangeIntakeIndex = qaPlanLower.search(/named[\s\S]{0,120}change[\s\S]{0,20}intake/i);
  const qaPlanObjectiveIndex = qaPlanLower.indexOf('objective and scope', qaPlanChangeIntakeIndex);
  const qaPlanRiskPlanningIndex = qaPlanLower.indexOf('risk analysis', qaPlanChangeIntakeIndex);

  if (
    qaPlanDiffInspectIndex < 0
    || qaPlanChangeIntakeIndex < 0
    || qaPlanDiffInspectIndex >= qaPlanChangeIntakeIndex
    || qaPlanChangeIntakeIndex >= qaPlanObjectiveIndex
    || qaPlanChangeIntakeIndex >= qaPlanRiskPlanningIndex
  ) {
    failures.push('qa-plan/SKILL.md must order: independent actual available Diff inspection -> named Change Intake -> Objective and Scope -> Risk Analysis');
  }

  const usingQaDiffOrderByOrder = /`?qa\-?plan`?[\s\S]{0,320}actual\s+available\s+diff[\s\S]{0,320}named\s+`?change\s+intake`?/i.test(usingQa) && /before\s+risk\s+planning/i.test(usingQa);
  const usingQaDiffOrderFallbackPattern = /`?qa\-?plan`?.{0,220}\s+begins\s+by.{0,220}(?:read|reads?|reading|inspect|inspecting|review|reviews|reviewing).{0,260}`?actual\s+available\s+diff`?.{0,260}then\s+records\s+the\s+named\s+`?Change\s+Intake`?.{0,120}before\s+risk\s+planning/i;
  if (!usingQaDiffOrderPattern.test(usingQa) && !usingQaDiffOrderByOrder && !usingQaDiffOrderFallbackPattern.test(usingQa)) {
    failures.push('using-qa/SKILL.md must require qa-plan to inspect diff before recording Change Intake (before risk planning)');
  }

  assertNoSemanticFailures(testId, failures);
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

test('P1-DISCOVERY-005 discovers all four skills through isolated OpenCode', () => {
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
