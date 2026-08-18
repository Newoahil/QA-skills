---
type: change
record_id: change-ab75b9ee58354673b48b9c875f91a889
date: 2026-08-18
title: 强化 Guardian Phase 6：调查 specialist coordinator
status: done
source: 强化无人值守 Guardian 方案 Phase 6
key_conclusion: 新增 investigation-coordinator 纯核心，按 issue complexity 选择正交只读 specialist，生成实际 capability-aware prompt，合并 hypotheses/evidence/unresolved facts 为 dossier 并计算 decision readiness，175/175 测试通过。
topics: [qa-guardian, investigation, orchestration]
author: Sisyphus
related_files: [tools/guardian/investigation-coordinator.mjs, tests/guardian/investigation-coordinator.test.mjs, tools/guardian/evidence.mjs, tools/guardian/capabilities.mjs]
related: [change-47dc8b8da91e4b6fa99315f0e3712686]
---

## Change Content

新增调查编排核心：

- simple issue 选择 code + runtime specialist；complex issue 选择 code/business/runtime，并在 Context7 可用时增加 docs；
- 构造 issue/repo/role/dossier path/actual available tools 的调查 prompt；
- 汇总 specialist structured DATA：hypotheses、evidence、unresolved facts、acceptance criteria；
- 按 evidence contract 排序假设，输出 dossier validation 和 decision readiness；
- 不执行真实 task/MCP/写操作，为后续 runtime coordinator 接入保留纯测试边界。

## Reason for Change

让无人值守 Guardian 从单个 write-capable agent 自行猜测，升级为多只读视角、证据汇总和假设比较，为后续 plan-gated execution 打基础。

## Impact Scope

新增纯调查协调核心和测试，不改变现有 issue routing、修复、qa、PR 或 gate 行为。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 175/175 pass。

## Notes

下一阶段为 runtime budgets；之后 Phase 8 才接入 plan validator 和真实 specialist dispatch。
