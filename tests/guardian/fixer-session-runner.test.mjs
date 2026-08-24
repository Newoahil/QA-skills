// Tests for tools/guardian/fixer-session-runner.mjs — fixer SDK session runner (方案 A).
// Locks: create-or-reuse fixer session, prompt with dossier/plan + human note as untrusted data,
// persist session id in state.opencode.fixer, deadline + abort (never kill serve).

import assert from 'node:assert/strict';
import test from 'node:test';

import { runFixerSession } from '../../tools/guardian/fixer-session-runner.mjs';

function fakeClient() {
  const calls = { create: [], prompt: [], abort: [] };
  const client = {
    createSession: async ({ title, agent }) => { calls.create.push({ title, agent }); return 'ses_fixer'; },
    prompt: async (params) => { calls.prompt.push(params); return { kind: 'ok', result: { structured: { status: 'READY_FOR_FINALIZATION', summary: 'fix applied', pr_summary_markdown: '## PR 概述\n\n中文摘要\n\n## 本次变更内容\n\n中文内容\n\n## SQL / 数据库影响\n\n无\n\n## 关联脚本与配置文件\n\n无\n\n## 测试与验证说明\n\n通过', changed_files: ['tools/guardian/fix.mjs'] } } }; },
    abort: async (id) => { calls.abort.push(id); },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fixer', agent: 'qa-guardian', directory: 'D:/repo' } }),
  };
  return { client, calls };
}

test('creates a fixer session on first use and persists its id', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  const result = await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: null,
    round: 1,
  });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].agent, 'qa-guardian');
  assert.equal(result.sessionId, 'ses_fixer');
  assert.equal(result.state.opencode.fixer.session_id, 'ses_fixer');
  assert.equal(result.state.opencode.fixer.agent, 'qa-guardian');
});

test('reuses an existing valid fixer session (no recreate)', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: { session_id: 'ses_fixer', agent: 'qa-guardian', repo_dir: 'D:/repo', issue: 211, role: 'fixer', permission_policy_version: 2 }, qa: null, specialists: {}, inflight: null } };
  const result = await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: null,
    round: 1,
  });
  assert.equal(calls.create.length, 0, 'must not recreate a valid session');
  assert.equal(result.sessionId, 'ses_fixer');
  assert.equal(result.state.opencode.fixer.permission_policy_version, 2);
});

test('passes dossier/plan paths and human note as untrusted data in the prompt', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: { command_kind: 'rework', command_comment_id: 'c9', trusted_author_id: 'goudaren0528', round: 2, human_note: 'please also fix the color' },
    round: 2,
  });
  const prompt = calls.prompt[0];
  assert.equal(prompt.agent, 'qa-guardian');
  const text = prompt.parts[0].text;
  assert.equal(text.includes('dossier.json'), true);
  assert.equal(text.includes('plan.json'), true);
  // Human note is untrusted data, clearly delimited, never in system/agent/permission.
  assert.equal(text.includes('HUMAN_NOTE'), true);
  assert.equal(text.includes('please also fix the color'), true);
  assert.equal(prompt.system, undefined, 'human note must never be injected into system');
  assert.equal(text.includes('READY_FOR_FINALIZATION'), true);
  assert.equal(text.includes('pr_summary_markdown'), true);
  assert.equal(text.includes('supervisor'), true);
  assert.equal(text.includes('commit and push'), true);
  assert.equal(text.includes('Do not create a PR'), true);
});

test('SDK fixer reports completion without invoking supervisor finalization before QA', async () => {
  const { client } = fakeClient();
  const calls = [];
  const supervisor = { finalizeFix: async (args) => { calls.push(args); return { branch: 'fix/issue-211', status: 'ok' }; } };
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  const result = await runFixerSession({
    client, supervisor, state, issue: 211, repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    plan: { affected_files: ['tools/guardian/fix.mjs'], test_plan: ['run the focused regression'], test_commands: [['node', '--test', 'tests/guardian/fix.test.mjs']] },
  });
  assert.deepEqual(calls, []);
  assert.equal(result.finalization, null);
  assert.deepEqual(result.completion.changedFiles, ['tools/guardian/fix.mjs']);
});

