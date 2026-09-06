import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBenchmarkOpenCodeEnv } from '../../functional-validation/real-project-benchmark.mjs';
import { parseJsonlStrict, resolveOpenCodeInvocation } from '../../functional-validation/harness.mjs';
import { materializeLocalAgentRuntime } from '../real-runner.mjs';
import { executePrimaryRunV2 } from './primary-run-harness-v2.mjs';
import { sha256CanonicalJson, validateQaCrMaturityManifest } from './case-manifest.mjs';
import { extractQaCrChildSessionIds } from './collect-run-telemetry.mjs';
import { getParentSessionIdentity } from './score-input-facts.mjs';
import { finalizeRuntimePinV2, hashArtifactRootPathV2, inspectRuntimePinV2, sha256CanonicalValueV2, validateAttemptAuthorizationV2, validateProbeV2 } from './runtime-pin-v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const manifestPath = path.join(repoRoot, 'benchmarks', 'qa-cr-maturity', 'manifest.json');
const scopePath = path.join(repoRoot, 'docs', 'qa-cr-maturity-scope-v1.md');
const probePath = path.join(repoRoot, 'benchmarks', 'qa-cr-maturity', 'probes', 'b2-parent-export-v2.json');
const targetCaseId = 'seed-defect-auth-guard-small';
const parentAgentRelativePath = 'qa.md';
const qaCrAgentRelativePath = 'qa-cr.md';
const EXPECTED_MODEL = 'cpa/gpt-5.5';
const EXPECTED_PROVIDER = 'cpa';
const EXPECTED_RUNTIME_VERSION = '1.18.19';
export const PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_PATH = 'benchmarks/qa-cr-maturity/authorizations/b2-parent-export-v2-attempt-1.json';
export const PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_SHA256 = 'e29ad15ab686c32b50618c69983fb11e3151a941d0113cdf69c872217046c704';

const phaseB2ParentExportV2ApprovedAuthorizationAbsolutePath = path.resolve(repoRoot, PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_PATH);

export const PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES = Object.freeze({
  EXECUTABLE_INVALID: 'executable_invalid',
  PROVIDER_CONFIG_INVALID: 'provider_config_invalid',
  AUTHORIZATION_PATH_INVALID: 'authorization_path_invalid',
  ARTIFACT_ROOT_INVALID: 'artifact_root_invalid',
  MODEL_INVALID: 'model_invalid',
  PROBE_INVALID: 'probe_invalid',
  MANIFEST_INVALID: 'manifest_invalid',
  PRODUCT_TREE_SETUP_INVALID: 'product_tree_setup_invalid',
  PRODUCT_TREE_POSTFLIGHT_INVALID: 'product_tree_postflight_invalid',
  AUTHORIZATION_INVALID: 'authorization_invalid',
  RUNTIME_INELIGIBLE: 'runtime_ineligible',
});

function controlledError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

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
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return result.stdout || '';
}

function validateAbsoluteExecutable(executablePath) {
  const resolved = resolveOpenCodeInvocation({ commandPath: executablePath });
  if (!resolved.shellSafe) throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.EXECUTABLE_INVALID);
  return { command: path.resolve(executablePath), invocation: resolved };
}

