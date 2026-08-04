import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const secretKeyPattern = /(?:token|secret|password|credential|cookie|auth|key)/i;
const verdictLinePattern = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:Overall\s+Status|QA\s+Verdict)\s*:?(?:\*\*)?\s*:??\s*(?:\*\*)?(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\b(?:\*\*)?/im;
const verdictTablePattern = /^\s*\|\s*(?:\*\*)?(?:Overall\s+Status|QA\s+Verdict)(?:\*\*)?\s*\|\s*(?:\*\*)?(PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)\b(?:\*\*)?\s*\|/im;
const requiredSkillNames = ['using-qa', 'qa-plan', 'qa-execute', 'qa-conclude'];
export const defaultTimeoutMs = 600000;

const providerModelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const agentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const unsafeCliValuePattern = /[\s\x00-\x1f\x7f;&|<>`$(){}[\]\\'"*?]/;

export function normalizeRelative(filePath) {
  return filePath.split(path.sep).join('/');
}

export function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeTextFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  ensureParent(absolutePath);
  writeFileSync(absolutePath, content, 'utf8');
}

export function regularFilesUnder(root) {
  if (!existsSync(root)) return [];

  const files = [];
  const pending = [''];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(root, relativePath);
      if (entry.isDirectory()) {
        pending.push(relativePath);
      } else if (entry.isFile()) {
        files.push(normalizeRelative(relativePath));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function fileSha256(absolutePath) {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

function sameRealPath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathHasLinkedComponent(absolutePath) {
  const parsed = path.parse(absolutePath);
  const relativeParts = path.relative(parsed.root, absolutePath).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) return true;
    const real = realpathSync.native(current);
    if (!sameRealPath(current, real)) return true;
  }
  return false;
}

export function validateRunInputs({ model, agent }) {
  const issues = [];
  if (typeof model !== 'string' || !providerModelPattern.test(model) || unsafeCliValuePattern.test(model)) {
    issues.push('model must be provider/model with conservative identifier characters only');
  }
  if (typeof agent !== 'string' || !agentPattern.test(agent) || unsafeCliValuePattern.test(agent) || agent.includes('/') || agent.includes('\\')) {
    issues.push('agent must be a simple identifier with conservative characters only');
  }
  return { ok: issues.length === 0, issues };
}

export function resolveOpenCodeInvocation({ commandPath }) {
  const issues = [];
  if (typeof commandPath !== 'string' || commandPath.length === 0) {
    return { shellSafe: false, issues: ['missing command path'] };
  }
  if (!path.isAbsolute(commandPath)) issues.push('command path must be absolute');
  const extension = path.extname(commandPath).toLowerCase();
  if (process.platform === 'win32' && extension !== '.exe') issues.push('command path must be a direct .exe');
  if (['.cmd', '.bat', '.ps1'].includes(extension)) issues.push('shell wrapper commands are rejected');
  if (issues.length === 0) {
    if (!existsSync(commandPath)) {
      issues.push('command path does not exist');
    } else if (!statSync(commandPath).isFile()) {
      issues.push('command path is not a regular file');
    } else if (pathHasLinkedComponent(commandPath)) {
      issues.push('command path contains a linked or reparse component');
    }
  }
  if (issues.length > 0) return { shellSafe: false, issues };
  return { command: commandPath, shell: false, shellSafe: true, issues: [] };
}

function candidateOpenCodePaths(env = process.env) {
  const candidates = [];
  if (env.QA_SKILL_OPENCODE_BIN) candidates.push(env.QA_SKILL_OPENCODE_BIN);
  if (process.platform === 'win32') {
    for (const entry of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
      candidates.push(path.join(entry, 'opencode.exe'));
    }
    const arch = process.arch === 'x64' ? 'x64' : process.arch;
    const appData = env.APPDATA;
    if (appData) {
      const nodeModulesRoot = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'node_modules');
      const packageRoot = path.join(nodeModulesRoot, `opencode-windows-${arch}`);
      candidates.push(path.join(packageRoot, 'bin', 'opencode.exe'));
      candidates.push(path.join(nodeModulesRoot, `opencode-windows-${arch}-baseline`, 'bin', 'opencode.exe'));
    }
  }
  return candidates;
}

function defaultOpenCodeInvocation(env = process.env) {
  if (process.platform !== 'win32' && !env.QA_SKILL_OPENCODE_BIN) {
    return { command: 'opencode', shell: false, shellSafe: true, issues: [] };
  }
  for (const candidate of candidateOpenCodePaths(env)) {
    const resolved = resolveOpenCodeInvocation({ commandPath: candidate });
    if (resolved.shellSafe) return resolved;
  }
  return { shellSafe: false, issues: ['no direct shell-free opencode executable found'] };
}

export function hashDirectory(root) {
  const files = regularFilesUnder(root).map((relativePath) => ({
    path: relativePath,
    sha256: fileSha256(path.join(root, relativePath)),
    bytes: statSync(path.join(root, relativePath)).size,
  }));
  const canonical = JSON.stringify(files.map(({ path: filePath, sha256 }) => [filePath, sha256]));
  return {
    root,
    sha256: createHash('sha256').update(canonical).digest('hex'),
    files,
  };
}

function copyDirectory(sourceRoot, destinationRoot) {
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true });
  for (const relativePath of regularFilesUnder(sourceRoot)) {
    const source = path.join(sourceRoot, relativePath);
    const destination = path.join(destinationRoot, relativePath);
    ensureParent(destination);
    copyFileSync(source, destination);
  }
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    env: { ...process.env, GIT_MASTER: '1' },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  };
}

function validateGitStep(label, result) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: status=${result.status}; error=${result.error?.message || 'none'}; stderr=${result.stderr.trim()}`);
  }
  return null;
}

export function createScenarioRepository({ scenario, runRoot, projectRoot }) {
  const scenarioRoot = projectRoot
    ? path.join(projectRoot, 'targets', scenario.id, 'product')
    : path.join(runRoot, scenario.id, 'product');
  rmSync(scenarioRoot, { recursive: true, force: true });
  mkdirSync(scenarioRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(scenario.product.baselineFiles)) {
    writeTextFile(scenarioRoot, relativePath, content);
  }

  const init = runGit(scenarioRoot, ['init', '--quiet']);
  const add = runGit(scenarioRoot, ['add', '.']);
  const commit = runGit(scenarioRoot, [
    '-c', 'user.name=QA Functional Fixture',
    '-c', 'user.email=qa-functional-fixture@example.invalid',
    'commit', '--quiet', '-m', 'baseline fixture',
  ]);
  const failures = [
    validateGitStep('git init', init),
    validateGitStep('git add', add),
    validateGitStep('git commit', commit),
  ].filter(Boolean);

  for (const [relativePath, content] of Object.entries(scenario.product.candidateFiles)) {
    writeTextFile(scenarioRoot, relativePath, content);
  }

  for (const relativePath of scenario.product.deleteFiles || []) {
    rmSync(path.join(scenarioRoot, relativePath), { force: true });
  }

  const diff = runGit(scenarioRoot, ['diff', '--', scenario.product.changedPath]);
  const status = runGit(scenarioRoot, ['status', '--short']);
  failures.push(...[
    validateGitStep('git diff', diff),
    validateGitStep('git status', status),
  ].filter(Boolean));
  const verification = spawnSync(scenario.product.verifyCommand[0], scenario.product.verifyCommand.slice(1), {
    cwd: scenarioRoot,
    env: { ...process.env },
    encoding: 'utf8',
  });

  return {
    root: scenarioRoot,
    git: {
      init,
      add,
      commit,
      status: status.status,
      statusText: status.stdout,
      failures,
    },
    diff: diff.stdout,
    verification: {
      command: scenario.product.verifyCommand,
      status: verification.status,
      stdout: verification.stdout || '',
      stderr: verification.stderr || '',
      error: verification.error?.message || null,
    },
    sourceManifest: hashDirectory(scenarioRoot),
  };
}

export function materializeCurrentSkill({ packRoot, runRoot }) {
  const projectRoot = path.join(runRoot, 'opencode-project');
  const skillRoot = path.join(projectRoot, '.opencode', 'skills');
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(projectRoot, { recursive: true });
  copyDirectory(packRoot, skillRoot);

  const source = hashDirectory(packRoot);
  const copied = hashDirectory(skillRoot);
  assert.equal(copied.sha256, source.sha256, 'copied skill tree hash must match current qa-skill source hash');

  return {
    projectRoot,
    skillRoot,
    sourceHash: source.sha256,
    copiedHash: copied.sha256,
    manifest: source,
    copiedManifest: copied,
  };
}

