import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  const readme = readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
  const directionDoc = readFileSync(path.join(repositoryRoot, 'docs', 'QA-skill开发方向.md'), 'utf8');
  const contractText = `${usingQa}\n${qaPlan}\n${qaReportTemplate}\n${readme}\n${directionDoc}`;
  const failures = [];

  const requiredPatterns = [
    [usingQa, 'using-qa/SKILL.md', 'separate skill source path and product target path', /skill\s+source\s+path[\s\S]{0,180}product\s+target\s+path/i],
    [usingQa, 'using-qa/SKILL.md', 'supplied and resolved paths for skill source and product target', /supplied\s+skill\s+source\s+path[\s\S]{0,220}(?:canonical|resolved)\s+skill\s+source\s+path[\s\S]{0,220}supplied\s+product\s+target\s+path[\s\S]{0,220}(?:canonical|resolved)\s+product\s+target\s+path/i],
    [usingQa, 'using-qa/SKILL.md', 'must not infer product target from skill location', /(?:never|must\s+not|do\s+not)\s+infer[\s\S]{0,160}product\s+target[\s\S]{0,160}skill\s+location/i],
    [usingQa, 'using-qa/SKILL.md', 'ambiguous or overlapping paths require clarification or BLOCKED', /ambiguous\s+or\s+overlapping\s+paths[\s\S]{0,180}(?:targeted\s+clarification|targeted\s+question)[\s\S]{0,80}BLOCKED/i],
    [usingQa, 'using-qa/SKILL.md', 'overlap comparison after path normalization and resolution', /compare\s+overlap[\s\S]{0,220}(?:after|only\s+after)[\s\S]{0,160}(?:normalization|normalize)[\s\S]{0,120}(?:resolution|resolve)[\s\S]{0,180}(?:relative\s+paths|symlinks|junctions)/i],
    [contractText, 'using-qa/SKILL.md|qa-plan/SKILL.md|templates/qa-report.md', 'skill self-tests are integrity-only and not product QA evidence', /(?:pack\s+self-tests?|skill\s+self-tests?|discovery\s+checks)[\s\S]{0,220}integrity-only[\s\S]{0,220}(?:never|not)[\s\S]{0,160}product\s+QA\s+evidence/i],
    [qaPlan, 'qa-plan/SKILL.md', 'Repository Preflight before Diff inspection and Change Intake', /Repository\s+Preflight[\s\S]{0,260}(?:before|precedes)[\s\S]{0,180}Diff\s+inspection[\s\S]{0,180}Change\s+Intake/i],
    [qaPlan, 'qa-plan/SKILL.md', 'preflight command hardening prefix for probe commands', /git\s+--no-pager\s+-c\s+core\.fsmonitor=false\s+-C\s+<git-probe-directory>/i],
    [qaPlan, 'qa-plan/SKILL.md', 'portable Git worktree detection via probe directory', /git\s+--no-pager\s+-c\s+core\.fsmonitor=false\s+-C\s+<git-probe-directory>\s+rev-parse\s+--is-inside-work-tree/i],
    [qaPlan, 'qa-plan/SKILL.md', 'Git probe directory supports file and directory targets', /Git\s+probe\s+directory[\s\S]{0,180}target\s+itself[\s\S]{0,120}directory[\s\S]{0,180}containing\s+directory[\s\S]{0,120}file/i],
    [qaPlan, 'qa-plan/SKILL.md', 'do not run git -C against file path', /(?:do\s+not|never|must\s+not)\s+run\s+`?git\s+-C`?[\s\S]{0,120}file\s+path/i],
    [qaPlan, 'qa-plan/SKILL.md', 'missing or inaccessible product target blocks preflight', /product\s+target[\s\S]{0,120}(?:does\s+not\s+exist|missing)[\s\S]{0,120}(?:cannot\s+be\s+read|inaccessible)[\s\S]{0,160}Repository\s+Preflight\s+BLOCKED[\s\S]{0,120}stop/i],
    [qaPlan, 'qa-plan/SKILL.md', 'no fallback to cwd or skill source for missing target', /(?:do\s+not|never|must\s+not)[\s\S]{0,120}fall\s+back[\s\S]{0,120}(?:cwd|current\s+working\s+directory)[\s\S]{0,120}skill\s+source/i],
    [qaPlan, 'qa-plan/SKILL.md', 'portable Git toplevel, git-dir, and common-dir resolution', /--show-toplevel[\s\S]{0,160}--git-dir[\s\S]{0,160}--git-common-dir/i],
    [qaPlan, 'qa-plan/SKILL.md', 'target-relative pathspec from probe show-prefix or equivalent', /git\s+-C\s+<git-probe-directory>\s+rev-parse\s+--show-prefix|equivalent\s+explicit\s+method[\s\S]{0,160}target-relative\s+pathspec/i],
    [qaPlan, 'qa-plan/SKILL.md', 'file target pathspec is containing directory prefix plus basename', /file\s+targets?[\s\S]{0,220}containing-directory\s+show-prefix[\s\S]{0,220}basename/i],
    [qaPlan, 'qa-plan/SKILL.md', 'directory target pathspec uses directory prefix and root dot', /directory\s+targets?[\s\S]{0,180}directory\s+prefix[\s\S]{0,220}repo(?:sitory)?\s+root[\s\S]{0,120}`?\.`?/i],
    [qaPlan, 'qa-plan/SKILL.md', 'empty show-prefix at repository root maps to dot pathspec', /--show-prefix[\s\S]{0,160}empty[\s\S]{0,160}repository\s+root[\s\S]{0,160}(?:use|map)[\s\S]{0,80}`?\.`?[\s\S]{0,120}pathspec/i],
    [qaPlan, 'qa-plan/SKILL.md', 'target-scoped ls-files and porcelain status', /(?:target-scoped|scoped)[\s\S]{0,160}ls-files[\s\S]{0,160}porcelain\s+status/i],
    [qaPlan, 'qa-plan/SKILL.md', 'literal pathspecs prevents pathspec magic', /--literal-pathspecs[\s\S]{0,220}(?:\[ab\]\.txt|`\[ab\]\.txt`)[\s\S]{0,160}(?:\:\(top\)|`\:\(top\)`)[\s\S]{0,180}(?:broadening|broaden|scope|范围)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'fsmonitor disabled to prevent repo configured execution', /-c\s+core\.fsmonitor=false[\s\S]{0,220}(?:prevents?|避免|防止)[\s\S]{0,160}fsmonitor[\s\S]{0,160}(?:execution|执行)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'exact hardened ls-files command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+ls-files\s+--\s+<relative-target>/i],
    [qaPlan, 'qa-plan/SKILL.md', 'deterministic porcelain status command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+status\s+--porcelain=v1\s+--untracked-files=all\s+--\s+<relative-target>/i],
    [qaPlan, 'qa-plan/SKILL.md', 'linked worktree classification after git-dir common-dir resolution', /resolve[\s\S]{0,120}git-dir[\s\S]{0,120}git-common-dir[\s\S]{0,220}(?:difference|differ)[\s\S]{0,160}linked\s+worktree/i],
    [contractText, 'preflight contract files', 'supplied paths and refs are untrusted quoted arguments', /supplied\s+paths\s+and\s+refs[\s\S]{0,160}untrusted\s+data[\s\S]{0,180}(?:quoted|escaped)\s+arguments[\s\S]{0,180}(?:never|not)[\s\S]{0,120}interpolated\s+as\s+executable\s+instructions/i],
    [contractText, 'preflight contract files', 'host structured argv preferred', /host\s+structured\s+argv[\s\S]{0,180}(?:when\s+available|if\s+available)/i],
    [contractText, 'preflight contract files', 'shell string fallback uses native escaping and records limitation', /shell\s+string[\s\S]{0,220}platform-native\s+literal\s+escaping[\s\S]{0,180}(?:no\s+raw\s+concatenation|never\s+raw\s+concatenation)[\s\S]{0,220}command-boundary\s+limitation/i],
    [qaPlan, 'qa-plan/SKILL.md', 'exact commit ref verification command with hardening and end-of-options', /git\s+--no-pager\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+rev-parse\s+--verify\s+--end-of-options\s+<baseline>\^\{commit\}/i],
    [qaPlan, 'qa-plan/SKILL.md', 'resolved commit OID reused after baseline validation', /resolved\s+commit\s+OID[\s\S]{0,180}(?:use|reuse)[\s\S]{0,160}(?:only\s+that\s+OID|validated\s+commit\s+OID)[\s\S]{0,180}(?:never|not)[\s\S]{0,120}original\s+user\s+ref/i],
    [qaPlan, 'qa-plan/SKILL.md', 'target tracking evidence command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+ls-files\s+--\s+<relative-target>/i],
    [qaPlan, 'qa-plan/SKILL.md', 'target path-history evidence command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+log\s+-1\s+--format=%H\s+--\s+<relative-target>/i],
    [qaPlan, 'qa-plan/SKILL.md', 'hardened scoped Diff command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+diff\s+--no-ext-diff\s+--no-textconv\s+<validated-commit-oid>\s+--\s+<relative-target>/i],
    [contractText, 'preflight contract files', 'preflight diff evidence minimized and redacted', /Diff\s+evidence[\s\S]{0,180}(?:minimized|minimum)[\s\S]{0,180}redacted[\s\S]{0,180}(?:summary|excerpt|hash)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'normal git diff excludes untracked files', /untracked\s+files[\s\S]{0,120}(?:not\s+included|excluded)[\s\S]{0,120}normal\s+git\s+diff/i],
    [qaPlan, 'qa-plan/SKILL.md', 'explicit baseline or HEAD commit validation', /(?:explicit\s+baseline|HEAD)[\s\S]{0,160}commit\s+validation/i],
    [qaPlan, 'qa-plan/SKILL.md', 'valid target Diff baseline requires commit ref and target scope content or history', /valid\s+product-target\s+Diff\s+baseline[\s\S]{0,240}(?:explicit\s+ref|HEAD)[\s\S]{0,240}(?:tracked\s+content|path\s+history)/i],
    [qaPlan, 'qa-plan/SKILL.md', 'ancestor HEAD alone is insufficient for untracked target', /ancestor-repository\s+HEAD[\s\S]{0,180}(?:not\s+sufficient|insufficient)[\s\S]{0,220}untracked\s+product\s+target/i],
    [qaPlan, 'qa-plan/SKILL.md', 'untracked ancestor target with no history blocks Diff checks', /untracked\s+directory\s+inside\s+an\s+ancestor\s+repo(?:sitory)?[\s\S]{0,260}zero\s+tracked\s+content\/path\s+history[\s\S]{0,160}Diff-dependent\s+checks\s+BLOCKED/i],
    [qaPlan, 'qa-plan/SKILL.md', 'no branch remote upstream PR or CI requirement', /(?:do\s+not|never|must\s+not)\s+require[\s\S]{0,160}branch[\s\S]{0,80}remote[\s\S]{0,80}upstream[\s\S]{0,80}PR[\s\S]{0,80}CI/i],
    [qaPlan, 'qa-plan/SKILL.md', 'orthogonal Git worktree topology classifications', /Git\s+worktree\s+topology[\s\S]{0,180}primary\s+worktree[\s\S]{0,120}linked\s+worktree[\s\S]{0,120}non-Git/i],
    [qaPlan, 'qa-plan/SKILL.md', 'orthogonal product target classifications', /Product\s+target\s+classification[\s\S]{0,180}repository\s+root[\s\S]{0,120}tracked\s+file[\s\S]{0,120}tracked\s+directory[\s\S]{0,120}untracked\s+file\s+inside\s+ancestor\s+repository[\s\S]{0,160}untracked\s+directory\s+inside\s+ancestor\s+repository[\s\S]{0,160}non-Git\s+file[\s\S]{0,120}non-Git\s+directory[\s\S]{0,160}missing\s+or\s+inaccessible\s+target/i],
    [qaPlan, 'qa-plan/SKILL.md', 'no baseline blocks only Diff-dependent verification', /no\s+valid\s+baseline[\s\S]{0,180}only\s+Diff-dependent\s+verifications\s+BLOCKED/i],
    [qaPlan, 'qa-plan/SKILL.md', 'non-Diff verification permitted with limitations', /(?:permit|allow|preserve)[\s\S]{0,120}non-Diff\s+verification[\s\S]{0,180}explicit\s+limitations/i],
    [qaPlan, 'qa-plan/SKILL.md', 'blocked Diff-dependent Must Verify prevents PASS', /blocked\s+Diff-dependent\s+Must\s+Verify[\s\S]{0,160}overall\s+PASS\s+is\s+unavailable/i],
    [qaReportTemplate, 'templates/qa-report.md', 'Repository Preflight section before Change Intake', /##\s+Repository\s+Preflight[\s\S]*##\s+Change\s+Intake/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records supplied and resolved paths', /supplied\s+skill\s+source\s+path[\s\S]{0,220}(?:canonical|resolved)\s+skill\s+source\s+path[\s\S]{0,220}supplied\s+product\s+target\s+path[\s\S]{0,220}(?:canonical|resolved)\s+product\s+target\s+path/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records target kind and git probe directory', /target\s+kind[\s\S]{0,160}file\s+\/\s+directory[\s\S]{0,220}Git\s+probe\s+directory/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records root dot pathspec rule', /root\s+pathspec[\s\S]{0,160}`?\.`?[\s\S]{0,160}empty\s+show-prefix/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records separate paths and topology/root', /skill\s+source\s+path[\s\S]{0,180}product\s+target\s+path[\s\S]{0,220}Git\s+worktree\s+topology[\s\S]{0,180}Product\s+target\s+classification[\s\S]{0,180}(?:repository\s+root|resolved\s+root)/i],
    [qaReportTemplate, 'templates/qa-report.md', 'template includes non-Git file and directory classifications', /Product\s+target\s+classification[\s\S]{0,260}non-Git\s+file[\s\S]{0,120}non-Git\s+directory/i],
    [qaReportTemplate, 'templates/qa-report.md', 'template records exact hardened ls-files command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+ls-files\s+--\s+<relative-target>/i],
    [qaReportTemplate, 'templates/qa-report.md', 'template records exact hardened status command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+status\s+--porcelain=v1\s+--untracked-files=all\s+--\s+<relative-target>/i],
    [qaReportTemplate, 'templates/qa-report.md', 'template records exact hardened log command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+log\s+-1\s+--format=%H\s+--\s+<relative-target>/i],
    [qaReportTemplate, 'templates/qa-report.md', 'template records exact hardened diff command', /git\s+--no-pager\s+--literal-pathspecs\s+-c\s+core\.fsmonitor=false\s+-C\s+<repo-root>\s+diff\s+--no-ext-diff\s+--no-textconv\s+<validated-commit-oid>\s+--\s+<relative-target>/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records target tracking and path-history evidence', /target\s+tracking\s+evidence[\s\S]{0,180}target\s+path-history\s+evidence/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight distinguishes commit-ref validation from target-scoped baseline availability', /commit-ref\s+validation[\s\S]{0,180}target-scoped\s+baseline\s+availability/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records scoped Diff command pathspec result and blocked reason', /scoped\s+Diff\s+command[\s\S]{0,180}--literal-pathspecs[\s\S]{0,120}--no-ext-diff[\s\S]{0,80}--no-textconv[\s\S]{0,160}pathspec[\s\S]{0,120}(?:observed\s+result|BLOCKED\s+reason)/i],
    [qaReportTemplate, 'templates/qa-report.md', 'template Plan Gate reconciles literal pathspec and fsmonitor hardening', /Repository\s+Preflight\s+reconciled[\s\S]{0,260}(?:literal-pathspecs|literal\s+pathspec)[\s\S]{0,220}fsmonitor/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records baseline, scoped Diff, and blocked reason', /baseline\s+validation[\s\S]{0,260}scoped\s+Diff[\s\S]{0,260}blocked\s+reason/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records self-check limitation and blocked Diff IDs', /self-check\s+limitation[\s\S]{0,180}Diff-dependent\s+blocked\s+IDs/i],
    [qaReportTemplate, 'templates/qa-report.md', 'preflight records non-Diff limitations', /non-Diff\s+limitations/i],
    [qaReportTemplate, 'templates/qa-report.md', 'Plan Gate reconciles preflight', /Repository\s+Preflight\s+reconciled[\s\S]{0,520}OPEN\/BLOCKED/i],
    [readme, 'README.md', 'README range/source bullet orders Repository Preflight before Diff and Change Intake', /范围和来源受控[\s\S]{0,360}Repository\s+Preflight[\s\S]{0,160}(?:之前|先于|前)[\s\S]{0,120}Diff[\s\S]{0,160}Change\s+Intake[\s\S]{0,220}(?:独立读取|独立检查)[\s\S]{0,120}Diff[\s\S]{0,120}Change\s+Intake/i],
    [readme, 'README.md', 'README qa-plan table orders preflight diff intake before scope/risk planning', /\[`qa-plan`\][^\n]*Repository\s+Preflight[^\n]*Diff[^\n]*Change\s+Intake[^\n]*(?:范围|scope)[^\n]*(?:风险|risk)/i],
    [readme, 'README.md', 'README change-forensics bullet orders preflight independent diff intake', /变更取证[^\n]*Repository\s+Preflight[^\n]*(?:独立检查|独立读取)[^\n]*Diff[^\n]*named\s+Change\s+Intake/i],
    [readme, 'README.md', 'README separates skill source from product target in handoff', /skill\s+source\s+path[\s\S]{0,220}product\s+target\s+path/i],
    [readme, 'README.md', 'README report output starts with Repository Preflight', /报告模板包含[\s\S]{0,120}-\s+Repository\s+Preflight[\s\S]{0,80}-\s+Change\s+Intake/i],
    [readme, 'README.md', 'README states seven validation cases', /包含\s+\*\*7\s+个验证用例\*\*/i],
    [readme, 'README.md', 'README includes preflight coverage sentence', /覆盖[\s\S]{0,160}Repository\s+Preflight[\s\S]{0,80}contract/i],
    [readme, 'README.md', 'README simulation section 3 shows preflight before Diff and Change Intake', /###\s+3\.[^\n]*Repository\s+Preflight[\s\S]{0,1200}Diff[\s\S]{0,1200}Change\s+Intake/i],
    [readme, 'README.md', 'README states pack self-tests are integrity-only', /pack\s+self-tests?[\s\S]{0,180}(?:完整性|integrity-only)[\s\S]{0,180}(?:不是|not|never)[\s\S]{0,120}product\s+QA\s+evidence[\s\S]{0,180}(?:不能|不得|never)[\s\S]{0,120}(?:替代|replace)/i],
    [directionDoc, 'docs/QA-skill开发方向.md', 'authoritative doc declares authority', /权威方向[\s\S]{0,160}以本文档为准/i],
    [directionDoc, 'docs/QA-skill开发方向.md', 'authoritative shared workflow separates paths and orders preflight diff intake', /共享\s+QA\s+工作流[\s\S]{0,600}supplied[\s\S]{0,120}skill\s+source[\s\S]{0,180}resolved[\s\S]{0,180}product\s+target[\s\S]{0,400}Repository\s+Preflight[\s\S]{0,260}Diff[\s\S]{0,260}Change\s+Intake[\s\S]{0,260}(?:范围|风险)/i],
    [directionDoc, 'docs/QA-skill开发方向.md', 'authoritative phase 1 loop orders preflight diff intake before planning', /Phase\s+1[\s\S]{0,900}Repository\s+Preflight[\s\S]{0,260}Diff[\s\S]{0,260}Change\s+Intake[\s\S]{0,260}(?:范围|风险)/i],
    [directionDoc, 'docs/QA-skill开发方向.md', 'authoritative doc says self-tests are integrity only', /pack\s+self-tests[\s\S]{0,220}(?:完整性|integrity)[\s\S]{0,180}(?:不能|不得)[\s\S]{0,160}product-target\s+QA/i],
  ];

  for (const [markdown, relativePath, label, pattern] of requiredPatterns) {
    if (!pattern.test(markdown)) {
      failures.push(`${relativePath} is missing ${label}`);
    }
  }

  const prohibitedPatterns = [
    [/Test-Path\s+\.git/i, 'Test-Path .git repository detection'],
    [/git\s+-C\s+<product-target>/i, 'literal git -C <product-target> placeholder'],
    [/(?:use|check|test|rely\s+on)[\s\S]{0,80}\.git\s+(?:directory|folder)?\s*(?:exists|existence)|\.git\s+(?:directory|folder)?\s*(?:exists|existence)[\s\S]{0,80}(?:means|proves|detects)/i, 'affirmative .git existence repository detection'],
    [/(?:pack\s+self-tests?|skill\s+self-tests?|discovery\s+checks)[\s\S]{0,160}(?:may|can|should)\s+(?:substitute|replace|stand\s+in)[\s\S]{0,160}product\s+QA/i, 'affirmative skill self-test substitution for product QA'],
  ];

  for (const [pattern, label] of prohibitedPatterns) {
    if (pattern.test(contractText)) {
      failures.push(`contract must prohibit ${label}`);
    }
  }

  const probeRoot = mkdtempSync(path.join(tmpdir(), 'qa-preflight-pathspec-'));
  const gitProbe = (args) => spawnSync('git', args, { cwd: probeRoot, encoding: 'utf8' });

  try {
    assert.equal(gitProbe(['init']).status, 0, `${testId}: pathspec probe git init failed`);
    mkdirSync(path.join(probeRoot, 'work'));
    for (const fileName of ['[ab].txt', 'a.txt', 'b.txt']) {
      writeFileSync(path.join(probeRoot, 'work', fileName), `${fileName}\n`, 'utf8');
    }
    assert.equal(gitProbe(['add', '-A']).status, 0, `${testId}: pathspec probe git add failed`);
    assert.equal(gitProbe(['config', 'core.fsmonitor', 'true']).status, 0, `${testId}: pathspec probe git config failed`);

    const defaultPathspec = gitProbe(['ls-files', '--', 'work/[ab].txt']);
    assert.equal(defaultPathspec.status, 0, `${testId}: default pathspec probe failed: ${defaultPathspec.stderr}`);
    const defaultMatches = defaultPathspec.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
    assert.ok(
      defaultMatches.includes('work/a.txt') && defaultMatches.includes('work/b.txt'),
      `${testId}: default Git pathspec should broaden [ab].txt to include a.txt and b.txt; got ${defaultMatches.join(', ')}`,
    );

    const literalPathspec = gitProbe(['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', probeRoot, 'ls-files', '--', 'work/[ab].txt']);
    assert.equal(literalPathspec.status, 0, `${testId}: literal pathspec probe failed with fsmonitor disabled: ${literalPathspec.stderr}`);
    assert.deepEqual(
      literalPathspec.stdout.trim().split(/\r?\n/).filter(Boolean),
      ['work/[ab].txt'],
      `${testId}: --literal-pathspecs must keep [ab].txt literal`,
    );

    const hardenedStatus = gitProbe([
      '--no-pager',
      '--literal-pathspecs',
      '-c',
      'core.fsmonitor=false',
      '-C',
      probeRoot,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      'work/[ab].txt',
    ]);
    assert.equal(hardenedStatus.status, 0, `${testId}: hardened status probe failed: ${hardenedStatus.stderr}`);
    assert.deepEqual(
      hardenedStatus.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => line.slice(3)),
      ['work/[ab].txt'],
      `${testId}: hardened status must keep [ab].txt literal with fsmonitor disabled`,
    );
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
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