function normalizeResolvedPathIdentity(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function defaultSpawnVersion(executablePath) {
  try {
    const result = spawnSync(executablePath, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    if (result.error || result.status !== 0) return { ok: false, code: 'version_spawn_failed' };
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    if (stderr.length > 0 || stdout !== EXPECTED_RUNTIME_VERSION) return { ok: false, code: 'version_output_malformed' };
    return { ok: true, observedVersion: stdout };
  } catch {
    return { ok: false, code: 'version_spawn_failed' };
  }
}

export function validatePhaseB2ParentExportV2ActivationAuthorization({ authorizationPath, readAuthorizationFile = readFileSync } = {}) {
  try {
    if (typeof authorizationPath !== 'string' || authorizationPath.length === 0 || !path.isAbsolute(authorizationPath)) return { ok: false, code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID };
    if (normalizeResolvedPathIdentity(authorizationPath) !== normalizeResolvedPathIdentity(phaseB2ParentExportV2ApprovedAuthorizationAbsolutePath)) return { ok: false, code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID };
    if (!existsSync(authorizationPath) || lstatSync(authorizationPath).isSymbolicLink() || !statSync(authorizationPath).isFile()) return { ok: false, code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID };
    const authorization = JSON.parse(readAuthorizationFile(authorizationPath, 'utf8'));
    if (sha256CanonicalJson(authorization) !== PHASE_B2_PARENT_EXPORT_V2_AUTHORIZATION_SHA256) return { ok: false, code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID };
    return { ok: true, authorizationPath: path.resolve(authorizationPath), authorization };
  } catch {
    return { ok: false, code: PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID };
  }
}

function normalizeExecutableIdentity(executablePath) {
  if (typeof executablePath !== 'string' || executablePath.trim().length === 0) return null;
  const resolved = path.resolve(executablePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function removeRuntimeStateSafely(paths, removePath = rmSync) {
  let removed = true;
  for (const target of paths) {
    try {
      removePath(target, { recursive: true, force: true });
    } catch {
      removed = false;
    }
  }
  for (const target of paths) {
    try {
      if (existsSync(target)) removed = false;
    } catch {
      removed = false;
    }
  }
  return removed;
}

function validateModel(model) {
  if (typeof model !== 'string' || model.trim() !== EXPECTED_MODEL) throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.MODEL_INVALID);
  return model.trim();
}

function validateRegularJsonFile(filePath, code) {
  try {
    if (typeof filePath !== 'string' || filePath.length === 0 || !path.isAbsolute(filePath)) throw new Error('invalid');
    if (!existsSync(filePath)) throw new Error('invalid');
    if (lstatSync(filePath).isSymbolicLink()) throw new Error('invalid');
    if (!statSync(filePath).isFile()) throw new Error('invalid');
    JSON.parse(readFileSync(filePath, 'utf8'));
    return path.resolve(filePath);
  } catch {
    throw controlledError(code);
  }
}

function validateArtifactRoot(artifactRoot) {
  try {
    if (typeof artifactRoot !== 'string' || artifactRoot.length === 0 || !path.isAbsolute(artifactRoot)) throw new Error('invalid');
    if (!existsSync(artifactRoot)) throw new Error('invalid');
    if (lstatSync(artifactRoot).isSymbolicLink()) throw new Error('invalid');
    if (!statSync(artifactRoot).isDirectory()) throw new Error('invalid');
    return path.resolve(artifactRoot);
  } catch {
    throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.ARTIFACT_ROOT_INVALID);
  }
}

function hashFile(absolutePath, readBytes = readFileSync) {
  const bytes = readBytes(absolutePath);
  return { sha256: sha256Bytes(bytes), bytes: Buffer.byteLength(bytes) };
}

function walkProductFilesError(stage) {
  return controlledError(
    stage === 'setup'
      ? PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.PRODUCT_TREE_SETUP_INVALID
      : PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.PRODUCT_TREE_POSTFLIGHT_INVALID,
  );
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
    else throw new Error(`unsupported_product_tree_entry:${normalizeRelative(next)}`);
  }
  return out.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function hashFixtureTree(root) {
  const files = walkProductFiles(root).map(({ relativePath, absolutePath }) => [relativePath, sha256Bytes(readFileSync(absolutePath))]);
  return sha256Text(JSON.stringify(files));
}

export function hashCandidateDiff(repoDir) {
  return sha256Text(git(repoDir, ['diff', '--binary', '--no-ext-diff']));
}

function buildFixtureCompositeSha256({ fixtureTreeSha256, candidateDiffSha256 }) {
  return sha256CanonicalValueV2({ fixtureTreeSha256, candidateDiffSha256 });
}

function buildSyntheticFixture(repoDir) {
  const baselineFiles = {
    'src/policy.mjs': 'export function canAccessResource({ actingUserId, ownerId, isAdmin }) {\n  return actingUserId === ownerId || isAdmin === true;\n}\n',
    'src/route.mjs': "import { canAccessResource } from './policy.mjs';\nimport { logDeniedAccess } from './audit.mjs';\n\nexport function updateResource({ actingUserId, isAdmin, resource }) {\n  const allowed = canAccessResource({ actingUserId, ownerId: resource.ownerId, isAdmin });\n  if (!allowed) {\n    logDeniedAccess({ actingUserId, ownerId: resource.ownerId, action: 'update' });\n    return { status: 403, body: { error: 'forbidden' } };\n  }\n  return { status: 200, body: { ok: true } };\n}\n",
    'src/audit.mjs': 'export function logDeniedAccess({ actingUserId, ownerId, action }) {\n  return { actingUserId, ownerId, action, result: "denied" };\n}\n',
    'tests/policy.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { updateResource } from '../src/route.mjs';\n\ntest('stranger is denied', () => {\n  const result = updateResource({ actingUserId: 'user-b', isAdmin: false, resource: { ownerId: 'user-a' } });\n  assert.equal(result.status, 403);\n});\n",
  };
  const candidateFiles = {
    'src/route.mjs': "import { canAccessResource } from './policy.mjs';\nimport { logDeniedAccess } from './audit.mjs';\n\nexport function updateResource({ actingUserId, isAdmin, resource }) {\n  const allowed = canAccessResource({ actingUserId: resource.ownerId, ownerId: resource.ownerId, isAdmin });\n  if (!allowed) {\n    logDeniedAccess({ actingUserId, ownerId: resource.ownerId, action: 'update' });\n    return { status: 403, body: { error: 'forbidden' } };\n  }\n  return { status: 200, body: { ok: true } };\n}\n",
  };
  for (const [relativePath, content] of Object.entries(baselineFiles)) write(repoDir, relativePath, content);
  git(repoDir, ['init', '--quiet']);
  git(repoDir, ['add', '.']);
  git(repoDir, ['-c', 'user.name=QA Real Smoke Fixture', '-c', 'user.email=qa-real-smoke@example.invalid', 'commit', '--quiet', '-m', 'baseline']);
  const head = git(repoDir, ['rev-parse', 'HEAD']).trim();
  for (const [relativePath, content] of Object.entries(candidateFiles)) write(repoDir, relativePath, content);
  return { head, touchedFiles: git(repoDir, ['diff', '--name-only']).trim().split(/\r?\n/).filter(Boolean) };
}

function loadManifestBundle() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const validation = validateQaCrMaturityManifest(manifest);
  if (!validation.ok) throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.MANIFEST_INVALID);
  const caseValue = manifest.cases.find((entry) => entry?.id === targetCaseId);
  if (!caseValue) throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.MANIFEST_INVALID);
  return { manifest, caseValue, manifestSha256: validation.manifestHash };
}

