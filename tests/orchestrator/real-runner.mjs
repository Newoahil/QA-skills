import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeOpenCodeEnv,
  extractFinalText,
  parseJsonlStrict,
  resolveOpenCodeInvocation,
} from '../functional-validation/harness.mjs';
import {
  assertNoQaE2eAfterStop,
  combinedEvidenceText,
  extractTaskCalls,
  finalStepTokens,
  normalizePathLikeText,
  serializeToolUseInputs,
  validateFinalReport,
} from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function ensureDir(target) {
  mkdirSync(target, { recursive: true });
}

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, content, 'utf8');
}

function walkFiles(root, relative = '') {
  const current = path.join(root, relative);
  const entries = existsSync(current) ? readdirSync(current, { withFileTypes: true }) : [];
  const out = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(root, next));
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

function copyTree(sourceRoot, destinationRoot) {
  ensureDir(destinationRoot);
  for (const relativePath of walkFiles(sourceRoot)) {
    const source = path.join(sourceRoot, relativePath);
    const destination = path.join(destinationRoot, relativePath);
    ensureDir(path.dirname(destination));
    copyFileSync(source, destination);
  }
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
  return result.stdout || '';
}

function materializeLocalAgentRuntime(projectRoot) {
  const opencodeRoot = path.join(projectRoot, '.opencode');
  const skillsRoot = path.join(opencodeRoot, 'skills', 'qa-skill');
  const agentsRoot = path.join(opencodeRoot, 'agents');
  ensureDir(skillsRoot);
  ensureDir(agentsRoot);

  copyTree(path.join(repoRoot, 'qa-skill', 'references'), path.join(skillsRoot, 'references'));
  copyTree(path.join(repoRoot, 'qa-skill', 'scripts'), path.join(skillsRoot, 'scripts'));
  copyFileSync(path.join(repoRoot, 'qa-skill', 'SKILL.md'), path.join(skillsRoot, 'SKILL.md'));
  for (const file of ['qa.md', 'qa-cr.md', 'qa-e2e.md']) {
    copyFileSync(path.join(repoRoot, 'qa-skill', 'agents', file), path.join(agentsRoot, file));
  }
}

function createRepoFixture(scenario) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), `qa-orchestrator-${scenario.id}-`));
  const repoDir = path.join(tempRoot, 'repo');
  ensureDir(repoDir);
  const fixture = scenario.makeFixture({});
  for (const [relativePath, content] of Object.entries(fixture.baselineFiles)) write(repoDir, relativePath, content);
  git(repoDir, ['init', '--quiet']);
  git(repoDir, ['add', '.']);
  git(repoDir, ['-c', 'user.name=QA Fixture', '-c', 'user.email=qa-fixture@example.invalid', 'commit', '--quiet', '-m', 'baseline']);
  const head = git(repoDir, ['rev-parse', 'HEAD']).trim();
  for (const [relativePath, content] of Object.entries(fixture.candidateFiles)) write(repoDir, relativePath, content);
  const diff = git(repoDir, ['diff']);
  const touchedFiles = git(repoDir, ['diff', '--name-only']).trim().split(/\r?\n/).filter(Boolean);

  let runDir = repoDir;
  if (fixture.useWorktree) {
    runDir = path.join(tempRoot, 'worktree-run');
    git(repoDir, ['worktree', 'add', '--detach', runDir, 'HEAD']);
    for (const [relativePath, content] of Object.entries(fixture.candidateFiles)) write(runDir, relativePath, content);
  }

  materializeLocalAgentRuntime(runDir);
  return { tempRoot, repoDir, runDir, fixture, head, diff, touchedFiles };
}

function buildPrompt({ fixtureData, scenario }) {
  const verifierLine = fixtureData.fixture.verifierCommand
    ? `Caller-supplied verifier: ${fixtureData.fixture.verifierCommand.join(' ')}`
    : 'No separate verifier is supplied; judge from bounded code evidence and any required runtime evidence.';
  return [
    `QA this bounded change in ${fixtureData.runDir}.`,
    `Caller-confirmed HEAD: ${fixtureData.head}`,
    `Touched files: ${fixtureData.touchedFiles.join(', ')}`,
    'Caller-confirmed diff follows:',
    fixtureData.diff,
    ...fixtureData.fixture.prompt,
    verifierLine,
    'Do not inspect external .git or linked gitdir metadata when caller-supplied change identity is sufficient.',
    'Return a full QA report with exactly one Overall Status line plus load-bearing evidence and findings/limits.',
  ].join('\n');
}

export function realRunEnabled() {
  return process.env.QA_ORCHESTRATOR_REAL_RUNS === '1';
}

export function realRunSkipReason(extra = null) {
  return extra ?? 'set QA_ORCHESTRATOR_REAL_RUNS=1 to run real model paired evaluations';
}

