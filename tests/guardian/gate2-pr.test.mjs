import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTORS } from '../../tools/guardian/actor-routing.mjs';
import { openGate2PullRequest } from '../../tools/guardian/gate2-pr.mjs';

test('openGate2PullRequest builds a structured body from artifacts and branch commits before creating PR', () => {
  const calls = {};
  const result = openGate2PullRequest({
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    issue: 211,
    issueTitle: 'Fix renewal bug',
    baseBranch: 'dev',
    currentBranch: 'fix/issue-211',
    verdict: { status: 'PASS', report_hash: 'sha256:abc' },
    actor: ACTORS.SUPERVISOR,
  }, {
    readArtifactPair: (guardianDir, issue) => {
      calls.readArtifactPair = { guardianDir, issue };
      return {
        plan: { root_cause: 'root', affected_files: ['src/app.mjs'], test_plan: ['node --test tests/app.test.mjs'] },
        dossier: { issue_class: 'bug' },
      };
    },
    collectCommitSummaries: (request) => {
      calls.collectCommitSummaries = request;
      return [{ sha: 'abcdef12', title: 'fix: resolve issue #211' }];
    },
    readRequiredPrSummary: (guardianDir, issue) => {
      calls.readRequiredPrSummary = { guardianDir, issue };
      return '## PR 概述\n\n中文摘要\n\n## 本次变更内容\n\n中文内容\n\n## SQL / 数据库影响\n\n无\n\n## 关联脚本与配置文件\n\n无\n\n## 测试与验证说明\n\n通过';
    },
    buildGuardianPrBodyFromAgentSummary: (request) => {
      calls.buildGuardianPrBodyFromAgentSummary = request;
      return '## PR 概述\n\nbody';
    },
    createPullRequest: (request) => {
      calls.createPullRequest = request;
      return 'https://github.com/o/r/pull/9';
    },
  });

  assert.deepEqual(result, { url: 'https://github.com/o/r/pull/9', title: 'Fix renewal bug' });
  assert.deepEqual(calls.readArtifactPair, { guardianDir: 'D:/repo/.qa/guardian', issue: 211 });
  assert.deepEqual(calls.readRequiredPrSummary, { guardianDir: 'D:/repo/.qa/guardian', issue: 211 });
  assert.deepEqual(calls.collectCommitSummaries, { repoDir: 'D:/repo', base: 'dev', head: 'fix/issue-211' });
  assert.equal(calls.buildGuardianPrBodyFromAgentSummary.commits[0].sha, 'abcdef12');
  assert.match(calls.buildGuardianPrBodyFromAgentSummary.summary, /中文摘要/);
  assert.equal(calls.createPullRequest.body, '## PR 概述\n\nbody');
  assert.equal(calls.createPullRequest.actor, ACTORS.SUPERVISOR);
});

test('openGate2PullRequest falls back to an issue title when the issue has no title', () => {
  const result = openGate2PullRequest({
    repoDir: 'D:/repo',
    guardianDir: 'D:/repo/.qa/guardian',
    issue: 7,
    issueTitle: null,
    baseBranch: 'dev',
    currentBranch: 'fix/issue-7',
    verdict: { status: 'PASS' },
    actor: ACTORS.SUPERVISOR,
  }, {
    readArtifactPair: () => ({ plan: {}, dossier: {} }),
    readRequiredPrSummary: () => '## PR 概述\n\n中文摘要\n\n## 本次变更内容\n\n中文内容\n\n## SQL / 数据库影响\n\n无\n\n## 关联脚本与配置文件\n\n无\n\n## 测试与验证说明\n\n通过',
    collectCommitSummaries: () => [],
    buildGuardianPrBodyFromAgentSummary: () => 'body',
    createPullRequest: () => 'https://github.com/o/r/pull/7',
  });

  assert.deepEqual(result, { url: 'https://github.com/o/r/pull/7', title: '修复 issue #7' });
});