function loadProbeBundle({ modelId, manifestId, scopeId }) {
  const probe = JSON.parse(readFileSync(probePath, 'utf8'));
  const validation = validateProbeV2(probe, {
    manifestId,
    scopeId,
    expectedRuntimeVersion: EXPECTED_RUNTIME_VERSION,
    providerId: EXPECTED_PROVIDER,
    modelId,
    agentParent: 'qa',
    agentChild: 'qa-cr',
  });
  if (validation.probeStatus !== 'VALID') throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.PROBE_INVALID);
  return { probe, probeSha256: sha256CanonicalJson(probe) };
}

const secretKeyPattern = /(?:^|_|-)(?:api[_-]?key|token|auth[_-]?token|secret|password|authorization|credential)s?$/i;
const builtEnvCredentialKeyPattern = /^CPA(?:_[A-Z0-9]+)*_(?:API_KEY|AUTH_TOKEN|TOKEN|KEY)$/;
const launchEnvAllowlist = new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI']);
const envSecretRedactionMarker = '[REDACTED_ENV_SECRET]';
const nativeCpaAuthCredentialKeys = new Set(['apiKey', 'token', 'authToken', 'authorization', 'credential', 'key', 'access', 'refresh']);

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

function selectedNativeCpaAuthShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cpa = value.cpa ?? value.provider?.cpa ?? null;
  return cpa && typeof cpa === 'object' && !Array.isArray(cpa) ? cpa : null;
}

function collectNativeCpaAuthCredentialValues(value, out = new Set()) {
  const cpa = selectedNativeCpaAuthShape(value);
  if (!cpa) return out;
  for (const [key, entry] of Object.entries(cpa)) {
    if (typeof entry === 'string' && entry.length > 0 && nativeCpaAuthCredentialKeys.has(key)) out.add(entry);
  }
  return out;
}

function buildSanitizedBaseEnv(baseEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (typeof value !== 'string') continue;
    if (launchEnvAllowlist.has(key) || builtEnvCredentialKeyPattern.test(key)) env[key] = value;
    if (key === 'OPENCODE_AUTH_CONTENT') {
      try {
        const parsed = JSON.parse(value);
        const cpa = parsed?.cpa ?? parsed?.provider?.cpa ?? null;
        if (cpa && typeof cpa === 'object' && !Array.isArray(cpa)) env[key] = JSON.stringify({ cpa });
      } catch {}
    }
  }
  return env;
}

function buildRedactedEnvDescription(env = {}) {
  return Object.keys(env).sort().map((key) => [
    key,
    (builtEnvCredentialKeyPattern.test(key) || key === 'OPENCODE_AUTH_CONTENT' || key === 'OPENCODE_CONFIG_CONTENT') ? envSecretRedactionMarker : env[key],
  ]);
}

function envFingerprint(env = {}) {
  return sha256Text(JSON.stringify(buildRedactedEnvDescription(env)));
}

function cwdFingerprint(cwd) {
  return sha256Text(path.resolve(cwd));
}

function collectSensitiveValues({ providerConfigPath, sensitiveValues = [], childEnv = {} }) {
  const values = new Set((Array.isArray(sensitiveValues) ? sensitiveValues : []).filter((value) => typeof value === 'string' && value.length > 0));
  try {
    const parsed = JSON.parse(readFileSync(providerConfigPath, 'utf8'));
    for (const value of collectSecretLikeJsonValues(parsed)) values.add(value);
    for (const value of collectNativeCpaAuthCredentialValues(parsed)) values.add(value);
  } catch {}
  for (const [key, value] of Object.entries(childEnv || {})) {
    if (typeof value === 'string' && value.length > 0 && builtEnvCredentialKeyPattern.test(key)) values.add(value);
  }
  if (typeof childEnv.OPENCODE_AUTH_CONTENT === 'string' && childEnv.OPENCODE_AUTH_CONTENT.length > 0) {
    values.add(childEnv.OPENCODE_AUTH_CONTENT);
    try {
      const parsed = JSON.parse(childEnv.OPENCODE_AUTH_CONTENT);
      for (const value of collectSecretLikeJsonValues(parsed)) values.add(value);
      for (const value of collectNativeCpaAuthCredentialValues(parsed)) values.add(value);
    } catch {}
  }
  return [...values];
}

function collectPathSensitiveValues(paths = [], env = {}) {
  const values = new Set();
  for (const value of [...paths, env.HOME, env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.OPENCODE_CONFIG_DIR, env.OPENCODE_STATE_DIR]) {
    if (typeof value === 'string' && value.length > 0) {
      values.add(value);
      values.add(path.normalize(value));
      values.add(value.replace(/\\/g, '/'));
    }
  }
  return [...values];
}

function collectBaseEnvSensitiveValues(baseEnv = {}) {
  const values = new Set();
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (builtEnvCredentialKeyPattern.test(key) || key === 'OPENCODE_AUTH_CONTENT') values.add(value);
    if (key === 'OPENCODE_AUTH_CONTENT') {
      try {
        const parsed = JSON.parse(value);
        for (const secret of collectSecretLikeJsonValues(parsed)) values.add(secret);
        for (const secret of collectNativeCpaAuthCredentialValues(parsed)) values.add(secret);
      } catch {}
    }
  }
  return [...values];
}

