import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyExecutionStatus,
  createIsolatedChildEnv,
  controlledProjectScenarios,
  copyProjectTree,
  fingerprintProjectTree,
  parseProjectScenarioArgs,
  runBoundedNodeProcess,
  runControlledProjectScenario,
  runRealProjectScenario,
  validateProjectRunAuthority,
  validateSafeNodeTestArgv,
} from './run-project-scenario.mjs';

function createArtifactRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function removeTree(root) {
  rmSync(root, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function refreshManifestArtifact(runDirectory, relativePath) {
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const manifest = readJson(manifestPath);
  const artifact = manifest.artifacts.find((entry) => entry.path === relativePath);
  const content = readFileSync(path.join(runDirectory, relativePath), 'utf8');
  artifact.sha256 = sha256Text(content);
  artifact.bytes = Buffer.byteLength(content, 'utf8');
  writeJson(manifestPath, manifest);
}

function refreshAllManifestArtifacts(runDirectory) {
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const manifest = readJson(manifestPath);
  for (const artifact of manifest.artifacts) {
    const content = readFileSync(path.join(runDirectory, artifact.path), 'utf8');
    artifact.sha256 = sha256Text(content);
    artifact.bytes = Buffer.byteLength(content, 'utf8');
  }
  const reportArtifact = manifest.artifacts.find((artifact) => artifact.path === 'project-qa-report.md');
  if (reportArtifact) {
    manifest.reportSha256 = reportArtifact.sha256;
    manifest.reportBytes = reportArtifact.bytes;
  }
  writeJson(manifestPath, manifest);
}

test('P2-M7-PASS-001 controlled all-evidence fixture produces authoritative PASS', async () => {
  const artifactRoot = createArtifactRoot('qa-skill-m7-pass-');
  try {
    assert.equal(Object.isFrozen(controlledProjectScenarios), true);
    assert.equal(Object.isFrozen(controlledProjectScenarios.pass), true);
    const result = await runControlledProjectScenario({ scenarioId: 'pass', artifactRoot, timeoutMs: 20000 });
    const authority = validateProjectRunAuthority(result.runDirectory);
    const manifest = readJson(path.join(result.runDirectory, 'manifest.json'));

    assert.equal(result.scenarioId, 'pass');
    assert.equal(result.status, 'PASS');
    assert.equal(result.reconciled.overallStatus, 'PASS');
    assert.equal(result.reconciled.coverageComplete, true);
    assert.deepEqual([...result.coveredImportantModules].sort(), ['auth', 'billing', 'shared-lib']);
    assert.ok(result.coveredKeyFlows.includes('KF-AUTH-BILLING-SHARED'));
    assert.equal(result.moduleResults.every((moduleResult) => moduleResult.status === 'PASS'), true);
    assert.equal(result.executionEvidence.every((entry) => entry.exitStatus === 0), true);
    assert.equal(authority.ok, true);
    assert.equal(authority.status, 'PASS');
    assert.ok(authority.manifestDiskMetadata.sha256);
    assert.deepEqual(manifest.requiredCoverage.importantModules, ['auth', 'billing', 'shared-lib']);
    assert.deepEqual(manifest.requiredCoverage.keyFlows, ['KF-AUTH-BILLING-SHARED']);
    assert.deepEqual(manifest.requiredCoverage.mustVerify, ['V-AUTH-SESSION', 'V-BILLING-TOTAL', 'V-SHARED-CONSISTENCY']);
    assert.equal(manifest.artifacts.some((artifact) => artifact.path === 'project-qa-report.md'), true);
    for (const artifact of manifest.artifacts) {
      assert.ok(artifact.kind);
      assert.equal(artifact.status, manifest.status);
      assert.equal(artifact.scenarioId, manifest.scenarioId);
      assert.equal(artifact.runId, manifest.runId);
      assert.equal(artifact.provenance.schema, 'qa-skill-m7-provenance-v1');
      assert.equal(artifact.provenance.snapshotFingerprint, manifest.snapshotFingerprint);
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isInteger(artifact.bytes));
    }
    assert.equal(result.executionEvidence.every((entry) => entry.verificationId && entry.status === 'PASS' && entry.stdoutSha256 && Number.isInteger(entry.stderrBytes)), true);
    assert.equal(readFileSync(path.join(result.runDirectory, 'project-qa-report.md'), 'utf8'), readFileSync(path.join(result.runDirectory, 'delivered-payload.md'), 'utf8'));
  } finally {
    removeTree(artifactRoot);
  }
});

test('P2-M7-FAIL-002 controlled billing assertion failure is product FAIL evidence', async () => {
  const artifactRoot = createArtifactRoot('qa-skill-m7-fail-');
  try {
    const result = await runControlledProjectScenario({ scenarioId: 'fail', artifactRoot, timeoutMs: 20000 });
    const authority = validateProjectRunAuthority(result.runDirectory);
    const billing = result.moduleResults.find((moduleResult) => moduleResult.moduleId === 'billing');

    assert.equal(result.status, 'FAIL');
    assert.equal(result.reconciled.overallStatus, 'FAIL');
    assert.equal(billing.status, 'FAIL');
    assert.ok(billing.evidence[0].exitStatus > 0);
    assert.match(billing.evidence[0].observation, /assert\.equal|AssertionError|billing total/i);
    assert.equal(result.reconciled.findings.some((finding) => finding.id === 'F-M7-BILLING-TOTAL' && finding.type === 'product'), true);
    assert.equal(result.reconciled.diagnostics.some((diagnostic) => /infrastructure/i.test(diagnostic)), false);
    assert.equal(authority.ok, true);
    assert.equal(authority.status, 'FAIL');
  } finally {
    removeTree(artifactRoot);
  }
});

test('P2-M7-BLOCKED-003 missing billing acceptance prerequisite blocks without spawning verifier', async () => {
  const artifactRoot = createArtifactRoot('qa-skill-m7-blocked-');
  try {
    const result = await runControlledProjectScenario({ scenarioId: 'blocked', artifactRoot, timeoutMs: 20000 });
    const authority = validateProjectRunAuthority(result.runDirectory);
    const billing = result.moduleResults.find((moduleResult) => moduleResult.moduleId === 'billing');
    const report = readFileSync(path.join(result.runDirectory, 'project-qa-report.md'), 'utf8');

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reconciled.overallStatus, 'BLOCKED');
    assert.equal(billing.status, 'BLOCKED');
    assert.equal(billing.evidence[0].exitStatus, 'NOT_RUN');
    assert.match(billing.findings[0].missingPrerequisite, /^acceptance\/billing-total\.md#AC-BILLING-TOTAL$/);
    assert.match(billing.findings[0].rerunCommand, /--scenario blocked/);
    assert.equal(result.executionEvidence.some((entry) => entry.argv?.includes('tests/billing-checkout.test.mjs')), false);
    assert.equal(result.reconciled.findings.some((finding) => finding.type === 'product'), false);
    assert.match(report, /^Overall Status: BLOCKED$/m);
    assert.match(report, /acceptance\/billing-total\.md#AC-BILLING-TOTAL/);
    assert.match(report, /node tests\/functional-validation\/run-project-scenario\.mjs --scenario blocked --artifact-root/);
    assert.equal(authority.ok, true);
    assert.equal(authority.status, 'BLOCKED');
  } finally {
    removeTree(artifactRoot);
  }
});

test('P2-M7-HUMAN-004 objective checks pass before critical Human Gate outcome', async () => {
  const artifactRoot = createArtifactRoot('qa-skill-m7-human-');
  try {
    const result = await runControlledProjectScenario({ scenarioId: 'human', artifactRoot, timeoutMs: 20000 });
    const authority = validateProjectRunAuthority(result.runDirectory);
    const report = readFileSync(path.join(result.runDirectory, 'project-qa-report.md'), 'utf8');

    assert.equal(result.status, 'NEEDS_HUMAN_REVIEW');
    assert.equal(result.executionEvidence.every((entry) => entry.exitStatus === 0), true);
    assert.equal(result.reconciled.humanGates.some((gate) => gate.id === 'H-M7-BUSINESS-SAFETY-DECISION' && gate.critical === true), true);
    assert.match(result.reconciled.humanGates.find((gate) => gate.id === 'H-M7-BUSINESS-SAFETY-DECISION').question, /business\/safety/i);
    assert.match(report, /H-M7-BUSINESS-SAFETY-DECISION/);
    assert.match(report, /business\/safety owner/);
    assert.equal(authority.ok, true);
    assert.equal(authority.status, 'NEEDS_HUMAN_REVIEW');
  } finally {
    removeTree(artifactRoot);
  }
});

test('P2-M7-AUTHORITY-005 authority accepts untampered runs and fails closed on injected mismatches', async () => {
  const artifactRoot = createArtifactRoot('qa-skill-m7-authority-');
  try {
    const runs = [];
    for (const scenarioId of ['pass', 'fail', 'blocked', 'human']) {
      runs.push(await runControlledProjectScenario({ scenarioId, artifactRoot, timeoutMs: 20000 }));
    }

    for (const result of runs) {
      const authority = validateProjectRunAuthority(result.runDirectory);
      assert.equal(authority.ok, true, `${result.scenarioId} authority should validate`);
      assert.equal(authority.status, result.status);
    }

    assert.equal(classifyExecutionStatus({ exitStatus: 0 }), 'PASS');
    assert.equal(classifyExecutionStatus({ exitStatus: 1 }), 'FAIL');
    assert.equal(classifyExecutionStatus({ exitStatus: 'SPAWN_ERROR' }), 'BLOCKED');
    assert.equal(classifyExecutionStatus({ exitStatus: 'TIMED_OUT' }), 'BLOCKED');
    assert.equal(classifyExecutionStatus({}), 'BLOCKED');

    const timeoutWorkspace = mkdtempSync(path.join(artifactRoot, 'timeout-workspace-'));
    const resistantScript = path.join(timeoutWorkspace, 'resistant-timeout.mjs');
    writeFileSync(resistantScript, [
      "import { spawn } from 'node:child_process';",
      "if (process.platform !== 'win32') process.on('SIGTERM', () => {});",
      "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
      "setInterval(() => {}, 1000);",
      '',
    ].join('\n'));
    const timeoutStarted = Date.now();
    const timeoutResult = await runBoundedNodeProcess({ cwd: timeoutWorkspace, argv: [resistantScript], timeoutMs: 100, env: createIsolatedChildEnv({ workspaceRoot: timeoutWorkspace, baseEnv: process.env }) });
    const timeoutElapsed = Date.now() - timeoutStarted;
    assert.equal(timeoutResult.exitStatus, 'TIMED_OUT');
    assert.equal(classifyExecutionStatus(timeoutResult), 'BLOCKED');
    assert.equal(timeoutResult.termination.requested, true);
    assert.ok(timeoutResult.termination.strategy);
    assert.ok(timeoutResult.termination.forcedAttempted || timeoutResult.termination.gracefulAttempted || timeoutResult.termination.status.startsWith('taskkill'));
    assert.equal(Object.isFrozen(timeoutResult.termination), true);
    assert.equal(Object.isFrozen(timeoutResult.termination.errors), true);
    assert.throws(() => timeoutResult.termination.errors.push('post-settle mutation'), /object is not extensible|read only|Cannot add property/);
    const terminationSnapshot = JSON.stringify(timeoutResult.termination);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(JSON.stringify(timeoutResult.termination), terminationSnapshot);
    assert.ok(timeoutElapsed < 5000, `timeout harness must not hang, elapsed ${timeoutElapsed}ms`);

    assert.throws(() => parseProjectScenarioArgs(['--unknown', 'x']), /Unknown option/);
    assert.throws(() => parseProjectScenarioArgs(['--timeout-ms', '0']), /positive integer/);
    assert.throws(() => parseProjectScenarioArgs(['--real-target', 'C:\\target'], {}), /QA_SKILL_REAL_PROJECT_RUNS=1/);
    assert.throws(() => parseProjectScenarioArgs([], { QA_SKILL_REAL_PROJECT_RUNS: '1', QA_SKILL_REAL_PROJECT_ARGV_JSON: '["--test","tests/a.test.mjs"]' }), /QA_SKILL_REAL_PROJECT_TARGET/);

    const envWorkspace = mkdtempSync(path.join(artifactRoot, 'env-workspace-'));
    const opencodeExe = path.join(envWorkspace, 'opencode.exe');
    writeFileSync(opencodeExe, 'native executable placeholder\n');
    const isolatedEnv = createIsolatedChildEnv({
      workspaceRoot: envWorkspace,
      baseEnv: {
        PATH: process.env.PATH || '',
        QA_SKILL_OPENCODE_BIN: opencodeExe,
        API_KEY: 'secret-api-key',
        TOKEN: 'secret-token',
        PASSWORD: 'secret-password',
        OPENCODE_AUTH_CONTENT: 'secret-auth',
        OPENCODE_CONFIG_DIR: 'C:\\Users\\real-user\\opencode-config',
        OPENAI_API_KEY: 'secret-provider',
        ANTHROPIC_API_KEY: 'secret-provider',
        HOME: 'C:\\Users\\real-user',
        USERPROFILE: 'C:\\Users\\real-user',
        TEMP: 'C:\\real-temp',
      },
    });
    assert.equal(isolatedEnv.QA_SKILL_OPENCODE_BIN, opencodeExe);
    for (const key of ['API_KEY', 'TOKEN', 'PASSWORD', 'OPENCODE_AUTH_CONTENT', 'OPENCODE_CONFIG_DIR', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_TEST_CONTEXT']) assert.equal(Object.hasOwn(isolatedEnv, key), false, key);
    for (const key of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR']) assert.equal(path.relative(envWorkspace, isolatedEnv[key]).startsWith('..'), false, key);
    assert.equal(isolatedEnv.NODE_OPTIONS, '');

    const tamperCases = [
      ['report', (runDirectory) => {
        const filePath = path.join(runDirectory, 'project-qa-report.md');
        writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}\nreport tamper\n`);
      }],
      ['manifest', (runDirectory) => {
        const filePath = path.join(runDirectory, 'manifest.json');
        const manifest = readJson(filePath);
        manifest.reportBytes += 1;
        writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
      }],
      ['module result', (runDirectory) => {
        const filePath = path.join(runDirectory, 'module-results.json');
        writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}\n`);
      }],
      ['delivery', (runDirectory) => {
        const filePath = path.join(runDirectory, 'delivered-payload.md');
        writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}\ndelivery tamper\n`);
      }],
      ['module result', (runDirectory) => {
        const filePath = path.join(runDirectory, 'module-results.json');
        const moduleResults = readJson(filePath);
        moduleResults.find((entry) => entry.moduleId === 'billing').scenarioId = 'semantic-tamper';
        writeJson(filePath, moduleResults);
        refreshManifestArtifact(runDirectory, 'module-results.json');
      }],
      ['manifest', (runDirectory) => {
        const filePath = path.join(runDirectory, 'manifest.json');
        const manifest = readJson(filePath);
        manifest.status = 'PASS';
        for (const artifact of manifest.artifacts) artifact.status = 'PASS';
        writeJson(filePath, manifest);
      }],
      ['report', (runDirectory) => {
        const filePath = path.join(runDirectory, 'project-qa-report.md');
        writeFileSync(filePath, readFileSync(filePath, 'utf8').replace('Overall Status: FAIL', 'Overall Status: PASS'));
        refreshManifestArtifact(runDirectory, 'project-qa-report.md');
      }],
    ];

    for (const [domain, tamper] of tamperCases) {
      const source = runs.find((result) => result.scenarioId === 'fail').runDirectory;
      const tampered = mkdtempSync(path.join(artifactRoot, `tampered-${domain.replace(/\s+/g, '-')}-`));
      copyProjectTree(source, tampered);
      tamper(tampered);
      const authority = validateProjectRunAuthority(tampered);
      assert.equal(authority.ok, false, `${domain} tamper must fail`);
      assert.equal(authority.status, 'BLOCKED');
      assert.notEqual(authority.status, 'PASS');
      assert.match(authority.diagnostics.join('\n'), new RegExp(domain, 'i'));
      assert.equal(authority.preservedFindings.some((finding) => finding.id === 'F-M7-BILLING-TOTAL'), true);
    }

    const passRun = runs.find((result) => result.scenarioId === 'pass').runDirectory;
    const coordinated = mkdtempSync(path.join(artifactRoot, 'tampered-coordinated-'));
    copyProjectTree(runs.find((result) => result.scenarioId === 'fail').runDirectory, coordinated);
    const coordinatedManifestPath = path.join(coordinated, 'manifest.json');
    const coordinatedManifest = readJson(coordinatedManifestPath);
    coordinatedManifest.status = 'PASS';
    for (const artifact of coordinatedManifest.artifacts) artifact.status = 'PASS';
    const coordinatedReport = readFileSync(path.join(coordinated, 'project-qa-report.md'), 'utf8').replace('Overall Status: FAIL', 'Overall Status: PASS');
    writeFileSync(path.join(coordinated, 'project-qa-report.md'), coordinatedReport);
    writeFileSync(path.join(coordinated, 'delivered-payload.md'), coordinatedReport);
    writeJson(coordinatedManifestPath, coordinatedManifest);
    refreshAllManifestArtifacts(coordinated);
    const coordinatedAuthority = validateProjectRunAuthority(coordinated);
    assert.equal(coordinatedAuthority.ok, false);
    assert.equal(coordinatedAuthority.status, 'BLOCKED');
    assert.match(coordinatedAuthority.diagnostics.join('\n'), /recomputed status mismatch/i);

    const malformedArtifacts = mkdtempSync(path.join(artifactRoot, 'tampered-artifacts-'));
    copyProjectTree(passRun, malformedArtifacts);
    const malformedManifestPath = path.join(malformedArtifacts, 'manifest.json');
    const malformedManifest = readJson(malformedManifestPath);
    malformedManifest.artifacts = { bad: true };
    writeJson(malformedManifestPath, malformedManifest);
    const malformedAuthority = validateProjectRunAuthority(malformedArtifacts);
    assert.equal(malformedAuthority.ok, false);
    assert.match(malformedAuthority.diagnostics.join('\n'), /artifacts must be an array/i);

    const duplicateArtifacts = mkdtempSync(path.join(artifactRoot, 'tampered-duplicate-artifacts-'));
    copyProjectTree(passRun, duplicateArtifacts);
    const duplicateManifestPath = path.join(duplicateArtifacts, 'manifest.json');
    const duplicateManifest = readJson(duplicateManifestPath);
    duplicateManifest.artifacts.push({ ...duplicateManifest.artifacts[0] });
    writeJson(duplicateManifestPath, duplicateManifest);
    const duplicateAuthority = validateProjectRunAuthority(duplicateArtifacts);
    assert.equal(duplicateAuthority.ok, false);
    assert.match(duplicateAuthority.diagnostics.join('\n'), /duplicate artifact path/i);

    const topLevelReportMetadata = mkdtempSync(path.join(artifactRoot, 'tampered-report-metadata-'));
    copyProjectTree(passRun, topLevelReportMetadata);
    const topLevelManifestPath = path.join(topLevelReportMetadata, 'manifest.json');
    const topLevelManifest = readJson(topLevelManifestPath);
    topLevelManifest.reportBytes += 1;
    writeJson(topLevelManifestPath, topLevelManifest);
    const topLevelMetadataAuthority = validateProjectRunAuthority(topLevelReportMetadata);
    assert.equal(topLevelMetadataAuthority.ok, false);
    assert.match(topLevelMetadataAuthority.diagnostics.join('\n'), /top-level report metadata|delivery manifest differs/i);

    const malformedCoverage = mkdtempSync(path.join(artifactRoot, 'tampered-coverage-'));
    copyProjectTree(passRun, malformedCoverage);
    const malformedCoverageManifestPath = path.join(malformedCoverage, 'manifest.json');
    const malformedCoverageManifest = readJson(malformedCoverageManifestPath);
    malformedCoverageManifest.requiredCoverage = { importantModules: 'auth' };
    writeJson(malformedCoverageManifestPath, malformedCoverageManifest);
    const malformedCoverageAuthority = validateProjectRunAuthority(malformedCoverage);
    assert.equal(malformedCoverageAuthority.ok, false);
    assert.equal(malformedCoverageAuthority.status, 'BLOCKED');
    assert.match(malformedCoverageAuthority.diagnostics.join('\n'), /requiredCoverage/i);

    const malformedModuleResult = mkdtempSync(path.join(artifactRoot, 'tampered-module-shape-'));
    copyProjectTree(passRun, malformedModuleResult);
    writeJson(path.join(malformedModuleResult, 'module-results.json'), [null, { moduleId: 'auth', status: 'PASS', evidence: null }]);
    refreshManifestArtifact(malformedModuleResult, 'module-results.json');
    const malformedModuleAuthority = validateProjectRunAuthority(malformedModuleResult);
    assert.equal(malformedModuleAuthority.ok, false);
    assert.equal(malformedModuleAuthority.status, 'BLOCKED');
    assert.match(malformedModuleAuthority.diagnostics.join('\n'), /module result entry must be an object|module result evidence must be an array|authority reconciliation failed/i);

    const cleanupTampered = mkdtempSync(path.join(artifactRoot, 'tampered-cleanup-'));
    copyProjectTree(passRun, cleanupTampered);
    const cleanup = readJson(path.join(cleanupTampered, 'cleanup.json'));
    cleanup.completed = false;
    writeJson(path.join(cleanupTampered, 'cleanup.json'), cleanup);
    refreshManifestArtifact(cleanupTampered, 'cleanup.json');
    const cleanupAuthority = validateProjectRunAuthority(cleanupTampered);
    assert.equal(cleanupAuthority.ok, false);
    assert.equal(cleanupAuthority.status, 'BLOCKED');
    assert.match(cleanupAuthority.diagnostics.join('\n'), /cleanup/i);

    const argvRoot = mkdtempSync(path.join(artifactRoot, 'argv-target-'));
    mkdirSync(path.join(argvRoot, 'tests'), { recursive: true });
    writeFileSync(path.join(argvRoot, 'tests', 'safe.test.mjs'), 'export const ok = true;\n');
    mkdirSync(path.join(argvRoot, '.git'), { recursive: true });
    writeFileSync(path.join(argvRoot, '.git', 'hidden.test.mjs'), 'export const bad = true;\n');
    mkdirSync(path.join(argvRoot, 'test-results'), { recursive: true });
    writeFileSync(path.join(argvRoot, 'test-results', 'hidden.test.mjs'), 'export const bad = true;\n');
    const unsafeArgvCases = [
      ['--test', path.join(argvRoot, 'tests', 'safe.test.mjs')],
      ['--test', 'tests/../package.json'],
      ['--test', 'tests/safe.test.mjs;rm'],
      ['--test', 'npm-install.test.mjs'],
      ['--test', 'https://example.test/file.test.mjs'],
      ['--test', '.git/hidden.test.mjs'],
      ['--test', 'test-results/hidden.test.mjs'],
      ['--test', 'tests/project-integration.test.mjs'],
      ['--test', '--watch'],
    ];
    for (const argv of unsafeArgvCases) assert.equal(validateSafeNodeTestArgv({ targetRoot: argvRoot, argv }).ok, false, argv.join(' '));
    assert.equal(validateSafeNodeTestArgv({ targetRoot: argvRoot, argv: ['--test', 'tests/safe.test.mjs'] }).ok, true);

    const linkRoot = mkdtempSync(path.join(artifactRoot, 'link-target-'));
    const outsideRoot = mkdtempSync(path.join(artifactRoot, 'link-outside-'));
    symlinkSync(outsideRoot, path.join(linkRoot, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => fingerprintProjectTree(linkRoot), /unsafe link entry/);
  } finally {
    removeTree(artifactRoot);
  }
});

test('P2-M7-REAL-006 real project run is opt-in, validates argv, isolates copy, and skips by default', async (t) => {
  if (process.env.QA_SKILL_REAL_PROJECT_RUNS !== '1') {
    t.skip('Set QA_SKILL_REAL_PROJECT_RUNS=1 with an approved target and direct Node test argv JSON.');
    return;
  }

  const target = process.env.QA_SKILL_REAL_PROJECT_TARGET;
  const argvJson = process.env.QA_SKILL_REAL_PROJECT_ARGV_JSON;
  assert.equal(typeof target, 'string');
  assert.notEqual(target.length, 0);
  assert.equal(typeof argvJson, 'string');
  assert.notEqual(argvJson.length, 0);
  assert.ok(path.isAbsolute(target), 'QA_SKILL_REAL_PROJECT_TARGET must be absolute');
  assert.ok(existsSync(target), 'QA_SKILL_REAL_PROJECT_TARGET must exist');
  const argv = JSON.parse(argvJson);
  assert.equal(Array.isArray(argv), true);
  const validation = validateSafeNodeTestArgv({ targetRoot: target, argv });
  assert.equal(validation.ok, true, validation.diagnostics.join('; '));
  assert.equal(validateSafeNodeTestArgv({ targetRoot: target, argv: ['--test', 'tests/../package.json'] }).ok, false);
  assert.equal(validateSafeNodeTestArgv({ targetRoot: target, argv: ['--test', 'tests/project-integration.test.mjs'] }).ok, false);

  const artifactRoot = process.env.QA_SKILL_REAL_PROJECT_ARTIFACT_ROOT || createArtifactRoot('qa-skill-m7-real-');
  const timeoutMs = Number(process.env.QA_SKILL_REAL_PROJECT_TIMEOUT_MS || 60000);
  const before = fingerprintProjectTree(target);
  const result = await runRealProjectScenario({ targetRoot: target, argv, artifactRoot, timeoutMs });
  const after = fingerprintProjectTree(target);
  const authority = validateProjectRunAuthority(result.runDirectory);
  const report = readFileSync(path.join(result.runDirectory, 'project-qa-report.md'), 'utf8');
  const manifest = readJson(path.join(result.runDirectory, 'manifest.json'));

  assert.deepEqual(after, before);
  assert.equal(result.status, 'PASS');
  assert.notEqual(result.isolationRoot, target);
  assert.equal(path.relative(target, result.runDirectory).startsWith('..'), true);
  assert.equal(result.cleanup.attempted, true);
  assert.equal(result.cleanup.completed, true);
  assert.equal(existsSync(result.isolationRoot), false);
  assert.equal(authority.ok, true);
  assert.match(report, /Important modules: real-project/);
  assert.match(report, /Key flows: None/);
  assert.match(report, /Evidence: V-M7-REAL-NODE-TEST/);
  assert.doesNotMatch(report, /KF-AUTH-BILLING-SHARED|auth, billing, shared-lib/);
  assert.deepEqual(manifest.requiredCoverage.importantModules, ['real-project']);
  assert.deepEqual(manifest.requiredCoverage.keyFlows, []);
  assert.deepEqual(parseProjectScenarioArgs(['--scenario', 'pass', '--artifact-root', artifactRoot]).scenarioId, 'pass');
});