test('normalizes an ok prompt kind to status ok without finalization', async () => {
  const { client } = fakeClient();
  const calls = [];
  const supervisor = { finalizeFix: async () => { calls.push('finalize'); return { status: 'ok' }; } };
  const result = await runFixerSession({
    client, supervisor, state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
    issue: 211, repoDir: 'D:/repo', dossierPath: 'dossier.json', planPath: 'plan.json',
    plan: { affected_files: ['tools/guardian/fix.mjs'] },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, []);
});

test('accepts validated fixer completion from text JSON when structured output is unavailable', async () => {
  const { client } = fakeClient();
  client.prompt = async () => ({
    kind: 'ok',
    result: {
      structured: null,
      text: JSON.stringify({
        status: 'READY_FOR_FINALIZATION',
        summary: 'fix applied',
        pr_summary_markdown: '## PR 概述\n\n中文摘要\n\n## 本次变更内容\n\n中文内容\n\n## SQL / 数据库影响\n\n无\n\n## 关联脚本与配置文件\n\n无\n\n## 测试与验证说明\n\n通过',
        changed_files: ['tools/guardian/fix.mjs'],
      }),
    },
  });
  const calls = [];
  const supervisor = { finalizeFix: async () => { calls.push('finalize'); return { status: 'ok' }; } };

  const result = await runFixerSession({
    client,
    supervisor,
    state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'dossier.json',
    planPath: 'plan.json',
    plan: { affected_files: ['tools/guardian/fix.mjs'] },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, []);
  assert.deepEqual(result.completion.changedFiles, ['tools/guardian/fix.mjs']);
});

test('does not finalize when fixer returns an empty or malformed ok result', async () => {
  for (const result of [{ kind: 'ok', result: {} }, { kind: 'ok', result: { structured: null } }, { kind: 'ok', result: { structured: null, text: '{not-json' } }, { kind: 'ok', result: { structured: { status: 'BLOCKED', summary: 'x', changed_files: [] } } }]) {
    const { client } = fakeClient();
    client.prompt = async () => result;
    const calls = [];
    const run = await runFixerSession({
      client,
      supervisor: { finalizeFix: async () => { calls.push('finalize'); return { status: 'ok' }; } },
      state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
      issue: 211, repoDir: 'D:/repo', dossierPath: 'dossier.json', planPath: 'plan.json',
      plan: { affected_files: ['tools/guardian/fix.mjs'] },
    });
    assert.equal(run.status, 'unverified');
    assert.deepEqual(calls, []);
  }
});

test('does not finalize when changed_files are outside the plan scope', async () => {
  const { client } = fakeClient();
  client.prompt = async () => ({ kind: 'ok', result: { structured: { status: 'READY_FOR_FINALIZATION', summary: 'x', changed_files: ['other/file.mjs'] } } });
  const calls = [];
  const run = await runFixerSession({
    client,
    supervisor: { finalizeFix: async () => { calls.push('finalize'); return { status: 'ok' }; } },
    state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
    issue: 211, repoDir: 'D:/repo', dossierPath: 'dossier.json', planPath: 'plan.json',
    plan: { affected_files: ['tools/guardian/fix.mjs'] },
  });
  assert.equal(run.status, 'unverified');
  assert.equal(run.completionError, 'changed-file-not-in-plan');
  assert.equal(run.state.opencode.fixer.last_error, 'changed-file-not-in-plan');
  assert.deepEqual(calls, []);
});

test('does not finalize for retryable or unusable prompt results', async () => {
  for (const kind of ['retryable', 'unusable-session']) {
    const { client } = fakeClient();
    client.prompt = async () => ({ kind });
    const calls = [];
    const result = await runFixerSession({
      client,
      supervisor: { finalizeFix: async () => { calls.push('finalize'); } },
      state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
      issue: 211, repoDir: 'D:/repo', dossierPath: 'dossier.json', planPath: 'plan.json',
    });
    assert.equal(result.status, kind === 'retryable' ? 'retry' : kind);
    assert.deepEqual(calls, []);
  }
});

test('aborts the session on deadline instead of killing the serve', async () => {
  const { client, calls } = fakeClient();
  const state = { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } };
  // Simulate a prompt that never resolves until the deadline.
  client.prompt = async () => new Promise(() => {});
  const result = await runFixerSession({
    client,
    state,
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    planPath: 'D:/repo/.qa/guardian/211/plan.json',
    humanNote: null,
    round: 1,
    deadlineMs: 50,
  });
  assert.equal(result.status, 'aborted');
  assert.equal(calls.abort.length, 1);
  assert.equal(calls.abort[0], 'ses_fixer');
});

test('preserves timeout result when abort cleanup fails', async () => {
  const { client } = fakeClient();
  client.prompt = async () => new Promise(() => {});
  client.abort = async () => { throw new Error('abort failed: secret-token'); };
  const result = await runFixerSession({
    client,
    state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
    issue: 211, repoDir: 'D:/repo', dossierPath: 'dossier.json', planPath: 'plan.json', deadlineMs: 10,
  });
  assert.equal(result.status, 'aborted');
  assert.match(result.error.message, /timed out/);
  assert.equal(result.abortError, null);
});

test('deadline result does not wait for hung abort cleanup', async () => {
  const { client } = fakeClient();
  client.prompt = async () => new Promise(() => {});
  client.abort = async () => new Promise(() => {});
  const result = await Promise.race([
    runFixerSession({
      client,
      state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
      issue: 211, repoDir: 'D:/repo', dossierPath: 'dossier.json', planPath: 'plan.json', deadlineMs: 10,
    }),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 80)),
  ]);

  assert.notEqual(result, 'hung');
  assert.equal(result.status, 'aborted');
  assert.match(result.error.message, /timed out/);
});

test('passes scheduler AbortSignal into fixer prompt', async () => {
  const { client, calls } = fakeClient();
  const controller = new AbortController();
  await runFixerSession({
    client,
    state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'dossier.json',
    planPath: 'plan.json',
    signal: controller.signal,
  });

  assert.equal(calls.prompt[0].signal, controller.signal);
});

test('does not write PR summary or accept fixer completion after the active-run fence falls false', async () => {
  const { client } = fakeClient();
  const prSummaries = [];

  const result = await runFixerSession({
    client,
    state: { opencode: { fixer: null, qa: null, specialists: {}, inflight: null } },
    issue: 211,
    repoDir: 'D:/repo',
    dossierPath: 'dossier.json',
    planPath: 'plan.json',
    plan: { affected_files: ['tools/guardian/fix.mjs'] },
    writePrSummary: (markdown) => { prSummaries.push(markdown); },
    isActiveRun: () => false,
  });

  assert.deepEqual(
    prSummaries,
    [],
    'late or stale fixer completion must be fenced before writePrSummary runs',
  );
  assert.equal(
    result.completion,
    null,
    'once the active-run fence is false, the runner must not keep the completion as current',
  );
  assert.notEqual(result.status, 'ok');
});