function materializedAgentPath(projectRoot, relativeName) {
  return path.join(projectRoot, '.opencode', 'agents', relativeName);
}

function materializedQaSkillRoot(projectRoot) {
  return path.join(projectRoot, '.opencode', 'skills', 'qa-skill');
}

function walkHashedTree(root, relative = '') {
  const current = path.join(root, relative);
  const entries = readdirSync(current, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const next = relative ? path.join(relative, entry.name) : entry.name;
    const absoluteNext = path.join(root, next);
    const lst = lstatSync(absoluteNext);
    if (lst.isSymbolicLink()) throw new Error(`unsupported_product_tree_entry:${normalizeRelative(next)}`);
    if (entry.isDirectory()) out.push(...walkHashedTree(root, next));
    else if (entry.isFile()) out.push([normalizeRelative(next), sha256Bytes(readFileSync(absoluteNext))]);
    else throw new Error(`unsupported_product_tree_entry:${normalizeRelative(next)}`);
  }
  return out.sort((left, right) => left[0].localeCompare(right[0]));
}

export function hashQaSkillTree(root) {
  return sha256Text(JSON.stringify(walkHashedTree(root)));
}

export function buildV2Prompt({ probeId, head, touchedFiles, diffText }) {
  return [
    `Probe ID: ${probeId}`,
    'This is a non-scoring plumbing probe for the qa orchestrator parent-export v2 adapter.',
    'Run exactly one direct qa-cr child task.',
    'Do not perform inline code review in the parent for this run.',
    'Do not invoke qa-e2e.',
    'Use first-attempt evidence only.',
    'There is no retry or replacement run.',
    'Do not claim defect detection accuracy, scoring, or graduation readiness.',
    `Bounded repo HEAD: ${head}`,
    `Touched files: ${touchedFiles.join(', ')}`,
    'Candidate working diff follows:',
    diffText,
  ].join('\n');
}

