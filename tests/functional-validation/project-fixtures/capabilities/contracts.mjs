import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const fixtureOnlyCapabilityTerms = Object.freeze([
  'm6-node-fixture',
  'm6-python-fixture',
  'm6-go-fixture',
  'm6-java-fixture',
  'm6-api-fixture',
  'm6-cli-fixture',
  'm6-malicious-fixture',
]);

const recognizedFileNames = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'tox.ini', 'go.mod', 'pom.xml', 'build.gradle', 'openapi.json', 'openapi.yaml', 'openapi.yml', 'cli-entry.json']);
const prunedDiscoveryDirectories = new Set(['node_modules', '.git', '.qa', '.venv', 'venv', 'vendor', 'dist', 'build', 'target', '.gradle', 'coverage', '.cache', 'out', 'generated']);
const resourceDeclarationStates = new Set(['declared', 'missing', 'ambiguous', 'undeclared', 'malformed', 'unsafe']);
const sharedKinds = new Set(['database', 'port', 'file', 'credential', 'fixture', 'environment', 'cache', 'service', 'external-system']);
const maxFallbackDirectoryDepth = 8;
const maxRecognizedArtifacts = 256;
const maxRecognizedArtifactBytes = 1048576;
const executionLog = [];
const createdWorkspaceRoots = new Set();

export function createCapabilityWorkspace(prefix = 'qa-skill-m6-capabilities-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const targetRoot = path.join(root, 'target');
  const artifactRoot = path.join(root, 'artifacts');
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  createdWorkspaceRoots.add(realpathSync(root));
  executionLog.length = 0;
  return deepFreeze({ root, targetRoot, artifactRoot });
}

export function removeCapabilityWorkspace(workspace) {
  const root = safeRealpath(workspace?.root);
  if (root.ok && createdWorkspaceRoots.has(root.path)) {
    rmSync(root.path, { recursive: true, force: true });
    createdWorkspaceRoots.delete(root.path);
  }
  executionLog.length = 0;
}

export function executionLogSnapshot() {
  return Object.freeze([...executionLog]);
}

export function writeProjectFile(root, relativePath, content) {
  const resolved = resolveSafePath({ root, relativePath, allowMissingLeaf: true });
  if (!resolved.ok) throw new Error(`unsafe project fixture write rejected: ${resolved.reason}`);
  if (resolved.kind !== 'missing' && resolved.kind !== 'file') throw new Error(`unsafe project fixture write rejected: existing leaf is not a regular file`);
  mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
  writeFileSync(resolved.absolutePath, String(content));
  return resolved.absolutePath;
}

export function hashText(content) {
  return createHash('sha256').update(String(content), 'utf8').digest('hex');
}

export function discoverProjectCapabilities({ targetRoot, artifactPaths } = {}) {
  const diagnostics = [];
  const evidence = [];
  const capabilities = [];
  const candidates = [];
  const root = safeRealpath(targetRoot);
  if (!root.ok) return deepFreeze({ root: blockedRootRecord(targetRoot), evidence: [], capabilities: [], candidates: [], diagnostics: ['invalid target root'], execution_log: executionLogSnapshot() });
  const discovered = artifactPaths ? { paths: artifactPaths, blocked: [] } : listRecognizedArtifacts(targetRoot, diagnostics);
  const paths = discovered.paths;
  evidence.push(...discovered.blocked);
  const seenCapabilities = new Set();

  for (const relativePath of paths) {
    const artifact = readRecognizedArtifact({ targetRoot, relativePath });
    if (!artifact.ok) {
      diagnostics.push(artifact.reason);
      evidence.push(artifact.blocked ?? rejectedPathEvidence(relativePath, artifact.reason));
      continue;
    }
    evidence.push(artifact.evidence);
    const adapted = adaptArtifact(artifact, diagnostics);
    for (const capability of adapted.capabilities) {
      const key = `${capability.kind}:${capability.adapter}`;
      if (seenCapabilities.has(key)) continue;
      seenCapabilities.add(key);
      capabilities.push(deepFreeze({ ...capability, evidence_refs: [artifact.evidence.id] }));
    }
    candidates.push(...adapted.candidates.map((candidate) => {
      const identity = hashText(`${artifact.evidence.id}:${stableStringify({ purpose: candidate.purpose, argv_hint: candidate.argv_hint, script_metadata: candidate.script_metadata, required_tool: candidate.required_tool, toolchain_basis: candidate.toolchain_basis })}`);
      return deepFreeze({ ...candidate, id: `candidate-${identity}`, source_evidence_refs: [artifact.evidence.id] });
    }));
  }

  return deepFreeze({ evidence, capabilities, candidates, diagnostics, execution_log: executionLogSnapshot() });
}

export function planNonWebVerification(discovery) {
  const hasCli = discovery.capabilities.some((capability) => capability.kind === 'cli');
  const hasApi = discovery.capabilities.some((capability) => capability.kind === 'api');
  return deepFreeze({
    mandatoryBrowserCandidate: false,
    plannedLayers: Object.freeze([hasCli ? 'Static/unit' : null, hasApi ? 'API/integration' : null].filter(Boolean)),
    browserOmission: hasCli || hasApi ? 'No browser/Playwright candidate is mandatory because only CLI/API capability was observed' : 'No browser capability observed',
    projectFailure: false,
  });
}

