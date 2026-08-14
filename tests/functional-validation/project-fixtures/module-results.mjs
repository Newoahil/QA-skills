import { createHash } from 'node:crypto';

export const snapshotFingerprint = 'snapshot-fixture-2026-07-31T00-00-00Z-sha256';
export const isolationWorkspaceReference = 'host-temp://qa-skill-m3-fixture/snapshot-fixture-2026-07-31T00-00-00Z-sha256';
export const authorityIntegrityOk = Object.freeze({ ok: true, diagnostics: Object.freeze([]) });

export const plannedModuleTasks = Object.freeze([
  Object.freeze({
    moduleId: 'auth',
    taskId: 'MT-AUTH-001',
    verificationIds: Object.freeze(['V-AUTH-SESSION']),
    allowedPaths: Object.freeze(['src/auth/', 'tests/auth-login.test.mjs', 'src/shared/']),
    plannedTools: Object.freeze(['node --test tests/auth-login.test.mjs']),
    declaredResources: Object.freeze(['fixture:auth-user']),
    risks: Object.freeze(['R-AUTH-SESSION']),
    snapshotFingerprint,
    isolationWorkspaceReference,
  }),
  Object.freeze({
    moduleId: 'billing',
    taskId: 'MT-BILLING-001',
    verificationIds: Object.freeze(['V-BILLING-TOTAL']),
    allowedPaths: Object.freeze(['src/billing/', 'tests/billing-checkout.test.mjs', 'src/shared/']),
    plannedTools: Object.freeze(['node --test tests/billing-checkout.test.mjs']),
    declaredResources: Object.freeze(['database:checkout']),
    risks: Object.freeze(['R-BILLING-TOTAL']),
    snapshotFingerprint,
    isolationWorkspaceReference,
  }),
  Object.freeze({
    moduleId: 'shared-lib',
    taskId: 'MT-SHARED-001',
    verificationIds: Object.freeze(['V-SHARED-CONSISTENCY']),
    allowedPaths: Object.freeze(['src/shared/', 'tests/shared-money.test.mjs']),
    plannedTools: Object.freeze(['node --test tests/shared-money.test.mjs']),
    declaredResources: Object.freeze(['database:checkout']),
    risks: Object.freeze(['R-SHARED-CONSISTENCY']),
    snapshotFingerprint,
    isolationWorkspaceReference,
  }),
]);

const taskIdByModule = Object.freeze(Object.fromEntries(plannedModuleTasks.map((task) => [task.moduleId, task.taskId])));

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function artifactReference({ path, content }) {
  return Object.freeze({
    path,
    sha256: sha256Text(content),
    bytes: Buffer.byteLength(content, 'utf8'),
  });
}

function evidenceRecord({ moduleId, verificationId, command, observation, exitStatus, status, timestamp, artifactContent }) {
  return Object.freeze({
    evidenceId: `E-${moduleId.toUpperCase()}-${verificationId}`,
    moduleId,
    taskId: taskIdByModule[moduleId],
    verificationId,
    actualCommandOrTool: command,
    observation,
    exitStatus,
    status,
    artifact: artifactReference({ path: `module-results/${moduleId}-${verificationId}.txt`, content: artifactContent }),
    timestamp,
    snapshotFingerprint,
    isolationWorkspaceReference,
  });
}

export function moduleResult({ moduleId, verificationId, status = 'PASS', command, observation, exitStatus = 0, finding = null, humanGate = null, artifactContent = observation }) {
  const evidence = evidenceRecord({
    moduleId,
    verificationId,
    command,
    observation,
    exitStatus,
    status,
    timestamp: '2026-07-31T00:00:00.000Z',
    artifactContent,
  });

  return Object.freeze({
    moduleId,
    resultId: `MR-${moduleId.toUpperCase()}`,
    taskId: taskIdByModule[moduleId],
    status,
    snapshotFingerprint,
    isolationWorkspaceReference,
    verificationIds: Object.freeze([verificationId]),
    evidence: Object.freeze([evidence]),
    findings: Object.freeze(finding ? [finding] : []),
    humanGates: Object.freeze(humanGate ? [humanGate] : []),
    artifact: evidence.artifact,
  });
}

const passAuth = moduleResult({
  moduleId: 'auth',
  verificationId: 'V-AUTH-SESSION',
  command: 'node --test tests/auth-login.test.mjs',
  observation: 'session identity preserved for authenticated checkout',
});

