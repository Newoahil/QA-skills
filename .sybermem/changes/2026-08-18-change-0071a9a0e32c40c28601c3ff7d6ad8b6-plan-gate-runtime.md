---
type: change
record_id: change-0071a9a0e32c40c28601c3ff7d6ad8b6
date: 2026-08-18
title: 强化 Guardian Phase 8：真实 scheduler plan gate 接入
status: done
source: 强化无人值守 Guardian 方案 Phase 8
key_conclusion: scheduler 现在消费 investigation_mode，在 shadow/enforced 模式读取 dossier/plan 并调用 assessFixingEntry，未通过计划门不启动 write-capable Guardian；legacy 保持兼容，190/190 测试通过。
topics: [qa-guardian, plan-gate, runtime]
author: Sisyphus
related_files: [tools/guardian/scheduler.mjs, tools/guardian/plan-gate.mjs, tools/guardian/artifacts.mjs, tests/guardian/scheduler-plan-gate.test.mjs]
related: [change-d9e9344cce4a4afbb937c6c637a7931c]
---

## Change Content

- scheduler 读取 `investigation_mode`；legacy 保持旧行为；shadow/enforced 读取 dossier/plan；
- enforced 只有 `assessFixingEntry` 允许时才启动 write-capable `qa-guardian`；
- shadow/invalid plan 记录结构化 warning 并释放 N=1 lock，不进入 fixing；
- 新增真实 scheduler gate 入口测试覆盖 legacy/shadow/enforced；
- 190/190 测试通过。

## Reason for Change

此前 plan-gate 只存在于纯 core/harness，实际 scheduler 仍直接启动 Guardian。该改动把安全门接入真实值守路径，避免无 dossier/plan 的 enforced 任务进入写入阶段。

## Impact Scope

影响 scheduler 在 `investigation_mode != legacy` 时的运行授权；默认 legacy 保持兼容。未改变 N=1、trusted author、独立 qa、Gate 2 等约束。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 190/190 pass。

## Notes

Phase 9 继续补真实 runtime integration harness，验证 coordinator/artifact/plan/qa 状态串联。