export function preparePhaseB2ParentExportV2AuthorizationContext({
  opencodeExecutable,
  artifactRoot,
  model = EXPECTED_MODEL,
  spawnVersion,
  readExecutableBytes = readFileSync,
  materializeRuntime = materializeLocalAgentRuntime,
} = {}) {
  const selectedModel = validateModel(model);
  const { command: executablePath } = validateAbsoluteExecutable(opencodeExecutable);
  const selectedArtifactRoot = validateArtifactRoot(artifactRoot);
  const artifactRootPathSha256 = hashArtifactRootPathV2(selectedArtifactRoot);
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'phase-b2-parent-export-v2-prepare-'));
  const repoDir = path.join(tempRoot, 'repo');
  try {
    ensureDir(repoDir);
    const manifestBundle = loadManifestBundle();
    const probeBundle = loadProbeBundle({
      modelId: selectedModel,
      manifestId: manifestBundle.manifest.manifestId,
      scopeId: manifestBundle.manifest.scopeContract.version,
    });
    const fixture = buildSyntheticFixture(repoDir);
    materializeRuntime(repoDir);
    const diffText = git(repoDir, ['diff', '--binary', '--no-ext-diff']);
    const promptText = buildV2Prompt({ probeId: probeBundle.probe.probeID, head: fixture.head, touchedFiles: fixture.touchedFiles, diffText });
    const expectedExecutableSha256 = sha256Bytes(readExecutableBytes(executablePath));
    const runtimePinPreflight = inspectRuntimePinV2({
      executablePath,
      expectedVersion: EXPECTED_RUNTIME_VERSION,
      expectedSha256: expectedExecutableSha256,
      spawnVersion,
      readExecutableBytes,
    });
    return {
      probeId: probeBundle.probe.probeID,
      probe: probeBundle.probe,
      probeSha256: probeBundle.probeSha256,
      manifest: manifestBundle.manifest,
      manifestSha256: manifestBundle.manifestSha256,
      caseId: manifestBundle.caseValue.id,
      caseSha256: sha256CanonicalJson(manifestBundle.caseValue),
      scopeSha256: sha256Bytes(readFileSync(scopePath)),
      fixtureTreeSha256: hashFixtureTree(repoDir),
      candidateDiffSha256: sha256Text(diffText),
      promptText,
      promptSha256: sha256Text(promptText),
      qaSkillTreeSha256: hashQaSkillTree(materializedQaSkillRoot(repoDir)),
      qaAgentSha256: hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256,
      qaCrAgentSha256: hashFile(materializedAgentPath(repoDir, qaCrAgentRelativePath)).sha256,
      providerId: EXPECTED_PROVIDER,
      modelId: selectedModel,
      expectedRuntimeVersion: EXPECTED_RUNTIME_VERSION,
      expectedExecutableSha256,
      artifactRootPathSha256,
      runtimePinPreflight,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function classifyTerminal(result) {
  return {
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    signal: typeof result?.signal === 'string' ? result.signal : null,
    errorCode: result?.error ? (result.error.code === 'ETIMEDOUT' ? 'spawn_timeout' : 'spawn_error') : null,
    timedOut: result?.error?.code === 'ETIMEDOUT' || /timed out/i.test(String(result?.error?.message || '')),
  };
}

function exportNestedSessionV2({ sessionId, projectRoot, env, invocation, timeoutMs, directSpawnImpl = spawnSync }) {
  const result = directSpawnImpl(invocation.command, ['export', sessionId, '--pure'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  return result;
}

function exportOutcomeFromResult({ sessionId, result }) {
  const exportText = String(result?.stdout || '');
  if (result?.error) return { sessionId, exportStatus: 'FAILED', exportErrorCode: result.error.code === 'ETIMEDOUT' ? 'export_spawn_timeout' : 'export_spawn_error', exportText };
  if (result?.status !== 0) return { sessionId, exportStatus: 'FAILED', exportErrorCode: 'export_nonzero', exportText };
  try {
    JSON.parse(exportText);
    return { sessionId, exportStatus: 'OK', exportErrorCode: null, exportText };
  } catch {
    return { sessionId, exportStatus: 'MALFORMED', exportErrorCode: 'export_json_malformed', exportText };
  }
}

function hashFixtureTreeForStage(root, stage) {
  try {
    return hashFixtureTree(root);
  } catch (error) {
    if (!String(error?.message || '').startsWith('unsupported_product_tree_entry:')) throw error;
    throw walkProductFilesError(stage);
  }
}

function runExport({ sessionId, repoDir, env, invocation, exportSession, timeoutMs, directSpawnImpl }) {
  try {
    const result = exportSession({ sessionId, projectRoot: repoDir, env, invocation, timeoutMs, directSpawnImpl });
    return exportOutcomeFromResult({ sessionId, result });
  } catch {
    return { sessionId, exportStatus: 'FAILED', exportErrorCode: 'export_spawn_throw', exportText: '' };
  }
}

function cleanupRuntimeState(paths) {
  let ok = true;
  for (const target of paths) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      ok = false;
    }
  }
  return { runtimeCleanupStatus: ok ? 'SUCCESS' : 'FAILED', runtimeCleanupSucceeded: ok };
}

function ineligibleRuntimePinFromPreflight(preflight) {
  return {
    schemaVersion: preflight?.schemaVersion ?? 'qa-cr-runtime-pin-v1',
    basename: typeof preflight?.basename === 'string' ? preflight.basename : null,
    pathSha256: typeof preflight?.pathSha256 === 'string' ? preflight.pathSha256 : null,
    bytes: Number.isInteger(preflight?.bytes) && preflight.bytes > 0 ? preflight.bytes : null,
    sha256Before: typeof preflight?.sha256Before === 'string' ? preflight.sha256Before : null,
    sha256After: typeof preflight?.sha256After === 'string' ? preflight.sha256After : null,
    observedVersion: typeof preflight?.observedVersion === 'string' ? preflight.observedVersion : null,
    expectedVersion: typeof preflight?.expectedVersion === 'string' ? preflight.expectedVersion : EXPECTED_RUNTIME_VERSION,
    expectedSha256: typeof preflight?.expectedSha256 === 'string' ? preflight.expectedSha256 : null,
    eligibilityStatus: 'INELIGIBLE',
    issueCodes: [...new Set([...(Array.isArray(preflight?.issueCodes) ? preflight.issueCodes : []), 'runtime_pin_finalize_failed'])].sort(),
  };
}

async function executePhaseB2ParentExportV2Core({
  opencodeExecutable,
  providerConfigPath,
  authorizationPath,
  artifactRoot,
  model = EXPECTED_MODEL,
  timeoutMs = 600000,
  baseEnv = process.env,
  sensitiveValues = [],
  directSpawn = spawnSync,
  exportSession = exportNestedSessionV2,
  buildEnv = buildBenchmarkOpenCodeEnv,
  materializeRuntime = materializeLocalAgentRuntime,
  spawnVersion = defaultSpawnVersion,
  readExecutableBytes = readFileSync,
  executePrimary = executePrimaryRunV2,
  removeRuntimePath = rmSync,
  authorizationOverride = null,
} = {}) {
  const selectedModel = validateModel(model);
  const { command: executablePath, invocation } = validateAbsoluteExecutable(opencodeExecutable);
  const selectedProviderConfigPath = validateRegularJsonFile(providerConfigPath, PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.PROVIDER_CONFIG_INVALID);
  const selectedAuthorizationPath = validateRegularJsonFile(authorizationPath, PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_PATH_INVALID);
  const selectedArtifactRoot = validateArtifactRoot(artifactRoot);
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'phase-b2-parent-export-v2-'));
  const repoDir = path.join(tempRoot, 'repo');
  const isolatedRoot = path.join(tempRoot, 'isolated-opencode');
  let runtimeStateRemoved = false;
  let response = null;
  try {
    ensureDir(repoDir);
    const prepared = preparePhaseB2ParentExportV2AuthorizationContext({
      opencodeExecutable: executablePath,
      artifactRoot: selectedArtifactRoot,
      model: selectedModel,
      spawnVersion,
      readExecutableBytes,
      materializeRuntime,
    });
    const { manifest, probe, probeSha256, manifestSha256, caseId, caseSha256, scopeSha256, fixtureTreeSha256, candidateDiffSha256, promptText, promptSha256, qaSkillTreeSha256, qaAgentSha256, qaCrAgentSha256, providerId, modelId, expectedRuntimeVersion, expectedExecutableSha256, artifactRootPathSha256, runtimePinPreflight: preflight } = prepared;
    const authorization = authorizationOverride ?? JSON.parse(readFileSync(selectedAuthorizationPath, 'utf8'));
    if (preflight.eligibilityStatus !== 'ELIGIBLE') throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.RUNTIME_INELIGIBLE);
    const authorizationValidation = validateAttemptAuthorizationV2(authorization, {
      probeId: probe.probeID,
      probeSha256,
      manifestSha256,
      scopeSha256,
      caseId,
      caseSha256,
      fixtureTreeSha256,
      candidateDiffSha256,
      promptSha256,
      qaSkillTreeSha256,
      qaAgentSha256,
      qaCrAgentSha256,
      providerId,
      modelId,
      expectedRuntimeVersion,
      expectedExecutableSha256,
      artifactRootPathSha256,
    });
    if (authorizationValidation.validationStatus !== 'AUTHORIZED') throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID);

    const fixture = buildSyntheticFixture(repoDir);
    materializeRuntime(repoDir);
    const diffText = git(repoDir, ['diff', '--binary', '--no-ext-diff']);
    const prompt = promptText;
    const env = buildEnv({ isolatedRoot, baseEnv: buildSanitizedBaseEnv(baseEnv), model: selectedModel, providerConfigPath: selectedProviderConfigPath });
    const secrets = [
      ...collectSensitiveValues({ providerConfigPath: selectedProviderConfigPath, sensitiveValues, childEnv: env }),
      ...collectBaseEnvSensitiveValues(baseEnv),
      ...collectPathSensitiveValues([repoDir, tempRoot, isolatedRoot, selectedArtifactRoot], env),
    ];
    if (sha256Text(diffText) !== candidateDiffSha256 || hashFixtureTree(repoDir) !== fixtureTreeSha256 || sha256Text(prompt) !== promptSha256 || hashQaSkillTree(materializedQaSkillRoot(repoDir)) !== qaSkillTreeSha256 || hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256 !== qaAgentSha256 || hashFile(materializedAgentPath(repoDir, qaCrAgentRelativePath)).sha256 !== qaCrAgentSha256) throw controlledError(PHASE_B2_PARENT_EXPORT_V2_ERROR_CODES.AUTHORIZATION_INVALID);
    const runSpec = {
      manifest,
      manifestSha256,
      caseSha256,
      probe,
      authorization,
      caseId,
      scopeSha256,
      promptText: prompt,
      promptSha256,
      qaSkillTreeSha256,
      qaAgentSha256,
      qaCrAgentSha256,
      providerId,
      modelId,
      expectedRuntimeVersion,
      expectedExecutableSha256,
      artifactRootPathSha256,
      fixtureTreeSha256,
      candidateDiffSha256,
    };
    const result = await executePrimary({
      artifactRoot: selectedArtifactRoot,
      runSpec,
      sensitiveValues: secrets,
      runner: async () => {
        const envObject = env;
        const cwd = repoDir;
        const beforeFixtureTreeSha256 = hashFixtureTreeForStage(repoDir, 'setup');
        const beforeCandidateDiffSha256 = hashCandidateDiff(repoDir);
        const beforeCompositeSha256 = buildFixtureCompositeSha256({ fixtureTreeSha256: beforeFixtureTreeSha256, candidateDiffSha256: beforeCandidateDiffSha256 });
        const beforeQaSkillTreeSha256 = hashQaSkillTree(materializedQaSkillRoot(repoDir));
        const beforeQaAgentSha256 = hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256;
        const beforeQaCrAgentSha256 = hashFile(materializedAgentPath(repoDir, qaCrAgentRelativePath)).sha256;
        const executableSha256Before = sha256Bytes(readExecutableBytes(executablePath));
        const commandArgs = ['run', '--agent', 'qa', '--format', 'json', '--model', selectedModel, '--dir', repoDir, '--pure', prompt];
        const command = [invocation.command, ...commandArgs].join(' ');
        let parentResult;
        const postflightObservation = {
          fixtureTreeSha256After: null,
          candidateDiffSha256After: null,
          productCompositeSha256After: null,
          qaSkillTreeSha256After: null,
          qaAgentSha256After: null,
          qaCrAgentSha256After: null,
          executableSha256After: null,
        };
        const partial = { childExports: [], postflightIssueCodes: [], runtimePin: null, parentExport: null, parentJsonl: '', observation: null };
        try {
          const runtimePinBeforeSpawn = finalizeRuntimePinV2({ preflight, executablePath, readExecutableBytes });
          if (runtimePinBeforeSpawn.sha256After !== expectedExecutableSha256 || runtimePinBeforeSpawn.sha256After !== preflight.sha256Before) {
            partial.runtimePin = runtimePinBeforeSpawn;
            partial.postflightIssueCodes = ['runtime_pre_spawn_invalid'];
            const cleanup = cleanupRuntimeState([repoDir, isolatedRoot]);
            return {
              parentJsonl: '',
              childExports: [],
              runtimePin: runtimePinBeforeSpawn,
              observation: {
                terminal: { exitCode: null, signal: null, errorCode: 'runtime_pre_spawn_invalid', timedOut: false },
                command,
                manifestSha256,
                scopeSha256,
                caseSha256,
                promptSha256,
                qaSkillTreeSha256Before: beforeQaSkillTreeSha256,
                qaSkillTreeSha256After: beforeQaSkillTreeSha256,
                qaAgentSha256Before: beforeQaAgentSha256,
                qaAgentSha256After: beforeQaAgentSha256,
                qaCrAgentSha256Before: beforeQaCrAgentSha256,
                qaCrAgentSha256After: beforeQaCrAgentSha256,
                fixtureTreeSha256Before: beforeFixtureTreeSha256,
                fixtureTreeSha256After: beforeFixtureTreeSha256,
                candidateDiffSha256Before: beforeCandidateDiffSha256,
                candidateDiffSha256After: beforeCandidateDiffSha256,
                productCompositeSha256Before: beforeCompositeSha256,
                productCompositeSha256After: beforeCompositeSha256,
                executableSha256Before,
                executableSha256After: runtimePinBeforeSpawn.sha256After,
                parentRunCount: 0,
                parentExportCount: 0,
                childExportCount: 0,
                sameEnvironment: true,
                sameWorkingDirectory: true,
                envIdentitySha256: envFingerprint(envObject),
                cwdIdentitySha256: cwdFingerprint(cwd),
                postflightIssueCodes: partial.postflightIssueCodes,
                runtimeCleanupStatus: cleanup.runtimeCleanupStatus,
                runtimeCleanupSucceeded: cleanup.runtimeCleanupSucceeded,
              },
            };
          }
          try {
            parentResult = directSpawn(invocation.command, commandArgs, {
              cwd,
              env: envObject,
              encoding: 'utf8',
              timeout: timeoutMs,
              maxBuffer: 50 * 1024 * 1024,
              windowsHide: true,
              shell: false,
            });
          } catch {
            parentResult = { status: null, signal: null, stdout: '', stderr: '', error: { code: 'SPAWN_THROW' } };
          }
          const parentJsonl = String(parentResult.stdout || '');
          partial.parentJsonl = parentJsonl;
          const parsedParent = parseJsonlStrict(Buffer.from(parentJsonl, 'utf8'));
          const parentIdentity = getParentSessionIdentity(parsedParent.events);
          const parentExport = parentIdentity.status === 'UNIQUE'
            ? runExport({ sessionId: parentIdentity.sessionId, repoDir, env: envObject, invocation, exportSession, timeoutMs, directSpawnImpl: directSpawn })
            : { sessionId: null, exportStatus: 'MISSING', exportErrorCode: parentIdentity.issueCode === 'parent_session_id_ambiguous' ? 'parent_session_ambiguous' : 'parent_session_missing', exportText: '' };
          partial.parentExport = parentExport;
          const childSessionIds = extractQaCrChildSessionIds(parsedParent.events);
          const childExports = childSessionIds.map((sessionId) => runExport({ sessionId, repoDir, env: envObject, invocation, exportSession, timeoutMs, directSpawnImpl: directSpawn }));
          partial.childExports = childExports;
          const runtimePin = finalizeRuntimePinV2({ preflight, executablePath, readExecutableBytes });
          partial.runtimePin = runtimePin;
          const postflightIssueCodes = [];
          const afterFixtureTreeSha256 = hashFixtureTreeForStage(repoDir, 'postflight');
          postflightObservation.fixtureTreeSha256After = afterFixtureTreeSha256;
          const afterCandidateDiffSha256 = hashCandidateDiff(repoDir);
          postflightObservation.candidateDiffSha256After = afterCandidateDiffSha256;
          const afterCompositeSha256 = buildFixtureCompositeSha256({ fixtureTreeSha256: afterFixtureTreeSha256, candidateDiffSha256: afterCandidateDiffSha256 });
          postflightObservation.productCompositeSha256After = afterCompositeSha256;
          const afterQaSkillTreeSha256 = hashQaSkillTree(materializedQaSkillRoot(repoDir));
          postflightObservation.qaSkillTreeSha256After = afterQaSkillTreeSha256;
          const afterQaAgentSha256 = hashFile(materializedAgentPath(repoDir, parentAgentRelativePath)).sha256;
          postflightObservation.qaAgentSha256After = afterQaAgentSha256;
          const afterQaCrAgentSha256 = hashFile(materializedAgentPath(repoDir, qaCrAgentRelativePath)).sha256;
          postflightObservation.qaCrAgentSha256After = afterQaCrAgentSha256;
          const executableSha256After = sha256Bytes(readExecutableBytes(executablePath));
          postflightObservation.executableSha256After = executableSha256After;
          if (runtimePin.eligibilityStatus !== 'ELIGIBLE') postflightIssueCodes.push('runtime_drift_detected');
          partial.postflightIssueCodes = [...new Set(postflightIssueCodes)].sort();
          const cleanup = cleanupRuntimeState([repoDir, isolatedRoot]);
          return {
            parentJsonl,
            parentExport,
            childExports,
            runtimePin,
            observation: {
              terminal: classifyTerminal(parentResult),
              command,
              manifestSha256,
              scopeSha256,
              caseSha256,
              promptSha256,
              qaSkillTreeSha256Before: beforeQaSkillTreeSha256,
              qaSkillTreeSha256After: afterQaSkillTreeSha256,
              qaAgentSha256Before: beforeQaAgentSha256,
              qaAgentSha256After: afterQaAgentSha256,
              qaCrAgentSha256Before: beforeQaCrAgentSha256,
              qaCrAgentSha256After: afterQaCrAgentSha256,
              fixtureTreeSha256Before: beforeFixtureTreeSha256,
              fixtureTreeSha256After: afterFixtureTreeSha256,
              candidateDiffSha256Before: beforeCandidateDiffSha256,
              candidateDiffSha256After: afterCandidateDiffSha256,
              productCompositeSha256Before: beforeCompositeSha256,
              productCompositeSha256After: afterCompositeSha256,
              executableSha256Before,
              executableSha256After,
              parentRunCount: 1,
              parentExportCount: parentExport.exportStatus === 'MISSING' ? 0 : 1,
              childExportCount: childExports.length,
              sameEnvironment: true,
              sameWorkingDirectory: true,
              envIdentitySha256: envFingerprint(envObject),
              cwdIdentitySha256: cwdFingerprint(cwd),
              postflightIssueCodes: partial.postflightIssueCodes,
              runtimeCleanupStatus: cleanup.runtimeCleanupStatus,
              runtimeCleanupSucceeded: cleanup.runtimeCleanupSucceeded,
            },
          };
        } catch (error) {
          const cleanup = cleanupRuntimeState([repoDir, isolatedRoot]);
          let runtimePin = partial.runtimePin;
          if (!runtimePin) {
            try {
              runtimePin = finalizeRuntimePinV2({ preflight, executablePath, readExecutableBytes });
            } catch {
              runtimePin = ineligibleRuntimePinFromPreflight(preflight);
            }
          }
          const partialResult = {
            ...partial,
            runtimePin,
            observation: {
              terminal: classifyTerminal(parentResult ?? { status: null, signal: null, error: null }),
              command,
              manifestSha256,
              scopeSha256,
              caseSha256,
              promptSha256,
              qaSkillTreeSha256Before: beforeQaSkillTreeSha256,
              qaSkillTreeSha256After: postflightObservation.qaSkillTreeSha256After,
              qaAgentSha256Before: beforeQaAgentSha256,
              qaAgentSha256After: postflightObservation.qaAgentSha256After,
              qaCrAgentSha256Before: beforeQaCrAgentSha256,
              qaCrAgentSha256After: postflightObservation.qaCrAgentSha256After,
              fixtureTreeSha256Before: beforeFixtureTreeSha256,
              fixtureTreeSha256After: postflightObservation.fixtureTreeSha256After,
              candidateDiffSha256Before: beforeCandidateDiffSha256,
              candidateDiffSha256After: postflightObservation.candidateDiffSha256After,
              productCompositeSha256Before: beforeCompositeSha256,
              productCompositeSha256After: postflightObservation.productCompositeSha256After,
              executableSha256Before,
              executableSha256After: postflightObservation.executableSha256After,
              parentRunCount: 1,
              parentExportCount: partial.parentExport?.exportStatus === 'MISSING' ? 0 : (partial.parentExport ? 1 : 0),
              childExportCount: partial.childExports.length,
              sameEnvironment: true,
              sameWorkingDirectory: true,
              envIdentitySha256: envFingerprint(envObject),
              cwdIdentitySha256: cwdFingerprint(cwd),
              postflightIssueCodes: [...new Set([...(partial.postflightIssueCodes ?? []), 'postflight_exception'])].sort(),
              runtimeCleanupStatus: cleanup.runtimeCleanupStatus,
              runtimeCleanupSucceeded: cleanup.runtimeCleanupSucceeded,
            },
          };
          throw Object.assign(error instanceof Error ? error : new Error('runner_partial_failure'), { partialResult });
        }
      },
    });
    response = { ...result, runtimeStateRemoved: false, probeId: probe.probeID };
  } finally {
    runtimeStateRemoved = removeRuntimeStateSafely([repoDir, isolatedRoot, tempRoot], removeRuntimePath);
    if (response) response.runtimeStateRemoved = runtimeStateRemoved;
  }
  return response;
}

