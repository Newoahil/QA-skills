import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGuardianPrBody, buildGuardianPrBodyFromAgentSummary, collectCommitSummaries } from '../../tools/guardian/pr-summary.mjs';

test('buildGuardianPrBody renders structured Chinese PR sections with commits and verification facts', () => {
  const body = buildGuardianPrBody({
    issue: 211,
    issueTitle: 'Fix broken renewal flow',
    base: 'dev',
    head: 'fix/issue-211',
    plan: {
      risk: 'LOW',
      root_cause: 'renewal handler returned before persisting the state transition',
      affected_files: ['src/renewal/service.mjs', 'tests/renewal/service.test.mjs', 'deploy/docker-compose.yml'],
      acceptance_criteria: ['renewal request persists terminal state', 'duplicate request remains idempotent'],
      test_plan: ['node --test tests/renewal/service.test.mjs'],
    },
    dossier: { issue_class: 'bug' },
    verdict: { status: 'PASS', report_hash: 'sha256:abc' },
    commits: [{ sha: 'abcdef12', title: 'fix: resolve issue #211' }],
  });

  assert.match(body, /## PR 概述/);
  assert.match(body, /## 本次变更内容/);
  assert.match(body, /## 关联 Commit SHA/);
  assert.match(body, /`abcdef12` - fix: resolve issue #211/);
  assert.match(body, /deploy\/docker-compose\.yml/);
  assert.match(body, /本 PR 不包含 SQL 文件变更/);
  assert.match(body, /Overall Status: PASS/);
  assert.match(body, /sha256:abc/);
});

test('buildGuardianPrBody lists SQL and script/config impacts from affected files', () => {
  const body = buildGuardianPrBody({
    issue: 7,
    issueTitle: 'schema fix',
    base: 'main',
    head: 'fix/issue-7',
    plan: {
      affected_files: ['db/migration/V12__orders.sql', 'scripts/repair.ps1'],
      root_cause: 'schema drift',
    },
    dossier: {},
    verdict: { status: 'PASS' },
    commits: [],
  });

  assert.match(body, /db\/migration\/V12__orders\.sql/);
  assert.match(body, /scripts\/repair\.ps1/);
  assert.match(body, /未能在分支范围内找到提交记录/);
});

test('collectCommitSummaries reads real branch commits with shell-free git log', () => {
  const calls = [];
  const commits = collectCommitSummaries({
    repoDir: 'D:/repo',
    base: 'dev',
    head: 'fix/issue-211',
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: 'abcdef12 fix: resolve issue #211\n12345678 test: cover renewal\n', stderr: '' };
    },
  });

  assert.deepEqual(commits, [
    { sha: 'abcdef12', title: 'fix: resolve issue #211' },
    { sha: '12345678', title: 'test: cover renewal' },
  ]);
  assert.equal(calls[0].cmd, 'git');
  assert.deepEqual(calls[0].args, ['log', '--oneline', '--no-decorate', 'dev..fix/issue-211']);
  assert.equal(calls[0].opts.shell, false);
});

test('collectCommitSummaries preserves configured base refs exactly', () => {
  let range;
  collectCommitSummaries({
    repoDir: 'D:/repo',
    base: 'lambda/main',
    head: 'hotfix/x',
    run: (_cmd, args) => {
      range = args.at(-1);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(range, 'lambda/main..hotfix/x');
});

test('buildGuardianPrBodyFromAgentSummary preserves agent-written Chinese prose and appends machine facts', () => {
  const body = buildGuardianPrBodyFromAgentSummary({
    summary: '## PR 概述\n\n这是 agent 写的中文说明。\n\n## 本次变更内容\n\n- 修复续费状态。\n\n## SQL / 数据库影响\n\n无。\n\n## 关联脚本与配置文件\n\n无。\n\n## 测试与验证说明\n\n已通过。',
    issue: 211,
    base: 'dev',
    head: 'fix/issue-211',
    verdict: { status: 'PASS', report_hash: 'sha256:abc' },
    commits: [{ sha: 'abcdef12', title: 'fix: resolve issue #211' }],
  });

  assert.match(body, /这是 agent 写的中文说明/);
  assert.match(body, /## 关联 Commit SHA/);
  assert.match(body, /`abcdef12` - fix: resolve issue #211/);
  assert.match(body, /## QA Guardian 机器校验/);
  assert.match(body, /Overall Status: PASS/);
});