export function runScenarioWithOpenCode(scenario) {
  const model = process.env.QA_SKILL_MODEL || 'cpa/gpt-5.5';
  const timeout = Number(process.env.QA_ORCHESTRATOR_TIMEOUT_MS || 600000);
  const agent = process.env.QA_ORCHESTRATOR_AGENT || 'qa';
  const resolved = process.env.QA_SKILL_OPENCODE_BIN
    ? resolveOpenCodeInvocation({ commandPath: process.env.QA_SKILL_OPENCODE_BIN })
    : (process.platform === 'win32'
      ? resolveOpenCodeInvocation({ commandPath: path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe') })
      : { command: 'opencode', shell: false, shellSafe: true, issues: [] });
  assert.equal(resolved.shellSafe, true, `opencode binary unavailable: ${(resolved.issues || []).join('; ')}`);

  const fixtureData = createRepoFixture(scenario);
  const prompt = buildPrompt({ fixtureData, scenario });
  const args = ['run', '--agent', agent, '--format', 'json', '--model', model, '--dir', fixtureData.runDir, '--pure', prompt];
  const env = createRuntimeOpenCodeEnv({ baseEnv: process.env });
  const startedAt = Date.now();
  const res = spawnSync(resolved.command, args, {
    cwd: fixtureData.runDir,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  writeFileSync(path.join(fixtureData.tempRoot, 'opencode-events.jsonl'), stdout, 'utf8');
  writeFileSync(path.join(fixtureData.tempRoot, 'stderr.txt'), stderr, 'utf8');

  const parsed = parseJsonlStrict(Buffer.from(stdout, 'utf8'));
  const finalReport = extractFinalText(parsed.events);
  const reportValidation = validateFinalReport(finalReport);
  const taskCalls = extractTaskCalls(parsed.events);
  const taskTypes = taskCalls.map((call) => call.subagentType).filter(Boolean);
  const toolUseInputsText = serializeToolUseInputs(parsed.events);
  const evidenceText = combinedEvidenceText({ finalReport, events: parsed.events });
  const finalTokens = finalStepTokens(parsed.events);

  return {
    scenario,
    fixtureData,
    command: [resolved.command, ...args],
    status: res.status,
    signal: res.signal,
    error: res.error?.message || null,
    stdout,
    stderr,
    events: parsed.events,
    jsonlErrors: parsed.errors,
    finalReport,
    reportValidation,
    taskCalls,
    taskTypes,
    toolUseInputsText,
    evidenceText,
    finalTokens,
    durationMs,
  };
}

export function assertScenarioOutcome(result) {
  assert.equal(result.error, null, `opencode spawn failed; temp root: ${result.fixtureData.tempRoot}`);
  assert.deepEqual(result.jsonlErrors, [], `invalid JSONL; temp root: ${result.fixtureData.tempRoot}`);
  assert.equal(result.reportValidation.ok, true, `invalid final report; temp root: ${result.fixtureData.tempRoot}\n${result.finalReport}`);
  assert.equal(result.stderr.includes('external_directory'), false, `unexpected external_directory marker in stderr; temp root: ${result.fixtureData.tempRoot}`);
  assert.equal(/external_directory/i.test(result.stdout), false, `unexpected external_directory marker in stdout; temp root: ${result.fixtureData.tempRoot}`);
  assertNoQaE2eAfterStop(result.events);
}

export function cleanupScenarioResult(result) {
  rmSync(result.fixtureData.tempRoot, { recursive: true, force: true });
}

export function maybeCleanupScenarioResult(result, ok) {
  if (!ok) return;
  if (process.env.QA_ORCHESTRATOR_KEEP_RUNS === '1') return;
  cleanupScenarioResult(result);
}

export function assertScenarioSpecifics(result) {
  const { scenario } = result;
  const normalizedEvidence = normalizePathLikeText(result.evidenceText);
  const normalizedToolInputs = normalizePathLikeText(result.toolUseInputsText);

  for (const term of scenario.requiredEvidenceTerms ?? []) {
    assert.match(normalizedEvidence, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing required evidence term ${term}; temp root: ${result.fixtureData.tempRoot}`);
  }
  if (scenario.requiredAnyEvidenceTerms?.length) {
    assert.equal(
      scenario.requiredAnyEvidenceTerms.some((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(normalizedEvidence)),
      true,
      `missing any-of evidence terms ${scenario.requiredAnyEvidenceTerms.join(', ')}; temp root: ${result.fixtureData.tempRoot}`,
    );
  }
  for (const term of scenario.forbiddenEvidenceTerms ?? []) {
    assert.doesNotMatch(normalizedEvidence, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `unexpected evidence term ${term}; temp root: ${result.fixtureData.tempRoot}`);
  }
  for (const term of scenario.forbiddenToolInputTerms ?? []) {
    assert.doesNotMatch(normalizedToolInputs, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `unexpected tool input term ${term}; temp root: ${result.fixtureData.tempRoot}`);
  }
  if (scenario.forbidQaE2e) {
    assert.equal(result.taskTypes.includes('qa-e2e'), false, `unexpected qa-e2e dispatch; temp root: ${result.fixtureData.tempRoot}`);
  }
  if (scenario.expectedTaskTypes) {
    for (const expectedType of scenario.expectedTaskTypes) {
      assert.equal(result.taskTypes.includes(expectedType), true, `missing expected task type ${expectedType}; temp root: ${result.fixtureData.tempRoot}`);
    }
  }
}
