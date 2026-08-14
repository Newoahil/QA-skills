#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgentTopologyEvidence,
  buildChildReportRelayEvidence,
  buildDeliveredReportAuthorityEvidence,
  buildNestedSessionEvidence,
  buildParentBoundaryEvidence,
  extractModelCommandEvidence,
  createRuntimeOpenCodeEnv,
  extractFinalText,
  extractQaVerdict,
  extractTaskResultReport,
  extractTaskSessionIds,
  hashDirectory,
  materializeCurrentSkill,
  materializeRuntimeConfig,
  parseJsonlStrict,
  promptMetadata,
  redactCommandMetadata,
  resolveOpenCodeInvocation,
  summarizeInfrastructure,
  validateRunInputs,
} from './harness.mjs';
import {
  BENCHMARK_RUBRIC,
  compareArmScorecards,
  validateBenchmarkManifest,
  validateScorecard,
} from './real-project-benchmark-contracts.mjs';
import { copyProjectTree, fingerprintProjectTree } from './run-project-scenario.mjs';

const safeIdPattern = /^[A-Za-z0-9_.-]+$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const shellWrappers = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const shellMetacharacters = /[;&|`$<>]/;
const unsafeExecutableNames = new Set(['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.exe', 'curl', 'curl.exe', 'wget', 'wget.exe']);
const unsafeDirectArgPattern = /\b(?:install|update|download|network|credential|credentials|secret|token|password|api[_-]?key|apikey|bearer|production|prod|deploy|migration|migrate|destructive|remove|delete|rm|rmdir|del|erase|destroy|drop|fetch|curl|wget)\b|\.\s*(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/i;
const maxTimeoutMs = 600000;
const benchmarkOptInEnv = 'QA_SKILL_PHASE2_BENCHMARK_RUNS';
const providerAuthEnvPattern = /^(?:CPA|ANTHROPIC|OPENAI|GEMINI|GOOGLE|OPENROUTER|AZURE_OPENAI|MISTRAL|COHERE)(?:_[A-Z0-9]+)*_(?:API_KEY|AUTH_TOKEN|TOKEN|KEY)$/;
const redactionPattern = /(?:\b(?:TOKEN|PASSWORD|SECRET|API_KEY|AUTH)\b\s*[=:]\s*)[^\s"'`,;]+|Bearer\s+[A-Za-z0-9._~+\/-]+=*|(?:api[_-]?key|token|password|secret|auth)["']?\s*[:=]\s*["']?[^\s"'`,;}]+/gi;
const githubCliConfigDirectoryName = 'GitHub CLI';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonicalExistingOrResolved(candidate) {
  const resolved = path.resolve(candidate);
  try {
    return existsSync(resolved) ? path.resolve(realpathSync.native(resolved)) : resolved;
  } catch {
    return resolved;
  }
}

function isInsidePath(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeSafeRelative(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) throw new Error(`${label} must be a non-empty safe relative path`);
  const slash = value.replace(/\\/g, '/');
  if (slash.startsWith('/') || slash.startsWith('//') || /^[A-Za-z]:/.test(slash)) throw new Error(`${label} must not be absolute, drive-qualified, or UNC`);
  const parts = slash.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) throw new Error(`${label} has unsafe traversal segments`);
  return parts.join('/');
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !safeIdPattern.test(value)) throw new Error(`${label} must be a safe identifier`);
  return value;
}

function safePathComponent(value) {
  return assertSafeId(value, 'path component');
}

function collectSensitiveValues(env = process.env) {
  const values = Object.entries(env || {})
    .filter(([key, value]) => typeof value === 'string' && value.length > 0 && (/(?:TOKEN|PASSWORD|SECRET|API[_-]?KEY|AUTH|PROVIDER)/i.test(key)))
    .map(([, value]) => value)
    .filter((value) => value.length >= 3);
  if (typeof env?.OPENCODE_CONFIG_CONTENT === 'string') {
    try {
      const pending = [JSON.parse(env.OPENCODE_CONFIG_CONTENT)];
      while (pending.length > 0) {
        const entry = pending.pop();
        if (typeof entry === 'string' && entry.length >= 3) values.push(entry);
        else if (Array.isArray(entry)) pending.push(...entry);
        else if (entry && typeof entry === 'object') pending.push(...Object.values(entry));
      }
    } catch {
      values.push(env.OPENCODE_CONFIG_CONTENT);
    }
  }
  return values;
}

function redactSensitiveText(text, env = process.env) {
  let redacted = String(text ?? '');
  for (const value of collectSensitiveValues(env)) redacted = redacted.split(value).join('[REDACTED]');
  return redacted.replace(redactionPattern, (match) => {
    const separator = match.match(/^(.*?[=:]\s*)/s)?.[1];
    if (separator) return `${separator}[REDACTED]`;
    return '[REDACTED]';
  });
}

function redactJsonValue(value, env = process.env) {
  if (typeof value === 'string') return redactSensitiveText(value, env);
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue(entry, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJsonValue(entry, env)]));
  }
  return value;
}

function redactedBuffer(buffer, env = process.env) {
  return Buffer.from(redactSensitiveText(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || ''), env), 'utf8');
}

function writeTextArtifact(root, relativePath, text) {
  const safe = normalizeSafeRelative(relativePath, 'artifact path');
  const absolutePath = path.join(root, safe);
  if (!isInsidePath(absolutePath, root)) throw new Error('artifact path escapes run directory');
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text, 'utf8');
  return artifactMetadata(root, safe);
}

function writeBufferArtifact(root, relativePath, buffer) {
  const safe = normalizeSafeRelative(relativePath, 'artifact path');
  const absolutePath = path.join(root, safe);
  if (!isInsidePath(absolutePath, root)) throw new Error('artifact path escapes run directory');
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);
  return artifactMetadata(root, safe);
}

function writeJsonArtifact(root, relativePath, value) {
  return writeTextArtifact(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function artifactMetadata(root, relativePath) {
  const safe = normalizeSafeRelative(relativePath, 'artifact path');
  const absolutePath = path.join(root, safe);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) throw new Error(`artifact is not a regular file: ${safe}`);
  const bytes = readFileSync(absolutePath);
  return { path: safe, sha256: sha256Bytes(bytes), bytes: bytes.length };
}

function assertEmptyCycleArtifactRoot(externalRoot) {
  const entries = readdirSync(externalRoot, { withFileTypes: true });
  if (entries.length > 0) throw new Error(`artifact cycle root must be empty before benchmark execution; refusing to overwrite or modify existing evidence: ${externalRoot}`);
}

function cleanupRegisteredDirectory(root) {
  const attempted = true;
  try {
    rmSync(root, { recursive: true, force: true });
    return { attempted, completed: !existsSync(root), rootRemoved: true };
  } catch (error) {
    return { attempted, completed: false, rootRemoved: false, error: error.message };
  }
}

const directChildEnvAllowlist = new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI']);

function validateProviderConfigPath(providerConfigPath) {
  if (typeof providerConfigPath !== 'string' || providerConfigPath.length === 0) throw new Error('provider config path is required');
  if (!path.isAbsolute(providerConfigPath)) throw new Error('provider config path must be absolute and point to a regular file');
  if (!existsSync(providerConfigPath)) throw new Error('provider config path must exist and point to a regular file');
  const linkStat = lstatSync(providerConfigPath);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) throw new Error('provider config path must be a regular non-symlink file');
  const fileStat = statSync(providerConfigPath);
  if (!fileStat.isFile()) throw new Error('provider config path must be a regular file');
  return path.resolve(providerConfigPath);
}

function selectedProviderConfigContent({ model, providerConfigPath }) {
  const validatedPath = validateProviderConfigPath(providerConfigPath);
  if (typeof model !== 'string' || !model.includes('/')) throw new Error('model must include provider/model when provider config is supplied');
  const providerId = assertSafeId(model.slice(0, model.indexOf('/')), 'model provider id');
  let config;
  try {
    config = JSON.parse(readFileSync(validatedPath, 'utf8'));
  } catch (error) {
    throw new Error(`provider config must be valid JSON: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('provider config must be a JSON object');
  if (!config.provider || typeof config.provider !== 'object' || Array.isArray(config.provider)) throw new Error('provider config must contain a provider object');
  if (!Object.hasOwn(config.provider, providerId)) throw new Error(`provider config does not contain selected provider ${providerId}`);
  const selectedProvider = deepClone(config.provider[providerId]);
  const modelId = model.slice(model.indexOf('/') + 1);
  const reasoningOptions = selectedProvider?.models?.[modelId]?.options;
  if (providerId === 'cpa' && typeof reasoningOptions?.reasoningEffort === 'string' && reasoningOptions.reasoningEffort.toLowerCase() === 'ultra') {
    reasoningOptions.reasoningEffort = 'max';
  }
  const selected = { provider: { [providerId]: selectedProvider } };
  if (typeof config.$schema === 'string') selected.$schema = config.$schema;
  return JSON.stringify(selected);
}

