---
type: change
record_id: change-d9e9344cce4a4afbb937c6c637a7931c
date: 2026-08-18
title: 强化 Guardian Phase 8：plan-gated execution core
status: done
source: 强化无人值守 Guardian 方案 Phase 8
key_conclusion: 新增 plan-gate.mjs，把 legacy/shadow/enforced 三种调查模式映射为是否允许写入，enforced 下只有 dossier-backed decision-complete LOW plan 可自主进入 FIXING，183/183 测试通过。
topics: [qa-guardian, plan-gate, safety]
author: Sisyphus
related_files: [tools/guardian/plan-gate.mjs, tests/guardian/plan-gate.test.mjs, tools/guardian/plan-validator.mjs]
related: [change-494b8d8a5ef14682bd96aeefdd945693]
---

## Change Content

新增 `plan-gate.mjs`：

- `legacy` 保持现有行为，便于迁移/回滚；
- `shadow` 运行 validator 但不把结果伪装成自主授权；
- `enforced` 只有 valid + autonomousReady plan 才允许编辑；
- invalid/unresolved/request LOW plan 返回 Gate1 必需；
- fixing prompt context 明确 `can_edit` 与 `requires_gate1`。

## Reason for Change

Evidence contract 和 plan validator 建立后，需要一个独立、可测试的执行前安全边界，防止无效或不完整 plan 进入 write-capable FIXING。

## Impact Scope

新增纯 adapter，尚未接入 scheduler/agent 主流程；保持当前 legacy 模式兼容，后续 Phase 9 再接入 pipeline harness。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 183/183 pass。

## Notes

后续 Phase 9 建立 scheduler→investigation→plan→fix→qa→Gate2 injected integration harness。
