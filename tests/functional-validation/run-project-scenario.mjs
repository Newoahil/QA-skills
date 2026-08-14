#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
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

import { resolveOpenCodeInvocation } from './harness.mjs';
import { materializeModuleResult, reconcileProjectStatus, validateExactDelivery } from './project-harness.mjs';
import { buildProjectPreflight, evaluateProjectPlanGate, planKeyFlows } from './project-scenarios.mjs';

export const TREE_LIMITS = Object.freeze({ maxDepth: 20, maxFiles: 25000, maxFileBytes: 32 * 1024 * 1024, maxAggregateBytes: 512 * 1024 * 1024 });
const MAX_TIMEOUT_MS = 600000;
const knownCliOptions = Object.freeze(new Set(['scenario', 'artifact-root', 'timeout-ms', 'real-target', 'real-argv-json', 'real-artifact-root', 'real-timeout-ms']));

const statuses = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const moduleTasks = Object.freeze({ auth: 'MT-AUTH-001', billing: 'MT-BILLING-001', 'shared-lib': 'MT-SHARED-001' });
const moduleVerification = Object.freeze({ auth: 'V-AUTH-SESSION', billing: 'V-BILLING-TOTAL', 'shared-lib': 'V-SHARED-CONSISTENCY' });
const controlledCoverage = Object.freeze({
  importantModules: Object.freeze(['auth', 'billing', 'shared-lib']),
  keyFlows: Object.freeze(['KF-AUTH-BILLING-SHARED']),
  mustVerify: Object.freeze(['V-AUTH-SESSION', 'V-BILLING-TOTAL', 'V-SHARED-CONSISTENCY']),
  taskIds: moduleTasks,
  moduleEvidence: Object.freeze({
    auth: Object.freeze(['V-AUTH-SESSION']),
    billing: Object.freeze(['V-BILLING-TOTAL']),
    'shared-lib': Object.freeze(['V-SHARED-CONSISTENCY']),
  }),
  keyFlowEvidence: Object.freeze({ 'KF-AUTH-BILLING-SHARED': Object.freeze(['V-AUTH-SESSION', 'V-BILLING-TOTAL', 'V-SHARED-CONSISTENCY']) }),
});

const realCoverage = Object.freeze({
  importantModules: Object.freeze(['real-project']),
  keyFlows: Object.freeze([]),
  mustVerify: Object.freeze(['V-M7-REAL-NODE-TEST']),
  taskIds: Object.freeze({ 'real-project': 'MT-M7-REAL-001' }),
  moduleEvidence: Object.freeze({ 'real-project': Object.freeze(['V-M7-REAL-NODE-TEST']) }),
  keyFlowEvidence: Object.freeze({}),
});

export const controlledProjectScenarios = deepFreeze({
  pass: { id: 'pass', status: 'PASS', billingBug: false, omitBillingAcceptance: false, humanGate: false },
  fail: { id: 'fail', status: 'FAIL', billingBug: true, omitBillingAcceptance: false, humanGate: false },
  blocked: { id: 'blocked', status: 'BLOCKED', billingBug: false, omitBillingAcceptance: true, humanGate: false },
  human: { id: 'human', status: 'NEEDS_HUMAN_REVIEW', billingBug: false, omitBillingAcceptance: false, humanGate: true },
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function sha256Bytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function textMetadata(relativePath, text) {
  return Object.freeze({ path: relativePath, sha256: sha256Text(text), bytes: Buffer.byteLength(text, 'utf8') });
}

function fileMetadata(root, relativePath) {
  const safe = normalizeRelativePath(relativePath);
  if (!safe.ok) throw new Error(`Unsafe artifact path ${relativePath}: ${safe.reason}`);
  const absolutePath = path.join(root, safe.path);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) throw new Error(`Artifact is not a regular file: ${relativePath}`);
  const content = readFileSync(absolutePath);
  return Object.freeze({ path: safe.path, sha256: sha256Bytes(content), bytes: content.length });
}

function writeTextArtifact(root, relativePath, text) {
  const safe = normalizeRelativePath(relativePath);
  if (!safe.ok) throw new Error(`Unsafe artifact path ${relativePath}: ${safe.reason}`);
  const absolutePath = path.join(root, safe.path);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text);
  return fileMetadata(root, safe.path);
}