export function materializeRuntimeConfig({ projectRoot, model }) {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    agent: {
      general: {
        mode: 'subagent',
        model,
      },
    },
  };
  const configPath = path.join(projectRoot, 'opencode.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return {
    configPath,
    config,
    sha256: fileSha256(configPath),
    bytes: statSync(configPath).size,
  };
}

function parseJsonFromStdout(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
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

export function validateProjectSkillDiscovery({ projectRoot, isolatedRoot, invocation = defaultOpenCodeInvocation() }) {
  if (!invocation.shellSafe) {
    return {
      status: null,
      stdout: '',
      stderr: '',
      error: invocation.issues.join('; '),
      discoveredNames: [],
      missingNames: requiredSkillNames,
      ok: false,
    };
  }
  const args = ['debug', 'skill', '--pure'];
  const result = spawnSync(invocation.command, args, {
    cwd: projectRoot,
    env: isolatedOpenCodeEnv({ isolatedRoot }),
    encoding: 'utf8',
    shell: false,
  });
  const parsed = parseJsonFromStdout(result.stdout || '');
  const entries = parsed ? flattenDiscoveryEntries(parsed) : [];
  const discoveredNames = entries
    .map((entry) => entry.name ?? entry.id ?? entry.skill ?? entry.title)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const missingNames = requiredSkillNames.filter((skillName) => !discoveredNames.includes(skillName));
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null,
    discoveredNames,
    missingNames,
    ok: result.status === 0 && missingNames.length === 0,
  };
}

export function isolatedOpenCodeEnv({ isolatedRoot }) {
  const configRoot = path.join(isolatedRoot, 'config');
  const dataRoot = path.join(isolatedRoot, 'data');
  const stateRoot = path.join(isolatedRoot, 'state');
  const cacheRoot = path.join(isolatedRoot, 'cache');
  return {
    ...process.env,
    OPENCODE_TEST_HOME: isolatedRoot,
    HOME: isolatedRoot,
    XDG_CONFIG_HOME: configRoot,
    XDG_DATA_HOME: dataRoot,
    XDG_STATE_HOME: stateRoot,
    XDG_CACHE_HOME: cacheRoot,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_AUTOCOMPACT: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_SKILL_WARNINGS: '1',
    OPENCODE_DISABLE_DISCOVERY_WARNINGS: '1',
    OPENCODE_AUTH_CONTENT: process.env.OPENCODE_AUTH_CONTENT || '{}',
  };
}

export function createRuntimeOpenCodeEnv({ baseEnv = process.env } = {}) {
  return {
    ...baseEnv,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_AUTOCOMPACT: '1',
    OPENCODE_DISABLE_SKILL_WARNINGS: '1',
    OPENCODE_DISABLE_DISCOVERY_WARNINGS: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  };
}

export function parseJsonlStrict(rawBytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch (error) {
    return { events: [], errors: [{ line: 0, message: `Invalid UTF-8 JSONL: ${error.message}` }] };
  }

  const events = [];
  const errors = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      errors.push({ line: index + 1, message: error.message, excerpt: line.slice(0, 200) });
    }
  }

  return { events, errors };
}

export function extractFinalText(events) {
  const messageOrder = [];
  const textPartsByMessage = new Map();
  for (const event of events) {
    if (event?.type !== 'text' || typeof event.part?.text !== 'string' || !event.part?.messageID) continue;
    const messageID = event.part.messageID;
    if (!textPartsByMessage.has(messageID)) {
      textPartsByMessage.set(messageID, []);
      messageOrder.push(messageID);
    }
    textPartsByMessage.get(messageID).push(event.part.text);
  }

  if (messageOrder.length > 0) {
    return textPartsByMessage.get(messageOrder[messageOrder.length - 1]).join('');
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'message' && event.role === 'assistant' && typeof event.text === 'string') return event.text;
  }
  return '';
}

function normalizeReportText(text) {
  return text.replace(/\r\n/g, '\n').trim();
}

function strictStatusMarkers(text) {
  const lines = normalizeReportText(text).split('\n');
  const exact = [];
  const invalid = [];
  for (const line of lines) {
    const exactMatch = /^Overall Status: (PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)$/.exec(line);
    if (exactMatch) {
      exact.push(exactMatch[1]);
    } else if (/Overall\s+Status[\s\S]*(?:PASS|FAIL|BLOCKED|NEEDS_HUMAN_REVIEW)/i.test(line)) {
      invalid.push(line);
    }
  }
  return { exact, invalid };
}

function stripTaskResultWrapperDelimiterNewlines(payload) {
  let text = payload;
  if (text.startsWith('\r\n')) text = text.slice(2);
  else if (text.startsWith('\n')) text = text.slice(1);

  if (text.endsWith('\r\n')) text = text.slice(0, -2);
  else if (text.endsWith('\n')) text = text.slice(0, -1);
  return text;
}

export function extractTaskResultReport({ events, parentSessionId = null }) {
  const issues = [];
  const parentEvents = (events || []).filter((event) => {
    if (event?.type !== 'tool_use') return false;
    if (!parentSessionId) return true;
    const sessionId = eventSessionId(event);
    return !sessionId || sessionId === parentSessionId;
  });
  const taskEvents = parentEvents.filter((event) => eventToolName(event) === 'task');
  if (taskEvents.length !== 1) issues.push(`expected exactly one parent task event, found ${taskEvents.length}`);

  const taskEvent = taskEvents[0] || null;
  const status = taskEvent?.part?.state?.status || null;
  const callID = taskEvent?.part?.callID || taskEvent?.part?.callId || null;
  const output = taskEvent?.part?.state?.output;
  const childSessionId = taskEvent?.part?.state?.metadata?.sessionId
    || taskEvent?.part?.state?.metadata?.sessionID
    || taskEvent?.part?.state?.metadata?.taskSessionId
    || taskEvent?.part?.state?.metadata?.taskSessionID
    || taskSessionIdFromOutput(output);

  if (taskEvent && status !== 'completed') issues.push('parent task event must be completed');
  if (taskEvent && typeof output !== 'string') issues.push('parent task output must be a string');

  let text = '';
  if (typeof output === 'string') {
    const opener = '<task_result>';
    const closer = '</task_result>';
    const openerMatches = output.match(/<task_result>/g) || [];
    const closerMatches = output.match(/<\/task_result>/g) || [];
    const openerIndex = output.indexOf(opener);
    const closerIndex = output.indexOf(closer);
    if (openerMatches.length !== 1) issues.push(`task output must contain exactly one <task_result> opener, found ${openerMatches.length}`);
    if (closerMatches.length !== 1) issues.push(`task output must contain exactly one </task_result> closer, found ${closerMatches.length}`);
    if (openerIndex !== -1 && closerIndex !== -1 && closerIndex < openerIndex) issues.push('task_result closer appears before opener');
    if (openerMatches.length === 1 && closerMatches.length === 1 && openerIndex !== -1 && closerIndex > openerIndex) {
      text = stripTaskResultWrapperDelimiterNewlines(output.slice(openerIndex + opener.length, closerIndex));
      if (text.trim().length === 0) issues.push('task_result report content is empty');
    }
  }

  const result = {
    ok: issues.length === 0,
    parentSessionId,
    taskCallCount: taskEvents.length,
    callID,
    status,
    childSessionId: childSessionId || null,
    reportBytes: Buffer.byteLength(text, 'utf8'),
    issues,
  };
  Object.defineProperty(result, 'text', { value: text, enumerable: false });
  return result;
}

