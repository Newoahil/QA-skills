---
type: change
record_id: change-12b834a1483f4fad8368e33dfe64947a
date: 2026-08-18
title: QA verdict contract 与 scheduler state reconciliation
status: done
source: Strong Guardian Phase 11 review blockers
key_conclusion: 新增 machine-readable qa-verdict contract，要求 PASS 前置 PR；scheduler 启动 command-driven run 前持久化 consumed comment、clearFixRounds 和 stall_retries；196/196 测试通过。
topics: [qa-guardian, qa, state]
author: Sisyphus
related_files: [tools/guardian/qa-verdict.mjs, tools/guardian/scheduler.mjs, qa-skill/agents/qa-guardian.md, tests/guardian/qa-verdict.test.mjs]
---

## Change Content

- `qa-verdict.mjs` 定义 PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW、Overall Status 解析、issue/branch/time/report hash 校验和 `canOpenPr`。
- `qa-guardian.md` 要求 PR 前写入并验证 `qa-verdict.json`，只有精确 PASS 才允许 PR。
- scheduler 在启动命令时持久化 `last_consumed_comment_id`、`clearFixRounds`、`nextStallRetries`，修复命令重复消费和 stalled retry 计数丢失。

## Reason for Change

review 指出 QA PASS 主要存在于 agent prose/harness，command consumption 和 stall/retry flags 也没有完整落盘；本批先建立 machine-readable 契约和 state reconciliation seam。

## Impact Scope

QA contract 和 scheduler state 持久化；真实 `qa` 输出收集/PR 创建器仍需后续 runtime adapter 接入。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 196/196 pass。

## Notes

下一步是让 qa runtime adapter 实际生成/校验 qa-verdict artifact，并在 PR 创建前强制调用 `canOpenPr`。