function createDirectChildEnv({ baseEnv = process.env } = {}) {
  const envRoot = mkdtempSync(path.join(tmpdir(), 'qa-real-project-direct-env-'));
  const homeRoot = path.join(envRoot, 'home');
  const tempRoot = path.join(envRoot, 'tmp');
  const cacheRoot = path.join(envRoot, 'cache');
  const configRoot = path.join(envRoot, 'config');
  const dataRoot = path.join(envRoot, 'data');
  for (const directory of [homeRoot, tempRoot, cacheRoot, configRoot, dataRoot]) mkdirSync(directory, { recursive: true });
  const childEnv = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (directChildEnvAllowlist.has(key) && typeof value === 'string') childEnv[key] = value;
  }
  childEnv.HOME = homeRoot;
  childEnv.USERPROFILE = homeRoot;
  childEnv.LOCALAPPDATA = dataRoot;
  childEnv.APPDATA = configRoot;
  childEnv.XDG_CACHE_HOME = cacheRoot;
  childEnv.XDG_CONFIG_HOME = configRoot;
  childEnv.XDG_DATA_HOME = dataRoot;
  childEnv.TEMP = tempRoot;
  childEnv.TMP = tempRoot;
  childEnv.TMPDIR = tempRoot;
  childEnv.NODE_OPTIONS = '';
  return { env: childEnv, envRoot };
}

export function buildBenchmarkOpenCodeEnv({ isolatedRoot, baseEnv = process.env, model, providerConfigPath } = {}) {
  if (typeof isolatedRoot !== 'string' || isolatedRoot.length === 0) throw new Error('isolatedRoot is required');
  const root = path.resolve(isolatedRoot);
  const homeRoot = path.join(root, 'home');
  const tempRoot = path.join(root, 'tmp');
  const cacheRoot = path.join(root, 'cache');
  const configRoot = path.join(root, 'config');
  const dataRoot = path.join(root, 'data');
  const stateRoot = path.join(root, 'state');
  for (const directory of [homeRoot, tempRoot, cacheRoot, configRoot, dataRoot, stateRoot]) mkdirSync(directory, { recursive: true });
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (directChildEnvAllowlist.has(key) && typeof value === 'string') env[key] = value;
    if ((providerAuthEnvPattern.test(key) || key === 'OPENCODE_AUTH_CONTENT') && typeof value === 'string') env[key] = value;
  }
  env.HOME = homeRoot;
  env.USERPROFILE = homeRoot;
  env.LOCALAPPDATA = dataRoot;
  env.APPDATA = configRoot;
  env.XDG_CACHE_HOME = cacheRoot;
  env.XDG_CONFIG_HOME = configRoot;
  env.XDG_DATA_HOME = dataRoot;
  env.XDG_STATE_HOME = stateRoot;
  env.TEMP = tempRoot;
  env.TMP = tempRoot;
  env.TMPDIR = tempRoot;
  env.OPENCODE_TEST_HOME = root;
  env.OPENCODE_DISABLE_AUTOUPDATE = '1';
  env.OPENCODE_DISABLE_AUTOCOMPACT = '1';
  env.OPENCODE_DISABLE_SKILL_WARNINGS = '1';
  env.OPENCODE_DISABLE_DISCOVERY_WARNINGS = '1';
  env.OPENCODE_DISABLE_EXTERNAL_SKILLS = '1';
  env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1';
  env.OPENCODE_DISABLE_DEFAULT_PLUGINS = '1';
  const hostGhConfigDir = typeof baseEnv.GH_CONFIG_DIR === 'string' && baseEnv.GH_CONFIG_DIR.length > 0
    ? baseEnv.GH_CONFIG_DIR
    : typeof baseEnv.APPDATA === 'string' && baseEnv.APPDATA.length > 0
      ? path.join(baseEnv.APPDATA, githubCliConfigDirectoryName)
      : null;
  if (hostGhConfigDir && existsSync(hostGhConfigDir) && statSync(hostGhConfigDir).isDirectory()) env.GH_CONFIG_DIR = hostGhConfigDir;
  if (providerConfigPath) env.OPENCODE_CONFIG_CONTENT = selectedProviderConfigContent({ model, providerConfigPath });
  return env;
}

function fingerprintMatches(left, right) {
  return left?.treeSha256 === right?.treeSha256 && JSON.stringify(left?.files || []) === JSON.stringify(right?.files || []);
}

function extractParentSessionId(events) {
  for (const event of events) {
    const id = event?.sessionID || event?.sessionId || event?.session?.id || event?.message?.sessionID || event?.part?.sessionID;
    if (id) return id;
  }
  return null;
}

function sanitizeModelCommandEvents(events) {
  return (events || [])
    .filter((event) => typeof event?.part?.state?.input?.command === 'string')
    .map((event) => ({
      tool: event.part?.tool || null,
      callID: event.part?.callID || event.part?.callId || null,
      status: event.part?.state?.status || null,
      exit: event.part?.state?.metadata?.exit ?? null,
      commandSha256: sha256Text(event.part.state.input.command),
      outputSha256: sha256Text(event.part?.state?.output || ''),
      outputBytes: Buffer.byteLength(event.part?.state?.output || '', 'utf8'),
      errorSha256: sha256Text(event.part?.state?.error || ''),
      errorBytes: Buffer.byteLength(event.part?.state?.error || '', 'utf8'),
    }));
}