export function buildChildReportRelayEvidence({ childText, parentText, expectedVerdict, deliveredText = childText }) {
  const issues = [];
  const deliveryIssues = [];
  const rawChildText = typeof childText === 'string' ? childText : '';
  const rawParentText = typeof parentText === 'string' ? parentText : '';
  const rawDeliveredText = typeof deliveredText === 'string' ? deliveredText : '';
  const normalizedChild = normalizeReportText(rawChildText);
  const normalizedParent = normalizeReportText(rawParentText);
  const normalizedDelivered = normalizeReportText(rawDeliveredText);
  const childMarkers = strictStatusMarkers(rawChildText);
  const parentMarkers = strictStatusMarkers(rawParentText);
  const deliveredMarkers = strictStatusMarkers(rawDeliveredText);
  const childVerdict = childMarkers.exact[0] || null;
  const parentVerdict = parentMarkers.exact[0] || null;
  const deliveredVerdict = deliveredMarkers.exact[0] || null;

  if (!normalizedChild) issues.push('missing child report text');
  if (childMarkers.exact.length !== 1) issues.push(`child report must contain exactly one strict Overall Status line, found ${childMarkers.exact.length}`);
  if (parentMarkers.exact.length !== 1) issues.push(`parent report must contain exactly one strict Overall Status line, found ${parentMarkers.exact.length}`);
  if (childMarkers.invalid.length > 0) issues.push('child report contains invalid marker-like Overall Status line');
  if (parentMarkers.invalid.length > 0) issues.push('parent report contains invalid marker-like Overall Status line');
  if (childVerdict && childVerdict !== expectedVerdict) issues.push(`child verdict mismatch: expected ${expectedVerdict}, got ${childVerdict}`);
  if (parentVerdict && parentVerdict !== expectedVerdict) issues.push(`parent verdict mismatch: expected ${expectedVerdict}, got ${parentVerdict}`);

  if (!normalizedChild) deliveryIssues.push('missing child report text');
  if (childMarkers.exact.length !== 1) deliveryIssues.push(`child report must contain exactly one strict Overall Status line, found ${childMarkers.exact.length}`);
  if (childMarkers.invalid.length > 0) deliveryIssues.push('child report contains invalid marker-like Overall Status line');
  if (childVerdict && childVerdict !== expectedVerdict) deliveryIssues.push(`child verdict mismatch: expected ${expectedVerdict}, got ${childVerdict}`);
  if (!normalizedDelivered) deliveryIssues.push('missing delivered final report text');
  if (deliveredMarkers.exact.length !== 1) deliveryIssues.push(`delivered report must contain exactly one strict Overall Status line, found ${deliveredMarkers.exact.length}`);
  if (deliveredMarkers.invalid.length > 0) deliveryIssues.push('delivered report contains invalid marker-like Overall Status line');
  if (deliveredVerdict && deliveredVerdict !== expectedVerdict) deliveryIssues.push(`delivered verdict mismatch: expected ${expectedVerdict}, got ${deliveredVerdict}`);

  const relayMatches = normalizedChild.length > 0 && rawChildText === rawParentText;
  if (!relayMatches) issues.push('parent final report does not exactly relay child report');
  const deliveredRelayMatches = normalizedChild.length > 0 && rawChildText === rawDeliveredText;
  if (!deliveredRelayMatches) deliveryIssues.push('delivered final report does not exactly match child report text');
  const deliveryOk = deliveryIssues.length === 0;
  return {
    ok: issues.length === 0,
    deliveryOk,
    deliveryIssues,
    childSha256: createHash('sha256').update(rawChildText, 'utf8').digest('hex'),
    parentSha256: createHash('sha256').update(rawParentText, 'utf8').digest('hex'),
    deliveredSha256: createHash('sha256').update(rawDeliveredText, 'utf8').digest('hex'),
    childBytes: Buffer.byteLength(rawChildText, 'utf8'),
    parentBytes: Buffer.byteLength(rawParentText, 'utf8'),
    deliveredBytes: Buffer.byteLength(rawDeliveredText, 'utf8'),
    childMarkerCount: childMarkers.exact.length,
    parentMarkerCount: parentMarkers.exact.length,
    deliveredMarkerCount: deliveredMarkers.exact.length,
    childVerdict,
    parentVerdict,
    deliveredVerdict,
    relayMatches,
    rawRelayMatches: relayMatches,
    deliveredRelayMatches,
    issues,
  };
}

export function extractQaVerdict(finalText) {
  const match = verdictLinePattern.exec(finalText) || verdictTablePattern.exec(finalText);
  return match ? match[1].toUpperCase() : null;
}

function normalizeCommand(command) {
  return command.trim().replace(/\s+/g, ' ');
}

function classifyVerifierInvocation({ actualCommand, expectedCommand }) {
  const normalizedActual = normalizeCommand(actualCommand);
  const normalizedExpected = normalizeCommand(expectedCommand);
  const wrapperCommand = `${normalizedExpected}; $ec=$LASTEXITCODE; git status --short; exit $ec`;
  const lowerActual = normalizedActual.toLowerCase();
  const lowerExpected = normalizedExpected.toLowerCase();
  const lowerWrapper = wrapperCommand.toLowerCase();

  if (lowerActual === lowerExpected) {
    return {
      accepted: true,
      invocationKind: 'exact',
      expectedCommand: normalizedExpected,
      actualCommand: normalizedActual,
      issues: [],
    };
  }

  if (lowerActual === lowerWrapper) {
    return {
      accepted: true,
      invocationKind: 'status-preserving-readonly-wrapper',
      expectedCommand: normalizedExpected,
      actualCommand: normalizedActual,
      issues: [],
    };
  }

  return {
    accepted: false,
    invocationKind: 'rejected',
    expectedCommand: normalizedExpected,
    actualCommand: normalizedActual,
    issues: ['command is neither exact verifier nor approved status-preserving read-only wrapper'],
  };
}

function eventCommand(event) {
  return event?.part?.state?.input?.command;
}

export function extractModelCommandEvidence({ events, expectedCommand }) {
  const normalizedExpected = normalizeCommand(expectedCommand);
  const matches = events
    .filter((event) => event?.type === 'tool_use' && typeof eventCommand(event) === 'string')
    .map((event) => ({ event, classification: classifyVerifierInvocation({ actualCommand: eventCommand(event), expectedCommand: normalizedExpected }) }))
    .filter(({ classification }) => classification.accepted)
    .map(({ event, classification }) => ({
      ok: true,
      expectedCommand: classification.expectedCommand,
      actualCommand: classification.actualCommand,
      command: classification.actualCommand,
      invocationKind: classification.invocationKind,
      status: event.part?.state?.status || null,
      exit: event.part?.state?.metadata?.exit ?? null,
      output: event.part?.state?.output || '',
      error: event.part?.state?.error || '',
      callID: event.part?.callID || event.part?.callId || null,
      title: event.part?.title || null,
    }));

  if (matches.length === 0) {
    return { ok: false, expectedCommand: normalizedExpected, actualCommand: null, invocationKind: 'missing', issues: ['missing accepted verifier tool_use event'] };
  }

  const signatures = new Set(matches.map((match) => JSON.stringify({ status: match.status, exit: match.exit, output: match.output, error: match.error })));
  if (signatures.size > 1) {
    return { ok: false, command: normalizedExpected, matches, issues: ['ambiguous conflicting command tool_use events'] };
  }

  return matches[matches.length - 1];
}

function taskSessionIdFromOutput(output) {
  if (typeof output !== 'string') return null;
  return /<task_metadata>[\s\S]*?session_id:\s*([A-Za-z0-9_-]+)[\s\S]*?<\/task_metadata>/i.exec(output)?.[1] || null;
}

function extractParentSessionId(events) {
  for (const event of events) {
    const id = event?.sessionID || event?.sessionId || event?.session?.id || event?.message?.sessionID || event?.part?.sessionID;
    if (id) return id;
  }
  return null;
}

function eventSessionId(event) {
  return event?.sessionID || event?.sessionId || event?.session?.id || event?.message?.sessionID || event?.part?.sessionID || null;
}

function eventToolName(event) {
  return event?.part?.tool || event?.part?.name || event?.part?.type || null;
}

export function buildParentBoundaryEvidence({ events, parentSessionId = null }) {
  const issues = [];
  const calls = [];
  const parentEvents = events.filter((event) => {
    if (event?.type !== 'tool_use') return false;
    if (!parentSessionId) return true;
    const sessionId = eventSessionId(event);
    return !sessionId || sessionId === parentSessionId;
  });

  for (const event of parentEvents) {
    const tool = eventToolName(event);
    const status = event.part?.state?.status || null;
    const callID = event.part?.callID || event.part?.callId || null;
    calls.push({ tool, callID, status });
    if (tool === 'skill') continue;
    if (tool === 'todowrite') {
      if (status !== 'completed') issues.push('parent todowrite call must be completed');
      continue;
    }
    if (tool === 'task') {
      if (status !== 'completed') issues.push('parent task call must be completed');
      continue;
    }
    issues.push(`parent used forbidden tool: ${tool || 'unknown'}`);
  }

  const taskCallCount = calls.filter((call) => call.tool === 'task').length;
  if (taskCallCount !== 1) issues.push(`expected exactly one parent task call, found ${taskCallCount}`);

  return {
    ok: issues.length === 0,
    parentSessionId,
    toolCallCount: calls.length,
    taskCallCount,
    skillCallCount: calls.filter((call) => call.tool === 'skill').length,
    calls,
    issues,
  };
}