export function missingToolBlocker({ verificationId, requiredTool }) {
  const verification = safeLogicalId(verificationId) ? verificationId : 'invalid-verification';
  const tool = safeLogicalId(requiredTool) ? requiredTool : 'invalid-tool';
  const diagnostics = [];
  if (verification !== verificationId) diagnostics.push('unsafe verification identifier rejected');
  if (tool !== requiredTool) diagnostics.push('unsafe tool identifier rejected');
  return deepFreeze({
    status: 'BLOCKED',
    affected_verification: verification,
    missing_prerequisite: `already-installed local tool available on PATH: ${tool}`,
    rerun_condition: `Make already-installed local tool ${tool} available, then rerun verification ${verification}`,
    diagnostics: Object.freeze(diagnostics),
    install_recommendation: false,
    human_gate_substitution: false,
  });
}

export function classifyCandidateSafety(candidate, { missingPrerequisite } = {}) {
  const argv = Array.isArray(candidate.argv_hint) ? candidate.argv_hint.map((part) => String(part)) : [];
  const text = `${argv.join(' ')} ${candidate.script_metadata?.content ?? ''} ${candidate.purpose ?? ''}`.toLowerCase();
  const reasons = [];
  if (!isKnownLocalCheck(argv, candidate.script_metadata, candidate.toolchain_basis)) reasons.push('unknown-safety');
  if (/[;&|`$<>]/.test(`${argv.join(' ')} ${candidate.script_metadata?.content ?? ''}`)) reasons.push('compound-shell');
  if (/\b(install|update|download|add)\b/.test(text)) reasons.push('dependency-install/update/download');
  if (/\b(curl|wget|http|https|network|fetch)\b/.test(text)) reasons.push('network');
  if (/(secret|token|credential|password|apikey|api_key)/.test(text)) reasons.push('credential/secret');
  if (/\b(prod|production|sensitive)\b/.test(text)) reasons.push('production/sensitive');
  if (/\b(rm\s+-rf|del\s+\/|destroy|drop\s+database|delete)\b/.test(text)) reasons.push('destructive/irreversible');
  if (/\b(watch|serve|daemon|forever|long-running)\b/.test(text)) reasons.push('long-running');
  if (/\b(paid|billing|charge)\b/.test(text)) reasons.push('paid');
  if (/\b(external-service|stripe|aws|gcp|azure)\b/.test(text)) reasons.push('external-service');
  if (/\b(scope|outside-target|parent-directory)\b/.test(text)) reasons.push('scope-expanding');
  if (candidate.policy_label === 'UNKNOWN_SAFETY' && !reasons.includes('unknown-safety')) reasons.push('unknown-safety');

  const humanGate = reasons.length === 0 ? null : deepFreeze({
    reason: [...new Set(reasons)].join(', '),
    blocked_action: redactSensitiveAction(argv.join(' ') || candidate.purpose || 'candidate action'),
    exact_question: `Do you authorize this ${reasons.join(', ')} candidate to execute?`,
    default_if_no_answer: 'do_not_execute',
  });
  const blocker = missingPrerequisite ? missingToolBlocker(missingPrerequisite) : null;
  return deepFreeze({
    policy_label: humanGate ? 'HUMAN_GATE_REQUIRED' : 'LOCAL_EXISTING_CHECK_CANDIDATE',
    execution_state: 'UNEXECUTED',
    human_gate: humanGate,
    blocker,
  });
}

export function immutablePromptPlan({ suppliedTarget, suppliedHostLimit, manifest = {} } = {}) {
  const argv = ['node', '--test'];
  const manifestName = minimizeUntrustedIdentifier(manifest.name, 'manifest');
  const candidate = deepFreeze({
    target: suppliedTarget,
    scope: 'supplied-target-only',
    mode: 'PROJECT_QA_ONLY',
    roles: ['Project QA Coordinator', 'Module QA Agent'],
    command_policy: 'M6_PLANNING_ONLY',
    gate_policy: 'HUMAN_GATE_REQUIRED_FOR_UNSAFE',
    host_limit: suppliedHostLimit,
    argv_hint: argv,
    execution_state: 'UNEXECUTED',
    source_manifest_name: manifestName.display,
    source_manifest_name_sha256: manifestName.sha256,
    source_manifest_name_bytes: manifestName.bytes,
    embedded_instructions_recorded_as_untrusted_data: Boolean(manifest.agentInstructions || manifest.scripts),
  });
  return deepFreeze({ candidate, classification: classifyCandidateSafety({ argv_hint: Object.values(manifest.scripts ?? {}).flatMap((script) => String(script).split(/\s+/)), script_metadata: { content: JSON.stringify(manifest.scripts ?? {}) }, purpose: 'manifest candidate' }) });
}

export function scheduleModuleTasksM6({ tasks = [], hostLimit, artifactRoot } = {}) {
  const diagnostics = [];
  const effective = normalizeHostLimit(hostLimit);
  const taskStates = tasks.map((task, index) => validateTask(task, index, artifactRoot, diagnostics, effective));
  const serial = new Set();
  let ok = taskStates.every((task) => task.valid_authority);
  if (!detectUniqueTaskIds(taskStates, diagnostics)) {
    return deepFreeze({
      ok: false,
      effective_host_limit: effective.limit,
      fallback_reason: effective.reason,
      waves: Object.freeze([]),
      diagnostics: Object.freeze(diagnostics),
      task_states: Object.freeze(taskStates),
      schedule_authorizes_commands: false,
    });
  }
  for (const task of taskStates) {
    if (task.force_serial) {
      serial.add(task.task_id);
      addSerialReason(task, 'force-serial due to invalid authority or unsafe planning input');
    }
  }
  ok = detectPathCollisions(taskStates, serial, diagnostics) && ok;

  for (let left = 0; left < taskStates.length; left += 1) {
    for (let right = left + 1; right < taskStates.length; right += 1) {
      const shared = taskStates[left].resources.filter((resource) => taskStates[right].resources.includes(resource));
      const sharedMutable = shared.filter((resource) => sharedKinds.has(resource.split(':')[0]));
      if (sharedMutable.length > 0 && !validDistinctIsolation(taskStates[left], taskStates[right])) {
        serial.add(taskStates[left].task_id);
        serial.add(taskStates[right].task_id);
        addSerialReason(taskStates[left], 'shared mutable resource without distinct isolation evidence');
        addSerialReason(taskStates[right], 'shared mutable resource without distinct isolation evidence');
        diagnostics.push(`shared mutable resources serialize without distinct isolation evidence: ${taskStates[left].task_id}, ${taskStates[right].task_id}`);
      } else if (sharedMutable.length > 0) {
        addParallelReason(taskStates[left], `shared resources have distinct validated isolation evidence, host bound ${effective.limit}, and separate safe paths`);
        addParallelReason(taskStates[right], `shared resources have distinct validated isolation evidence, host bound ${effective.limit}, and separate safe paths`);
      }
    }
  }

  for (const task of taskStates) {
    if (!serial.has(task.task_id) && task.resources.length > 0 && task.parallel_eligible_reasons.length === 0) {
      addParallelReason(task, `disjoint declared resources, host bound ${effective.limit}, and separate safe result and artifact paths`);
    }
  }

  const remaining = taskStates.map((task) => task.task_id);
  const waves = [];
  while (remaining.length > 0) {
    const current = [];
    for (let index = 0; index < remaining.length && current.length < effective.limit;) {
      const taskId = remaining[index];
      if (serial.has(taskId) && current.length > 0) break;
      if (current.length === 0 || !serial.has(taskId)) {
        current.push(taskId);
        remaining.splice(index, 1);
        if (serial.has(taskId)) break;
      } else {
        index += 1;
      }
    }
    if (current.length === 0) current.push(remaining.shift());
    waves.push(Object.freeze(current));
  }

  return deepFreeze({
    ok,
    effective_host_limit: effective.limit,
    fallback_reason: effective.reason,
    waves: Object.freeze(waves),
    diagnostics: Object.freeze(diagnostics),
    task_states: Object.freeze(taskStates),
    schedule_authorizes_commands: false,
  });
}

function listRecognizedArtifacts(root, diagnostics) {
  const output = [];
  const blocked = [];
  const pending = [{ relativeDirectory: '', depth: 0 }];
  if (!safeRealpath(root).ok) {
    diagnostics.push('target root is missing or invalid');
    return { paths: output, blocked };
  }
  while (pending.length > 0) {
    const { relativeDirectory, depth } = pending.pop();
    if (depth > maxFallbackDirectoryDepth) {
      blocked.push(blockedDiscoveryRecord('FALLBACK_DEPTH_LIMIT', relativeDirectory));
      diagnostics.push('fallback discovery depth limit reached');
      continue;
    }
    const absoluteDirectory = path.join(root, relativeDirectory);
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      diagnostics.push('directory read failed');
      continue;
    }
    const childDirectories = [];
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        if (recognizedFileNames.has(entry.name)) diagnostics.push(`recognized artifact is symlink or junction: ${reportableSourcePath(relativePath).source_path}`);
      } else if (entry.isDirectory()) {
        if (prunedDiscoveryDirectories.has(entry.name)) {
          diagnostics.push(`pruned bounded fallback scan directory: ${entry.name}`);
          continue;
        }
        childDirectories.push({ relativeDirectory: relativePath, depth: depth + 1 });
      } else if (entry.isFile() && recognizedFileNames.has(entry.name)) {
        if (output.length >= maxRecognizedArtifacts) {
          blocked.push(blockedDiscoveryRecord('FALLBACK_ARTIFACT_COUNT_LIMIT', relativePath));
          diagnostics.push('fallback discovery artifact count limit reached');
          return { paths: output.sort((left, right) => left.localeCompare(right)), blocked };
        }
        output.push(relativePath);
      } else if (!entry.isFile() && recognizedFileNames.has(entry.name)) {
        diagnostics.push(`recognized artifact is special file: ${reportableSourcePath(relativePath).source_path}`);
      }
    }
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) pending.push(childDirectories[index]);
  }
  return { paths: output.sort((left, right) => left.localeCompare(right)), blocked };
}

function readRecognizedArtifact({ targetRoot, relativePath }) {
  const safe = resolveSafePath({ root: targetRoot, relativePath, allowMissingLeaf: false });
  if (!safe.ok) return deepFreeze({ ok: false, reason: safe.reason });
  if (!recognizedFileNames.has(path.basename(safe.relativePath))) return deepFreeze({ ok: false, reason: 'unrecognized artifact' });
  if (safe.kind !== 'file') return deepFreeze({ ok: false, reason: 'recognized artifact is not a regular file' });
  if (safe.bytes > maxRecognizedArtifactBytes) return deepFreeze({ ok: false, reason: 'recognized artifact exceeds byte limit', blocked: blockedDiscoveryRecord('ARTIFACT_SIZE_LIMIT', safe.relativePath) });
  let content;
  try {
    content = readFileSync(safe.absolutePath);
  } catch (error) {
    return deepFreeze({ ok: false, reason: 'recognized artifact read failed' });
  }
  const contentHash = hashBuffer(content);
  const evidence = deepFreeze({
    id: `cap-${hashText(`${safe.relativePath}:${contentHash}`)}`,
    ...reportableSourcePath(safe.relativePath),
    sha256: contentHash,
    bytes: content.byteLength,
    reason: `recognized allowlisted artifact ${path.basename(safe.relativePath)}`,
    recognized_kind: recognizedKind(safe.relativePath),
    adapter: adapterFor(safe.relativePath),
    confidence: 'direct',
  });
  return deepFreeze({ ok: true, relativePath: safe.relativePath, displayPath: reportableSourcePath(safe.relativePath).source_path, text: content.toString('utf8'), evidence });
}

function adaptArtifact(artifact, diagnostics) {
  const adapter = artifact.evidence.adapter;
  const capabilities = [];
  const candidates = [];
  if (adapter === 'node') {
    let manifest = {};
    try { manifest = JSON.parse(artifact.text); } catch (error) { diagnostics.push(`malformed package.json ${artifact.displayPath}`); return { capabilities, candidates }; }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      diagnostics.push(`malformed package.json ${artifact.displayPath}: expected object`);
      return { capabilities, candidates };
    }
    capabilities.push({ kind: 'node', adapter, confidence: 'direct' });
    const npmBasis = npmToolchainBasis(manifest.packageManager);
    if (manifest.packageManager !== undefined && !npmBasis) diagnostics.push(`package-manager command basis is not established for ${artifact.displayPath}`);
    const scriptEntries = isPlainRecord(manifest.scripts) ? Object.entries(manifest.scripts) : [];
    if (manifest.scripts !== undefined && !isPlainRecord(manifest.scripts)) {
      diagnostics.push(`invalid package.json scripts ${artifact.displayPath}: expected object`);
    }
    for (const [scriptName, scriptContent] of scriptEntries) {
      if (!npmBasis) {
        diagnostics.push(`package-manager command basis is not established for ${artifact.displayPath}`);
        continue;
      }
      const scriptIdentifier = minimizeUntrustedIdentifier(scriptName, 'script');
      candidates.push(candidateRecord({ purpose: `package script ${scriptIdentifier.display}`, argv: ['npm', 'run', scriptIdentifier.display], requiredTool: 'npm', toolchainBasis: npmBasis, script: { name: scriptName, content: String(scriptContent), identifier: scriptIdentifier } }));
    }
    if (manifest.bin !== undefined) {
      const cliEntry = validateCliDeclaration(manifest.bin, artifact.displayPath, diagnostics);
      if (cliEntry.ok) capabilities.push({ kind: 'cli', adapter: 'cli', confidence: 'direct' });
    }
  } else if (adapter === 'python') {
    if (!/(\[project\]|\[tool\.|^\s*[-A-Za-z0-9_.]+(?:[=<>!~]|$)|from\s+setuptools|\[testenv\])/im.test(artifact.text)) {
      diagnostics.push(`invalid Python manifest ${artifact.displayPath}`);
      return { capabilities, candidates };
    }
    capabilities.push({ kind: 'python', adapter, confidence: 'direct' });
    if (/\[project\.scripts\]|console_scripts|entry_points/i.test(artifact.text)) capabilities.push({ kind: 'cli', adapter: 'cli', confidence: 'inferred' });
  } else if (adapter === 'go') {
    if (!/^\s*module\s+\S+/m.test(artifact.text)) { diagnostics.push(`invalid go.mod ${artifact.displayPath}`); return { capabilities, candidates }; }
    capabilities.push({ kind: 'go', adapter, confidence: 'direct' });
  } else if (adapter === 'java') {
    if (!/(<project[\s>]|plugins\s*\{|apply\s+plugin|group\s*=)/i.test(artifact.text)) { diagnostics.push(`invalid Java manifest ${artifact.displayPath}`); return { capabilities, candidates }; }
    capabilities.push({ kind: 'java', adapter, confidence: 'direct' });
  } else if (adapter === 'api') {
    if (!/("openapi"\s*:\s*"3\.|^\s*openapi:\s*3\.)/im.test(artifact.text)) { diagnostics.push(`invalid OpenAPI artifact ${artifact.displayPath}`); return { capabilities, candidates }; }
    capabilities.push({ kind: 'api', adapter, confidence: 'direct' });
  } else if (adapter === 'cli') {
    let manifest = {};
    try { manifest = JSON.parse(artifact.text); } catch (error) { diagnostics.push(`invalid CLI entry ${artifact.displayPath}`); return { capabilities, candidates }; }
    if (!isPlainRecord(manifest)) {
      diagnostics.push(`invalid CLI entry ${artifact.displayPath}: expected object`);
      return { capabilities, candidates };
    }
    const cliEntry = validateCliDeclaration(manifest.bin ?? manifest.entry, artifact.displayPath, diagnostics);
    if (!cliEntry.ok) {
      diagnostics.push(`invalid CLI entry ${artifact.displayPath}: missing nonempty bin or entry`);
      return { capabilities, candidates };
    }
    capabilities.push({ kind: 'cli', adapter, confidence: 'direct' });
  }
  return { capabilities, candidates };
}

function candidateRecord({ purpose, argv, requiredTool, toolchainBasis, script }) {
  const safety = classifyCandidateSafety({ argv_hint: argv, purpose, toolchain_basis: toolchainBasis, script_metadata: script ? { name: script.name, content: script.content } : null });
  const scriptBytes = script ? Buffer.byteLength(script.content, 'utf8') : 0;
  const scriptIdentifier = script?.identifier ?? minimizeUntrustedIdentifier(script?.name, 'script');
  return {
    id: `candidate-${hashText(stableStringify({ purpose, argv, requiredTool, toolchainBasis, script_name: scriptIdentifier }))}`,
    policy_label: safety.policy_label,
    execution_state: 'UNEXECUTED',
    purpose,
    argv_hint: argv,
    cwd_hint: '.',
    required_tool: requiredTool,
    toolchain_basis: toolchainBasis ? Object.freeze({ ...toolchainBasis }) : null,
    prerequisites: ['already-installed local tool available'],
    script_metadata: script ? Object.freeze({ name: scriptIdentifier.display, name_sha256: scriptIdentifier.sha256, name_bytes: scriptIdentifier.bytes, sha256: hashText(script.content), bytes: scriptBytes, safety_classification: safety.policy_label, safety_reasons: safety.human_gate?.reason ?? 'known-local-check' }) : null,
    human_gate: safety.human_gate,
  };
}

function recognizedKind(relativePath) {
  const base = path.basename(relativePath);
  if (base === 'package.json') return 'package.json';
  if (['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'tox.ini'].includes(base)) return 'Python manifest';
  if (base === 'go.mod') return 'go.mod';
  if (['pom.xml', 'build.gradle'].includes(base)) return 'Java manifest';
  if (/^openapi\.(json|ya?ml)$/.test(base)) return 'OpenAPI';
  if (base === 'cli-entry.json') return 'explicit CLI entry';
  return 'unknown';
}

function adapterFor(relativePath) {
  const kind = recognizedKind(relativePath);
  if (kind === 'package.json') return 'node';
  if (kind === 'Python manifest') return 'python';
  if (kind === 'go.mod') return 'go';
  if (kind === 'Java manifest') return 'java';
  if (kind === 'OpenAPI') return 'api';
  if (kind === 'explicit CLI entry') return 'cli';
  return 'unknown';
}

function validateTask(task, index, artifactRoot, diagnostics, effective) {
  const taskId = safeLogicalId(task.task_id) ? task.task_id : `invalid-task-${index + 1}`;
  const resources = [];
  const serialReasons = [];
  const parallelEligibleReasons = [];
  let forceSerial = false;
  let validAuthority = true;
  const addLocalSerialReason = (reason) => addReason(serialReasons, reason);
  if (taskId !== task.task_id) {
    diagnostics.push(`task ${index + 1} unsafe task identifier rejected`);
    addLocalSerialReason('invalid authority: unsafe task identifier');
    forceSerial = true;
    validAuthority = false;
  }
  const declarationState = normalizeResourceDeclarationState(task.resource_declaration_state);
  if (declarationState !== 'declared') {
    diagnostics.push(`task ${index + 1} resource declaration state is not declared`);
    addLocalSerialReason(`invalid authority: ${declarationState} resource declaration state`);
    forceSerial = true;
    validAuthority = false;
  }
  const declaredResources = Array.isArray(task.declared_resources) ? task.declared_resources : [];
  if (declaredResources.length === 0) {
    diagnostics.push(`task ${index + 1} undeclared resources serialize by default`);
    addLocalSerialReason('invalid authority: undeclared resources serialize by default');
    forceSerial = true;
    validAuthority = false;
  }
  for (const resource of declaredResources) {
    const parsed = parseResourceId(resource);
    if (!parsed.ok) {
      diagnostics.push(`task ${index + 1} ${parsed.reason}`);
      addLocalSerialReason(`invalid authority: ${parsed.reason}`);
      forceSerial = true;
      validAuthority = false;
    } else {
      resources.push(parsed.value);
    }
  }
  const resultPath = validateOutputPath(task.result_path, artifactRoot, `task ${index + 1} result output path`, diagnostics);
  const artifactPath = validateOutputPath(task.artifact_path, artifactRoot, `task ${index + 1} artifact output path`, diagnostics);
  if (!resultPath.ok) addLocalSerialReason('invalid authority: output path unsafe or missing');
  if (!artifactPath.ok) addLocalSerialReason('invalid authority: output path unsafe or missing');
  validAuthority = validAuthority && resultPath.ok && artifactPath.ok;
  const isolationKey = validateIsolationKey(task.isolation_key, index, diagnostics);
  if (task.isolation_key !== undefined && task.isolation_key !== null && !isolationKey.ok) {
    forceSerial = true;
    validAuthority = false;
    addLocalSerialReason('invalid authority: unsafe isolation key');
  }
  const isolationEvidence = validateIsolationEvidence(task.isolation_evidence, artifactRoot, diagnostics);
  if (task.isolation_evidence && !isolationEvidence) {
    forceSerial = true;
    validAuthority = false;
    addLocalSerialReason('invalid authority: isolation evidence invalid');
  }
  if (effective.reason) addLocalSerialReason('host limit fallback constrains task to serial host bound 1');
  return { task_id: taskId, resources, force_serial: forceSerial || !resultPath.ok || !artifactPath.ok, valid_authority: validAuthority, resource_declaration_state: declarationState, result_path: resultPath.path, result_path_identity: resultPath.identity, artifact_path: artifactPath.path, artifact_path_identity: artifactPath.identity, result_path_ok: resultPath.ok, artifact_path_ok: artifactPath.ok, isolation_key: isolationKey.value, isolation_evidence: isolationEvidence, serial_reasons: serialReasons, parallel_eligible_reasons: parallelEligibleReasons };
}

function validateOutputPath(relativePath, root, label, diagnostics) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    diagnostics.push(`${label} is missing`);
    return { ok: false, path: null, identity: null };
  }
  const safe = resolveSafePath({ root, relativePath, allowMissingLeaf: true });
  if (!safe.ok || safe.kind !== 'missing') {
    diagnostics.push(`${label} unsafe`);
    return { ok: false, path: null, identity: null };
  }
  return { ok: true, path: safe.relativePath, identity: safe.identity };
}

function validateIsolationEvidence(record, artifactRoot, diagnostics) {
  if (!record) return null;
  const safe = resolveSafePath({ root: artifactRoot, relativePath: record.path, allowMissingLeaf: false });
  if (!safe.ok || safe.kind !== 'file') {
    diagnostics.push('isolation evidence unsafe or missing');
    return null;
  }
  let content;
  try {
    content = readFileSync(safe.absolutePath);
  } catch (error) {
    diagnostics.push('isolation evidence read failed');
    return null;
  }
  const actual = { path: safe.relativePath, sha256: hashBuffer(content), bytes: content.byteLength };
  if (actual.sha256 !== record.sha256 || actual.bytes !== record.bytes) {
    diagnostics.push('isolation evidence hash/byte mismatch');
    return null;
  }
  return deepFreeze({ ...actual, identity: hashText(`${actual.path}:${actual.sha256}:${actual.bytes}`) });
}

function validDistinctIsolation(left, right) {
  return Boolean(left.isolation_key && right.isolation_key && left.isolation_key !== right.isolation_key && left.isolation_evidence && right.isolation_evidence && left.isolation_evidence.path !== right.isolation_evidence.path && left.isolation_evidence.identity !== right.isolation_evidence.identity);
}

function normalizeHostLimit(limit) {
  if (Number.isInteger(limit) && limit > 0 && Number.isFinite(limit)) return { limit, reason: null };
  return { limit: 1, reason: 'host-declared limit missing or invalid; fell back to 1' };
}

function resolveSafePath({ root, relativePath, allowMissingLeaf }) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized.ok) return deepFreeze({ ok: false, reason: normalized.reason });
  const rootPath = safeRealpath(root);
  if (!rootPath.ok) return deepFreeze({ ok: false, reason: 'invalid root' });
  const canonicalRoot = rootPath.path;
  if (hasSymlinkComponent(canonicalRoot, normalized.path)) return deepFreeze({ ok: false, reason: 'symlink or junction rejected' });
  const absolutePath = path.resolve(root, normalized.path);
  if (!isInside(absolutePath, canonicalRoot)) return deepFreeze({ ok: false, reason: 'path escapes root before realpath' });
  const parent = path.dirname(absolutePath);
  const parentPath = safeRealpath(existsSync(parent) ? parent : nearestExistingParent(parent));
  if (!parentPath.ok) return deepFreeze({ ok: false, reason: 'parent realpath unavailable' });
  const canonicalParent = parentPath.path;
  if (!isInside(canonicalParent, canonicalRoot)) return deepFreeze({ ok: false, reason: 'parent realpath escapes root' });
  const identityPath = path.resolve(canonicalRoot, normalized.path);
  const identity = hashText(canonicalIdentityPath(identityPath));
  if (!existsSync(absolutePath)) {
    if (allowMissingLeaf) return deepFreeze({ ok: true, absolutePath, relativePath: normalized.path, kind: 'missing', identity });
    return deepFreeze({ ok: false, reason: 'path does not exist' });
  }
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    return deepFreeze({ ok: false, reason: 'lstat failed' });
  }
  if (stat.isSymbolicLink()) return deepFreeze({ ok: false, reason: 'symlink or junction rejected' });
  const realPath = safeRealpath(absolutePath);
  if (!realPath.ok) return deepFreeze({ ok: false, reason: 'realpath unavailable' });
  const real = realPath.path;
  if (!isInside(real, canonicalRoot)) return deepFreeze({ ok: false, reason: 'realpath escapes root' });
  if (stat.isFile()) return deepFreeze({ ok: true, absolutePath, relativePath: normalized.path, kind: 'file', bytes: stat.size, identity: hashText(canonicalIdentityPath(real)) });
  if (stat.isDirectory()) return deepFreeze({ ok: true, absolutePath, relativePath: normalized.path, kind: 'directory', identity: hashText(canonicalIdentityPath(real)) });
  return deepFreeze({ ok: false, reason: 'special file rejected' });
}

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return { ok: false, reason: 'empty path' };
  if (relativePath.includes('\0')) return { ok: false, reason: 'NUL byte in path' };
  const slashPath = relativePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || /^[A-Za-z]:/.test(slashPath)) return { ok: false, reason: 'absolute, drive-qualified, or UNC path' };
  const parts = slashPath.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) return { ok: false, reason: 'traversal segment' };
  if (parts.length === 0) return { ok: false, reason: 'empty normalized path' };
  return { ok: true, path: parts.join('/') };
}

function nearestExistingParent(directory) {
  let current = directory;
  while (!existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function detectPathCollisions(taskStates, serial, diagnostics) {
  let ok = true;
  const resultPaths = new Map();
  const artifactPaths = new Map();
    const recordCollision = (label, pathValue, firstTask, secondTask) => {
    ok = false;
    serial.add(firstTask);
    serial.add(secondTask);
    const firstState = taskStates.find((task) => task.task_id === firstTask);
    const secondState = taskStates.find((task) => task.task_id === secondTask);
    if (firstState) addSerialReason(firstState, `${label} path collision`);
    if (secondState) addSerialReason(secondState, `${label} path collision`);
    diagnostics.push(`${label} collision: ${firstTask}, ${secondTask}`);
  };
  for (const task of taskStates) {
    if (task.result_path_identity) {
      if (resultPaths.has(task.result_path_identity)) recordCollision('duplicate result path', task.result_path_identity, resultPaths.get(task.result_path_identity), task.task_id);
      resultPaths.set(task.result_path_identity, task.task_id);
    }
    if (task.artifact_path_identity) {
      if (artifactPaths.has(task.artifact_path_identity)) recordCollision('duplicate artifact path', task.artifact_path_identity, artifactPaths.get(task.artifact_path_identity), task.task_id);
      artifactPaths.set(task.artifact_path_identity, task.task_id);
    }
  }
  for (const [resultPath, resultTask] of resultPaths) {
    if (artifactPaths.has(resultPath)) recordCollision('result/artifact path', resultPath, resultTask, artifactPaths.get(resultPath));
  }
  return ok;
}

function detectUniqueTaskIds(taskStates, diagnostics) {
  const seen = new Map();
  let unique = true;
  taskStates.forEach((task, index) => {
    if (seen.has(task.task_id)) {
      unique = false;
      addSerialReason(taskStates[seen.get(task.task_id)], 'invalid authority: duplicate task identifier');
      addSerialReason(task, 'invalid authority: duplicate task identifier');
      diagnostics.push(`duplicate task identifier rejected at task ${seen.get(task.task_id) + 1} and task ${index + 1}`);
    } else {
      seen.set(task.task_id, index);
    }
  });
  return unique;
}

function parseResourceId(resource) {
  if (typeof resource !== 'string' || resource.length === 0) return { ok: false, reason: 'malformed resource id rejected' };
  if (/(secret|token|password|apikey|api_key|bearer|:\/\/|=|@)/i.test(resource)) return { ok: false, reason: 'secret-like resource id rejected' };
  const match = /^([-a-z]+):([A-Za-z0-9_.-]+)$/.exec(resource);
  if (!match) return { ok: false, reason: 'malformed resource id rejected' };
  const [, kind] = match;
  if (!sharedKinds.has(kind)) return { ok: false, reason: 'unknown resource kind rejected' };
  return { ok: true, value: resource };
}

function isKnownLocalCheck(argv, scriptMetadata, toolchainBasis) {
  const scriptContent = scriptMetadata?.content ? String(scriptMetadata.content).trim() : '';
  const joined = argv.join(' ');
  if (/^npm run (test|lint|typecheck)$/.test(joined)) {
    return Boolean(validNpmBasis(toolchainBasis)) && Boolean(scriptContent) && isKnownLocalCheck(scriptContent.split(/\s+/));
  }
  if (scriptContent && !isKnownLocalCheck(scriptContent.split(/\s+/))) return false;
  const known = [
    /^node --test(?: [A-Za-z0-9_./-]+)?$/,
    /^python -m pytest(?: [A-Za-z0-9_./-]+)?$/,
    /^go test \.\/\.\.\.$/,
    /^mvn test$/,
    /^gradle test$/,
    /^npm run (test|lint|typecheck)$/,
  ];
  return argv.length > 0 && known.some((pattern) => pattern.test(joined));
}

function redactSensitiveAction(value) {
  const redacted = String(value)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@')
    .replace(/(--?(?:token|secret|password|credential|api[_-]?key)(?:=|\s+))\S+/gi, '$1[REDACTED]')
    .replace(/\b(?:token|secret|password|credential|api[_-]?key)\b\S*/gi, '[REDACTED]');
  if (/(https?:\/\/|\brm\s+-rf\b|\bcurl\b|\bwget\b|&&|\|\||;)/i.test(redacted)) return '[REDACTED_UNSAFE_ACTION]';
  return redacted;
}

function safeRealpath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) return { ok: false, reason: 'empty path' };
  try {
    return { ok: true, path: realpathSync(targetPath) };
  } catch (error) {
    return { ok: false, reason: 'realpath failed' };
  }
}

function validateIsolationKey(value, index, diagnostics) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!safeLogicalId(value)) {
    diagnostics.push(`task ${index + 1} unsafe isolation key rejected`);
    return { ok: false, value: null };
  }
  return { ok: true, value };
}

function safeLogicalId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value) && !/(secret|token|password|credential|apikey|api_key|bearer|:\/\/|=|@)/i.test(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateCliDeclaration(value, relativePath, diagnostics) {
  if (isPlainRecord(value)) return validateCliDeclarationMap(value, relativePath, diagnostics);
  const minimized = minimizeUntrustedIdentifier(value, 'cli-entry');
  if (!nonEmptyString(value)) return { ok: false, minimized };
  if (!safeTargetRelativeDeclaration(value)) {
    diagnostics.push(`invalid CLI entry ${relativePath}: unsafe bin or entry rejected`);
    return { ok: false, minimized };
  }
  return { ok: true, minimized };
}

function validateCliDeclarationMap(value, relativePath, diagnostics) {
  const entries = Object.entries(value);
  if (entries.length === 0) return { ok: false, minimized: null };
  for (const [commandName, commandPath] of entries) {
    if (!safeLogicalId(commandName) || !safeTargetRelativeDeclaration(commandPath)) {
      diagnostics.push(`invalid CLI entry ${relativePath}: unsafe bin map rejected`);
      return { ok: false, minimized: null };
    }
  }
  return { ok: true, minimized: null };
}

function safeTargetRelativeDeclaration(value) {
  if (!nonEmptyString(value)) return false;
  const text = String(value);
  if (text.length > 160 || /(secret|token|password|credential|apikey|api_key|bearer|=|@)/i.test(text)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)) return false;
  return normalizeRelativePath(text).ok;
}

function npmToolchainBasis(packageManager) {
  if (typeof packageManager !== 'string') return null;
  const match = /^npm@([0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?)$/.exec(packageManager);
  if (!match || packageManager.length > 80 || /(secret|token|password|credential|apikey|api_key|bearer|=|@.*@|:\/\/)/i.test(match[1])) return null;
  return Object.freeze({ name: 'npm', version: match[1], source: 'packageManager' });
}

function validNpmBasis(value) {
  return Boolean(value && value.name === 'npm' && typeof value.version === 'string' && npmToolchainBasis(`npm@${value.version}`));
}

function normalizeResourceDeclarationState(value) {
  if (value === undefined || value === null || value === '') return 'missing';
  if (typeof value !== 'string') return 'malformed';
  if (/(secret|token|password|credential|apikey|api_key|bearer|:\/\/|=|@)/i.test(value)) return 'unsafe';
  return resourceDeclarationStates.has(value) ? value : 'malformed';
}

function rejectedPathEvidence(relativePath, reason) {
  const pathText = String(relativePath);
  return deepFreeze({
    ok: false,
    source_path: 'REJECTED_INPUT',
    path_identity: `rejected-path-${hashText(pathText)}`,
    path_bytes: Buffer.byteLength(pathText, 'utf8'),
    status: 'BLOCKED',
    reason: rejectedPathReason(reason),
  });
}

function blockedRootRecord(targetRoot) {
  const rootText = String(targetRoot ?? '');
  return deepFreeze({
    ok: false,
    target_root: 'REDACTED_TARGET_ROOT',
    target_root_identity: `target-root-${hashText(rootText)}`,
    target_root_bytes: Buffer.byteLength(rootText, 'utf8'),
    status: 'BLOCKED',
    reason: 'invalid target root',
    blocker_code: 'INVALID_TARGET_ROOT',
    rerun_condition: 'Supply a valid safe target root, then rerun Project QA',
  });
}

function blockedDiscoveryRecord(blockerCode, relativePath) {
  const pathText = String(relativePath ?? '');
  return deepFreeze({
    ok: false,
    source_path: 'BLOCKED_DISCOVERY_INPUT',
    source_path_identity: `source-path-${hashText(pathText)}`,
    source_path_bytes: Buffer.byteLength(pathText, 'utf8'),
    status: 'BLOCKED',
    reason: discoveryBlockerReason(blockerCode),
    blocker_code: blockerCode,
    rerun_condition: discoveryBlockerRerunCondition(blockerCode),
  });
}

function discoveryBlockerReason(blockerCode) {
  if (blockerCode === 'FALLBACK_DEPTH_LIMIT') return 'fallback discovery depth limit reached';
  if (blockerCode === 'FALLBACK_ARTIFACT_COUNT_LIMIT') return 'fallback discovery recognized artifact count limit reached';
  if (blockerCode === 'ARTIFACT_SIZE_LIMIT') return 'recognized artifact byte limit exceeded';
  return 'discovery blocker';
}

function discoveryBlockerRerunCondition(blockerCode) {
  if (blockerCode === 'FALLBACK_DEPTH_LIMIT') return 'Supply explicit safe Project Inventory artifact paths, then rerun Project QA';
  if (blockerCode === 'FALLBACK_ARTIFACT_COUNT_LIMIT') return 'Supply explicit safe Project Inventory artifact paths, then rerun Project QA';
  if (blockerCode === 'ARTIFACT_SIZE_LIMIT') return 'Reduce or split the artifact below 1048576 bytes, then rerun Project QA';
  return 'Resolve the discovery blocker, then rerun Project QA';
}

function canonicalIdentityPath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function reportableSourcePath(relativePath) {
  const pathText = String(relativePath);
  const metadata = {
    source_path_identity: `source-path-${hashText(pathText)}`,
    source_path_bytes: Buffer.byteLength(pathText, 'utf8'),
  };
  if (pathText.split('/').some((segment) => secretLike(segment))) {
    return { source_path: 'REDACTED_SOURCE_PATH', ...metadata };
  }
  return { source_path: pathText, ...metadata };
}

function rejectedPathReason(reason) {
  if (/traversal/i.test(reason)) return 'rejected unsafe target-relative artifact path: traversal';
  if (/absolute|drive-qualified|UNC/i.test(reason)) return 'rejected unsafe target-relative artifact path: absolute, drive-qualified, or UNC path';
  if (/NUL/i.test(reason)) return 'rejected unsafe target-relative artifact path: NUL byte';
  if (/unrecognized artifact/i.test(reason)) return 'rejected artifact outside recognized allowlist';
  return 'rejected unsafe artifact path';
}

function minimizeUntrustedIdentifier(value, label) {
  const text = value === undefined || value === null ? '' : String(value);
  const safe = safeLogicalId(text) && text.length <= 64;
  return {
    display: safe ? text : 'REDACTED_UNTRUSTED_IDENTIFIER',
    sha256: hashText(text),
    bytes: Buffer.byteLength(text, 'utf8'),
    label,
  };
}

function hasSymlinkComponent(canonicalRoot, relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  let current = canonicalRoot;
  for (const part of parts) {
    current = path.join(current, part);
    if (!existsSync(current)) return false;
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return true;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

function secretLike(value) {
  return /(secret|token|password|credential|apikey|api_key|bearer|:\/\/|=|@)/i.test(String(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function addSerialReason(task, reason) {
  addReason(task.serial_reasons, reason);
}

function addParallelReason(task, reason) {
  addReason(task.parallel_eligible_reasons, reason);
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
