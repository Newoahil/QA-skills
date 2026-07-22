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
    /Must\s+Verify/i,
    /Should\s+Verify/i,
    /Optional/i,
    /Explicitly\s+Not\s+Verified/i,
  ].every((pattern) => pattern.test(markdown));
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
  const qaReportTemplate = readRequiredMarkdown('templates/qa-report.md', testId);

  const semanticAnchorGroups = [
    ['manual trigger and one dedicated/reused QA subagent', [/manual(?:ly)?\s+(?:trigger|invoke|load|start)/i, /(?:one|single|dedicated|reused|same)\s+.*qa\s+subagent/i]],
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
    ['guarded Diff-related test updates', [/guarded\s+diff|diff-related\s+test\s+updates|test\s+updates\s+.*diff/i]],
    ['product source hash and no product-source edit', [/product\s+source\s+hash/i, /no\s+product[-\s]source\s+edit|must\s+not\s+edit\s+product\s+source/i]],
    ['no test deletion/weakening', [/no\s+test\s+deletion|must\s+not\s+delete\s+tests/i, /no\s+test\s+weakening|must\s+not\s+weaken\s+tests/i]],
    ['rerun evidence', [/rerun\s+evidence|evidence\s+from\s+rerun/i]],
    ['human gate', [/human\s+gate|human\s+review|NEEDS_HUMAN_REVIEW/i]],
    ['no final release decision', [/no\s+final\s+release\s+decision|must\s+not\s+make\s+(?:the\s+)?final\s+release\s+decision/i]],
    ['residual risk', [/residual\s+risk/i]],
  ];

  for (const [label, patterns] of semanticAnchorGroups) {
    assertAnchorGroup(corpus, testId, label, patterns);
  }

  const fileSpecificFailures = [];

  if (!/product\s+source/i.test(usingQa) || !/must\s+not\s+edit\s+product\s+source|forbid(?:s|den)?\s+product\s+source\s+edit|no\s+product[-\s]source\s+edit/i.test(usingQa)) {
    fileSpecificFailures.push('using-qa/SKILL.md must still forbid product source edits');
  }

  if (!/(guarded|narrowly\s+guarded|only\s+when\s+.*approved).*Diff(?:.|\n){0,160}(?:stale\s+test|test[-\s]asset|test\s+update|update(?:d|s)?\s+(?:related\s+)?tests?)/i.test(usingQa)) {
    fileSpecificFailures.push('using-qa/SKILL.md must permit narrowly guarded Diff-related stale-test/test-asset updates');
  }

  if (/must\s+not\s+edit[^.\n]*\bproduct\s+tests?\b/i.test(usingQa)) {
    fileSpecificFailures.push('using-qa/SKILL.md must not contain a blanket rule that the QA subagent must not edit product tests');
  }

  if (!/(?:must\s+not|never|do\s+not)\s+weaken(?:.|\n){0,120}(?:assertions?|thresholds?|test\s+intent)(?:.|\n){0,120}(?:obtain|force|achieve|get)\s+(?:a\s+)?\x60?PASS\x60?/i.test(evidenceGuide)) {
    fileSpecificFailures.push('references/evidence-guide.md must say assertions, thresholds, and test intent are not weakened merely to obtain PASS');
  }

  if (!/(?:business\s+value|asserted\s+value|expected\s+value)(?:.|\n){0,160}(?:change|update)(?:.|\n){0,160}(?:explicit(?:ly)?\s+approved\s+behavior|approved\s+behavior\s+requires|behavior\s+change\s+is\s+approved)/i.test(evidenceGuide)) {
    fileSpecificFailures.push('references/evidence-guide.md must allow an asserted business value to change only when explicit approved behavior requires it');
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

  const policyRequirements = [
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
    [evidenceGuide, 'references/evidence-guide.md', 'recorded product-source path set', /record(?:ed)?\s+(?:the\s+)?(?:exact\s+)?product[-\s]source\s+(?:path\s+set|file\s+set|paths?)/i],
    [evidenceGuide, 'references/evidence-guide.md', 'exact hash command or tool', /exact\s+(?:hash\s+)?command\s+or\s+tool/i],
    [evidenceGuide, 'references/evidence-guide.md', 'same hash scope and procedure', /same\s+(?:path\s+set|file\s+set)[\s\S]{0,200}(?:algorithm|ordering|procedure)[\s\S]{0,200}before\s+and\s+after/i],
    [findingClassification, 'references/finding-classification.md', 'generic unavailable runner rule', /unavailable\s+required\s+runner[\s\S]{0,160}(?:tool|dependency|environment)/i],
    [qaReportTemplate, 'templates/qa-report.md', 'generic runner example', /unavailable\s+required\s+runner[\s\S]{0,160}missing-qa-runner/i],
  ];

  for (const [markdown, relativePath, label, pattern] of policyRequirements) {
    if (!pattern.test(markdown)) {
      failures.push(`${relativePath} is missing ${label}`);
    }
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