export function extractTaskSessionIds(events) {
  const ids = [];
  for (const event of events) {
    if (event?.type !== 'tool_use') continue;
    const state = event.part?.state;
    if (state?.status !== 'completed') continue;
    const toolName = event.part?.tool || event.part?.name || event.part?.type || event.part?.title || '';
    if (!/\btask\b/i.test(toolName)) continue;
    const id = state.metadata?.sessionId || state.metadata?.sessionID || state.metadata?.taskSessionId || state.metadata?.taskSessionID || taskSessionIdFromOutput(state.output);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function modelString(model) {
  if (typeof model === 'string') return model;
  if (!model || typeof model !== 'object') return null;
  const provider = model.providerID || model.provider || model.providerId;
  const name = model.modelID || model.model || model.id || model.modelId;
  return provider && name ? `${provider}/${name}` : name || null;
}

function normalizeExportToolPart(part) {
  if (part?.type === 'tool_use' && part.part?.state) return part;
  if (part?.type !== 'tool' || !part.state) return null;
  return {
    type: 'tool_use',
    part: {
      tool: part.tool || null,
      callID: part.callID || part.callId || null,
      title: part.state?.title || part.title || null,
      state: part.state,
    },
  };
}

function exportedToolEvents(exportJson) {
  const events = [];
  for (const message of exportJson?.messages || []) {
    for (const part of message.parts || []) {
      const normalized = normalizeExportToolPart(part);
      if (normalized) events.push(normalized);
    }
  }
  for (const part of exportJson?.parts || []) {
    const normalized = normalizeExportToolPart(part);
    if (normalized) events.push(normalized);
  }
  return events;
}

function sanitizeToolEvent(event) {
  return {
    type: 'tool_use',
    part: {
      callID: event.part?.callID || event.part?.callId || null,
      title: event.part?.title || null,
      tool: event.part?.tool || event.part?.name || null,
      state: {
        status: event.part?.state?.status || null,
        input: { command: event.part?.state?.input?.command || '' },
        metadata: { exit: event.part?.state?.metadata?.exit ?? null },
        output: event.part?.state?.output || '',
        error: event.part?.state?.error || '',
        startedAt: event.part?.state?.startedAt ?? event.part?.state?.time?.start ?? null,
        endedAt: event.part?.state?.endedAt ?? event.part?.state?.time?.end ?? null,
      },
    },
  };
}

export function buildNestedSessionEvidence({ sessionId, parentSessionId, exportJson, expectedCommand }) {
  const session = exportJson?.info || exportJson?.session || exportJson?.metadata?.session || exportJson;
  if (!session || typeof session !== 'object' || !session.id) {
    return { ok: false, sessionId, parentSessionId, issues: ['malformed export JSON: missing session metadata'], selectedToolEvents: [] };
  }
  let selectedToolEvents = exportedToolEvents(exportJson)
    .filter((event) => typeof event.part?.state?.input?.command === 'string')
    .filter((event) => (event.part?.tool || '').toLowerCase() === 'bash' || event.part?.tool == null)
    .map(sanitizeToolEvent);
  if (expectedCommand) {
    selectedToolEvents = selectedToolEvents.filter((event) => classifyVerifierInvocation({
      actualCommand: event.part.state.input.command,
      expectedCommand,
    }).accepted);
  }
  return {
    ok: true,
    sessionId: session.id || sessionId,
    parentSessionId: session.parentID || session.parentId || session.parent || parentSessionId || null,
    agent: session.agent || session.agentName || session.mode || null,
    model: modelString(session.model) || modelString(session.provider ? { provider: session.provider, model: session.model } : null),
    version: session.version || exportJson?.version || null,
    selectedToolEvents,
    issues: [],
  };
}

export function buildAgentTopologyEvidence({ parentSessionId, childSessionIds, nestedSessionEvidence, requestedModel, expectedAgent = 'general', exportResult }) {
  const issues = [];
  if (childSessionIds.length !== 1) issues.push(`expected exactly one child session, found ${childSessionIds.length}`);
  if (!nestedSessionEvidence?.ok) issues.push(...(nestedSessionEvidence?.issues || ['nested session export failed']));
  if (!parentSessionId || !nestedSessionEvidence?.parentSessionId) issues.push('missing parent linkage evidence');
  if (nestedSessionEvidence?.parentSessionId && parentSessionId && nestedSessionEvidence.parentSessionId !== parentSessionId) issues.push('child parent linkage does not match parent session');
  if (nestedSessionEvidence?.agent !== expectedAgent) issues.push(`child agent mismatch: expected ${expectedAgent}, got ${nestedSessionEvidence?.agent || 'unknown'}`);
  if (nestedSessionEvidence?.model !== requestedModel) issues.push(`child model mismatch: expected ${requestedModel}, got ${nestedSessionEvidence?.model || 'unknown'}`);
  if (exportResult && exportResult.status !== 0) issues.push(`opencode export failed with status ${exportResult.status}`);
  return {
    ok: issues.length === 0,
    parentSessionId,
    childIds: childSessionIds,
    childCount: childSessionIds.length,
    childParentId: nestedSessionEvidence?.parentSessionId || null,
    requestedModel,
    actualChildModel: nestedSessionEvidence?.model || null,
    expectedAgent,
    actualAgent: nestedSessionEvidence?.agent || null,
    exportStatus: exportResult?.status ?? null,
    issues,
  };
}

function exportNestedSession({ sessionId, projectRoot, env, invocation }) {
  if (!invocation.shellSafe) {
    return { status: null, stdout: '', stderr: '', error: invocation.issues.join('; '), json: null };
  }
  const result = spawnSync(invocation.command, ['export', sessionId, '--pure'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 1024 * 1024 * 20,
  });
  const parsed = result.status === 0 ? parseJsonFromStdout(result.stdout || '') : null;
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null,
    json: parsed,
  };
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
  if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return cells;
}

export function analyzeReportDiagnostics(finalText) {
  const warnings = [];
  const blockingIssues = [];
  const lines = finalText.split(/\r?\n/);

  for (const line of lines) {
    const cells = splitMarkdownTableRow(line);
    if (!cells || cells.length < 4) continue;
    const statusIndex = cells.findIndex((cell) => /^BLOCKED$/i.test(cell));
    if (statusIndex === -1) continue;
    const rowText = cells.join(' | ');
    const hasNonApplicableReason = /\b(?:not applicable|out of scope|not required)\b/i.test(rowText);
    const hasNoBlocker = cells.some((cell) => /^(?:none|n\/a)$/i.test(cell));
    const hasRealBlocker = /\b(?:missing prerequisite|unresolved|blocked because|blocker:)\b/i.test(rowText) && !hasNonApplicableReason;

    if (hasNonApplicableReason && hasNoBlocker) {
      warnings.push({ type: 'non-applicable-blocked-row', row: line });
    } else if (hasRealBlocker) {
      blockingIssues.push({ type: 'blocked-row', row: line });
    }
  }

  return { warnings, blockingIssues };
}

export function selectReportSource({ finalMessage, projectRoot }) {
  const issues = [];
  const match = /^\s*(?:[-*]\s*)?(?:\*\*)?Report artifact:(?:\*\*)?\s*(?:`([^`\s]+)`|([^`\s]+))\s*$/im.exec(finalMessage);
  if (!match) {
    return { reportText: finalMessage, source: 'assistant-message', relativePath: null, citationFound: false, issues: ['no Report artifact citation'] };
  }

  const citedPath = match[1] || match[2];
  if (path.isAbsolute(citedPath)) issues.push('absolute report artifact paths are rejected');
  if (!citedPath.toLowerCase().endsWith('.md')) issues.push('report artifact must be a Markdown .md file');

  const normalizedCitation = normalizeRelative(path.normalize(citedPath));
  if (normalizedCitation.startsWith('../') || normalizedCitation === '..' || normalizedCitation.includes('/../')) {
    issues.push('report artifact traversal is rejected');
  }
  if (normalizedCitation === '.opencode' || normalizedCitation.startsWith('.opencode/')) {
    issues.push('report artifact inside .opencode is rejected');
  }
  if (normalizedCitation === 'targets' || normalizedCitation.startsWith('targets/')) {
    issues.push('report artifact inside product targets is rejected');
  }

  const absoluteReport = path.resolve(projectRoot, citedPath);
  const relativeToProject = path.relative(projectRoot, absoluteReport);
  if (relativeToProject === '' || relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) {
    issues.push('report artifact must resolve inside project root');
  }

  if (issues.length === 0) {
    if (!existsSync(absoluteReport)) {
      issues.push('report artifact file does not exist');
    } else if (!statSync(absoluteReport).isFile()) {
      issues.push('report artifact path is not a regular file');
    } else if (pathHasLinkedComponent(absoluteReport)) {
      issues.push('report artifact path contains a link or reparse component');
    } else {
      const projectRealPath = realpathSync.native(projectRoot);
      const reportRealPath = realpathSync.native(absoluteReport);
      const realRelative = path.relative(projectRealPath, reportRealPath);
      if (realRelative === '' || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        issues.push('report artifact realpath escapes project root');
      }
    }
  }

  if (issues.length > 0) {
    return { reportText: finalMessage, source: 'assistant-message', relativePath: null, citationFound: true, issues };
  }

  return {
    reportText: readFileSync(absoluteReport, 'utf8'),
    source: 'artifact',
    relativePath: normalizeRelative(relativeToProject),
    citationFound: true,
    issues: [],
  };
}

