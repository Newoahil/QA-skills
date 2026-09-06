import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBenchmarkOpenCodeEnv } from '../../functional-validation/real-project-benchmark.mjs';
import { exportNestedSession, parseJsonlStrict, resolveOpenCodeInvocation } from '../../functional-validation/harness.mjs';
import { materializeLocalAgentRuntime } from '../real-runner.mjs';
import { executePrimaryRun } from './primary-run-harness.mjs';
import { buildRunIdentity } from './evidence-envelope.mjs';
import { sha256CanonicalJson, validateQaCrMaturityManifest } from './case-manifest.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const manifestPath = path.join(repoRoot, 'benchmarks', 'qa-cr-maturity', 'manifest.json');
const scopePath = path.join(repoRoot, 'docs', 'qa-cr-maturity-scope-v1.md');
const parentAgentRelativePath = 'qa.md';
const candidateAgentRelativePath = 'qa-cr.md';
const targetCaseId = 'seed-defect-auth-guard-small';

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(String(value), 'utf8'));
}

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function ensureDir(target) {
  mkdirSync(target, { recursive: true });
}

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  ensureDir(path.dirname(absolutePath));
  writeFileSync(absolutePath, content, 'utf8');
}

function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout || '';
}

function validateAbsoluteExecutable(executablePath) {
  const resolved = resolveOpenCodeInvocation({ commandPath: executablePath });
  assert.equal(resolved.shellSafe, true, `invalid direct opencode executable: ${(resolved.issues || []).join('; ')}`);
  return resolved;
}

function validateModel(model) {
  assert.equal(typeof model, 'string', 'model is required');
  assert.equal(model.trim().length > 0, true, 'model is required');
  assert.equal(model.includes('/'), true, 'model must be provider/model');
  return model.trim();
}

function validateRegularJsonFile(filePath, label) {
  assert.equal(typeof filePath, 'string', `${label} is required`);
  assert.equal(filePath.length > 0, true, `${label} is required`);
  assert.equal(path.isAbsolute(filePath), true, `${label} must be absolute`);
  assert.equal(existsSync(filePath), true, `${label} must exist`);
  assert.equal(lstatSync(filePath).isSymbolicLink(), false, `${label} must not be a symlink`);
  assert.equal(statSync(filePath).isFile(), true, `${label} must be a regular file`);
  JSON.parse(readFileSync(filePath, 'utf8'));
  return path.resolve(filePath);
}

const secretKeyPattern = /(?:^|_|-)(?:api[_-]?key|token|auth[_-]?token|secret|password|authorization|credential)s?$/i;
const builtEnvCredentialKeyPattern = /^(?:CPA|ANTHROPIC|OPENAI|GEMINI|GOOGLE|OPENROUTER|AZURE_OPENAI|MISTRAL|COHERE)(?:_[A-Z0-9]+)*_(?:API_KEY|AUTH_TOKEN|TOKEN|KEY)$/;

function collectSecretLikeJsonValues(value, out = new Set(), keyPath = []) {
  if (typeof value === 'string') {
    const leafKey = keyPath.at(-1) ?? '';
    if (value.length > 0 && secretKeyPattern.test(leafKey)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecretLikeJsonValues(item, out, keyPath);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) collectSecretLikeJsonValues(entry, out, [...keyPath, key]);
  }
  return out;
}

function collectSensitiveValues({ providerConfigPath, sensitiveValues = [], childEnv = {} }) {
  const values = new Set((Array.isArray(sensitiveValues) ? sensitiveValues : []).filter((value) => typeof value === 'string' && value.length > 0));
  try {
    const parsed = JSON.parse(readFileSync(providerConfigPath, 'utf8'));
    for (const value of collectSecretLikeJsonValues(parsed)) values.add(value);
  } catch {}
  for (const [key, value] of Object.entries(childEnv || {})) {
    if (typeof value === 'string' && value.length > 0 && builtEnvCredentialKeyPattern.test(key)) values.add(value);
  }
  if (typeof childEnv?.OPENCODE_AUTH_CONTENT === 'string' && childEnv.OPENCODE_AUTH_CONTENT.length > 0) {
    values.add(childEnv.OPENCODE_AUTH_CONTENT);
    try {
      const parsed = JSON.parse(childEnv.OPENCODE_AUTH_CONTENT);
      for (const value of collectSecretLikeJsonValues(parsed)) values.add(value);
    } catch {}
  }
  return [...values];
}

function hashFile(absolutePath) {
  const bytes = readFileSync(absolutePath);
  return { path: absolutePath, sha256: sha256Bytes(bytes), bytes: bytes.length };
}