function writeJsonArtifact(root, relativePath, value) {
  return writeTextArtifact(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function artifactContract({ kind, metadata, status, scenarioId, runId, provenance }) {
  return Object.freeze({
    kind,
    path: metadata.path,
    sha256: metadata.sha256,
    bytes: metadata.bytes,
    status,
    scenarioId,
    runId,
    provenance,
  });
}

function runProvenance({ source, snapshotFingerprint }) {
  return Object.freeze({ schema: 'qa-skill-m7-provenance-v1', source, snapshotFingerprint });
}

function validateTimeoutMs(value, label = 'timeout-ms') {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`${label} must be a positive integer no greater than ${MAX_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function normalizeRelativePath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return Object.freeze({ ok: false, reason: 'empty path' });
  if (candidate.includes('\0')) return Object.freeze({ ok: false, reason: 'NUL byte in path' });
  const slashPath = candidate.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || /^[A-Za-z]:/.test(slashPath)) return Object.freeze({ ok: false, reason: 'absolute, UNC, or drive-qualified path' });
  const parts = slashPath.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0) return Object.freeze({ ok: false, reason: 'empty normalized path' });
  if (parts.some((part) => part === '..')) return Object.freeze({ ok: false, reason: 'traversal segment' });
  return Object.freeze({ ok: true, path: parts.join('/') });
}

function isInsidePath(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(root, candidate) {
  if (!isInsidePath(candidate, root)) throw new Error('path escaped root');
}

function createRunDirectory(artifactRoot, scenarioId) {
  const root = path.resolve(artifactRoot || path.join(process.cwd(), 'test-results', 'functional-validation', 'project-integration'));
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, `${scenarioId}-${new Date().toISOString().replace(/[:.]/g, '-')}-`));
}

function writeProjectFile(root, relativePath, text) {
  const safe = normalizeRelativePath(relativePath);
  if (!safe.ok) throw new Error(`Unsafe project path ${relativePath}: ${safe.reason}`);
  const absolutePath = path.join(root, safe.path);
  assertInside(root, absolutePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text);
}

function createControlledProject(scenario) {
  const root = mkdtempSync(path.join(tmpdir(), `qa-skill-m7-${scenario.id}-target-`));
  writeProjectFile(root, 'package.json', '{"type":"module"}\n');
  writeProjectFile(root, 'acceptance/auth-session.md', '# AC-AUTH-SESSION\nAuthenticated sessions keep identity.\n');
  writeProjectFile(root, 'acceptance/shared-consistency.md', '# AC-SHARED-CONSISTENCY\nMoney formatting and session tokens are consistent.\n');
  if (!scenario.omitBillingAcceptance) writeProjectFile(root, 'acceptance/billing-total.md', '# AC-BILLING-TOTAL\nCheckout totals include all cents exactly.\n');
  writeProjectFile(root, 'src/shared/session-token.mjs', "export function issueSession(userId) { return { userId, token: `session:${userId}` }; }\n");
  writeProjectFile(root, 'src/shared/money.mjs', "export function formatCents(cents) { return `$${(cents / 100).toFixed(2)}`; }\nexport function sumCents(items) { return items.reduce((total, item) => total + item.cents, 0); }\n");
  writeProjectFile(root, 'src/auth/login.mjs', "import { issueSession } from '../shared/session-token.mjs';\nexport function login(userId) { if (!userId) throw new Error('userId required'); return issueSession(userId); }\n");
  const checkout = scenario.billingBug
    ? "import { sumCents, formatCents } from '../shared/money.mjs';\nexport function checkout(session, items) { return { userId: session.userId, totalCents: sumCents(items) - 100, displayTotal: formatCents(sumCents(items) - 100) }; }\n"
    : "import { sumCents, formatCents } from '../shared/money.mjs';\nexport function checkout(session, items) { return { userId: session.userId, totalCents: sumCents(items), displayTotal: formatCents(sumCents(items)) }; }\n";
  writeProjectFile(root, 'src/billing/checkout.mjs', checkout);
  writeProjectFile(root, 'tests/auth-login.test.mjs', "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { login } from '../src/auth/login.mjs';\ntest('auth login issues session', () => { assert.equal(login('user-1').token, 'session:user-1'); });\n");
  writeProjectFile(root, 'tests/shared-money.test.mjs', "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { formatCents, sumCents } from '../src/shared/money.mjs';\ntest('shared money helpers are consistent', () => { assert.equal(sumCents([{ cents: 899 }, { cents: 400 }]), 1299); assert.equal(formatCents(1299), '$12.99'); });\n");
  writeProjectFile(root, 'tests/billing-checkout.test.mjs', "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { login } from '../src/auth/login.mjs';\nimport { checkout } from '../src/billing/checkout.mjs';\ntest('auth to checkout flow preserves user and billing total', () => { const receipt = checkout(login('user-1'), [{ cents: 899 }, { cents: 400 }]); assert.equal(receipt.userId, 'user-1'); assert.equal(receipt.totalCents, 1299); assert.equal(receipt.displayTotal, '$12.99'); });\n");
  return root;
}

export function fingerprintProjectTree(root, limits = TREE_LIMITS) {
  const targetRoot = path.resolve(root);
  const canonicalRoot = realpathSync(targetRoot);
  const entries = [];
  let aggregateBytes = 0;
  function walk(directory, depth) {
    if (depth > limits.maxDepth) throw new Error(`tree depth limit exceeded at ${path.relative(targetRoot, directory)}`);
    const names = readdirSync(directory).sort();
    for (const name of names) {
      if (name === '.git' || name === 'test-results') continue;
      const absolutePath = path.join(directory, name);
      const stat = lstatSync(absolutePath);
      const relativePath = path.relative(targetRoot, absolutePath).replace(/\\/g, '/');
      if (stat.isSymbolicLink()) throw new Error(`unsafe link entry in project tree: ${relativePath}`);
      if (stat.isFIFO?.() || stat.isSocket?.() || stat.isBlockDevice?.() || stat.isCharacterDevice?.()) throw new Error(`unsafe special entry in project tree: ${relativePath}`);
      if (stat.isDirectory()) {
        walk(absolutePath, depth + 1);
      } else if (stat.isFile()) {
        if (entries.length >= limits.maxFiles) throw new Error('tree file count limit exceeded');
        if (stat.size > limits.maxFileBytes) throw new Error(`file size limit exceeded: ${relativePath}`);
        aggregateBytes += stat.size;
        if (aggregateBytes > limits.maxAggregateBytes) throw new Error('tree aggregate byte limit exceeded');
        const canonicalFile = realpathSync(absolutePath);
        if (!isInsidePath(canonicalFile, canonicalRoot)) throw new Error(`realpath escape in project tree: ${relativePath}`);
        entries.push(Object.freeze({ path: relativePath, sha256: sha256Bytes(readFileSync(absolutePath)), bytes: stat.size }));
      } else {
        throw new Error(`unsupported project tree entry: ${relativePath}`);
      }
    }
  }
  walk(targetRoot, 0);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return deepFreeze({ rootIdentity: sha256Text(canonicalRoot), files: entries, aggregateBytes, treeSha256: sha256Text(JSON.stringify(entries)) });
}

export function copyProjectTree(sourceRoot, destinationRoot, limits = TREE_LIMITS) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  mkdirSync(destination, { recursive: true });
  const fingerprint = fingerprintProjectTree(source, limits);
  for (const entry of fingerprint.files) {
    const from = path.join(source, entry.path);
    const to = path.join(destination, entry.path);
    assertInside(source, from);
    assertInside(destination, to);
    const sourceStat = lstatSync(from);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`copy source is not a regular file: ${entry.path}`);
    const sourceBytes = readFileSync(from);
    if (sha256Bytes(sourceBytes) !== entry.sha256 || sourceBytes.length !== entry.bytes) throw new Error(`copy source changed during fingerprint: ${entry.path}`);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    const copied = fileMetadata(destination, entry.path);
    if (copied.sha256 !== entry.sha256 || copied.bytes !== entry.bytes) throw new Error(`copy mismatch: ${entry.path}`);
  }
  return fingerprint;
}

export function classifyExecutionStatus(execution = {}) {
  if (execution.exitStatus === 0) return 'PASS';
  if (Number.isInteger(execution.exitStatus) && execution.exitStatus !== 0) return 'FAIL';
  if (execution.exitStatus === 'SPAWN_ERROR' || execution.exitStatus === 'TIMED_OUT') return 'BLOCKED';
  return 'BLOCKED';
}

function executionOutputMetadata(execution) {
  const stdout = execution.stdout || '';
  const stderr = execution.stderr || '';
  return Object.freeze({
    stdoutSha256: sha256Text(stdout),
    stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
    stderrSha256: sha256Text(stderr),
    stderrBytes: Buffer.byteLength(stderr, 'utf8'),
  });
}

function boundedOutput(buffer) {
  return buffer.length > 4000 ? `${buffer.slice(-4000)}\n[truncated]` : buffer;
}

export function runBoundedNodeProcess({ cwd, argv, timeoutMs, env = createIsolatedChildEnv({ workspaceRoot: cwd, baseEnv: process.env }) }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, argv, { cwd, shell: false, windowsHide: true, env, detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const termination = { requested: false, strategy: process.platform === 'win32' ? 'taskkill-tree' : 'process-group-signals', gracefulAttempted: false, forcedAttempted: false, errors: [], status: 'not-requested' };
    let fallbackTimer = null;
    let forceTimer = null;
    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(fallbackTimer);
      if (termination.requested) {
        child.unref?.();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
      child.off?.('close', onChildClose);
      const terminationEvidence = Object.freeze({ ...termination, errors: Object.freeze([...termination.errors]) });
      resolve(Object.freeze({ ...result, termination: terminationEvidence }));
    }
    function terminateTree() {
      termination.requested = true;
      termination.status = 'requested';
      if (typeof child.pid !== 'number') {
        termination.errors.push('child pid unavailable');
        return;
      }
      if (process.platform === 'win32') {
        const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
        const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
        try {
          const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          termination.forcedAttempted = true;
          killer.unref?.();
          killer.on('error', (error) => {
            if (settled) return;
            termination.errors.push(`taskkill failed: ${error.message}`);
            try { child.kill(); } catch (killError) { termination.errors.push(`child.kill failed: ${killError.message}`); }
          });
          killer.on('close', (code) => {
            if (settled) return;
            termination.status = `taskkill-exit-${code}`;
            if (code !== 0) {
              termination.errors.push(`taskkill exited ${code}`);
              try { child.kill(); } catch (killError) { termination.errors.push(`child.kill failed: ${killError.message}`); }
            }
          });
        } catch (error) {
          termination.errors.push(`taskkill spawn failed: ${error.message}`);
          try { child.kill(); } catch (killError) { termination.errors.push(`child.kill failed: ${killError.message}`); }
        }
      } else {
        try {
          termination.gracefulAttempted = true;
          process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
          termination.errors.push(`SIGTERM group failed: ${error.message}`);
        }
        forceTimer = setTimeout(() => {
          try {
            termination.forcedAttempted = true;
            process.kill(-child.pid, 'SIGKILL');
            termination.status = 'sigkill-sent';
          } catch (error) {
            termination.errors.push(`SIGKILL group failed: ${error.message}`);
          }
        }, 250);
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree();
      fallbackTimer = setTimeout(() => {
        termination.status = termination.status === 'requested' ? 'fallback-resolved' : termination.status;
        child.unref?.();
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle({ argv, startedAt, endedAt: new Date().toISOString(), exitStatus: 'TIMED_OUT', timedOut, stdout, stderr });
      }, 1500);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = boundedOutput(`${stdout}${chunk.toString('utf8')}`); });
    child.stderr.on('data', (chunk) => { stderr = boundedOutput(`${stderr}${chunk.toString('utf8')}`); });
    function onChildError(error) {
      settle({ argv, startedAt, endedAt: new Date().toISOString(), exitStatus: 'SPAWN_ERROR', timedOut, stdout, stderr, error: error.message });
    }
    function onChildClose(code, signal) {
      settle({ argv, startedAt, endedAt: new Date().toISOString(), exitStatus: timedOut ? 'TIMED_OUT' : code, signal, timedOut, stdout, stderr });
    }
    child.on('error', onChildError);
    child.on('close', onChildClose);
  });
}

function runNodeTest(options) {
  return runBoundedNodeProcess(options);
}

const allowedEnvNames = Object.freeze(new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI']));
const remappedEnvNames = Object.freeze(['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'TEMP', 'TMP', 'TMPDIR']);
const secretEnvPattern = /(?:secret|token|password|passwd|credential|auth|api[_-]?key|provider|opencode|openai|anthropic|gemini|azure|aws|gcp)/i;

export function createIsolatedChildEnv({ workspaceRoot, baseEnv = process.env } = {}) {
  const root = path.resolve(workspaceRoot || process.cwd());
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (secretEnvPattern.test(key)) continue;
    if (allowedEnvNames.has(key) && typeof value === 'string') env[key] = value;
  }
  const envRoot = path.join(root, '.qa-skill-m7-env');
  const homeRoot = path.join(envRoot, 'home');
  const tempRoot = path.join(envRoot, 'tmp');
  const cacheRoot = path.join(envRoot, 'cache');
  const configRoot = path.join(envRoot, 'config');
  const dataRoot = path.join(envRoot, 'data');
  for (const directory of [homeRoot, tempRoot, cacheRoot, configRoot, dataRoot]) mkdirSync(directory, { recursive: true });
  env.HOME = homeRoot;
  env.USERPROFILE = homeRoot;
  env.LOCALAPPDATA = dataRoot;
  env.APPDATA = configRoot;
  env.XDG_CACHE_HOME = cacheRoot;
  env.XDG_CONFIG_HOME = configRoot;
  env.XDG_DATA_HOME = dataRoot;
  env.TEMP = tempRoot;
  env.TMP = tempRoot;
  env.TMPDIR = tempRoot;
  env.NODE_OPTIONS = '';
  delete env.NODE_TEST_CONTEXT;
  const opencodeBin = resolveValidatedOpenCodeBin(baseEnv);
  if (opencodeBin) env.QA_SKILL_OPENCODE_BIN = opencodeBin;
  return Object.freeze(env);
}

function resolveValidatedOpenCodeBin(baseEnv = process.env) {
  for (const candidate of candidateOpenCodeBins(baseEnv)) {
    const resolved = resolveOpenCodeInvocation({ commandPath: candidate });
    if (resolved.shellSafe === true) return resolved.command;
  }
  return null;
}

function candidateOpenCodeBins(baseEnv = process.env) {
  const candidates = [];
  if (typeof baseEnv.QA_SKILL_OPENCODE_BIN === 'string' && baseEnv.QA_SKILL_OPENCODE_BIN.length > 0) candidates.push(baseEnv.QA_SKILL_OPENCODE_BIN);
  for (const entry of String(baseEnv.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(entry, process.platform === 'win32' ? 'opencode.exe' : 'opencode'));
  if (process.platform === 'win32' && typeof baseEnv.APPDATA === 'string' && baseEnv.APPDATA.length > 0) {
    const arch = process.arch === 'x64' ? 'x64' : process.arch;
    const packageRoot = path.join(baseEnv.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'node_modules');
    candidates.push(path.join(packageRoot, `opencode-windows-${arch}`, 'bin', 'opencode.exe'));
    candidates.push(path.join(packageRoot, `opencode-windows-${arch}-baseline`, 'bin', 'opencode.exe'));
  }
  return candidates;
}

function moduleFromExecution({ moduleId, commandArgv, execution, snapshotFingerprint, isolationWorkspaceReference, artifact, scenario, runId, provenance }) {
  const verificationId = moduleVerification[moduleId];
  const status = classifyExecutionStatus(execution);
  const failed = status === 'FAIL';
  const blocked = status === 'BLOCKED';
  const observation = failed
    ? `Node test failed for ${moduleId}: ${execution.stderr || execution.stdout}`
    : blocked
      ? `Node test could not complete for ${moduleId}: ${execution.error || execution.exitStatus || 'missing exit code'}`
    : `Node test passed for ${moduleId} with executable evidence`;
  const finding = failed ? Object.freeze({ id: 'F-M7-BILLING-TOTAL', status: 'FAIL', type: 'product', verificationId, evidence: 'billing assert.equal failure', scenarioId: scenario.id, runId, provenance }) : null;
  const blocker = blocked ? Object.freeze({ id: `B-M7-${moduleId.toUpperCase()}-EXECUTION`, status: 'BLOCKED', type: 'infrastructure', verificationId, evidence: String(execution.exitStatus || 'missing exit code'), scenarioId: scenario.id, runId, provenance }) : null;
  return Object.freeze({ ...materializeModuleResult({
    moduleId,
    resultId: `MR-M7-${moduleId.toUpperCase()}`,
    taskId: moduleTasks[moduleId],
    status,
    snapshotFingerprint,
    isolationWorkspaceReference,
    verificationIds: Object.freeze([verificationId]),
    evidence: Object.freeze([Object.freeze({
      evidenceId: `E-M7-${moduleId.toUpperCase()}`,
      scenarioId: scenario.id,
      runId,
      provenance,
      moduleId,
      taskId: moduleTasks[moduleId],
      verificationId,
      actualCommandOrTool: [process.execPath, ...commandArgv].join(' '),
      argv: Object.freeze([...commandArgv]),
      observation,
      exitStatus: execution.exitStatus,
      status,
      artifact,
      ...executionOutputMetadata(execution),
      timestamp: execution.endedAt,
      snapshotFingerprint,
      isolationWorkspaceReference,
    })]),
    findings: Object.freeze([finding, blocker].filter(Boolean)),
    humanGates: Object.freeze([]),
    artifact,
  }), scenarioId: scenario.id, runId, provenance });
}

function blockedBillingModule({ snapshotFingerprint, isolationWorkspaceReference, artifact, scenarioId, runId, runDirectory, provenance }) {
  const rerunCommand = `node tests/functional-validation/run-project-scenario.mjs --scenario ${scenarioId} --artifact-root ${path.dirname(runDirectory)}`;
  const finding = Object.freeze({
    id: 'B-M7-BILLING-ACCEPTANCE',
    status: 'BLOCKED',
    type: 'infrastructure',
    verificationId: 'V-BILLING-TOTAL',
    missingPrerequisite: 'acceptance/billing-total.md#AC-BILLING-TOTAL',
    rerunCommand,
    scenarioId,
    runId,
    provenance,
  });
  return Object.freeze({ ...materializeModuleResult({
    moduleId: 'billing',
    resultId: 'MR-M7-BILLING',
    taskId: moduleTasks.billing,
    status: 'BLOCKED',
    snapshotFingerprint,
    isolationWorkspaceReference,
    verificationIds: Object.freeze(['V-BILLING-TOTAL']),
    evidence: Object.freeze([Object.freeze({
      evidenceId: 'E-M7-BILLING-BLOCKED',
      scenarioId,
      runId,
      provenance,
      moduleId: 'billing',
      taskId: moduleTasks.billing,
      verificationId: 'V-BILLING-TOTAL',
      actualCommandOrTool: 'NOT_RUN missing acceptance/billing-total.md#AC-BILLING-TOTAL',
      observation: 'Objective prerequisite acceptance/billing-total.md#AC-BILLING-TOTAL is missing; billing verifier was not spawned.',
      exitStatus: 'NOT_RUN',
      status: 'BLOCKED',
      artifact,
      timestamp: new Date().toISOString(),
      snapshotFingerprint,
      isolationWorkspaceReference,
    })]),
    findings: Object.freeze([finding]),
    humanGates: Object.freeze([]),
    artifact,
  }), scenarioId, runId, provenance });
}

function addHumanGate(moduleResults, scenario) {
  if (!scenario.humanGate) return moduleResults;
  return moduleResults.map((result) => (result.moduleId === 'shared-lib'
    ? materializeModuleResult({
      ...result,
      status: 'NEEDS_HUMAN_REVIEW',
      humanGates: Object.freeze([Object.freeze({
        id: 'H-M7-BUSINESS-SAFETY-DECISION',
        critical: true,
        question: 'Does the business/safety owner approve releasing the authenticated checkout behavior after objective evidence passed?',
      })]),
    })
    : result));
}

function reportMarkdown({ scenarioId, runId, status, reconciled, moduleResults, targetIntegrity, cleanup, requiredCoverage }) {
  const lines = [
    '# Project QA Report',
    '',
    `Scenario: ${scenarioId}`,
    `Run ID: ${runId}`,
    `Overall Status: ${status}`,
    'Authority Status: PENDING_DISK_RE_READ',
    '',
    '## Coverage',
    `- Important modules: ${requiredCoverage.importantModules.join(', ') || 'None'}`,
    `- Key flows: ${requiredCoverage.keyFlows.join(', ') || 'None'}`,
    `- Evidence: ${requiredCoverage.mustVerify.join(', ') || 'None'}`,
    '',
    '## Modules',
  ];
  for (const result of moduleResults) lines.push(`- ${result.moduleId}: ${result.status} (${result.verificationIds.join(', ')})`);
  lines.push('', '## Findings');
  if (reconciled.findings.length === 0) lines.push('- None');
  for (const finding of reconciled.findings) {
    lines.push(`- ${finding.id}: ${finding.status} ${finding.type}`);
    if (finding.missingPrerequisite) lines.push(`  Missing prerequisite: ${finding.missingPrerequisite}`);
    if (finding.rerunCommand) lines.push(`  Rerun command: ${finding.rerunCommand}`);
  }
  lines.push('', '## Human Gates');
  if (reconciled.humanGates.length === 0) lines.push('- None');
  for (const gate of reconciled.humanGates) lines.push(`- ${gate.id}: ${gate.question}`);
  lines.push('', '## Integrity');
  lines.push(`- Target integrity: ${targetIntegrity.ok ? 'ok' : 'failed'}`);
  for (const diagnostic of targetIntegrity.diagnostics || []) lines.push(`  - ${diagnostic}`);
  lines.push(`- Cleanup: attempted=${cleanup.attempted === true}, completed=${cleanup.completed === true}`);
  return `${lines.join('\n')}\n`;
}

function jsonSafeCoverage(requiredCoverage) {
  return deepFreeze(JSON.parse(JSON.stringify(requiredCoverage)));
}

function deriveCoveredImportantModules(moduleResults, requiredCoverage) {
  const byModule = new Map(moduleResults.map((result) => [result.moduleId, result]));
  return Object.freeze(requiredCoverage.importantModules.filter((moduleId) => {
    const result = byModule.get(moduleId);
    return result && result.status !== 'BLOCKED' && (result.evidence || []).some((entry) => entry.status === 'PASS' || entry.status === 'FAIL');
  }));
}

function deriveCoveredKeyFlows(moduleResults, requiredCoverage, coverageComplete) {
  if (!coverageComplete) return Object.freeze([]);
  const evidenceIds = new Set(moduleResults.flatMap((result) => (result.evidence || []).map((entry) => entry.verificationId)));
  return Object.freeze(requiredCoverage.keyFlows.filter((flowId) => (requiredCoverage.keyFlowEvidence[flowId] || []).every((verificationId) => evidenceIds.has(verificationId))));
}

async function finalizeRun({ runDirectory, scenarioId, runId, targetIntegrity, cleanup, moduleResults, executionEvidence, requiredCoverage, snapshotFingerprint, provenance }) {
  const statusBeforeAuthority = reconcileProjectStatus({
    moduleResults,
    requiredCoverage,
    currentSnapshotFingerprint: snapshotFingerprint,
    authorityIntegrity: Object.freeze({ ok: true, diagnostics: Object.freeze([]) }),
    targetIntegrity,
  }).overallStatus;
  const executionMetaRaw = writeJsonArtifact(runDirectory, 'execution-evidence.json', executionEvidence);
  const executionMeta = artifactContract({ kind: 'execution-evidence', metadata: executionMetaRaw, status: statusBeforeAuthority, scenarioId, runId, provenance });
  const moduleResultsWithArtifacts = moduleResults.map((result) => materializeModuleResult({
    ...result,
    artifact: executionMeta,
    evidence: Object.freeze(result.evidence.map((entry) => Object.freeze({ ...entry, artifact: executionMeta }))),
  })).map((result) => Object.freeze({ ...result, scenarioId, runId, provenance }));
  const targetMetaRaw = writeJsonArtifact(runDirectory, 'target-integrity.json', targetIntegrity);
  const cleanupMetaRaw = writeJsonArtifact(runDirectory, 'cleanup.json', cleanup);
  const moduleMetaRaw = writeJsonArtifact(runDirectory, 'module-results.json', moduleResultsWithArtifacts);
  const targetMeta = artifactContract({ kind: 'target-integrity', metadata: targetMetaRaw, status: statusBeforeAuthority, scenarioId, runId, provenance });
  const cleanupMeta = artifactContract({ kind: 'cleanup', metadata: cleanupMetaRaw, status: statusBeforeAuthority, scenarioId, runId, provenance });
  const moduleMeta = artifactContract({ kind: 'module-results', metadata: moduleMetaRaw, status: statusBeforeAuthority, scenarioId, runId, provenance });
  const reconciled = reconcileProjectStatus({
    moduleResults: moduleResultsWithArtifacts,
    requiredCoverage,
    currentSnapshotFingerprint: snapshotFingerprint,
    authorityIntegrity: Object.freeze({ ok: true, diagnostics: Object.freeze([]) }),
    targetIntegrity,
  });
  const status = reconciled.overallStatus;
  const report = reportMarkdown({ scenarioId, runId, status, reconciled, moduleResults: moduleResultsWithArtifacts, targetIntegrity, cleanup, requiredCoverage });
  const reportMetaRaw = writeTextArtifact(runDirectory, 'project-qa-report.md', report);
  const deliveryMetaRaw = writeTextArtifact(runDirectory, 'delivered-payload.md', report);
  const reportMeta = artifactContract({ kind: 'project-report', metadata: reportMetaRaw, status, scenarioId, runId, provenance });
  const deliveryMeta = artifactContract({ kind: 'delivered-payload', metadata: deliveryMetaRaw, status, scenarioId, runId, provenance });
  const manifest = {
    schema: 'qa-skill-m7-project-run-manifest-v1',
    scenarioId,
    runId,
    status,
    provenance,
    createdAt: new Date().toISOString(),
    reportSha256: reportMeta.sha256,
    reportBytes: reportMeta.bytes,
    artifacts: [reportMeta, moduleMeta, executionMeta, deliveryMeta, targetMeta, cleanupMeta],
    requiredCoverage: jsonSafeCoverage(requiredCoverage),
    snapshotFingerprint,
    treeIdentity: targetIntegrity.snapshot?.rootIdentity || targetIntegrity.copyFingerprint?.rootIdentity || targetIntegrity.originalBefore?.rootIdentity,
  };
  writeJsonArtifact(runDirectory, 'manifest.json', manifest);
  const authority = validateProjectRunAuthority(runDirectory);
  return Object.freeze({
    scenarioId,
    runId,
    status,
    runDirectory,
    moduleResults: Object.freeze(moduleResultsWithArtifacts),
    executionEvidence: Object.freeze(executionEvidence),
    reconciled,
    authority,
    coveredImportantModules: deriveCoveredImportantModules(moduleResultsWithArtifacts, requiredCoverage),
    coveredKeyFlows: deriveCoveredKeyFlows(moduleResultsWithArtifacts, requiredCoverage, reconciled.coverageComplete),
    artifacts: Object.freeze({ reportMeta, moduleMeta, executionMeta, deliveryMeta, targetMeta, cleanupMeta }),
  });
}

export async function runControlledProjectScenario({ scenarioId = 'pass', artifactRoot, timeoutMs = 30000 } = {}) {
  const scenario = controlledProjectScenarios[scenarioId];
  if (!scenario) throw new Error(`Unknown controlled scenario ${scenarioId}`);
  const runId = randomUUID();
  const runDirectory = createRunDirectory(artifactRoot, scenarioId);
  const targetRoot = createControlledProject(scenario);
  const preflight = buildProjectPreflight({ diff: null });
  const flowPlan = planKeyFlows();
  const missingGate = scenario.omitBillingAcceptance ? evaluateProjectPlanGate({ missingPrerequisites: ['acceptance/billing-total.md#AC-BILLING-TOTAL'] }) : evaluateProjectPlanGate();
  const snapshot = fingerprintProjectTree(targetRoot);
  const snapshotFingerprint = snapshot.treeSha256;
  const provenance = runProvenance({ source: 'controlled-fixture', snapshotFingerprint });
  const isolationWorkspaceReference = `host-temp://${path.basename(targetRoot)}/${snapshotFingerprint}`;
  const executionEvidence = [];
  let cleanup = { attempted: false, completed: false };
  try {
    const executionMetaStub = textMetadata('execution-evidence.json', 'pending');
    const commands = [
      ['auth', ['--test', 'tests/auth-login.test.mjs']],
      ['shared-lib', ['--test', 'tests/shared-money.test.mjs']],
    ];
    if (!scenario.omitBillingAcceptance) commands.push(['billing', ['--test', 'tests/billing-checkout.test.mjs']]);
    const moduleResults = [];
    for (const [moduleId, argv] of commands) {
      const execution = await runNodeTest({ cwd: targetRoot, argv, timeoutMs });
      const executionStatus = classifyExecutionStatus(execution);
      executionEvidence.push(Object.freeze({ scenarioId, runId, provenance, snapshotFingerprint, moduleId, verificationId: moduleVerification[moduleId], status: executionStatus, argv: Object.freeze([...argv]), ...execution, ...executionOutputMetadata(execution) }));
      moduleResults.push(moduleFromExecution({ moduleId, commandArgv: argv, execution, snapshotFingerprint, isolationWorkspaceReference, artifact: executionMetaStub, scenario, runId, provenance }));
    }
    if (scenario.omitBillingAcceptance) moduleResults.push(blockedBillingModule({ snapshotFingerprint, isolationWorkspaceReference, artifact: executionMetaStub, scenarioId, runId, runDirectory, provenance }));
    const orderedResults = ['auth', 'billing', 'shared-lib'].map((moduleId) => moduleResults.find((result) => result.moduleId === moduleId));
    const finalModuleResults = addHumanGate(orderedResults, scenario);
    cleanup = cleanupRegisteredDirectory(targetRoot);
    const targetIntegrity = buildTargetIntegrity({ ok: cleanup.completed, diagnostics: cleanup.completed ? [] : ['registered controlled fixture cleanup failed'], snapshot, preflight, flowPlan, planGate: missingGate, cleanup });
    return finalizeRun({
      runDirectory,
      scenarioId,
      runId,
      targetIntegrity,
      cleanup,
      moduleResults: finalModuleResults,
      executionEvidence,
      requiredCoverage: controlledCoverage,
      snapshotFingerprint,
      provenance,
    });
  } catch (error) {
    if (!cleanup.attempted) cleanupRegisteredDirectory(targetRoot);
    throw error;
  }
}

function buildTargetIntegrity({ ok, diagnostics = [], ...rest }) {
  return deepFreeze({ ok, diagnostics: Object.freeze(diagnostics), ...rest });
}

function cleanupRegisteredDirectory(root) {
  const attempted = true;
  try {
    rmSync(root, { recursive: true, force: true });
    return Object.freeze({ attempted, completed: !existsSync(root), rootRemoved: true });
  } catch (error) {
    return Object.freeze({ attempted, completed: false, rootRemoved: false, error: error.message });
  }
}

const forbiddenArgPattern = /[;&|<>`$]|\b(?:npm|pnpm|yarn|bun|install|update|curl|wget|http:|https:|credential|token|secret|production|prod|deploy|migration|migrate|destructive|delete|remove|release|rm|del|rmdir)\b/i;

export function validateSafeNodeTestArgv({ targetRoot, argv }) {
  const diagnostics = [];
  if (!path.isAbsolute(targetRoot || '')) diagnostics.push('real target must be an absolute path');
  let canonicalTarget = null;
  if (targetRoot && (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory())) diagnostics.push('real target must be an existing directory');
  if (targetRoot && existsSync(targetRoot)) {
    try {
      const rootStat = lstatSync(targetRoot);
      if (!rootStat.isDirectory()) diagnostics.push('real target must be a directory');
      if (rootStat.isSymbolicLink()) diagnostics.push('real target symlink or reparse point rejected');
      canonicalTarget = realpathSync(targetRoot);
    } catch (error) {
      diagnostics.push(`real target canonicalization failed: ${error.message}`);
    }
  }
  if (!Array.isArray(argv)) diagnostics.push('argv must be a JSON array');
  if (!Array.isArray(argv)) return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
  if (argv[0] !== '--test') diagnostics.push('argv must start with --test');
  if (argv.length < 2) diagnostics.push('argv must include at least one target-relative test file');
  for (const token of argv) {
    if (typeof token !== 'string' || token.length === 0) diagnostics.push('argv entries must be non-empty strings');
    else if (token.includes('\0')) diagnostics.push('argv contains NUL byte');
    else if (forbiddenArgPattern.test(token)) diagnostics.push(`argv token rejected by safety policy: ${token.replace(/[A-Za-z0-9._/-]*secret[A-Za-z0-9._/-]*/ig, 'REDACTED')}`);
  }
  for (const token of argv.slice(1)) {
    if (token.startsWith('--')) diagnostics.push(`unknown flag rejected: ${token}`);
    const safe = normalizeRelativePath(token);
    if (!safe.ok) {
      diagnostics.push(`unsafe test path ${token}: ${safe.reason}`);
      continue;
    }
    if (safe.path.split('/').some((part) => part === '.git' || part === 'test-results')) diagnostics.push(`test path uses excluded directory: ${safe.path}`);
    if (!safe.path.endsWith('.test.mjs')) diagnostics.push(`test path must end with .test.mjs: ${safe.path}`);
    if (path.basename(safe.path) === 'project-integration.test.mjs') diagnostics.push('project-integration.test.mjs recursion rejected');
    if (targetRoot && existsSync(targetRoot)) {
      const absolute = path.join(targetRoot, safe.path);
      if (!isInsidePath(absolute, targetRoot)) diagnostics.push(`test path escapes target: ${safe.path}`);
      else if (!existsSync(absolute)) diagnostics.push(`test path does not exist: ${safe.path}`);
      else {
        const componentCheck = validatePathComponents({ targetRoot, relativePath: safe.path, canonicalTarget });
        diagnostics.push(...componentCheck.diagnostics);
        const stat = lstatSync(absolute);
        if (!stat.isFile()) diagnostics.push(`test path is not a regular file: ${safe.path}`);
        if (stat.isSymbolicLink()) diagnostics.push(`test path is a symlink: ${safe.path}`);
      }
    }
  }
  return Object.freeze({ ok: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

function validatePathComponents({ targetRoot, relativePath, canonicalTarget }) {
  const diagnostics = [];
  const parts = relativePath.split('/');
  let current = path.resolve(targetRoot);
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) diagnostics.push(`path component is a symlink or junction: ${part}`);
    } catch (error) {
      diagnostics.push(`path component inaccessible: ${part}: ${error.message}`);
      break;
    }
  }
  if (canonicalTarget) {
    try {
      const canonicalFinal = realpathSync(path.join(targetRoot, relativePath));
      if (!isInsidePath(canonicalFinal, canonicalTarget)) diagnostics.push(`test path canonical realpath escapes target: ${relativePath}`);
    } catch (error) {
      diagnostics.push(`test path realpath unavailable: ${relativePath}: ${error.message}`);
    }
  }
  return Object.freeze({ ok: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

export async function runRealProjectScenario({ targetRoot, argv, artifactRoot, timeoutMs = 60000 } = {}) {
  if (process.env.QA_SKILL_REAL_PROJECT_RUNS !== '1') throw new Error('QA_SKILL_REAL_PROJECT_RUNS=1 is required for real project execution');
  validateTimeoutMs(timeoutMs, 'real-timeout-ms');
  const validation = validateSafeNodeTestArgv({ targetRoot, argv });
  if (!validation.ok) throw new Error(`Unsafe real project argv: ${validation.diagnostics.join('; ')}`);
  const canonicalTarget = realpathSync(targetRoot);
  const resolvedArtifactRoot = path.resolve(artifactRoot || path.join(process.cwd(), 'test-results', 'functional-validation', 'project-integration-real'));
  mkdirSync(resolvedArtifactRoot, { recursive: true });
  const canonicalArtifactRoot = realpathSync(resolvedArtifactRoot);
  if (isInsidePath(canonicalArtifactRoot, canonicalTarget)) throw new Error('real project artifact root must be outside the original target');
  const scenarioId = 'real';
  const runId = randomUUID();
  const runDirectory = createRunDirectory(resolvedArtifactRoot, scenarioId);
  const originalBefore = fingerprintProjectTree(targetRoot);
  const isolationRoot = mkdtempSync(path.join(tmpdir(), 'qa-skill-m7-real-isolation-'));
  let cleanup = { attempted: false, completed: false };
  const executionEvidence = [];
  try {
    copyProjectTree(targetRoot, isolationRoot);
    const copyFingerprint = fingerprintProjectTree(isolationRoot);
    const copiedEqual = JSON.stringify(originalBefore.files) === JSON.stringify(copyFingerprint.files);
    if (!copiedEqual) throw new Error('source/copy fingerprint mismatch before execution');
    const snapshotFingerprint = copyFingerprint.treeSha256;
    const provenance = runProvenance({ source: 'real-project-isolated-copy', snapshotFingerprint });
    const execution = await runNodeTest({ cwd: isolationRoot, argv, timeoutMs });
    const status = classifyExecutionStatus(execution);
    executionEvidence.push(Object.freeze({ scenarioId, runId, provenance, snapshotFingerprint, moduleId: 'real-project', verificationId: 'V-M7-REAL-NODE-TEST', status, argv: Object.freeze([...argv]), ...execution, ...executionOutputMetadata(execution) }));
    const originalAfter = fingerprintProjectTree(targetRoot);
    cleanup = cleanupRegisteredDirectory(isolationRoot);
    const unchanged = JSON.stringify(originalBefore.files) === JSON.stringify(originalAfter.files);
    const targetIntegrity = buildTargetIntegrity({ ok: copiedEqual && unchanged && cleanup.completed, diagnostics: [
      copiedEqual ? null : 'source/copy fingerprint mismatch',
      unchanged ? null : 'original target changed during real run',
      cleanup.completed ? null : 'registered isolation cleanup failed',
    ].filter(Boolean), originalBefore, originalAfter, copyFingerprint, cleanup });
    const artifact = textMetadata('execution-evidence.json', 'pending');
    const moduleResult = Object.freeze({ ...materializeModuleResult({
      moduleId: 'real-project',
      resultId: 'MR-M7-REAL-PROJECT',
      taskId: 'MT-M7-REAL-001',
      status,
      snapshotFingerprint,
      isolationWorkspaceReference: `host-temp://${path.basename(isolationRoot)}/${snapshotFingerprint}`,
      verificationIds: Object.freeze(['V-M7-REAL-NODE-TEST']),
      evidence: Object.freeze([Object.freeze({
        evidenceId: 'E-M7-REAL-NODE-TEST',
        scenarioId,
        runId,
        provenance,
        moduleId: 'real-project',
        taskId: 'MT-M7-REAL-001',
        verificationId: 'V-M7-REAL-NODE-TEST',
        actualCommandOrTool: [process.execPath, ...argv].join(' '),
        argv: Object.freeze([...argv]),
        observation: status === 'PASS'
          ? 'Approved direct Node test argv passed in isolated copy'
          : status === 'FAIL'
            ? 'Approved direct Node test argv failed in isolated copy'
            : 'Approved direct Node test argv execution could not complete in isolated copy',
        exitStatus: execution.exitStatus,
        status,
        artifact,
        ...executionOutputMetadata(execution),
        timestamp: execution.endedAt,
        snapshotFingerprint,
        isolationWorkspaceReference: `host-temp://${path.basename(isolationRoot)}/${snapshotFingerprint}`,
      })]),
      findings: Object.freeze(status === 'FAIL' ? [Object.freeze({ id: 'F-M7-REAL-NODE-TEST', status: 'FAIL', type: 'product', verificationId: 'V-M7-REAL-NODE-TEST', scenarioId, runId, provenance })] : status === 'BLOCKED' ? [Object.freeze({ id: 'B-M7-REAL-NODE-TEST', status: 'BLOCKED', type: 'infrastructure', verificationId: 'V-M7-REAL-NODE-TEST', scenarioId, runId, provenance })] : []),
      humanGates: Object.freeze([]),
      artifact,
    }), scenarioId, runId, provenance });
    const finalized = await finalizeRun({ runDirectory, scenarioId, runId, targetIntegrity, cleanup, moduleResults: [moduleResult], executionEvidence, requiredCoverage: realCoverage, snapshotFingerprint, provenance });
    return Object.freeze({ ...finalized, isolationRoot, cleanup });
  } catch (error) {
    if (!cleanup.attempted) cleanup = cleanupRegisteredDirectory(isolationRoot);
    throw error;
  }
}