export function buildReportAuthorityEvidence({ selectedReportSource, authoritativeText }) {
  const issues = [];
  const selectionIssues = (selectedReportSource?.issues || []).filter((issue) => typeof issue === 'string');
  const authoritative = authoritativeText || '';
  const selected = selectedReportSource?.reportText || '';
  const selectedMatchesAuthoritative = selected === authoritative;
  if (!authoritative) issues.push('missing authoritative task-result report text');
  if (!selectedMatchesAuthoritative) issues.push('selected report source does not match authoritative task-result report');
  return {
    ok: issues.length === 0,
    source: selectedReportSource?.source || 'unknown',
    relativePath: selectedReportSource?.relativePath || null,
    selectedMatchesAuthoritative,
    authoritativeSha256: createHash('sha256').update(authoritative, 'utf8').digest('hex'),
    selectedSha256: createHash('sha256').update(selected, 'utf8').digest('hex'),
    authoritativeBytes: Buffer.byteLength(authoritative, 'utf8'),
    selectedBytes: Buffer.byteLength(selected, 'utf8'),
    selectionIssues,
    issues,
  };
}

export function buildDeliveredReportAuthorityEvidence({ authoritativeText, projectRoot }) {
  const authoritative = typeof authoritativeText === 'string' ? authoritativeText : '';
  const authorityEvidence = buildReportAuthorityEvidence({
    selectedReportSource: {
      reportText: authoritative,
      source: 'task-result',
      relativePath: null,
      issues: [],
    },
    authoritativeText: authoritative,
  });
  const mirrorSelection = selectReportSource({ finalMessage: authoritative, projectRoot });
  const mirrorFound = mirrorSelection.citationFound === true;
  const mirrorIsArtifact = mirrorFound && mirrorSelection.source === 'artifact';
  const mirrorText = mirrorIsArtifact ? mirrorSelection.reportText : '';
  const mirrorMatchesAuthoritative = mirrorFound ? mirrorIsArtifact && mirrorText === authoritative : null;
  const mirrorSelectionIssues = mirrorFound
    ? (mirrorSelection.issues || []).filter((issue) => typeof issue === 'string')
    : [];
  const issues = [...authorityEvidence.issues];

  if (mirrorFound) {
    for (const issue of mirrorSelectionIssues) issues.push(`cited report mirror invalid: ${issue}`);
    if (!mirrorMatchesAuthoritative) issues.push('cited report mirror does not exactly match authoritative task-result report');
  }

  return {
    ...authorityEvidence,
    ok: issues.length === 0,
    mirrorFound,
    mirrorSource: mirrorFound ? mirrorSelection.source : null,
    mirrorRelativePath: mirrorFound ? mirrorSelection.relativePath : null,
    mirrorMatchesAuthoritative,
    mirrorSha256: mirrorIsArtifact ? createHash('sha256').update(mirrorText, 'utf8').digest('hex') : null,
    mirrorBytes: mirrorIsArtifact ? Buffer.byteLength(mirrorText, 'utf8') : null,
    mirrorSelectionIssues,
    issues,
  };
}

export function promptMetadata(prompt) {
  const bytes = Buffer.byteLength(prompt, 'utf8');
  return { sha256: createHash('sha256').update(prompt, 'utf8').digest('hex'), bytes };
}