function walkProductFiles(root, relative = '') {
  const current = path.join(root, relative);
  const entries = readdirSync(current, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.opencode') continue;
    const next = relative ? path.join(relative, entry.name) : entry.name;
    const absoluteNext = path.join(root, next);
    if (entry.isDirectory()) out.push(...walkProductFiles(root, next));
    else if (entry.isFile()) out.push({ relativePath: normalizeRelative(next), absolutePath: absoluteNext });
    else throw new Error(`unsupported product tree entry: ${normalizeRelative(next)}`);
  }
  return out.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function hashProductTree(root) {
  const files = walkProductFiles(root).map(({ relativePath, absolutePath }) => [relativePath, sha256Bytes(readFileSync(absolutePath))]);
  return { sha256: sha256Text(JSON.stringify(files)), files: files.map(([relativePath]) => relativePath) };
}

function buildCandidateDiffDigest(repoDir) {
  const diff = git(repoDir, ['diff', '--binary', '--no-ext-diff']);
  return { text: diff, sha256: sha256Text(diff), bytes: Buffer.byteLength(diff, 'utf8') };
}

function buildProductMutationDigest({ productTreeSha256, candidateDiffSha256 }) {
  return sha256Text(JSON.stringify({ productTreeSha256, candidateDiffSha256 }));
}

function materializedAgentPath(projectRoot, relativeName) {
  return path.join(projectRoot, '.opencode', 'agents', relativeName);
}

function buildSyntheticFixture(repoDir) {
  const baselineFiles = {
    'src/policy.mjs': [
      'export function canAccessResource({ actingUserId, ownerId, isAdmin }) {',
      '  return actingUserId === ownerId || isAdmin === true;',
      '}',
      '',
    ].join('\n'),
    'src/route.mjs': [
      "import { canAccessResource } from './policy.mjs';",
      "import { logDeniedAccess } from './audit.mjs';",
      '',
      'export function updateResource({ actingUserId, isAdmin, resource }) {',
      '  const allowed = canAccessResource({ actingUserId, ownerId: resource.ownerId, isAdmin });',
      '  if (!allowed) {',
      "    logDeniedAccess({ actingUserId, ownerId: resource.ownerId, action: 'update' });",
      "    return { status: 403, body: { error: 'forbidden' } };",
      '  }',
      '  return { status: 200, body: { ok: true } };',
      '}',
      '',
    ].join('\n'),
    'src/audit.mjs': [
      'export function logDeniedAccess({ actingUserId, ownerId, action }) {',
      '  return { actingUserId, ownerId, action, result: \"denied\" };',
      '}',
      '',
    ].join('\n'),
    'tests/policy.test.mjs': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { updateResource } from '../src/route.mjs';",
      '',
      "test('stranger is denied', () => {",
      "  const result = updateResource({ actingUserId: 'user-b', isAdmin: false, resource: { ownerId: 'user-a' } });",
      '  assert.equal(result.status, 403);',
      '});',
      '',
    ].join('\n'),
  };
  const candidateFiles = {
    'src/route.mjs': [
      "import { canAccessResource } from './policy.mjs';",
      "import { logDeniedAccess } from './audit.mjs';",
      '',
      'export function updateResource({ actingUserId, isAdmin, resource }) {',
      '  const allowed = canAccessResource({ actingUserId: resource.ownerId, ownerId: resource.ownerId, isAdmin });',
      '  if (!allowed) {',
      "    logDeniedAccess({ actingUserId, ownerId: resource.ownerId, action: 'update' });",
      "    return { status: 403, body: { error: 'forbidden' } };",
      '  }',
      '  return { status: 200, body: { ok: true } };',
      '}',
      '',
    ].join('\n'),
  };
  for (const [relativePath, content] of Object.entries(baselineFiles)) write(repoDir, relativePath, content);
  git(repoDir, ['init', '--quiet']);
  git(repoDir, ['add', '.']);
  git(repoDir, ['-c', 'user.name=QA Real Smoke Fixture', '-c', 'user.email=qa-real-smoke@example.invalid', 'commit', '--quiet', '-m', 'baseline']);
  const head = git(repoDir, ['rev-parse', 'HEAD']).trim();
  for (const [relativePath, content] of Object.entries(candidateFiles)) write(repoDir, relativePath, content);
  return {
    head,
    touchedFiles: git(repoDir, ['diff', '--name-only']).trim().split(/\r?\n/).filter(Boolean),
    baselineFiles,
    candidateFiles,
  };
}

function buildPrompt({ head, diffText, touchedFiles }) {
  return [
    'This is a non-scoring plumbing probe for the qa orchestrator real-smoke adapter.',
    'Run exactly one direct qa-cr child task.',
    'Do not perform inline code review in the parent for this run.',
    'Do not invoke qa-e2e.',
    'Use first-attempt evidence only.',
    'There is no retry, replacement run, or second attempt.',
    'Do not claim benchmark scoring or defect-detection success; just execute the plumbing path honestly.',
    `Bounded repo HEAD: ${head}`,
    `Touched files: ${touchedFiles.join(', ')}`,
    'Candidate working diff follows:',
    diffText,
  ].join('\n');
}

function loadPhaseAManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const validation = validateQaCrMaturityManifest(manifest);
  assert.equal(validation.ok, true, 'Phase A manifest must validate');
  const caseValue = manifest.cases.find((entry) => entry?.id === targetCaseId);
  assert.ok(caseValue, `missing Phase A case ${targetCaseId}`);
  return { manifest, caseValue, manifestHash: validation.manifestHash };
}

const launchEnvAllowlist = new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI']);
const envSecretRedactionMarker = '[REDACTED_ENV_SECRET]';

function buildSanitizedBaseEnv(baseEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (typeof value !== 'string') continue;
    if (launchEnvAllowlist.has(key) || builtEnvCredentialKeyPattern.test(key) || key === 'OPENCODE_AUTH_CONTENT') env[key] = value;
  }
  return env;
}

function buildRedactedEnvDescription(env = {}) {
  return Object.keys(env).sort().map((key) => [
    key,
    (builtEnvCredentialKeyPattern.test(key) || key === 'OPENCODE_AUTH_CONTENT' || key === 'OPENCODE_CONFIG_CONTENT')
      ? envSecretRedactionMarker
      : env[key],
  ]);
}

function envFingerprint(env) {
  return sha256Text(JSON.stringify(buildRedactedEnvDescription(env)));
}

function commandString(command, args) {
  return [command, ...args].map((value) => (/\s/.test(value) ? JSON.stringify(value) : value)).join(' ');
}

function summarizeSpawnError(error) {
  if (!error) return null;
  return String(error.message || error.code || error.name || error);
}