const passBilling = moduleResult({
  moduleId: 'billing',
  verificationId: 'V-BILLING-TOTAL',
  command: 'node --test tests/billing-checkout.test.mjs',
  observation: 'billing total matches authoritative expected result',
});

const passShared = moduleResult({
  moduleId: 'shared-lib',
  verificationId: 'V-SHARED-CONSISTENCY',
  command: 'node --test tests/shared-money.test.mjs',
  observation: 'shared formatting and token helpers remain consistent',
});

export const moduleResultFixtures = Object.freeze({
  allPass: Object.freeze([passAuth, passBilling, passShared]),
  oneFail: Object.freeze([
    passAuth,
    moduleResult({
      moduleId: 'billing',
      verificationId: 'V-BILLING-TOTAL',
      status: 'FAIL',
      command: 'node --test tests/billing-checkout.test.mjs',
      observation: 'billing total did not match authoritative expected result',
      exitStatus: 1,
      finding: Object.freeze({ id: 'F-BILLING-TOTAL', status: 'FAIL', type: 'product', verificationId: 'V-BILLING-TOTAL' }),
    }),
    passShared,
  ]),
  oneBlocked: Object.freeze([
    passAuth,
    passBilling,
    moduleResult({
      moduleId: 'shared-lib',
      verificationId: 'V-SHARED-CONSISTENCY',
      status: 'BLOCKED',
      command: 'node --test tests/shared-money.test.mjs',
      observation: 'required local runner unavailable',
      exitStatus: 'TOOL_UNAVAILABLE',
      finding: Object.freeze({ id: 'B-SHARED-RUNNER', status: 'BLOCKED', type: 'infrastructure', verificationId: 'V-SHARED-CONSISTENCY' }),
    }),
  ]),
  oneHuman: Object.freeze([
    passAuth,
    passBilling,
    moduleResult({
      moduleId: 'shared-lib',
      verificationId: 'V-SHARED-CONSISTENCY',
      status: 'NEEDS_HUMAN_REVIEW',
      command: 'node --test tests/shared-money.test.mjs',
      observation: 'objective evidence exists but owner decision is unresolved',
      humanGate: Object.freeze({ id: 'H-SHARED-POLICY', critical: true, question: 'Owner must decide accepted shared policy behavior.' }),
    }),
  ]),
  mixedBlockedAndFail: Object.freeze([
    moduleResult({
      moduleId: 'auth',
      verificationId: 'V-AUTH-SESSION',
      status: 'FAIL',
      command: 'node --test tests/auth-login.test.mjs',
      observation: 'session identity broke authenticated checkout',
      exitStatus: 1,
      finding: Object.freeze({ id: 'F-AUTH-SESSION', status: 'FAIL', type: 'product', verificationId: 'V-AUTH-SESSION' }),
    }),
    passBilling,
    moduleResult({
      moduleId: 'shared-lib',
      verificationId: 'V-SHARED-CONSISTENCY',
      status: 'BLOCKED',
      command: 'node --test tests/shared-money.test.mjs',
      observation: 'required fixture data unavailable',
      exitStatus: 'DATA_UNAVAILABLE',
      finding: Object.freeze({ id: 'B-SHARED-DATA', status: 'BLOCKED', type: 'infrastructure', verificationId: 'V-SHARED-CONSISTENCY' }),
    }),
  ]),
});

export const requiredCoverage = Object.freeze({
  importantModules: Object.freeze(['auth', 'billing', 'shared-lib']),
  keyFlows: Object.freeze(['KF-AUTH-BILLING-SHARED']),
  mustVerify: Object.freeze(['V-AUTH-SESSION', 'V-BILLING-TOTAL', 'V-SHARED-CONSISTENCY']),
  taskIds: Object.freeze({
    auth: 'MT-AUTH-001',
    billing: 'MT-BILLING-001',
    'shared-lib': 'MT-SHARED-001',
  }),
  moduleEvidence: Object.freeze({
    auth: Object.freeze(['V-AUTH-SESSION']),
    billing: Object.freeze(['V-BILLING-TOTAL']),
    'shared-lib': Object.freeze(['V-SHARED-CONSISTENCY']),
  }),
  keyFlowEvidence: Object.freeze({
    'KF-AUTH-BILLING-SHARED': Object.freeze(['V-AUTH-SESSION', 'V-BILLING-TOTAL', 'V-SHARED-CONSISTENCY']),
  }),
});