export function redactCommandMetadata({ command, args, env, prompt }) {
  const safeEnv = {};
  const alwaysRedactKeys = new Set(['OPENCODE_CONFIG_CONTENT', 'OPENCODE_AUTH_CONTENT']);
  for (const key of ['QA_SKILL_REAL_RUNS', 'QA_SKILL_MODEL', 'QA_SKILL_AGENT', 'QA_SKILL_TIMEOUT_MS', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_AUTH_CONTENT', 'API_TOKEN', 'NORMAL_VALUE']) {
    if (!(key in env)) continue;
    safeEnv[key] = alwaysRedactKeys.has(key) || secretKeyPattern.test(key) ? '[REDACTED]' : env[key];
  }
  return { command, args, env: safeEnv, prompt: prompt ? promptMetadata(prompt) : undefined };
}

export function summarizeInfrastructure({ spawnError, timedOut, exitCode, jsonlErrors, finalText, qaVerdict }) {
  const issues = [];
  if (timedOut) return { status: 'TIMED_OUT', issues: [{ type: 'timeout', message: 'opencode run exceeded timeout' }] };
  if (spawnError) return { status: 'SPAWN_FAILED', issues: [{ type: 'spawn', message: spawnError.message }] };
  if (exitCode !== 0) return { status: 'PROCESS_FAILED', issues: [{ type: 'exit', message: `opencode exited ${exitCode}` }] };
  if (jsonlErrors.length > 0) {
    for (const error of jsonlErrors) issues.push({ type: 'jsonl', message: error.message, line: error.line });
    return { status: 'INVALID_JSONL', issues };
  }
  if (!finalText || finalText.trim().length === 0) return { status: 'MISSING_FINAL_TEXT', issues: [{ type: 'final-text', message: 'missing final assistant text' }] };
  if (!qaVerdict) return { status: 'UNEXTRACTED_VERDICT', issues: [{ type: 'verdict', message: 'missing canonical QA verdict' }] };
  return { status: 'COMPLETED', issues };
}

function assertIncludesAll(finalText, values, label) {
  const missing = values.filter((value) => !finalText.includes(value));
  assert.deepEqual(missing, [], `missing ${label}: ${missing.join(', ')}`);
}

function assertPostRunEvidence({ oracle, postflight }) {
  assert.ok(oracle, 'missing post-run oracle evidence');
  assert.equal(oracle.checkedAfterModel, true, 'oracle must run after model process exits');
  assert.equal(oracle.matchesExpectedExitCode, true, 'post-run oracle exit code must match expected scenario exit code');
  assert.ok(postflight, 'missing postflight integrity evidence');
  assert.equal(postflight.productUnchanged, true, `product integrity mutation detected: ${(postflight.integrityIssues || []).join('; ')}`);
  assert.equal(postflight.skillUnchanged, true, `copied skill integrity mutation detected: ${(postflight.integrityIssues || []).join('; ')}`);
  assert.equal(postflight.runtimeConfigUnchanged, true, `runtime config mutation detected: ${(postflight.integrityIssues || []).join('; ')}`);
}

function assertAgentTopology({ agentTopology }) {
  assert.ok(agentTopology, 'missing agent topology evidence');
  assert.equal(agentTopology.ok, true, `agent topology invalid: ${(agentTopology.issues || []).join('; ')}`);
  assert.equal(agentTopology.childCount, 1, 'functional validation requires exactly one QA child session');
  assert.equal(agentTopology.actualAgent, agentTopology.expectedAgent || 'general', 'QA child session must use the expected subagent');
  assert.equal(agentTopology.actualChildModel, agentTopology.requestedModel, 'QA child session model must match requested model');
}

function assertParentBoundaryEvidence({ parentBoundaryEvidence }) {
  assert.ok(parentBoundaryEvidence, 'missing parent boundary evidence');
  assert.equal(parentBoundaryEvidence.ok, true, `parent boundary invalid: ${(parentBoundaryEvidence.issues || []).join('; ')}`);
  assert.equal(parentBoundaryEvidence.taskCallCount, 1, 'parent boundary requires exactly one task call');
  const serialized = JSON.stringify(parentBoundaryEvidence);
  assert.ok(!/input|output|prompt|title|transcript/i.test(serialized), 'parent boundary evidence must stay compact');
}

function assertChildReportRelayEvidence({ childReportRelayEvidence, scenario }) {
  assert.ok(childReportRelayEvidence, 'missing child report relay evidence');
  assert.equal(childReportRelayEvidence.deliveryOk, true, `delivered child report relay invalid: ${(childReportRelayEvidence.deliveryIssues || []).join('; ')}`);
  assert.equal(childReportRelayEvidence.deliveredRelayMatches, true, 'delivered report must exactly match child report');
  assert.equal(childReportRelayEvidence.childVerdict, scenario.expectedVerdict, 'child report relay verdict must match expected verdict');
  assert.equal(childReportRelayEvidence.deliveredVerdict, scenario.expectedVerdict, 'delivered report verdict must match expected verdict');
  const serialized = JSON.stringify(childReportRelayEvidence);
  assert.ok(!/Overall Status:|QA Plan Gate|messages|prompt|transcript|text/i.test(serialized), 'child report relay evidence must stay compact');
}

function assertReportAuthorityEvidence({ reportAuthorityEvidence }) {
  assert.ok(reportAuthorityEvidence, 'missing report authority evidence');
  assert.equal(reportAuthorityEvidence.ok, true, `report authority invalid: ${(reportAuthorityEvidence.issues || []).join('; ')}`);
  assert.equal(reportAuthorityEvidence.selectedMatchesAuthoritative, true, 'selected report source must match authoritative task-result report');
  const serialized = JSON.stringify(reportAuthorityEvidence);
  assert.ok(!/Overall Status:|QA Plan Gate|reportText|task_result|task_metadata|transcript/i.test(serialized), 'report authority evidence must stay compact');
}

function assertReportEvidenceLine({ scenario, finalText, expectedCommand, expectedStatus, expectedOutput }) {
  const escapedCommand = expectedCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedOutput = expectedOutput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const [riskId, verificationId, evidenceId, findingId] = scenario.requiredEvidence;
  assert.match(finalText, new RegExp(evidenceId, 'i'), `report missing evidence ID ${evidenceId}`);
  assert.match(finalText, new RegExp(verificationId, 'i'), `report missing verification ID ${verificationId}`);
  assert.match(finalText, new RegExp(escapedCommand, 'i'), `report missing exact command ${expectedCommand}`);
  assert.match(finalText, new RegExp(expectedStatus, 'i'), `report missing ${expectedStatus} result`);
  assert.match(finalText, new RegExp(escapedOutput, 'i'), 'report missing observed command output');
  if (riskId) assert.match(finalText, new RegExp(riskId, 'i'), `report missing risk ID ${riskId}`);
  if (findingId) assert.match(finalText, new RegExp(findingId, 'i'), `report missing finding ID ${findingId}`);
}

function assertModelCommandEvidence({ evidence, expectedCommand, expectedExit, expectedOutput }) {
  assert.ok(evidence, 'missing model command evidence');
  assert.equal(evidence.ok, true, `model command evidence invalid: ${(evidence.issues || []).join('; ')}`);
  assert.equal(evidence.expectedCommand, normalizeCommand(expectedCommand), 'model command evidence used a different verifier identity');
  assert.match(evidence.invocationKind, /^(?:exact|status-preserving-readonly-wrapper)$/, 'model command evidence invocation kind is not accepted');
  assert.equal(evidence.status, 'completed', 'model command evidence must be completed');
  assert.equal(evidence.exit, expectedExit, `model command evidence exit must be ${expectedExit}`);
  assert.match(evidence.output, new RegExp(expectedOutput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'model command output mismatch');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertTraceabilityChain({ finalText, evidenceIds, verdict }) {
  const [riskId, verificationId, evidenceId, findingId] = evidenceIds;
  const compactValues = [riskId, verificationId, evidenceId, findingId, verdict];
  const compactFields = ['Risk', 'Verification', 'Evidence', 'Finding', 'Status'];
  const compactPattern = new RegExp(
    compactFields
      .map((field, index) => `${field}[^\\r\\n]{0,40}${escapeRegExp(compactValues[index])}`)
      .join('[^\\r\\n]{0,160}'),
    'i',
  );
  const hasCompactMapping = finalText.split(/\r?\n/).some((line) => compactPattern.test(line));
  const verificationPattern = [riskId, verificationId, evidenceId, verdict]
    .map(escapeRegExp)
    .join('\\s*(?:->|→)\\s*');
  const findingPattern = `${escapeRegExp(findingId)}\\s*(?:->|→)\\s*${escapeRegExp(riskId)}\\s*/\\s*${escapeRegExp(verificationId)}\\s*/\\s*${escapeRegExp(evidenceId)}`;
  const hasExplicitMapping = new RegExp(verificationPattern, 'i').test(finalText)
    && new RegExp(findingPattern, 'i').test(finalText);
  assert.equal(
    hasCompactMapping || hasExplicitMapping,
    true,
    `missing traceability links ${riskId} -> ${verificationId} -> ${evidenceId} -> ${verdict} and ${findingId} -> ${riskId} / ${verificationId} / ${evidenceId}`,
  );
}

function hasBlockedRerunCondition({ finalText, missingPrerequisite, verifyCommand }) {
  const escapedPrerequisite = escapeRegExp(missingPrerequisite);
  const escapedCommand = escapeRegExp(verifyCommand);
  const supplyThenRun = /(?:provide|restore|supply|supplied)[\s\S]{0,200}(?:run|rerun)|(?:run|rerun)[\s\S]{0,200}(?:provide|restore|supply|supplied)/i.test(finalText);
  if (supplyThenRun) return true;

  const pathAvailability = new RegExp(
    `(?:availability|existence|presence|exists|available|present)[\\s\\S]{0,160}${escapedPrerequisite}|${escapedPrerequisite}[\\s\\S]{0,160}(?:availability|existence|presence|exists|available|present)`,
    'i',
  ).test(finalText);
  const conditionalVerifierRun = new RegExp(
    `(?:then|once|when|after)[\\s\\S]{0,80}(?:run|rerun|execute)[\\s\\S]{0,80}${escapedCommand}|(?:then|once|when|after)[\\s\\S]{0,80}${escapedCommand}`,
    'i',
  ).test(finalText);
  return pathAvailability && conditionalVerifierRun;
}

export function assertScenarioOutcome({ scenario, qaVerdict, finalText, infrastructureStatus, oracle, postflight, modelCommandEvidence, reportDiagnostics = { warnings: [], blockingIssues: [] }, agentTopology, parentBoundaryEvidence, childReportRelayEvidence, reportAuthorityEvidence }) {
  assert.equal(infrastructureStatus.status, 'COMPLETED', `infrastructure must complete before product verdict assertion: ${JSON.stringify(infrastructureStatus.issues)}`);
  assertAgentTopology({ agentTopology });
  assertParentBoundaryEvidence({ parentBoundaryEvidence });
  assertChildReportRelayEvidence({ childReportRelayEvidence, scenario });
  assertReportAuthorityEvidence({ reportAuthorityEvidence });
  assert.equal(qaVerdict, scenario.expectedVerdict, `${scenario.id}: QA verdict must match scenario oracle`);
  if (scenario.expectedVerdict !== 'BLOCKED') {
    assert.deepEqual(reportDiagnostics.blockingIssues || [], [], `report diagnostics contain blocking issues: ${JSON.stringify(reportDiagnostics.blockingIssues)}`);
  }

  if (scenario.expectedVerdict === 'PASS') {
    assertIncludesAll(finalText, scenario.requiredEvidence, 'PASS evidence identifiers');
    assert.match(finalText, /QA\s+Plan\s+Gate\s*:\s*OPEN/i);
    assert.match(finalText, /QA\s+Conclusion\s+Gate\s*:\s*COMPLETE/i);
    assert.match(finalText, /Risk[\s\S]{0,120}Verification[\s\S]{0,120}Evidence[\s\S]{0,120}Status|R01\s*->\s*V01\s*->\s*E01\s*->\s*PASS/i);
    assertReportEvidenceLine({ scenario, finalText, expectedCommand: scenario.product.verifyCommand.join(' '), expectedStatus: 'PASS', expectedOutput: 'OK membership discount behavior: member=90 guest=100' });
    assertModelCommandEvidence({ evidence: modelCommandEvidence, expectedCommand: scenario.product.verifyCommand.join(' '), expectedExit: 0, expectedOutput: 'OK membership discount behavior: member=90 guest=100' });
  }

  if (scenario.expectedVerdict === 'FAIL') {
    assertIncludesAll(finalText, scenario.requiredEvidence, 'FAIL risk verification evidence finding identifiers');
    assert.match(finalText, /product defect|expected behavior was not met|unmet expected behavior/i);
    assertTraceabilityChain({ finalText, evidenceIds: scenario.requiredEvidence, verdict: scenario.expectedVerdict });
    assertReportEvidenceLine({ scenario, finalText, expectedCommand: scenario.product.verifyCommand.join(' '), expectedStatus: 'FAIL', expectedOutput: 'tax rounding defect: expected 10.24 received 10.23' });
    assertModelCommandEvidence({ evidence: modelCommandEvidence, expectedCommand: scenario.product.verifyCommand.join(' '), expectedExit: 1, expectedOutput: 'tax rounding defect: expected 10.24 received 10.23' });
  }

  if (scenario.expectedVerdict === 'BLOCKED') {
    assertIncludesAll(finalText, scenario.requiredEvidence, 'BLOCKED risk verification evidence identifiers');
    assert.ok(finalText.includes(scenario.missingPrerequisite), `missing exact prerequisite: ${scenario.missingPrerequisite}`);
    const escapedPrerequisite = escapeRegExp(scenario.missingPrerequisite);
    assert.match(
      finalText,
      new RegExp(`(?:missing|absent|unavailable)[\\s\\S]{0,120}${escapedPrerequisite}|${escapedPrerequisite}[\\s\\S]{0,120}(?:missing|absent|unavailable)`, 'i'),
      'missing semantic prerequisite absence tied to exact path',
    );
    assert.equal(
      hasBlockedRerunCondition({ finalText, missingPrerequisite: scenario.missingPrerequisite, verifyCommand: scenario.product.verifyCommand.join(' ') }),
      true,
      'missing semantic rerun condition',
    );
  }

  assertPostRunEvidence({ oracle, postflight });
}

export function evaluateScenarioOutcome(input) {
  try {
    assertScenarioOutcome(input);
    return { passed: true, errors: [] };
  } catch (error) {
    return { passed: false, errors: [error.message] };
  }
}

function artifactEntry(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  return {
    path: normalizeRelative(relativePath),
    sha256: fileSha256(absolutePath),
    bytes: statSync(absolutePath).size,
  };
}

export function writeRunArtifacts({
  artifactRoot,
  scenario,
  fixture,
  skillMaterialization,
  commandMetadata,
  terminal,
  rawStdout,
  stderr,
  events,
  finalMessage,
  finalText,
  reportSource,
  qaVerdict,
  infrastructureStatus,
  scenarioAssertion,
  modelCommandEvidence,
  reportDiagnostics,
  nestedSessionEvidence,
  agentTopology,
  parentBoundaryEvidence,
  childReportRelayEvidence,
  runtimeConfig,
  postflight,
  oracle,
  discovery,
}) {
  const runDirectory = path.join(artifactRoot, scenario.id);
  rmSync(runDirectory, { recursive: true, force: true });
  mkdirSync(runDirectory, { recursive: true });

  writeFileSync(path.join(runDirectory, 'raw-stdout.jsonl'), rawStdout);
  writeFileSync(path.join(runDirectory, 'stderr.txt'), stderr, 'utf8');
  writeFileSync(path.join(runDirectory, 'events.json'), `${JSON.stringify(events, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'final-message.md'), finalMessage ?? finalText, 'utf8');
  writeFileSync(path.join(runDirectory, 'final-report.md'), finalText, 'utf8');
  writeFileSync(path.join(runDirectory, 'report-source.json'), `${JSON.stringify(reportSource || { source: 'assistant-message', relativePath: null, issues: [] }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'command-metadata.json'), `${JSON.stringify(commandMetadata, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'terminal.json'), `${JSON.stringify(terminal, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'infrastructure-status.json'), `${JSON.stringify(infrastructureStatus, null, 2)}\n`, 'utf8');
  if (discovery) writeFileSync(path.join(runDirectory, 'skill-discovery.json'), `${JSON.stringify(discovery, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'model-command-evidence.json'), `${JSON.stringify(modelCommandEvidence, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'report-diagnostics.json'), `${JSON.stringify(reportDiagnostics || { warnings: [], blockingIssues: [] }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'nested-session-evidence.json'), `${JSON.stringify(nestedSessionEvidence || { ok: false, issues: ['missing nested session evidence'] }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'agent-topology.json'), `${JSON.stringify(agentTopology || { ok: false, issues: ['missing agent topology evidence'] }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'parent-boundary-evidence.json'), `${JSON.stringify(parentBoundaryEvidence || { ok: false, issues: ['missing parent boundary evidence'] }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'child-report-relay-evidence.json'), `${JSON.stringify(childReportRelayEvidence || { ok: false, issues: ['missing child report relay evidence'] }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'runtime-config.json'), `${JSON.stringify(runtimeConfig || null, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'scenario-assertion.json'), `${JSON.stringify(scenarioAssertion, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'postflight.json'), `${JSON.stringify(postflight, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(runDirectory, 'oracle.json'), `${JSON.stringify(oracle, null, 2)}\n`, 'utf8');

  const skillSources = skillMaterialization
    ? skillMaterialization.copiedManifest.files.map((entry) => ({ path: `.opencode/skills/${entry.path}`, sha256: entry.sha256, bytes: entry.bytes }))
    : [];
  const manifest = {
    scenario: scenario.id,
    artifacts: regularFilesUnder(runDirectory)
      .filter((relativePath) => relativePath !== 'manifest.json')
      .map((relativePath) => artifactEntry(runDirectory, relativePath)),
    sources: [
      ...fixture.sourceManifest.files,
      ...skillSources,
    ],
    fixtureSha256: fixture.sourceManifest.sha256,
    skillSha256: skillMaterialization?.copiedHash || null,
  };
  writeFileSync(path.join(runDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { runDirectory, manifest };
}

export function buildScenarioPrompt({ scenario, skillSourcePath, productTargetPath }) {
  return [
    scenario.prompt,
    '',
    'Use the current project skill `using-qa`, then continue through `qa-plan`, `qa-execute`, and `qa-conclude` in one QA run.',
    'Parent delegation boundary: make exactly one `task` call with subagent_type: "general"; use that same child for qa-plan, qa-execute, and qa-conclude. The parent must not inspect product files, run the verifier, generate the report, or create additional QA children.',
    'Report output discipline: the child must return the complete child report as plain report text only through its task result. The child must not include literal `<task_result>` or `</task_result>` tags; the task tool supplies the wrapper. After the one `task` call completes, the parent must extract the full report content inside `<task_result>` and use that content as the entire final assistant message, verbatim. This parent relay is the final message. No summary, rewrite, reformat, normalization, omission, reordering, prefix, suffix, or additional commentary is allowed. Both outputs must contain exactly one standalone unprefixed line `Overall Status: <workflow-selected-status>`; replace the placeholder. Markdown heading, list, emphasis, or table forms are not substitutes.',
    'Artifact/prerequisite discipline: must not write, create, modify, or cite any report or artifact under the product target, including qa-report.md. Do not run the verifier when a named required prerequisite is absent.',
    `Supplied skill source path: ${skillSourcePath}`,
    `Resolved skill source path: ${skillSourcePath}`,
    `Supplied product target path: ${productTargetPath}`,
    `Resolved product target path: ${productTargetPath}`,
    `Project verification command: ${scenario.product.verifyCommand.join(' ')}`,
    `Traceability contract: child task result and parent final message must include every supplied neutral ID exactly as written and must not omit or rename them: ${scenario.requiredEvidence.join(', ')}. Link them using Risk → Verification → Evidence → Status.`,
    scenario.missingPrerequisite ? `The product requirement names this critical prerequisite artifact: ${scenario.missingPrerequisite}.` : '',
    'Return the final Markdown QA report as the final assistant message with a canonical `Overall Status:` marker selected by the QA workflow.',
  ].filter(Boolean).join('\n');
}

function terminalMetadata({ startedAtMs, endedAtMs, timeoutMs, result, cwd }) {
  return {
    platform: process.platform,
    node: process.version,
    cwd,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    timeoutMs,
    exitCode: result.status,
    signal: result.signal || null,
    spawnError: result.error?.message || null,
    stdoutBytes: result.stdout?.byteLength || 0,
    stderrBytes: result.stderr?.byteLength || 0,
  };
}

export function executeScenarioOracle({ scenario, productRoot }) {
  const result = spawnSync(scenario.product.verifyCommand[0], scenario.product.verifyCommand.slice(1), {
    cwd: productRoot,
    env: { ...process.env },
    encoding: 'utf8',
  });
  const exitCode = result.status;
  return {
    checkedAfterModel: true,
    command: scenario.product.verifyCommand,
    cwd: productRoot,
    expectedExitCode: scenario.expectedVerificationExitCode,
    exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    spawnError: result.error?.message || null,
    matchesExpectedExitCode: exitCode === scenario.expectedVerificationExitCode,
  };
}

export function capturePostflight({ productRoot, skillRoot, runtimeConfig, preProduct, preSkill, scenario }) {
  const postProduct = hashDirectory(productRoot);
  const postSkill = hashDirectory(skillRoot);
  const postRuntimeConfigSha256 = runtimeConfig?.configPath && existsSync(runtimeConfig.configPath) ? fileSha256(runtimeConfig.configPath) : null;
  const productUnchanged = preProduct.sha256 === postProduct.sha256;
  const skillUnchanged = preSkill.sha256 === postSkill.sha256;
  const runtimeConfigUnchanged = runtimeConfig ? runtimeConfig.sha256 === postRuntimeConfigSha256 : false;
  const scopedDiff = runGit(productRoot, ['diff', '--', scenario.product.changedPath]);
  const gitStatus = runGit(productRoot, ['status', '--short']);
  const integrityIssues = [];
  if (!productUnchanged) integrityIssues.push('product target files changed after model run');
  if (!skillUnchanged) integrityIssues.push('copied skill files changed after model run');
  if (!runtimeConfigUnchanged) integrityIssues.push('runtime config changed after model run');
  if (scopedDiff.error || scopedDiff.status !== 0) integrityIssues.push(`post-run git diff failed: ${scopedDiff.stderr.trim() || scopedDiff.error?.message}`);
  if (gitStatus.error || gitStatus.status !== 0) integrityIssues.push(`post-run git status failed: ${gitStatus.stderr.trim() || gitStatus.error?.message}`);
  return {
    preProductHash: preProduct.sha256,
    postProductHash: postProduct.sha256,
    preSkillHash: preSkill.sha256,
    postSkillHash: postSkill.sha256,
    preRuntimeConfigHash: runtimeConfig?.sha256 || null,
    postRuntimeConfigHash: postRuntimeConfigSha256,
    productUnchanged,
    skillUnchanged,
    runtimeConfigUnchanged,
    scopedDiff: {
      status: scopedDiff.status,
      stdout: scopedDiff.stdout,
      stderr: scopedDiff.stderr,
      error: scopedDiff.error?.message || null,
    },
    gitStatus: {
      status: gitStatus.status,
      stdout: gitStatus.stdout,
      stderr: gitStatus.stderr,
      error: gitStatus.error?.message || null,
    },
    integrityIssues,
  };
}

export function runOpenCodeScenario({ scenario, model, agent, artifactRoot, packRoot, timeoutMs = Number(process.env.QA_SKILL_TIMEOUT_MS || defaultTimeoutMs) }) {
  const runInputValidation = validateRunInputs({ model, agent });
  assert.equal(runInputValidation.ok, true, `invalid OpenCode run inputs: ${runInputValidation.issues.join('; ')}`);
  const invocation = defaultOpenCodeInvocation();
  assert.equal(invocation.shellSafe, true, `unsafe OpenCode invocation: ${invocation.issues.join('; ')}`);
  const runRoot = mkdtempSync(path.join(tmpdir(), `qa-functional-${scenario.id}-`));
  let keepRunRoot = false;
  let artifactDirectory = null;
  try {
    const skillMaterialization = materializeCurrentSkill({ packRoot, runRoot });
    const runtimeConfig = materializeRuntimeConfig({ projectRoot: skillMaterialization.projectRoot, model });
    const fixture = createScenarioRepository({ scenario, projectRoot: skillMaterialization.projectRoot });
    const discovery = validateProjectSkillDiscovery({
      projectRoot: skillMaterialization.projectRoot,
      isolatedRoot: path.join(runRoot, 'discovery-home'),
      invocation,
    });
    assert.equal(discovery.ok, true, `project skill discovery failed: ${JSON.stringify(discovery)}`);
    const preProduct = hashDirectory(fixture.root);
    const preSkill = hashDirectory(skillMaterialization.skillRoot);
    const prompt = buildScenarioPrompt({
      scenario,
      skillSourcePath: path.join(skillMaterialization.projectRoot, '.opencode', 'skills'),
      productTargetPath: fixture.root,
    });
    const args = [
      'run',
      '--pure',
      '--dir', skillMaterialization.projectRoot,
      '--model', model,
      '--agent', agent,
      '--format', 'json',
    ];
    const env = createRuntimeOpenCodeEnv();
    const startedAtMs = Date.now();
    const result = spawnSync(invocation.command, args, {
      cwd: skillMaterialization.projectRoot,
      env,
      input: Buffer.from(prompt, 'utf8'),
      encoding: 'buffer',
      shell: false,
      maxBuffer: 1024 * 1024 * 50,
      timeout: timeoutMs,
    });
    const endedAtMs = Date.now();
    const postflight = capturePostflight({
      productRoot: fixture.root,
      skillRoot: skillMaterialization.skillRoot,
      runtimeConfig,
      preProduct,
      preSkill,
      scenario,
    });
    const oracle = executeScenarioOracle({ scenario, productRoot: fixture.root });

    const rawStdout = result.stdout || Buffer.alloc(0);
    const stderr = (result.stderr || Buffer.alloc(0)).toString('utf8');
    const { events, errors } = parseJsonlStrict(rawStdout);
    const parentSessionId = extractParentSessionId(events);
    const parentBoundaryEvidence = buildParentBoundaryEvidence({ events, parentSessionId });
    const childSessionIds = extractTaskSessionIds(events);
    const exportResult = childSessionIds.length === 1
      ? exportNestedSession({ sessionId: childSessionIds[0], projectRoot: skillMaterialization.projectRoot, env, invocation })
      : { status: null, stdout: '', stderr: '', error: null, json: null };
    const nestedSessionEvidence = childSessionIds.length === 1
      ? buildNestedSessionEvidence({
        sessionId: childSessionIds[0],
        parentSessionId,
        exportJson: exportResult.json,
        expectedCommand: scenario.product.verifyCommand.join(' '),
      })
      : { ok: false, sessionId: null, parentSessionId, issues: [`expected exactly one child session, found ${childSessionIds.length}`], selectedToolEvents: [] };
    const agentTopology = buildAgentTopologyEvidence({
      parentSessionId,
      childSessionIds,
      nestedSessionEvidence,
      requestedModel: model,
      expectedAgent: 'general',
      exportResult,
    });
    const finalMessage = extractFinalText(events);
    const taskResultReport = extractTaskResultReport({ events, parentSessionId });
    const finalText = taskResultReport.text;
    const childReportRelayEvidence = buildChildReportRelayEvidence({
      childText: taskResultReport.text,
      parentText: finalMessage,
      expectedVerdict: scenario.expectedVerdict,
      deliveredText: finalText,
    });
    if (taskResultReport.issues.length > 0) {
      childReportRelayEvidence.deliveryIssues.push(...taskResultReport.issues);
      childReportRelayEvidence.deliveryOk = false;
      childReportRelayEvidence.issues.push(...taskResultReport.issues);
    }
    const reportSource = buildDeliveredReportAuthorityEvidence({
      authoritativeText: finalText,
      projectRoot: skillMaterialization.projectRoot,
    });
    const qaVerdict = extractQaVerdict(finalText);
    const modelCommandEvidence = extractModelCommandEvidence({ events: nestedSessionEvidence.selectedToolEvents || [], expectedCommand: scenario.product.verifyCommand.join(' ') });
    const reportDiagnostics = analyzeReportDiagnostics(finalText);
    const infrastructureStatus = summarizeInfrastructure({
      spawnError: result.error || null,
      timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
      exitCode: result.status,
      jsonlErrors: errors,
      finalText,
      qaVerdict,
    });
    const commandMetadata = redactCommandMetadata({ command: invocation.command, args, env, prompt });
    const terminal = terminalMetadata({ startedAtMs, endedAtMs, timeoutMs, result, cwd: skillMaterialization.projectRoot });
    const scenarioAssertion = evaluateScenarioOutcome({ scenario, qaVerdict, finalText, infrastructureStatus, oracle, postflight, modelCommandEvidence, reportDiagnostics, agentTopology, parentBoundaryEvidence, childReportRelayEvidence, reportAuthorityEvidence: reportSource });
    const artifacts = writeRunArtifacts({
      artifactRoot,
      scenario,
      fixture,
      skillMaterialization,
      commandMetadata,
      terminal,
      rawStdout,
      stderr,
      events,
      finalMessage,
      finalText,
      reportSource,
      qaVerdict,
      infrastructureStatus,
      scenarioAssertion,
      modelCommandEvidence,
      reportDiagnostics,
      nestedSessionEvidence,
      agentTopology,
      parentBoundaryEvidence,
      childReportRelayEvidence,
      runtimeConfig,
      postflight,
      discovery,
      oracle: {
        ...oracle,
        scenarioId: scenario.id,
        expectedVerdict: scenario.expectedVerdict,
      },
    });
    artifactDirectory = artifacts.runDirectory;

    if (!scenarioAssertion.passed) {
      throw new Error(`scenario assertion failed: ${scenarioAssertion.errors.join('; ')}`);
    }
    return { scenario, fixture, artifacts, qaVerdict, infrastructureStatus, agentTopology };
  } catch (error) {
    keepRunRoot = true;
    error.message = `${error.message}${artifactDirectory ? `\nArtifact directory retained: ${artifactDirectory}` : ''}\nTemporary run root retained: ${runRoot}`;
    throw error;
  } finally {
    if (!keepRunRoot) rmSync(runRoot, { recursive: true, force: true });
  }
}