function normalizeExecutableIdentity(executablePath) {
  if (typeof executablePath !== 'string' || executablePath.trim().length === 0) return null;
  const resolved = path.resolve(executablePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function executePhaseB2RealSmoke() {
  const error = new Error('b2_v1_attempt_consumed');
  error.code = 'b2_v1_attempt_consumed';
  throw error;
}

export async function executePhaseB2V1Simulation({
  opencodeExecutable,
  model,
  providerConfigPath,
  timeoutMs = 600000,
  keepArtifacts = false,
  directSpawn,
  exportSession,
  executePrimary = executePrimaryRun,
  buildEnv = buildBenchmarkOpenCodeEnv,
  materializeRuntime = materializeLocalAgentRuntime,
  sensitiveValues = [],
  baseEnv = process.env,
} = {}) {
  assert.equal(typeof directSpawn, 'function', 'directSpawn is required for simulation');
  assert.equal(typeof exportSession, 'function', 'exportSession is required for simulation');
  if (normalizeExecutableIdentity(opencodeExecutable) !== normalizeExecutableIdentity(process.execPath)) {
    const error = new Error('simulation_requires_process_execpath');
    error.code = 'simulation_requires_process_execpath';
    throw error;
  }
  const invocation = validateAbsoluteExecutable(opencodeExecutable);
  const selectedModel = validateModel(model);
  const selectedProviderConfigPath = validateRegularJsonFile(providerConfigPath, 'providerConfigPath');
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'phase-b2-real-smoke-'));
  const repoDir = path.join(tempRoot, 'repo');
  const artifactRoot = path.join(tempRoot, 'artifacts');
  const isolatedRoot = path.join(tempRoot, 'isolated-opencode');
  const transcript = [];
  let cleanedUp = false;
  let b1 = null;
  let runSpec = null;
  let fixture = null;
  let runnerResult = null;
  let response = null;
  const sanitizedBaseEnv = buildSanitizedBaseEnv(baseEnv);
  ensureDir(repoDir);
  ensureDir(artifactRoot);
  try {
    fixture = buildSyntheticFixture(repoDir);
    materializeRuntime(repoDir);
    const env = buildEnv({ isolatedRoot, baseEnv: sanitizedBaseEnv, model: selectedModel, providerConfigPath: selectedProviderConfigPath });
    const envHash = envFingerprint(env);
    const manifestBundle = loadPhaseAManifest();
    const prompt = buildPrompt({ head: fixture.head, diffText: buildCandidateDiffDigest(repoDir).text, touchedFiles: fixture.touchedFiles });
    const promptSha256 = sha256Text(prompt);
    const scopeSha256 = hashFile(scopePath).sha256;
    runSpec = {
      runId: buildRunIdentity({ manifest: manifestBundle.manifest, caseId: manifestBundle.caseValue.id, attempt: 1 }),
      primary: true,
      attempt: 1,
      retryPolicy: 'none',
      manifest: manifestBundle.manifest,
      caseId: manifestBundle.caseValue.id,
      scopeSha256,
      qaCrAgentSha256: hashFile(materializedAgentPath(repoDir, candidateAgentRelativePath)).sha256,
      parentAgentSha256: hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256,
      promptSha256,
    };
    const secrets = collectSensitiveValues({ providerConfigPath: selectedProviderConfigPath, sensitiveValues, childEnv: env });
    b1 = await executePrimary({
      artifactRoot,
      runSpec,
      sensitiveValues: secrets,
      runner: async () => {
        const diffBefore = buildCandidateDiffDigest(repoDir);
        const productBefore = hashProductTree(repoDir);
        const parentAgentBefore = hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256;
        const candidateBefore = hashFile(materializedAgentPath(repoDir, candidateAgentRelativePath)).sha256;
        const args = ['run', '--agent', 'qa', '--format', 'json', '--model', selectedModel, '--dir', repoDir, '--pure', prompt];
        transcript.push({ kind: 'parent-run', command: invocation.command, args: [...args], cwd: repoDir, envHash, timeoutMs });
        let parentResult;
        try {
          parentResult = directSpawn(invocation.command, args, {
            cwd: repoDir,
            env,
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: 50 * 1024 * 1024,
            windowsHide: true,
            shell: false,
          });
        } catch (error) {
          parentResult = { status: null, signal: null, stdout: '', stderr: '', error };
        }
        const parentJsonl = String(parentResult.stdout || '');
        const parsedParent = parseJsonlStrict(Buffer.from(parentJsonl, 'utf8'));
        const observedChildIds = extractQaCrChildSessionIds(parsedParent.events);
        const childExports = [];
        for (const sessionId of observedChildIds) {
          transcript.push({ kind: 'child-export', sessionId, command: invocation.command, args: ['export', sessionId, '--pure'], cwd: repoDir, envHash });
          try {
            const exported = exportSession({ sessionId, projectRoot: repoDir, env, invocation });
            childExports.push({
              sessionId,
              exportStatus: exported?.status ?? 'failed',
              exportError: exported?.error ?? null,
              exportText: String(exported?.stdout || ''),
            });
          } catch (error) {
            childExports.push({ sessionId, exportStatus: 'failed', exportError: summarizeSpawnError(error), exportText: '' });
          }
        }
        const diffAfter = buildCandidateDiffDigest(repoDir);
        const productAfter = hashProductTree(repoDir);
        const productDigestBefore = buildProductMutationDigest({ productTreeSha256: productBefore.sha256, candidateDiffSha256: diffBefore.sha256 });
        const productDigestAfter = buildProductMutationDigest({ productTreeSha256: productAfter.sha256, candidateDiffSha256: diffAfter.sha256 });
        const parentAgentAfter = hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256;
        const candidateAfter = hashFile(materializedAgentPath(repoDir, candidateAgentRelativePath)).sha256;
        const timedOut = parentResult.error?.code === 'ETIMEDOUT' || /timed out/i.test(String(parentResult.error?.message || ''));
        runnerResult = {
          parentJsonl,
          childExports,
          observation: {
            terminal: {
              exitCode: Number.isInteger(parentResult.status) ? parentResult.status : null,
              signal: parentResult.signal ?? null,
              spawnError: summarizeSpawnError(parentResult.error),
              timedOut,
            },
            command: commandString(invocation.command, args),
            manifestHashObserved: manifestBundle.manifestHash,
            scopeHashObserved: scopeSha256,
            caseHashObserved: sha256CanonicalJson(manifestBundle.caseValue),
            promptHashObserved: promptSha256,
            candidateBefore,
            candidateAfter,
            parentAgentBefore,
            parentAgentAfter,
            productBefore: productDigestBefore,
            productAfter: productDigestAfter,
            productTreeBefore: productBefore.sha256,
            productTreeAfter: productAfter.sha256,
            candidateDiffBefore: diffBefore.sha256,
            candidateDiffAfter: diffAfter.sha256,
            promptBytes: Buffer.byteLength(prompt, 'utf8'),
            scopeBytes: hashFile(scopePath).bytes,
            qaAgentMaterializedSha256: parentAgentBefore,
            qaCrAgentMaterializedSha256: candidateBefore,
          },
        };
        return runnerResult;
      },
    });
    response = {
      b1,
      runSpec,
      transcript,
      tempRoot,
      repoDir,
      artifactRoot,
      keptArtifacts: keepArtifacts,
      cleanedUp,
      fixture: {
        head: fixture.head,
        touchedFiles: fixture.touchedFiles,
      },
      runnerResult,
    };
    return response;
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(isolatedRoot, { recursive: true, force: true });
    if (!keepArtifacts) rmSync(tempRoot, { recursive: true, force: true });
    cleanedUp = !keepArtifacts ? !existsSync(tempRoot) : (!existsSync(repoDir) && !existsSync(isolatedRoot));
    if (response) response.cleanedUp = cleanedUp;
  }
}