function readJsonArtifact(runDirectory, relativePath, diagnostics, domain) {
  try {
    return JSON.parse(readFileSync(path.join(runDirectory, relativePath), 'utf8'));
  } catch (error) {
    diagnostics.push(`${domain} JSON unreadable: ${error.message}`);
    return null;
  }
}

export function validateProjectRunAuthority(runDirectory) {
  const diagnostics = [];
  const root = path.resolve(runDirectory || '');
  const manifest = readJsonArtifact(root, 'manifest.json', diagnostics, 'manifest');
  const moduleResults = readJsonArtifact(root, 'module-results.json', diagnostics, 'module result');
  const executionEvidence = readJsonArtifact(root, 'execution-evidence.json', diagnostics, 'execution evidence');
  const targetIntegrity = readJsonArtifact(root, 'target-integrity.json', diagnostics, 'target integrity');
  const cleanup = readJsonArtifact(root, 'cleanup.json', diagnostics, 'cleanup');
  const preservedFindings = Object.freeze(Array.isArray(moduleResults) ? moduleResults.flatMap((result) => (Array.isArray(result?.findings) ? result.findings : [])) : []);
  const manifestDiskMetadata = existsSync(path.join(root, 'manifest.json')) && lstatSync(path.join(root, 'manifest.json')).isFile()
    ? fileMetadata(root, 'manifest.json')
    : null;
  if (!manifest) return Object.freeze({ ok: false, status: 'BLOCKED', diagnostics: Object.freeze(diagnostics), preservedFindings, manifestDiskMetadata });
  if (!statuses.includes(manifest.status)) diagnostics.push('manifest status is not canonical');
  if (!manifest.scenarioId || !manifest.runId || !manifest.provenance) diagnostics.push('manifest scenario/run/provenance missing');
  if (!manifest.snapshotFingerprint || manifest.snapshotFingerprint !== manifest.provenance?.snapshotFingerprint) diagnostics.push('manifest snapshot/provenance mismatch');
  const artifactMap = new Map();
  const manifestArtifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!Array.isArray(manifest.artifacts)) diagnostics.push('manifest artifacts must be an array');
  for (const artifact of manifestArtifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      diagnostics.push('manifest artifact entry must be an object');
      continue;
    }
    if (artifactMap.has(artifact.path)) diagnostics.push(`manifest duplicate artifact path: ${artifact.path}`);
    validateArtifactContext({ artifact, manifest, diagnostics });
    const safe = normalizeRelativePath(artifact.path);
    if (!safe.ok) {
      diagnostics.push(`manifest artifact path unsafe: ${artifact.path}`);
      continue;
    }
    const absolute = path.join(root, safe.path);
    if (!isInsidePath(absolute, root)) diagnostics.push(`manifest artifact path escapes run directory: ${artifact.path}`);
    else if (!existsSync(absolute) || !lstatSync(absolute).isFile()) diagnostics.push(`manifest artifact is not a regular file: ${artifact.path}`);
    else {
      const actual = fileMetadata(root, safe.path);
      if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) diagnostics.push(`${domainForPath(safe.path)} artifact hash/byte mismatch: ${safe.path}`);
      artifactMap.set(safe.path, artifact);
    }
  }
  for (const required of ['project-qa-report.md', 'module-results.json', 'execution-evidence.json', 'delivered-payload.md', 'target-integrity.json', 'cleanup.json']) {
    if (!artifactMap.has(required)) diagnostics.push(`manifest missing artifact reference: ${required}`);
  }
  const report = existsSync(path.join(root, 'project-qa-report.md')) ? readFileSync(path.join(root, 'project-qa-report.md'), 'utf8') : '';
  const delivered = existsSync(path.join(root, 'delivered-payload.md')) ? readFileSync(path.join(root, 'delivered-payload.md'), 'utf8') : '';
  const reportStatus = report.match(/^Overall Status: (PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)$/m)?.[1];
  if (!reportStatus) diagnostics.push('report missing standalone Overall Status');
  if (reportStatus && reportStatus !== manifest.status) diagnostics.push('report status mismatch with manifest');
  if (!report.includes(`Scenario: ${manifest.scenarioId}`) || !report.includes(`Run ID: ${manifest.runId}`)) diagnostics.push('report scenario/run mismatch with manifest');
  if (report !== delivered) diagnostics.push('delivery report mismatch: delivered-payload.md differs from project-qa-report.md');
  const exactDelivery = validateExactDelivery({ completedPayload: delivered, reportArtifact: artifactMap.get('project-qa-report.md'), manifest });
  if (!exactDelivery.ok) diagnostics.push(...exactDelivery.diagnostics.map((diagnostic) => `delivery ${diagnostic}`));
  const reportArtifact = artifactMap.get('project-qa-report.md');
  if (reportArtifact && (manifest.reportSha256 !== reportArtifact.sha256 || manifest.reportBytes !== reportArtifact.bytes)) diagnostics.push('manifest top-level report metadata differs from report artifact');
  if (!Array.isArray(moduleResults)) diagnostics.push('module result artifact must contain an array');
  if (!Array.isArray(executionEvidence)) diagnostics.push('execution evidence artifact must contain an array');
  if (!targetIntegrity || targetIntegrity.ok !== true) diagnostics.push('target integrity JSON is missing or not ok');
  if (!cleanup || cleanup.attempted !== true || cleanup.completed !== true) diagnostics.push('cleanup JSON is missing or incomplete');
  validateTargetCleanupConsistency({ targetIntegrity, cleanup, diagnostics });
  if (Array.isArray(moduleResults)) {
    for (const result of moduleResults) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        diagnostics.push('module result entry must be an object');
        continue;
      }
      if (!result.moduleId || !result.taskId || !statuses.includes(result.status)) diagnostics.push('module result shape/status invalid');
      if (result.scenarioId !== manifest.scenarioId || result.runId !== manifest.runId) diagnostics.push(`module result scenario/run mismatch: ${result.moduleId || 'unknown'}`);
      if (result.provenance?.snapshotFingerprint !== manifest.snapshotFingerprint) diagnostics.push(`module result provenance mismatch: ${result.moduleId || 'unknown'}`);
      if (result.snapshotFingerprint !== manifest.snapshotFingerprint) diagnostics.push(`module result snapshot mismatch: ${result.moduleId || 'unknown'}`);
      if (!Array.isArray(result.evidence)) {
        diagnostics.push(`module result evidence must be an array: ${result.moduleId || 'unknown'}`);
        continue;
      }
      for (const evidence of result.evidence) {
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
          diagnostics.push(`module evidence entry must be an object: ${result.moduleId || 'unknown'}`);
          continue;
        }
        if (evidence.moduleId !== result.moduleId || evidence.taskId !== result.taskId) diagnostics.push('module result evidence consistency mismatch');
        if (evidence.scenarioId !== manifest.scenarioId || evidence.runId !== manifest.runId) diagnostics.push(`module evidence scenario/run mismatch: ${result.moduleId}`);
        if (evidence.provenance?.snapshotFingerprint !== manifest.snapshotFingerprint || evidence.snapshotFingerprint !== manifest.snapshotFingerprint) diagnostics.push(`module evidence snapshot/provenance mismatch: ${result.moduleId}`);
        if (evidence.status !== result.status && !(['FAIL', 'NEEDS_HUMAN_REVIEW'].includes(result.status) && evidence.status === 'PASS')) diagnostics.push(`module evidence status mismatch: ${result.moduleId}`);
        if (!artifactMap.has(evidence.artifact?.path)) diagnostics.push(`module result evidence artifact reference missing: ${evidence.artifact?.path}`);
      }
    }
  }
  if (Array.isArray(executionEvidence)) {
    for (const evidence of executionEvidence) {
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        diagnostics.push('execution evidence entry must be an object');
        continue;
      }
      if (evidence.scenarioId !== manifest.scenarioId || evidence.runId !== manifest.runId) diagnostics.push('execution evidence scenario/run mismatch');
      if (!evidence.verificationId || !statuses.includes(evidence.status)) diagnostics.push('execution evidence verification/status missing');
      if (evidence.provenance?.snapshotFingerprint !== manifest.snapshotFingerprint || evidence.snapshotFingerprint !== manifest.snapshotFingerprint) diagnostics.push('execution evidence provenance/snapshot mismatch');
      if (classifyExecutionStatus(evidence) !== evidence.status) diagnostics.push('execution evidence status does not match exit classification');
    }
  }
  if (Array.isArray(moduleResults) && Array.isArray(executionEvidence)) {
    const executionByVerification = new Map(executionEvidence.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => [entry.verificationId, entry]));
    for (const result of moduleResults) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
      for (const verificationId of Array.isArray(result.verificationIds) ? result.verificationIds : []) {
        if (result.status !== 'BLOCKED' && !executionByVerification.has(verificationId)) diagnostics.push(`module/execution verification mismatch: ${verificationId}`);
      }
    }
  }
  const coverageValidation = validateRequiredCoverageShape(manifest.requiredCoverage);
  diagnostics.push(...coverageValidation.diagnostics);
  if (coverageValidation.ok && Array.isArray(moduleResults) && targetIntegrity) {
    try {
      const recomputed = reconcileProjectStatus({
        moduleResults,
        requiredCoverage: manifest.requiredCoverage,
        currentSnapshotFingerprint: manifest.snapshotFingerprint,
        authorityIntegrity: Object.freeze({ ok: true, diagnostics: Object.freeze([]) }),
        targetIntegrity,
      });
      if (recomputed.overallStatus !== manifest.status) diagnostics.push(`authority recomputed status mismatch: manifest ${manifest.status}, disk ${recomputed.overallStatus}`);
      if (manifest.status === 'PASS' && recomputed.coverageComplete !== true) diagnostics.push('authority recomputed coverage is incomplete for PASS');
    } catch (error) {
      diagnostics.push(`authority reconciliation failed: ${error.message}`);
    }
  }
  const ok = diagnostics.length === 0;
  return Object.freeze({ ok, status: ok ? manifest.status : 'BLOCKED', diagnostics: Object.freeze(diagnostics), preservedFindings, manifestDiskMetadata });
}