function normalizeCommandText(command) {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function approvedVerifierCommand(argv) {
  return normalizeCommandText((argv || []).join(' '));
}

function statusPreservingWrapper(command) {
  return `${command}; $ec=$LASTEXITCODE; git status --short; exit $ec`;
}

function classifyRelevantModelCommandEvidence({ evidence, directArgvArrays }) {
  const approvedCommands = (directArgvArrays || []).map(approvedVerifierCommand);
  const entries = [];
  for (const command of approvedCommands) {
    const direct = normalizeCommandText(evidence?.actualCommand || evidence?.command || '');
    const invocationKind = evidence?.invocationKind || (direct === command ? 'exact' : null);
    const accepted = evidence?.ok === true
      && (invocationKind === 'exact' || invocationKind === 'status-preserving-readonly-wrapper')
      && (direct === command || direct === normalizeCommandText(statusPreservingWrapper(command)));
    entries.push({ ok: accepted, expectedCommand: command, actualCommand: direct || null, invocationKind: invocationKind || 'missing', issues: accepted ? [] : ['missing relevant accepted verifier command evidence'] });
  }
  return { ok: entries.length > 0 && entries.every((entry) => entry.ok), entries };
}

function buildRelevantModelCommandEvidence({ openCodeResult, directArgvArrays }) {
  if (openCodeResult?.rawModelCommandEvents) {
    const entries = directArgvArrays.map((argv) => extractModelCommandEvidence({ events: openCodeResult.rawModelCommandEvents, expectedCommand: approvedVerifierCommand(argv) }));
    return { ok: entries.length > 0 && entries.every((entry) => entry.ok === true), entries };
  }
  if (openCodeResult?.modelCommandEvidence) return classifyRelevantModelCommandEvidence({ evidence: openCodeResult.modelCommandEvidence, directArgvArrays });
  return { ok: false, entries: directArgvArrays.map((argv) => ({ ok: false, expectedCommand: approvedVerifierCommand(argv), actualCommand: null, invocationKind: 'missing', issues: ['model command evidence unavailable'] })) };
}

function authorityEvidenceOk(openCodeResult) {
  const child = openCodeResult?.childReportRelayEvidence;
  return openCodeResult?.agentTopology?.ok === true
    && openCodeResult?.parentBoundaryEvidence?.ok === true
    && child?.ok === true
    && child.deliveryOk !== false
    && openCodeResult?.reportAuthorityEvidence?.ok === true;
}

function hasTraceabilityChain(finalText) {
  return /Risk[^\r\n]{0,80}Verification[^\r\n]{0,80}Evidence[^\r\n]{0,80}Status/i.test(finalText || '')
    || /[A-Za-z0-9_.-]+\s*(?:->|→)\s*[A-Za-z0-9_.-]+\s*(?:->|→)\s*[A-Za-z0-9_.-]+\s*(?:->|→)\s*(?:PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)/i.test(finalText || '');
}

export function expandBenchmarkManifest({ manifest } = {}) {
  const validation = validateBenchmarkManifest(manifest);
  if (!validation.ok) throw new Error(`invalid benchmark manifest: ${validation.diagnostics.join('; ')}`);
  const runs = [];
  for (const pair of manifest.pairs) {
    for (const snapshotRole of ['preSnapshot', 'postSnapshot']) {
      const snapshot = pair[snapshotRole];
      for (const armId of ['baseline', 'skill']) {
        const arm = manifest.arms[armId];
        const primaryRun = arm.primaryRuns[0];
        runs.push({
          ...deepClone(primaryRun),
          armId,
          skillLoaded: arm.skillLoaded,
          pairId: pair.pairId,
          snapshotId: snapshot.snapshotId,
          snapshotRole: snapshotRole === 'preSnapshot' ? 'pre' : 'post',
          primary: true,
          attempt: 1,
          maxAttempts: 1,
          retryPolicy: 'none',
          retryCount: 0,
          directArgvArrays: deepClone(snapshot.directArgvArrays),
          expectedVerdict: snapshot.expectedVerdict,
          localSnapshot: snapshot.localSnapshot,
          treeSha256: snapshot.treeSha256,
        });
      }
    }
  }
  return { manifestStatus: manifest.status, runs };
}

export function resolveCorpusSnapshotPath({ corpusRoot, localSnapshot } = {}) {
  if (!corpusRoot || !path.isAbsolute(path.resolve(corpusRoot))) throw new Error('corpusRoot is required');
  const relativePath = normalizeSafeRelative(localSnapshot, 'localSnapshot');
  const absolutePath = path.resolve(corpusRoot, relativePath);
  if (!isInsidePath(absolutePath, corpusRoot)) throw new Error('unsafe localSnapshot traversal escape');
  return { absolutePath, relativePath };
}

export function fingerprintCorpusSnapshot({ snapshotRoot } = {}) {
  return fingerprintProjectTree(snapshotRoot);
}

export function verifyPinnedSnapshotFingerprint({ snapshotRoot, expectedTreeSha256 } = {}) {
  if (!sha256Pattern.test(expectedTreeSha256 || '')) throw new Error('expectedTreeSha256 must be a SHA-256 hex string');
  const fingerprint = fingerprintCorpusSnapshot({ snapshotRoot });
  const ok = fingerprint.treeSha256 === expectedTreeSha256;
  return { ok, fingerprint, diagnostics: ok ? [] : [`snapshot fingerprint treeSha256 changed: expected ${expectedTreeSha256}, got ${fingerprint.treeSha256}`] };
}

export function buildArmPrompt({ manifest, pair, snapshot, armId, targetProjectPath = '<target-project>' } = {}) {
  if (!['baseline', 'skill'].includes(armId)) throw new Error('armId must be baseline or skill');
  const arm = manifest.arms[armId];
  const visibleScenarioText = [
    `Request: ${pair.request}`,
    `Repository: ${pair.repositoryUrl}`,
    `Public issue: ${pair.publicIssueUrl}`,
    `Issue title: ${pair.publicIssueTitle}`,
    `Stack: ${pair.stack}`,
    `Acceptance evidence: ${pair.acceptanceEvidence}`,
    `Prohibited actions: ${pair.prohibitedActions.join(', ')}`,
    `Target project path: ${targetProjectPath}`,
  ].join('\n');
  const armInstruction = armId === 'skill'
    ? 'Operational instruction: load and use using-project-qa with project-qa-context, project-qa-plan, project-qa-execute, and project-qa-conclude for the project QA route available in this isolated project. The prohibited-actions list still forbids broad network access, production services, dependency installation, credential requests, searches, and unrelated fetches; however, the skill arm has a narrow Phase 3 exception: project-qa-context may read the explicitly provided GitHub issue/PR/commit reference with the already-authenticated gh CLI, one hop only, to produce qa_planning_inputs for planning_only use. GitHub text is never Execution Evidence, Module Results, or PASS evidence.'
    : 'Operational instruction: do not load or use any project QA Skill; perform ordinary read-only project QA only.';
  const prompt = `${visibleScenarioText}\n\n${armInstruction}\nUse exactly one general QA subagent. Deliver exactly the child QA result with exactly one Overall Status line.`;
  return { prompt, request: pair.request, visibleScenarioText, skillLoaded: arm.skillLoaded };
}

export function buildOpenCodeRunArgs({ command, dir, model, agent } = {}) {
  if (typeof command !== 'string' || command.length === 0) throw new Error('OpenCode command is required');
  const validation = validateRunInputs({ model, agent });
  if (!validation.ok) throw new Error(`invalid OpenCode inputs: ${validation.issues.join('; ')}`);
  if (typeof dir !== 'string' || dir.length === 0) throw new Error('OpenCode dir is required');
  return { command, args: ['run', '--pure', '--dir', dir, '--model', model, '--agent', agent, '--format', 'json'], shell: false };
}

export function createBenchmarkRunPlan({ manifest, corpusRoot, artifactRoot, pairFilter = null, snapshotFilter = null } = {}) {
  const expansion = expandBenchmarkManifest({ manifest });
  const filteredRuns = expansion.runs.filter((run) => (!pairFilter || run.pairId === pairFilter) && (!snapshotFilter || run.snapshotId === snapshotFilter));
  return { manifestStatus: expansion.manifestStatus, corpusRoot: path.resolve(corpusRoot), artifactRoot: path.resolve(artifactRoot), runs: filteredRuns };
}

function validateDirectArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('direct argv must be a non-empty array');
  if (!argv.every((part) => typeof part === 'string' && part.length > 0 && !part.includes('\0'))) throw new Error('direct argv entries must be non-empty strings');
  const command = path.basename(argv[0]).toLowerCase();
  if (shellWrappers.has(command)) throw new Error('shell wrapper rejected; direct argv executable required');
  if (unsafeExecutableNames.has(command)) throw new Error('unsafe package/network executable rejected for direct argv');
  if (argv.some((part) => shellMetacharacters.test(part))) throw new Error('direct argv contains shell metacharacters');
  const text = argv.join(' ');
  if (unsafeDirectArgPattern.test(text)) throw new Error('unsafe direct argv operation rejected: install/update/network/credential/production/migration/destructive/remove/delete/rm text');
  return argv;
}