export async function executePhaseB2ParentExportV2({
  opencodeExecutable,
  providerConfigPath,
  authorizationPath,
  artifactRoot,
  model = EXPECTED_MODEL,
  timeoutMs = 600000,
  baseEnv = process.env,
  sensitiveValues = [],
} = {}) {
  void opencodeExecutable;
  void providerConfigPath;
  void authorizationPath;
  void artifactRoot;
  void model;
  void timeoutMs;
  void baseEnv;
  void sensitiveValues;
  throw controlledError('b2_v2_attempt_consumed');
}

export async function executePhaseB2ParentExportV2Simulation({
  opencodeExecutable,
  providerConfigPath,
  authorizationPath,
  artifactRoot,
  model = EXPECTED_MODEL,
  timeoutMs = 600000,
  baseEnv = process.env,
  sensitiveValues = [],
  directSpawn,
  exportSession,
  buildEnv = buildBenchmarkOpenCodeEnv,
  materializeRuntime = materializeLocalAgentRuntime,
  spawnVersion,
  readExecutableBytes = readFileSync,
  executePrimary = executePrimaryRunV2,
  removeRuntimePath = rmSync,
} = {}) {
  if (typeof directSpawn !== 'function' || typeof exportSession !== 'function' || typeof spawnVersion !== 'function') throw controlledError('b2_v2_simulation_seam_required');
  if (normalizeExecutableIdentity(opencodeExecutable) !== normalizeExecutableIdentity(process.execPath)) throw controlledError('simulation_requires_process_execpath');
  return executePhaseB2ParentExportV2Core({
    opencodeExecutable,
    providerConfigPath,
    authorizationPath,
    artifactRoot,
    model,
    timeoutMs,
    baseEnv,
    sensitiveValues,
    directSpawn,
    exportSession,
    buildEnv,
    materializeRuntime,
    spawnVersion,
    readExecutableBytes,
    executePrimary,
    removeRuntimePath,
  });
}
