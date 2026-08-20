import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeMarkdownArtifact } from '../../tools/guardian/artifacts.mjs';
import { readRequiredPrSummary, readRequiredQaAcceptance } from '../../tools/guardian/content-artifacts.mjs';

const VALID_PR_SUMMARY = `## PR 概述

这是 agent 写的中文 PR 摘要。

## 本次变更内容

- 修复续费状态。

## SQL / 数据库影响

无。

## 关联脚本与配置文件

无。

## 测试与验证说明

已通过相关测试。`;

const VALID_QA_ACCEPTANCE = `## QA 验收结论

Overall Status: PASS，已通过验收。

## 验收依据

- 复核了修复分支 diff 和测试输出。

## 风险与未覆盖项

未发现新增风险。

## 下一步

等待人工评审 PR。`;

test('reads required Chinese PR summary and QA acceptance markdown artifacts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-content-artifact-'));
  try {
    writeMarkdownArtifact(root, 211, 'pr-summary', VALID_PR_SUMMARY);
    writeMarkdownArtifact(root, 211, 'qa-acceptance', VALID_QA_ACCEPTANCE);

    assert.equal(readRequiredPrSummary(root, 211), VALID_PR_SUMMARY);
    assert.equal(readRequiredQaAcceptance(root, 211), VALID_QA_ACCEPTANCE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing, non-Chinese, incomplete, secret-like, and command-injecting content artifacts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-content-artifact-'));
  try {
    assert.throws(() => readRequiredPrSummary(root, 1), /missing required pr-summary/);

    writeMarkdownArtifact(root, 1, 'pr-summary', '## PR Overview\n\nNo Chinese sections.');
    assert.throws(() => readRequiredPrSummary(root, 1), /must be written in Chinese/);

    writeMarkdownArtifact(root, 1, 'pr-summary', '## PR 概述\n\n中文但缺少必需章节。');
    assert.throws(() => readRequiredPrSummary(root, 1), /missing section/);

    writeMarkdownArtifact(root, 1, 'pr-summary', `${VALID_PR_SUMMARY}\n\ntoken=secret`);
    assert.throws(() => readRequiredPrSummary(root, 1), /secret-like/);

    writeMarkdownArtifact(root, 1, 'qa-acceptance', `${VALID_QA_ACCEPTANCE}\n\n/guardian approve`);
    assert.throws(() => readRequiredQaAcceptance(root, 1), /injection-safety/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