export function executeDirectArgv({ cwd, argv, timeoutMs = 60000, spawn = spawnSync, env = process.env, context = null } = {}) {
  validateDirectArgv(argv);
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('cwd must be an existing directory');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maxTimeoutMs) throw new Error(`timeoutMs must be 1..${maxTimeoutMs}`);
  const startedAt = new Date().toISOString();
  const isolatedEnv = createDirectChildEnv({ baseEnv: env });
  const options = { cwd, env: isolatedEnv.env, encoding: 'utf8', shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 20 };
  if (context) {
    options.context = context;
    options.snapshotId = context.snapshotId;
  }
  let result;
  let envCleanup = { attempted: false, completed: false };
  try {
    result = spawn(argv[0], argv.slice(1), options);
  } finally {
    envCleanup = cleanupRegisteredDirectory(isolatedEnv.envRoot);
  }
  const endedAt = new Date().toISOString();
  const timedOut = result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM';
  const exitStatus = timedOut ? 'TIMED_OUT' : result?.error ? 'SPAWN_ERROR' : result?.status;
  return {
    argv: [...argv],
    startedAt,
    endedAt,
    exitStatus,
    signal: result?.signal ?? null,
    timedOut,
    stdout: result?.stdout || '',
    stderr: result?.stderr || '',
    error: result?.error?.message || null,
    envCleanup,
  };
}

export function interpretOracleVerdict({ execution, expectedVerdict } = {}) {
  const actualVerdict = execution?.exitStatus === 0 ? 'PASS' : Number.isInteger(execution?.exitStatus) ? 'FAIL' : 'BLOCKED';
  return { actualVerdict, matchesExpectedVerdict: actualVerdict === expectedVerdict };
}

export function detectPostflightMutation({ beforeFingerprint, afterFingerprint } = {}) {
  const ok = beforeFingerprint?.treeSha256 === afterFingerprint?.treeSha256;
  return { ok, diagnostics: ok ? [] : ['postflight mutation detected: snapshot fingerprint changed'] };
}

export function validateBenchmarkRunScorecard({ manifestStatus, scorecard } = {}) {
  const diagnostics = [];
  const validation = validateScorecard(scorecard);
  diagnostics.push(...validation.diagnostics);
  if (scorecard?.scorer !== 'automated-heuristic' || scorecard?.scoringLabel !== 'automated heuristic') diagnostics.push('scorecard must use automated-heuristic scorer and automated heuristic label');
  if (/independent[- ]human|human scored|human judge/i.test(JSON.stringify(scorecard))) diagnostics.push('independent human scoring claims are not permitted');
  return { ok: diagnostics.length === 0, diagnostics, manifestStatus, scorer: 'automated-heuristic', scoringLabel: 'automated heuristic' };
}

export function validateBenchmarkComparison({ manifestStatus, comparison } = {}) {
  const ok = comparison?.ok === true;
  return { ok, diagnostics: comparison?.diagnostics || [], comparison, approvedEffectivenessClaim: false, manifestStatus };
}

export function resolveExternalArtifactRoot({ corpusRoot, artifactRoot, sourceSnapshotRoot = null } = {}) {
  if (!artifactRoot) throw new Error('artifact root is required');
  const absolutePath = canonicalExistingOrResolved(artifactRoot);
  const corpus = canonicalExistingOrResolved(corpusRoot || '');
  if (isInsidePath(absolutePath, corpus) || isInsidePath(corpus, absolutePath)) throw new Error('artifact root must be outside, non-overlapping, and external to corpus root');
  if (sourceSnapshotRoot) {
    const source = canonicalExistingOrResolved(sourceSnapshotRoot);
    if (isInsidePath(absolutePath, source) || isInsidePath(source, absolutePath)) throw new Error('artifact root must be outside, non-overlapping, and external to source snapshot');
  }
  mkdirSync(absolutePath, { recursive: true });
  return { absolutePath };
}

export function parseBenchmarkCliArgs(argv = process.argv.slice(2), env = process.env) {
  const options = { allowRealProjectBenchmark: env[benchmarkOptInEnv] === '1' };
  const known = new Set(['allow-real-project-benchmark', 'manifest', 'corpus-root', 'artifact-root', 'comparison-threshold', 'pair', 'snapshot', 'provider-config']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`strict CLI rejected positional argument ${token}`);
    const key = token.slice(2);
    if (!known.has(key)) throw new Error(`unknown strict benchmark option --${key}`);
    if (key === 'allow-real-project-benchmark') {
      options.allowRealProjectBenchmark = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    index += 1;
    if (key === 'comparison-threshold') options.comparisonThreshold = Number(value);
    else if (key === 'manifest') options.manifestPath = value;
    else if (key === 'pair') options.pairFilter = assertSafeId(value, 'pair filter');
    else if (key === 'snapshot') options.snapshotFilter = assertSafeId(value, 'snapshot filter');
    else if (key === 'provider-config') options.providerConfigPath = value;
    else options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.providerConfigPath && env.QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH) options.providerConfigPath = env.QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH;
  if (!options.allowRealProjectBenchmark) throw new Error('explicit opt-in --allow-real-project-benchmark is required');
  for (const required of ['manifestPath', 'corpusRoot', 'artifactRoot']) {
    if (!options[required]) throw new Error(`${required} is required`);
  }
  if (!Number.isInteger(options.comparisonThreshold) || options.comparisonThreshold < 0) throw new Error('comparison threshold is required and must be non-negative');
  options.manifestPath = path.resolve(options.manifestPath);
  options.corpusRoot = path.resolve(options.corpusRoot);
  options.artifactRoot = resolveExternalArtifactRoot({ corpusRoot: options.corpusRoot, artifactRoot: options.artifactRoot }).absolutePath;
  if (options.providerConfigPath) options.providerConfigPath = validateProviderConfigPath(options.providerConfigPath);
  return options;
}

function resolveDefaultOpenCodeInvocation(env = process.env) {
  const candidates = [];
  if (env.QA_SKILL_OPENCODE_BIN) candidates.push(env.QA_SKILL_OPENCODE_BIN);
  if (process.platform !== 'win32') candidates.push('/usr/local/bin/opencode', '/usr/bin/opencode');
  else {
    for (const entry of String(env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(entry, 'opencode.exe'));
    if (env.APPDATA) {
      const arch = process.arch === 'x64' ? 'x64' : process.arch;
      const root = path.join(env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'node_modules');
      candidates.push(path.join(root, `opencode-windows-${arch}`, 'bin', 'opencode.exe'));
      candidates.push(path.join(root, `opencode-windows-${arch}-baseline`, 'bin', 'opencode.exe'));
    }
  }
  for (const candidate of candidates) {
    const resolved = resolveOpenCodeInvocation({ commandPath: candidate });
    if (resolved.shellSafe) return resolved;
  }
  throw new Error('QA_SKILL_OPENCODE_BIN is required: no safe direct OpenCode executable could be resolved');
}

function extractTaskResultText(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const output = events[index]?.part?.state?.output;
    if (typeof output !== 'string') continue;
    const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/i.exec(output);
    if (match) return match[1];
  }
  return '';
}