function validateTargetCleanupConsistency({ targetIntegrity, cleanup, diagnostics }) {
  if (!targetIntegrity || !cleanup) return;
  if (targetIntegrity.cleanup && JSON.stringify(targetIntegrity.cleanup) !== JSON.stringify(cleanup)) diagnostics.push('target integrity cleanup does not match cleanup artifact');
  if (targetIntegrity.cleanup && targetIntegrity.cleanup.completed !== true) diagnostics.push('target integrity cleanup incomplete');
  if (targetIntegrity.snapshot && cleanup.completed !== true) diagnostics.push('controlled cleanup incomplete');
  if (targetIntegrity.originalBefore || targetIntegrity.originalAfter || targetIntegrity.copyFingerprint) {
    const before = JSON.stringify(targetIntegrity.originalBefore?.files || []);
    const after = JSON.stringify(targetIntegrity.originalAfter?.files || []);
    const copy = JSON.stringify(targetIntegrity.copyFingerprint?.files || []);
    if (before !== after) diagnostics.push('real target before/after fingerprint mismatch');
    if (before !== copy) diagnostics.push('real source/copy fingerprint mismatch');
  }
}

function validateRequiredCoverageShape(requiredCoverage) {
  const diagnostics = [];
  if (!requiredCoverage || typeof requiredCoverage !== 'object' || Array.isArray(requiredCoverage)) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(['manifest requiredCoverage missing or malformed']) });
  }
  for (const key of ['importantModules', 'keyFlows', 'mustVerify']) {
    if (!Array.isArray(requiredCoverage[key]) || requiredCoverage[key].some((entry) => typeof entry !== 'string')) diagnostics.push(`manifest requiredCoverage.${key} must be a string array`);
  }
  for (const key of ['taskIds', 'moduleEvidence', 'keyFlowEvidence']) {
    if (!requiredCoverage[key] || typeof requiredCoverage[key] !== 'object' || Array.isArray(requiredCoverage[key])) diagnostics.push(`manifest requiredCoverage.${key} must be an object`);
  }
  for (const [moduleId, verificationIds] of Object.entries(requiredCoverage.moduleEvidence || {})) {
    if (typeof moduleId !== 'string' || !Array.isArray(verificationIds) || verificationIds.some((entry) => typeof entry !== 'string')) diagnostics.push('manifest requiredCoverage.moduleEvidence values must be string arrays');
  }
  for (const [flowId, verificationIds] of Object.entries(requiredCoverage.keyFlowEvidence || {})) {
    if (typeof flowId !== 'string' || !Array.isArray(verificationIds) || verificationIds.some((entry) => typeof entry !== 'string')) diagnostics.push('manifest requiredCoverage.keyFlowEvidence values must be string arrays');
  }
  return Object.freeze({ ok: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

function validateArtifactContext({ artifact, manifest, diagnostics }) {
  if (!artifact.kind) diagnostics.push(`artifact kind missing: ${artifact.path || 'unknown'}`);
  if (artifact.scenarioId !== manifest.scenarioId || artifact.runId !== manifest.runId) diagnostics.push(`${domainForPath(artifact.path)} artifact scenario/run mismatch: ${artifact.path}`);
  if (artifact.status !== manifest.status) diagnostics.push(`${domainForPath(artifact.path)} artifact status mismatch: ${artifact.path}`);
  if (!artifact.provenance?.schema || artifact.provenance?.snapshotFingerprint !== manifest.snapshotFingerprint) diagnostics.push(`${domainForPath(artifact.path)} artifact provenance mismatch: ${artifact.path}`);
  if (typeof artifact.sha256 !== 'string' || !Number.isInteger(artifact.bytes)) diagnostics.push(`${domainForPath(artifact.path)} artifact hash/bytes missing: ${artifact.path}`);
}

function domainForPath(relativePath) {
  if (relativePath === 'project-qa-report.md') return 'report';
  if (relativePath === 'manifest.json') return 'manifest';
  if (relativePath === 'module-results.json') return 'module result';
  if (relativePath === 'delivered-payload.md') return 'delivery';
  if (relativePath === 'execution-evidence.json') return 'execution evidence';
  return 'artifact';
}

export function parseProjectScenarioArgs(argv, env = process.env) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);
    const key = token.slice(2);
    if (!knownCliOptions.has(key)) throw new Error(`Unknown option --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  const hasRealOption = ['real-target', 'real-argv-json', 'real-artifact-root', 'real-timeout-ms'].some((key) => Object.hasOwn(options, key));
  if (hasRealOption && env.QA_SKILL_REAL_PROJECT_RUNS !== '1') throw new Error('QA_SKILL_REAL_PROJECT_RUNS=1 is required for real CLI options');
  const scenarioId = options.scenario || 'pass';
  if (!controlledProjectScenarios[scenarioId]) throw new Error(`Unknown controlled scenario ${scenarioId}`);
  const timeoutMs = validateTimeoutMs(options['timeout-ms'] || 30000);
  const realTarget = options['real-target'] || env.QA_SKILL_REAL_PROJECT_TARGET;
  const realArgvJson = options['real-argv-json'] || env.QA_SKILL_REAL_PROJECT_ARGV_JSON;
  const realTimeoutMs = validateTimeoutMs(options['real-timeout-ms'] || env.QA_SKILL_REAL_PROJECT_TIMEOUT_MS || 60000, 'real-timeout-ms');
  if (env.QA_SKILL_REAL_PROJECT_RUNS === '1' && realTarget && !realArgvJson) throw new Error('QA_SKILL_REAL_PROJECT_ARGV_JSON or --real-argv-json is required for real execution');
  if (env.QA_SKILL_REAL_PROJECT_RUNS === '1' && !realTarget && realArgvJson) throw new Error('QA_SKILL_REAL_PROJECT_TARGET or --real-target is required for real execution');
  return Object.freeze({
    scenarioId,
    artifactRoot: options['artifact-root'],
    timeoutMs,
    realTarget,
    realArgvJson,
    realArtifactRoot: options['real-artifact-root'] || env.QA_SKILL_REAL_PROJECT_ARTIFACT_ROOT,
    realTimeoutMs,
  });
}

async function main() {
  const options = parseProjectScenarioArgs(process.argv.slice(2));
  const result = options.realTarget
    ? await runRealProjectScenario({ targetRoot: path.resolve(options.realTarget), argv: JSON.parse(options.realArgvJson), artifactRoot: options.realArtifactRoot, timeoutMs: options.realTimeoutMs })
    : await runControlledProjectScenario({ scenarioId: options.scenarioId, artifactRoot: options.artifactRoot, timeoutMs: options.timeoutMs });
  process.stdout.write(`${JSON.stringify({ scenarioId: result.scenarioId, runId: result.runId, status: result.status, authorityOk: result.authority.ok, runDirectory: result.runDirectory })}\n`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'BLOCKED', error: error.message })}\n`);
    process.exitCode = 1;
  });
}
