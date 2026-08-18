---
type: change
record_id: change-abb444d029c440fba6895ca3d3dc1946
date: 2026-08-18
title: enforced runtime QA PASS 到 PR 创建机器闸门接线
status: done
source: Strong Guardian final review blocker
key_conclusion: enforced 模式下 qa-guardian 只生成 qa-verdict.json，scheduler 使用 qa-gate 校验 issue/branch/plan hash/Overall Status PASS 后通过 pr-io 创建 PR 并写 GATE_2_WAIT；204/204 测试通过。
topics: [qa-guardian, qa-gate, pr]
author: Sisyphus
related_files: [tools/guardian/qa-gate.mjs, tools/guardian/pr-io.mjs, tools/guardian/scheduler.mjs, tools/guardian/qa-verdict.mjs, qa-skill/agents/qa-guardian.md]
---

## Change Content

- enforced runtime prompt 明确禁止 qa-guardian 自行 `gh pr create`，只写 machine-readable `qa-verdict.json`；
- scheduler run 结束后调用 qa-gate，校验 PASS/issue/branch/plan hash；
- PASS 后由 scheduler 的 shell-free `pr-io` 调用 `gh pr create`，写入 `pr_url` 和 `GATE_2_WAIT`；
- 缺失/非 PASS/不匹配 verdict 不创建 PR。

## Reason for Change

review 指出独立 QA PASS 和 PR 创建原先主要依赖 agent prose，缺少机器可执行的 PR 前拦截。

## Impact Scope

仅 `investigation_mode=enforced` 走 scheduler-owned PR gate；legacy 兼容路径仍保留，shadow 不创建 PR。merge/close 仍不允许。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 204/204 pass。

## Notes

真实 qa agent 输出和真实 GitHub PR 联调仍需在本机凭证/目标仓库中执行；本阶段先完成可测机器边界。