async function defaultOpenCodeRunner(context) {
  const validation = validateRunInputs({ model: context.model, agent: context.agent });
  if (!validation.ok) throw new Error(`invalid OpenCode inputs: ${validation.issues.join('; ')}`);
  const invocation = resolveDefaultOpenCodeInvocation(context.env || process.env);
  const runInvocation = buildOpenCodeRunArgs({ command: invocation.command, dir: context.projectRoot, model: context.model, agent: context.agent });
  const args = runInvocation.args;
  const runtimeEnvRoot = context.runtimeEnvRoot || mkdtempSync(path.join(tmpdir(), 'qa-real-project-opencode-env-'));
  const ownsRuntimeEnvRoot = !context.runtimeEnvRoot;
  try {
    const env = buildBenchmarkOpenCodeEnv({ isolatedRoot: runtimeEnvRoot, baseEnv: context.env || process.env, model: context.model, providerConfigPath: context.providerConfigPath });
    const startedAtMs = Date.now();
    const result = spawnSync(invocation.command, args, {
      cwd: context.projectRoot,
      env,
      input: Buffer.from(context.prompt, 'utf8'),
      encoding: 'buffer',
      shell: false,
      windowsHide: true,
      timeout: context.timeoutMs,
      maxBuffer: 1024 * 1024 * 50,
    });
    const endedAtMs = Date.now();
    const rawStdout = result.stdout || Buffer.alloc(0);
    const stderr = (result.stderr || Buffer.alloc(0)).toString('utf8');
    const parsed = parseJsonlStrict(rawStdout);
    const parentSessionId = extractParentSessionId(parsed.events);
    const parentBoundaryEvidence = buildParentBoundaryEvidence({ events: parsed.events, parentSessionId });
    const childSessionIds = extractTaskSessionIds(parsed.events);
    const exportResult = childSessionIds.length === 1
      ? spawnSync(invocation.command, ['export', childSessionIds[0], '--pure'], { cwd: context.projectRoot, env, encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 1024 * 1024 * 20 })
      : null;
    let exportJson = null;
    if (exportResult?.status === 0 && exportResult.stdout) {
      try {
        exportJson = JSON.parse(exportResult.stdout);
      } catch (error) {
        exportJson = { parseError: error.message };
      }
    }
    const nestedSessionEvidence = childSessionIds.length === 1
      ? buildNestedSessionEvidence({ sessionId: childSessionIds[0], parentSessionId, exportJson, expectedCommand: null })
      : { ok: false, sessionId: null, parentSessionId, issues: [`expected exactly one child session, found ${childSessionIds.length}`], selectedToolEvents: [] };
    const agentTopology = buildAgentTopologyEvidence({ parentSessionId, childSessionIds, nestedSessionEvidence, requestedModel: context.model, expectedAgent: 'general', exportResult: exportResult ? { status: exportResult.status } : null });
    const finalMessage = extractFinalText(parsed.events);
    const taskResultReport = extractTaskResultReport({ events: parsed.events, parentSessionId });
    const taskResultText = taskResultReport.text || extractTaskResultText(parsed.events);
    const finalText = taskResultText || finalMessage;
    const qaVerdict = extractQaVerdict(finalText);
    const childReportRelayEvidence = buildChildReportRelayEvidence({ childText: taskResultText, parentText: finalMessage, expectedVerdict: qaVerdict || 'BLOCKED', deliveredText: finalText });
    if (taskResultReport.issues.length > 0) {
      childReportRelayEvidence.deliveryIssues.push(...taskResultReport.issues);
      childReportRelayEvidence.deliveryOk = false;
      childReportRelayEvidence.issues.push(...taskResultReport.issues);
    }
    const reportAuthorityEvidence = buildDeliveredReportAuthorityEvidence({ authoritativeText: finalText, projectRoot: context.projectRoot });
    const rawModelCommandEvents = nestedSessionEvidence.selectedToolEvents || [];
    const modelCommandEvents = sanitizeModelCommandEvents(rawModelCommandEvents);
    const modelCommandEvidence = modelCommandEvents.length > 0
      ? { ok: true, eventCount: modelCommandEvents.length, selectedToolEvents: modelCommandEvents }
      : { ok: false, issues: ['model command evidence unavailable'] };
    const runnerResult = {
      status: summarizeInfrastructure({ spawnError: result.error || null, timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM', exitCode: result.status, jsonlErrors: parsed.errors, finalText, qaVerdict }).status,
      rawStdout,
      stderr,
      events: parsed.events,
      jsonlErrors: parsed.errors,
      finalMessage,
      finalText,
      qaVerdict,
      terminal: { platform: process.platform, node: process.version, startedAt: new Date(startedAtMs).toISOString(), endedAt: new Date(endedAtMs).toISOString(), durationMs: endedAtMs - startedAtMs, timeoutMs: context.timeoutMs, exitCode: result.status, signal: result.signal ?? null, spawnError: result.error?.message || null, stdoutBytes: rawStdout.length, stderrBytes: Buffer.byteLength(stderr, 'utf8') },
      commandMetadata: redactCommandMetadata({ command: invocation.command, args, env: redactJsonValue(env, env), prompt: context.prompt }),
      runtimeEnvRootReference: `host-temp://${path.basename(runtimeEnvRoot)}`,
      parentBoundaryEvidence,
      nestedSessionEvidence,
      agentTopology,
      childReportRelayEvidence,
      reportAuthorityEvidence,
      modelCommandEvidence,
      modelCommandEvents,
      rawModelCommandEvents,
    };
    Object.defineProperty(runnerResult, 'redactionEnv', { value: env, enumerable: false });
    return runnerResult;
  } finally {
    if (ownsRuntimeEnvRoot) cleanupRegisteredDirectory(runtimeEnvRoot);
  }
}

function proportionalMentionScore({ finalText, values, weight }) {
  const uniqueValues = [...new Set((values || []).filter(Boolean))];
  if (uniqueValues.length === 0) return 0;
  const lowerText = String(finalText || '').toLowerCase();
  const matched = uniqueValues.filter((value) => lowerText.includes(String(value).toLowerCase())).length;
  return Math.floor((matched / uniqueValues.length) * weight);
}

function createScorecard({ run, pair, finalText, openCodeResult, oracleResults, postflight, cleanup }) {
  const modelVerdict = openCodeResult?.status === 'COMPLETED' ? extractQaVerdict(finalText) : null;
  const actualVerdict = modelVerdict || 'BLOCKED';
  const oracleConfirmsExpected = oracleResults.length > 0 && oracleResults.every((entry) => entry.matchesExpectedVerdict === true);
  const authorityOk = authorityEvidenceOk(openCodeResult);
  const relevantCommandEvidence = buildRelevantModelCommandEvidence({ openCodeResult, directArgvArrays: run.directArgvArrays });
  const commandEvidenceOk = relevantCommandEvidence.ok === true;
  const expectedCoverageItems = [...(pair.expectedRisks || []), ...(pair.expectedModules || []), ...(pair.expectedFlows || [])];
  const coverageScore = proportionalMentionScore({ finalText, values: expectedCoverageItems, weight: BENCHMARK_RUBRIC.coverage });
  const traceabilityOk = authorityOk && hasTraceabilityChain(finalText);
  const blockerOk = !/missing prerequisite|blocked because|unresolved blocker/i.test(finalText || '') || /NEEDS_HUMAN_REVIEW|BLOCKED/.test(finalText || '');
  const readOnlyOk = authorityOk && postflight.ok === true && cleanup?.completed === true;
  const reportOk = authorityOk && typeof finalText === 'string' && finalText.trim().length > 0 && Boolean(modelVerdict) && openCodeResult?.status === 'COMPLETED';
  const costOk = openCodeResult?.terminal?.timeoutMs <= maxTimeoutMs && openCodeResult?.terminal?.durationMs !== undefined;
  const dimensions = {
    verdict: { score: authorityOk && actualVerdict === run.expectedVerdict && oracleConfirmsExpected ? BENCHMARK_RUBRIC.verdict : 0, evidenceIds: ['E-verdict'] },
    coverage: { score: coverageScore, evidenceIds: ['E-coverage'] },
    commandEvidence: { score: commandEvidenceOk ? BENCHMARK_RUBRIC.commandEvidence : 0, evidenceIds: ['E-commandEvidence'] },
    traceability: { score: traceabilityOk ? BENCHMARK_RUBRIC.traceability : 0, evidenceIds: ['E-traceability'] },
    blockerHumanGate: { score: blockerOk ? BENCHMARK_RUBRIC.blockerHumanGate : 0, evidenceIds: ['E-blockerHumanGate'] },
    readOnly: { score: readOnlyOk ? BENCHMARK_RUBRIC.readOnly : 0, evidenceIds: ['E-readOnly'] },
    report: { score: reportOk ? BENCHMARK_RUBRIC.report : 0, evidenceIds: ['E-report'] },
    costTime: { score: costOk ? BENCHMARK_RUBRIC.costTime : 0, evidenceIds: ['E-costTime'] },
  };
  const total = Object.values(dimensions).reduce((sum, entry) => sum + entry.score, 0);
  const scorecard = { armId: run.armId, pairId: run.pairId, snapshotId: run.snapshotId, runId: run.runId, actualVerdict, scorer: 'automated-heuristic', scoringLabel: 'automated heuristic', dimensions, total };
  const validation = validateScorecard(scorecard);
  if (!validation.ok) throw new Error(`invalid generated scorecard: ${validation.diagnostics.join('; ')}`);
  return scorecard;
}

function createRunArtifactRoot({ artifactRoot, run }) {
  const runRoot = path.join(
    artifactRoot,
    safePathComponent(run.pairId),
    safePathComponent(run.snapshotId),
    safePathComponent(run.armId),
    safePathComponent(run.runId),
  );
  if (existsSync(runRoot)) throw new Error(`artifact run identity directory already exists; refusing to overwrite existing evidence: ${runRoot}`);
  mkdirSync(runRoot, { recursive: true });
  return runRoot;
}

async function executeBenchmarkRun({ manifest, pair, snapshot, run, corpusRoot, artifactRoot, skillPackRoot, providerConfigPath = null, openCodeRunner, directSpawn }) {
  const source = resolveCorpusSnapshotPath({ corpusRoot, localSnapshot: snapshot.localSnapshot });
  const externalArtifactRoot = createRunArtifactRoot({ artifactRoot, run });
  let runRoot = null;
  let cleanup = { attempted: false, completed: false };
  let redactionEnv = process.env;
  try {
    resolveExternalArtifactRoot({ corpusRoot, artifactRoot: externalArtifactRoot, sourceSnapshotRoot: source.absolutePath });
    const originalBefore = fingerprintCorpusSnapshot({ snapshotRoot: source.absolutePath });
    const pinned = verifyPinnedSnapshotFingerprint({ snapshotRoot: source.absolutePath, expectedTreeSha256: snapshot.treeSha256 });
    if (!pinned.ok) throw new Error(pinned.diagnostics.join('; '));
    const skillSourceBefore = skillPackRoot && existsSync(skillPackRoot) ? hashDirectory(skillPackRoot) : null;
    runRoot = mkdtempSync(path.join(tmpdir(), 'qa-real-project-benchmark-'));
    let projectRoot = path.join(runRoot, 'opencode-project');
    let skillMaterialization = null;
    if (run.armId === 'skill') {
      if (!skillPackRoot) throw new Error('skillPackRoot is required for skill arm');
      skillMaterialization = materializeCurrentSkill({ packRoot: skillPackRoot, runRoot });
      projectRoot = skillMaterialization.projectRoot;
    } else {
      mkdirSync(projectRoot, { recursive: true });
    }
    const targetRoot = path.join(projectRoot, 'target');
    const copiedSourceFingerprint = copyProjectTree(source.absolutePath, targetRoot);
    const copyBefore = fingerprintProjectTree(targetRoot);
    if (!fingerprintMatches(copiedSourceFingerprint, copyBefore) || copyBefore.treeSha256 !== snapshot.treeSha256) throw new Error('source/copy fingerprint mismatch before model run');
    const originalRecheck = fingerprintCorpusSnapshot({ snapshotRoot: source.absolutePath });
    if (!fingerprintMatches(originalBefore, originalRecheck)) throw new Error('source snapshot changed during copy');
    const runtimeConfig = materializeRuntimeConfig({ projectRoot, model: manifest.runConfig.model });
    const promptBundle = buildArmPrompt({ manifest, pair, snapshot, armId: run.armId, targetProjectPath: 'target' });
    const context = {
      armId: run.armId,
      pairId: run.pairId,
      snapshotId: run.snapshotId,
      snapshotRole: run.snapshotRole,
      runId: run.runId,
      primary: true,
      attempt: 1,
      maxAttempts: 1,
      retryPolicy: 'none',
      model: manifest.runConfig.model,
      agent: manifest.runConfig.agent,
      timeoutMs: manifest.runConfig.timeoutMs,
      projectRoot,
      targetRoot,
      artifactRoot: externalArtifactRoot,
      request: promptBundle.request,
      skillLoaded: promptBundle.skillLoaded,
      skillSourceRoot: run.armId === 'skill' ? skillPackRoot : undefined,
      skillRoot: run.armId === 'skill' ? skillMaterialization.skillRoot : null,
      copiedSkillManifest: run.armId === 'skill' ? skillMaterialization.copiedManifest : undefined,
    };
    Object.defineProperty(context, 'prompt', { value: promptBundle.prompt, enumerable: false });
    Object.defineProperty(context, 'visibleScenarioText', { value: promptBundle.visibleScenarioText, enumerable: false });
    Object.defineProperty(context, 'runtimeEnvRoot', { value: path.join(runRoot, 'opencode-runtime-env'), enumerable: false });
    if (providerConfigPath) Object.defineProperty(context, 'providerConfigPath', { value: providerConfigPath, enumerable: false });
    if (run.armId === 'baseline') {
      delete context.skillSourceRoot;
      delete context.copiedSkillManifest;
    }
    const openCodeResult = await openCodeRunner(context);
    const rawStdout = Buffer.isBuffer(openCodeResult.rawStdout) ? openCodeResult.rawStdout : Buffer.from(openCodeResult.rawStdout || '', 'utf8');
    const events = openCodeResult.events || parseJsonlStrict(rawStdout).events;
    const finalMessage = openCodeResult.finalMessage || extractFinalText(events);
    const finalText = openCodeResult.finalText || finalMessage || '';
    const terminal = openCodeResult.terminal || { status: openCodeResult.status || 'UNKNOWN' };
    const commandMetadata = openCodeResult.commandMetadata || { runner: 'injected', prompt: promptMetadata(promptBundle.prompt) };
    redactionEnv = openCodeResult.redactionEnv || process.env;
    const errorEvents = events.filter((event) => event?.type === 'error');
    const terminalFailed = (Number.isInteger(terminal.exitCode) && terminal.exitCode !== 0)
      || (Object.hasOwn(terminal, 'exitCode') && terminal.exitCode === null)
      || Boolean(terminal.signal)
      || Boolean(terminal.spawnError);
    if (terminalFailed || errorEvents.length > 0) {
      writeJsonArtifact(externalArtifactRoot, 'terminal.json', redactJsonValue(terminal, redactionEnv));
      writeBufferArtifact(externalArtifactRoot, 'raw-stdout.jsonl', redactedBuffer(rawStdout, redactionEnv));
      writeTextArtifact(externalArtifactRoot, 'stderr.txt', redactSensitiveText(openCodeResult.stderr || '', redactionEnv));
      writeJsonArtifact(externalArtifactRoot, 'events.json', redactJsonValue(events, redactionEnv));
      const eventMessages = errorEvents
        .map((event) => event?.error?.data?.message || event?.error?.message || event?.message)
        .filter((message) => typeof message === 'string' && message.length > 0);
      const diagnostics = [
        Number.isInteger(terminal.exitCode) && terminal.exitCode !== 0 ? `exit code ${terminal.exitCode}` : null,
        terminal.signal ? `signal ${terminal.signal}` : null,
        terminal.spawnError ? `spawn error: ${terminal.spawnError}` : null,
        ...eventMessages,
      ].filter(Boolean);
      throw new Error(`OpenCode primary run failed before valid QA evidence: ${diagnostics.join('; ') || 'unknown execution failure'}`);
    }
    const oracleExecutions = [];
    for (const argv of snapshot.directArgvArrays) {
      const execution = executeDirectArgv({
        cwd: targetRoot,
        argv,
        timeoutMs: Math.min(manifest.runConfig.timeoutMs, maxTimeoutMs),
        spawn: directSpawn || spawnSync,
        context: { pairId: pair.pairId, snapshotId: snapshot.snapshotId, armId: run.armId, runId: run.runId },
      });
      oracleExecutions.push({ argv: [...argv], execution, ...interpretOracleVerdict({ execution, expectedVerdict: snapshot.expectedVerdict }) });
    }
    const originalAfter = fingerprintCorpusSnapshot({ snapshotRoot: source.absolutePath });
    const copyAfter = fingerprintProjectTree(targetRoot);
    const skillAfter = run.armId === 'skill' ? hashDirectory(skillMaterialization.skillRoot) : null;
    const skillSourceAfter = skillPackRoot && existsSync(skillPackRoot) ? hashDirectory(skillPackRoot) : null;
    const runtimeConfigAfter = sha256Bytes(readFileSync(runtimeConfig.configPath));
    const mutation = detectPostflightMutation({ beforeFingerprint: originalBefore, afterFingerprint: originalAfter });
    const copyUnchanged = fingerprintMatches(copyBefore, copyAfter);
    const skillUnchanged = run.armId !== 'skill' || skillAfter.sha256 === skillMaterialization.copiedManifest.sha256;
    const skillSourceUnchanged = !skillPackRoot ? true : Boolean(skillSourceBefore && skillSourceAfter && skillSourceBefore.sha256 === skillSourceAfter.sha256);
    const runtimeConfigUnchanged = runtimeConfigAfter === runtimeConfig.sha256;
    cleanup = cleanupRegisteredDirectory(runRoot);
    const postflight = {
      ok: mutation.ok && copyUnchanged && skillUnchanged && skillSourceUnchanged && runtimeConfigUnchanged && cleanup.completed === true,
      corpusUnchanged: mutation.ok,
      copyUnchanged,
      skillUnchanged,
      skillSourceUnchanged,
      runtimeConfigUnchanged,
      cleanupCompleted: cleanup.completed === true,
      originalBefore,
      originalAfter,
      copyBefore,
      copyAfter,
      skillHash: run.armId === 'skill' ? skillMaterialization.copiedHash : null,
      skillSourceBefore,
      skillSourceAfter,
      runtimeConfigHash: runtimeConfig.sha256,
      diagnostics: [
        ...mutation.diagnostics,
        copyUnchanged ? null : 'copied target changed during run',
        skillUnchanged ? null : 'copied Skill changed during run',
        skillSourceUnchanged ? null : 'original Skill source changed during run',
        runtimeConfigUnchanged ? null : 'runtime config changed during run',
        cleanup.completed ? null : 'registered isolation cleanup failed',
      ].filter(Boolean),
    };
    const relevantModelCommandEvidence = buildRelevantModelCommandEvidence({ openCodeResult, directArgvArrays: snapshot.directArgvArrays });
    openCodeResult.relevantModelCommandEvidence = relevantModelCommandEvidence;
    const scorecard = createScorecard({ run, pair, finalText, openCodeResult, oracleResults: oracleExecutions, postflight, cleanup });
    const scoreValidation = validateBenchmarkRunScorecard({ manifestStatus: manifest.status, scorecard });
    const artifacts = [];
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'run-input.json', {
      schema: 'phase2-real-project-benchmark-run-input-v1',
      armId: run.armId,
      pairId: pair.pairId,
      snapshotId: snapshot.snapshotId,
      runId: run.runId,
      model: manifest.runConfig.model,
      agent: manifest.runConfig.agent,
      timeoutMs: manifest.runConfig.timeoutMs,
      primary: true,
      attempt: 1,
      maxAttempts: 1,
      retryPolicy: 'none',
      request: promptBundle.request,
      prompt: promptMetadata(promptBundle.prompt),
      skillLoaded: promptBundle.skillLoaded,
      targetRootReference: `host-temp://${path.basename(targetRoot)}`,
    }));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'prompt-metadata.json', { ...promptMetadata(promptBundle.prompt), requestSha256: sha256Text(promptBundle.request), skillLoaded: promptBundle.skillLoaded }));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'terminal.json', redactJsonValue(terminal, redactionEnv)));
    artifacts.push(writeBufferArtifact(externalArtifactRoot, 'raw-stdout.jsonl', redactedBuffer(rawStdout, redactionEnv)));
    artifacts.push(writeTextArtifact(externalArtifactRoot, 'stderr.txt', redactSensitiveText(openCodeResult.stderr || '', redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'events.json', redactJsonValue(events, redactionEnv)));
    artifacts.push(writeTextArtifact(externalArtifactRoot, 'final-message.md', redactSensitiveText(finalMessage, redactionEnv)));
    artifacts.push(writeTextArtifact(externalArtifactRoot, 'final-report.md', redactSensitiveText(finalText, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'command-evidence.json', redactJsonValue(commandMetadata, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'model-command-evidence.json', redactJsonValue(openCodeResult.modelCommandEvidence || { ok: false, issues: ['model command evidence unavailable'] }, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'relevant-model-command-evidence.json', redactJsonValue(relevantModelCommandEvidence, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'model-command-events.json', redactJsonValue(openCodeResult.modelCommandEvents || [], redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'agent-topology.json', redactJsonValue(openCodeResult.agentTopology || { ok: false, issues: ['agent topology unavailable'] }, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'parent-boundary-evidence.json', redactJsonValue(openCodeResult.parentBoundaryEvidence || { ok: false, issues: ['parent boundary unavailable'] }, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'child-report-relay-evidence.json', redactJsonValue(openCodeResult.childReportRelayEvidence || { ok: false, issues: ['child relay unavailable'] }, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'report-authority-evidence.json', redactJsonValue(openCodeResult.reportAuthorityEvidence || { ok: false, issues: ['report authority unavailable'] }, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'oracle.json', { assessorOnly: true, checkedAfterModel: true, expectedVerdict: snapshot.expectedVerdict, executions: redactJsonValue(oracleExecutions, redactionEnv) }));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'postflight.json', redactJsonValue(postflight, redactionEnv)));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'scorecard.json', scorecard));
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'cleanup.json', cleanup));
    const manifestArtifact = {
      schema: 'phase2-real-project-benchmark-run-artifacts-v1',
      runId: run.runId,
      armId: run.armId,
      pairId: pair.pairId,
      snapshotId: snapshot.snapshotId,
      artifacts,
      scoreValidation,
      cleanup,
    };
    artifacts.push(writeJsonArtifact(externalArtifactRoot, 'manifest.json', manifestArtifact));
    const modelVerdict = openCodeResult.status === 'COMPLETED' ? extractQaVerdict(finalText) || 'BLOCKED' : 'BLOCKED';
    const oracleVerdict = oracleExecutions.find((entry) => entry.actualVerdict !== 'PASS')?.actualVerdict || 'PASS';
    return { ...run, artifactRoot: externalArtifactRoot, retryCount: 0, openCodeStatus: openCodeResult.status, modelVerdict, oracleVerdict, oracle: oracleExecutions, postflight, scorecard, scoreValidation, artifacts, cleanup };
  } catch (error) {
    if (!cleanup.attempted && runRoot) cleanup = cleanupRegisteredDirectory(runRoot);
    else if (!runRoot) cleanup = { attempted: true, completed: true, rootRemoved: true, rootUnavailable: true };
    const failure = {
      schema: 'phase2-real-project-benchmark-run-failure-v1',
      armId: run.armId,
      pairId: run.pairId,
      snapshotId: run.snapshotId,
      runId: run.runId,
      attempt: 1,
      maxAttempts: 1,
      retryPolicy: 'none',
      error: { name: error?.name || 'Error', message: error?.message || String(error) },
      cleanup,
    };
    try {
      writeJsonArtifact(externalArtifactRoot, 'failure.json', redactJsonValue(failure, redactionEnv));
      writeJsonArtifact(externalArtifactRoot, 'cleanup.json', cleanup);
    } catch (artifactError) {
      error.message = `${error.message}; additionally failed to write failure artifacts: ${artifactError.message}`;
    }
    throw error;
  }
}

export async function runRealProjectBenchmark({ manifest, corpusRoot, artifactRoot, skillPackRoot, comparisonThreshold, providerConfigPath = null, openCodeRunner = defaultOpenCodeRunner, directSpawn = spawnSync, pairFilter = null, snapshotFilter = null } = {}) {
  if (!Number.isInteger(comparisonThreshold) || comparisonThreshold < 0) throw new Error('comparisonThreshold must be a non-negative integer');
  const selectedProviderConfigPath = providerConfigPath ? validateProviderConfigPath(providerConfigPath) : null;
  const validation = validateBenchmarkManifest(manifest);
  if (!validation.ok) throw new Error(`invalid benchmark manifest: ${validation.diagnostics.join('; ')}`);
  const externalRoot = resolveExternalArtifactRoot({ corpusRoot, artifactRoot }).absolutePath;
  assertEmptyCycleArtifactRoot(externalRoot);
  const plan = createBenchmarkRunPlan({ manifest, corpusRoot, artifactRoot: externalRoot, pairFilter, snapshotFilter });
  const runs = [];
  for (const run of plan.runs) {
    const pair = manifest.pairs.find((candidate) => candidate.pairId === run.pairId);
    const snapshot = [pair.preSnapshot, pair.postSnapshot].find((candidate) => candidate.snapshotId === run.snapshotId);
    runs.push(await executeBenchmarkRun({ manifest, pair, snapshot, run, corpusRoot, artifactRoot: externalRoot, skillPackRoot, providerConfigPath: selectedProviderConfigPath, openCodeRunner, directSpawn }));
  }
  const comparisons = [];
  for (const pair of manifest.pairs) {
    for (const snapshot of [pair.preSnapshot, pair.postSnapshot]) {
      const baseline = runs.find((run) => run.pairId === pair.pairId && run.snapshotId === snapshot.snapshotId && run.armId === 'baseline')?.scorecard;
      const skill = runs.find((run) => run.pairId === pair.pairId && run.snapshotId === snapshot.snapshotId && run.armId === 'skill')?.scorecard;
      if (!baseline || !skill) continue;
      const comparison = compareArmScorecards({ baseline, skill, threshold: comparisonThreshold });
      const validated = { pairId: pair.pairId, snapshotId: snapshot.snapshotId, ...validateBenchmarkComparison({ manifestStatus: manifest.status, comparison }) };
      comparisons.push(validated);
      writeJsonArtifact(externalRoot, path.join(pair.pairId, snapshot.snapshotId, 'comparison.json'), validated);
      writeTextArtifact(externalRoot, path.join(pair.pairId, snapshot.snapshotId, 'comparison.md'), `# Snapshot Comparison\n\nPair: ${pair.pairId}\nSnapshot: ${snapshot.snapshotId}\nConclusion: ${comparison.conclusion}\nApproved effectiveness claim: false\n`);
    }
  }
  for (const pair of manifest.pairs) {
    const pairComparisons = comparisons.filter((comparison) => comparison.pairId === pair.pairId);
    if (pairComparisons.length === 0) continue;
    const counts = comparisonCounts(pairComparisons);
    writeJsonArtifact(externalRoot, path.join(pair.pairId, 'comparison.json'), { pairId: pair.pairId, comparisons: pairComparisons, counts, approvedEffectivenessClaim: false });
    writeTextArtifact(externalRoot, path.join(pair.pairId, 'comparison.md'), `# Pair Comparison\n\nPair: ${pair.pairId}\nObserved counts: ${formatComparisonCounts(counts)}\nApproved effectiveness claim: false\n`);
  }
  const observedCounts = comparisonCounts(comparisons);
  const summary = buildBenchmarkSummary({ manifestStatus: manifest.status, comparison: { ok: comparisons.every((entry) => entry.ok), conclusion: 'inconclusive', observedCounts }, runCount: runs.length, scorer: 'automated-heuristic' });
  const scorecards = runs.map(({ scorecard, artifactRoot: runArtifactRoot, armId, pairId, snapshotId, runId }) => ({ armId, pairId, snapshotId, runId, artifactRoot: runArtifactRoot, scorecard }));
  writeJsonArtifact(externalRoot, 'corpus-manifest.json', { assessorOnly: true, ...deepClone(manifest) });
  writeJsonArtifact(externalRoot, 'run-order.json', { primaryOnly: true, retryPolicy: 'none', runs: runs.map((run, index) => ({ order: index + 1, armId: run.armId, pairId: run.pairId, snapshotId: run.snapshotId, runId: run.runId, attempt: 1, maxAttempts: 1, retryPolicy: 'none' })) });
  mkdirSync(path.join(externalRoot, 'scorecards'), { recursive: true });
  for (const entry of scorecards) writeJsonArtifact(externalRoot, path.join('scorecards', `${entry.pairId}.${entry.snapshotId}.${entry.armId}.json`), entry);
  writeJsonArtifact(externalRoot, 'scorecards.json', scorecards);
  writeJsonArtifact(externalRoot, 'comparisons.json', comparisons);
  writeJsonArtifact(externalRoot, 'summary.json', { runs: scorecards, comparisons, summary });
  writeTextArtifact(externalRoot, 'benchmark-summary.md', `${summary.text}\n`);
  writeTextArtifact(externalRoot, 'limitations.md', '# Limitations\n\nAutomated heuristic scoring is draft and inconclusive. Independent human review is required before any effectiveness claim.\n`oracle.json` and `corpus-manifest.json` are assessor-only artifacts written outside model input.\n');
  return { manifestStatus: manifest.status, runs, comparisons, summary, artifactRoot: externalRoot };
}

function comparisonCounts(comparisons = []) {
  const counts = { improvement: 0, no_improvement: 0, tie: 0, inconclusive: 0 };
  for (const entry of comparisons) {
    const conclusion = entry?.comparison?.conclusion || entry?.conclusion || 'inconclusive';
    if (conclusion in counts) counts[conclusion] += 1;
    else counts.inconclusive += 1;
  }
  return counts;
}

function formatComparisonCounts(counts) {
  return `${counts.improvement} improvement, ${counts.no_improvement} no_improvement, ${counts.tie} tie, ${counts.inconclusive} inconclusive`;
}

export function buildBenchmarkSummary({ manifestStatus, comparison, runCount, scorer } = {}) {
  const scoringLabel = scorer === 'automated-heuristic' ? 'automated heuristic' : String(scorer || 'unknown');
  const counts = comparison?.observedCounts || comparisonCounts([comparison].filter(Boolean));
  const text = `Real project benchmark summary: manifest is ${manifestStatus}; ${runCount} runs evaluated with ${scoringLabel} scoring; result is inconclusive. Observed counts: ${formatComparisonCounts(counts)}. Separate human review remains required before any formal effectiveness statement.`;
  return { text, approvedEffectivenessClaim: false, scoringLabel, runCount, manifestStatus, comparison, observedCounts: counts };
}

async function main() {
  const options = parseBenchmarkCliArgs();
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  const result = await runRealProjectBenchmark({
    manifest,
    corpusRoot: options.corpusRoot,
    artifactRoot: options.artifactRoot,
    skillPackRoot: path.resolve(fileURLToPath(new URL('../../qa-skill', import.meta.url))),
    comparisonThreshold: options.comparisonThreshold,
    providerConfigPath: options.providerConfigPath || null,
    pairFilter: options.pairFilter || null,
    snapshotFilter: options.snapshotFilter || null,
  });
  process.stdout.write(`${JSON.stringify({ artifactRoot: result.artifactRoot, runCount: result.runs.length, approvedEffectivenessClaim: result.summary.approvedEffectivenessClaim }, null, 2)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
