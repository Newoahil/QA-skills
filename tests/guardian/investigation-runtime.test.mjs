import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { investigationArtifactsReady, prepareInvestigation } from '../../tools/guardian/investigation-runtime.mjs';

const testCommands = [['node', '--test', 'tests/guardian/investigation-runtime.test.mjs']];
const riskAssessment = {
  certain: true,
  lowDangerSurfaceOnly: true,
  touchedSurfaces: [],
  localImpact: true,
  diffLines: 10,
  reproducibleOracle: true,
  scopeExpansionRequested: false,
};

test('prepareInvestigation runs bounded specialists and persists dossier/plan', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const calls = [];
  try {
    const result = await prepareInvestigation({
      issue: 42, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'simple',
      issueData: { title: 'Wrong badge color', body: 'Expected pink, observed red.' },
      capabilities: {}, config: { investigation_budget_ms: 1000, specialist_timeout_ms: 100 },
      memoryContext: { provider: 'sybermem', items: [{ id: 'R1', title: 'Rule', summary: 'Use pink.' }] },
      runSpecialist: async ({ role, timeout_ms, issueData, issueDataPath }) => {
        calls.push({ role, timeout_ms, issueData, issueDataPath });
        return {
          specialist: role,
          hypotheses: [{ id: 'H1', statement: 'root' }],
          evidence: [{ id: `E-${role}`, kind: 'runtime_reproduction', source: role, observation: 'fail', supports: ['H1'], contradicts: [] }],
          unresolved_facts: [],
        };
      },
      buildPlan: async ({ memoryContext }) => {
        assert.equal(memoryContext.provider, 'sybermem');
        return { root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['test'], test_commands: testCommands, acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code', 'E-guardian-runtime'], risk: 'LOW', risk_assessment: riskAssessment };
      },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.issueData), [
      { title: 'Wrong badge color', body: 'Expected pink, observed red.' },
      { title: 'Wrong badge color', body: 'Expected pink, observed red.' },
    ]);
    assert.equal(calls.every((call) => call.issueDataPath.endsWith('issue-data.json')), true);
    assert.equal(result.planResult.valid, true);
    assert.equal(investigationArtifactsReady(root, 42), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation logs specialist and plan lifecycle events', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const events = [];
  const logger = { info: (event, fields) => events.push({ event, fields }), warn: () => {}, error: () => {} };
  try {
    await prepareInvestigation({
      issue: 205, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'simple',
      issueData: { title: 't', body: 'b' }, capabilities: {}, config: {}, logger,
      runSpecialist: async ({ role }) => ({ specialist: role, hypotheses: [{ id: 'H1', statement: 'r' }], evidence: [{ id: `E-${role}`, kind: 'source_invariant', source: role, observation: 'o', supports: ['H1'], contradicts: [] }], unresolved_facts: [], acceptance_criteria: [] }),
      buildPlan: async () => ({ root_cause: 'r', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['t'], test_commands: testCommands, acceptance_criteria: ['w'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code'], risk: 'LOW', risk_assessment: riskAssessment }),
    });
    const names = events.map((e) => e.event);
    assert.equal(names.includes('specialist.begin'), true);
    assert.equal(names.includes('specialist.ok'), true);
    assert.equal(names.includes('plan.begin'), true);
    assert.equal(names.includes('plan.ok'), true);
    const begin = events.find((e) => e.event === 'specialist.begin');
    assert.equal(begin.fields.issue, 205);
    assert.equal(typeof begin.fields.role, 'string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation logs specialist failure without leaking issue body', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const events = [];
  const logger = { info: (event, fields) => events.push({ level: 'info', event, fields }), warn: (event, fields) => events.push({ level: 'warn', event, fields }), error: (event, fields) => events.push({ level: 'error', event, fields }) };
  try {
    await prepareInvestigation({
      issue: 205, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'simple',
      issueData: { title: 'SECRET-TITLE', body: 'SECRET-BODY' }, capabilities: {}, config: {}, logger,
      runSpecialist: async () => { throw new Error('model_cooldown'); },
      buildPlan: async () => ({ root_cause: 'r', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['t'], test_commands: testCommands, acceptance_criteria: ['w'], rollback_plan: 'revert', evidence_ids: [], risk: 'LOW', risk_assessment: riskAssessment }),
    }).then(() => null, (e) => e);
    const failed = events.filter((e) => e.event === 'specialist.failed');
    assert.equal(failed.length >= 1, true);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes('SECRET-BODY'), false);
    assert.equal(serialized.includes('SECRET-TITLE'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation respects disabled optional specialists', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const roles = [];
  try {
    await prepareInvestigation({
      issue: 43, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'complex',
      issueData: { title: 'Regression', body: 'Broke after commit.' },
      capabilities: { context7: { available: true }, git_history: { available: true }, plan_critic: { available: true } },
      config: { agents: { guardian_plan_critic: false }, skills: { disabled: ['guardian-history'] } },
      runSpecialist: async ({ role }) => {
        roles.push(role);
        return { specialist: role, hypotheses: [{ id: 'H1', statement: 'root' }], evidence: [{ id: `E-${role}`, kind: 'source_invariant', source: role, observation: 'obs', supports: ['H1'], contradicts: [] }], unresolved_facts: [], acceptance_criteria: [] };
      },
      buildPlan: async () => ({ root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['test'], test_commands: testCommands, acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code', 'E-guardian-business', 'E-guardian-runtime', 'E-guardian-docs'], risk: 'HIGH' }),
    });
    assert.deepEqual(roles, ['guardian-code', 'guardian-business', 'guardian-runtime', 'guardian-docs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation records overall + per-role durations without enforcing a limit', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const seenTimeouts = [];
  let clock = 1000;
  const now = () => clock;
  try {
    const result = await prepareInvestigation({
      issue: 205, repoDir: 'D:/repo', guardianDir: root, issueClass: 'bug', complexity: 'simple',
      issueData: { title: 'empty state text', body: 'wrong copy' },
      capabilities: {}, config: {}, // budgets default to unlimited (0)
      now,
      runSpecialist: async ({ role, timeout_ms }) => {
        seenTimeouts.push(timeout_ms);
        clock += 5000; // simulate 5s of work per specialist
        return { specialist: role, hypotheses: [{ id: 'H1', statement: 'root' }], evidence: [{ id: `E-${role}`, kind: 'source_invariant', source: role, observation: 'o', supports: ['H1'], contradicts: [] }], unresolved_facts: [], acceptance_criteria: [] };
      },
      buildPlan: async () => { clock += 2000; return { root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['t'], test_commands: testCommands, acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code', 'E-guardian-runtime'], risk: 'LOW', risk_assessment: riskAssessment }; },
    });
    // No forced timeout: specialists receive 0 (unlimited).
    assert.equal(seenTimeouts.every((ms) => ms === 0), true);
    // Durations are recorded (telemetry). Specialists run concurrently over a shared fake clock, so
    // assert they are captured and positive rather than pinning exact concurrent values.
    assert.ok(result.timing.investigation_duration_ms >= 12000);
    assert.equal(result.timing.plan_duration_ms, 2000);
    assert.ok(result.timing.specialist_durations_ms['guardian-code'] > 0);
    assert.ok(result.timing.specialist_durations_ms['guardian-runtime'] > 0);
    assert.ok(typeof result.timing.investigation_started_at === 'string');
    assert.ok(typeof result.timing.investigation_completed_at === 'string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation waits for all started specialists before failing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  const state = { opencode: { specialists: {} } };
  let clock = 1000;
  const calls = [];
  try {
    const failure = await prepareInvestigation({
      issue: 205,
      repoDir: 'D:/repo',
      guardianDir: root,
      issueClass: 'bug',
      complexity: 'simple',
      capabilities: {},
      state,
      now: () => clock,
      runSpecialist: async ({ role }) => {
        calls.push(role);
        state.opencode.specialists[role] = { role, last_status: 'running' };
        clock += role === 'guardian-code' ? 10 : 20;
        if (role === 'guardian-runtime') {
          state.opencode.specialists[role].last_status = 'failed';
          state.opencode.specialists[role].last_error = 'model_cooldown';
          throw new Error('model_cooldown');
        }
        state.opencode.specialists[role].last_status = 'ok';
        return { specialist: role, hypotheses: [{ id: 'H1', statement: 'root' }], evidence: [{ id: `E-${role}`, kind: 'source_invariant', source: role, observation: 'ok', supports: ['H1'], contradicts: [] }], unresolved_facts: [], acceptance_criteria: [] };
      },
      buildPlan: async () => ({ root_cause: 'root', affected_files: ['a.mjs'], non_goals: ['b'], test_plan: ['t'], acceptance_criteria: ['works'], rollback_plan: 'revert', evidence_ids: ['E-guardian-code'], risk: 'LOW' }),
    }).then(
      () => null,
      (error) => error,
    );

    assert.ok(failure instanceof Error);
    assert.match(failure.message, /model_cooldown/);
    assert.deepEqual(Object.keys(failure.specialist_durations_ms).sort(), ['guardian-code', 'guardian-runtime']);
    assert.deepEqual(failure.specialist_failures, ['guardian-runtime']);
    assert.deepEqual(calls.sort(), ['guardian-code', 'guardian-runtime']);
    assert.equal(state.opencode.specialists['guardian-code'].last_status, 'ok');
    assert.equal(state.opencode.specialists['guardian-runtime'].last_status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation fails closed without specialist runner', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  try {
    await assert.rejects(() => prepareInvestigation({ issue: 1, repoDir: 'D:/r', guardianDir: root, issueClass: 'bug', capabilities: {}, buildPlan: async () => ({}) }), /specialist runner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareInvestigation does not persist a structurally invalid plan', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-investigation-'));
  try {
    await assert.rejects(() => prepareInvestigation({
      issue: 263,
      repoDir: 'D:/repo',
      guardianDir: root,
      issueClass: 'bug',
      complexity: 'simple',
      capabilities: {},
      runSpecialist: async ({ role }) => ({
        specialist: role,
        hypotheses: [{ id: 'H1', statement: 'root' }],
        evidence: [{ id: `E-${role}`, kind: 'source_invariant', source: 'src/a.mjs:1', observation: 'root', supports: ['H1'], contradicts: [] }],
        unresolved_facts: [],
        acceptance_criteria: [],
      }),
      buildPlan: async () => ({ risk: { level: '中' } }),
    }), /generated plan is structurally invalid/);
    assert.equal(investigationArtifactsReady(root, 263), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
