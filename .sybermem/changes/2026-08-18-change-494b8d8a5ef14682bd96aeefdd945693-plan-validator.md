---
type: change
record_id: change-494b8d8a5ef14682bd96aeefdd945693
date: 2026-08-18
title: 强化 Guardian Phase 2：Plan Validator
status: done
source: 强化无人值守 Guardian 方案 Phase 2
key_conclusion: 新增 plan-validator.mjs，要求根因证据、影响文件、非目标、测试/验收、回滚、风险和 evidence_ids 完整；request 不可默认 LOW，未确定事实和无效 dossier 不得进入 autonomous-ready，164/164 测试通过。
topics: [qa-guardian, planning, safety-gate]
author: Sisyphus
related_files: [tools/guardian/plan-validator.mjs, tests/guardian/plan-validator.test.mjs, tools/guardian/evidence.mjs]
related: [change-559f7f25f2834bb2b50e4b7bcf9a3bfb]
---

## Change Content

新增纯 plan validator：

- 校验 root_cause、affected_files、non_goals、test_plan、acceptance_criteria、rollback_plan、risk、evidence_ids；
- 复用 dossier validation 与 decision readiness；
- 未确定事实导致 `autonomousReady=false`；
- request 即使计划完整也不能默认 LOW 自动执行；
- HIGH 计划可以结构完整但必须 Gate 1；
- 未知 evidence id、缺字段、invalid risk、无证据假设都会阻断。

## Reason for Change

让无人值守 Guardian 在调查后、修改代码前有机器可校验的 decision-complete plan，而不是依赖单个 agent 的自然语言自检。

## Impact Scope

新增契约和测试，尚未接入 FIXING 主流程；Phase 8 再接入 plan-gated execution，当前行为保持兼容。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 164/164 pass。

## Notes

下一阶段扩展 state/artifact persistence，保存 dossier/plan/status/phase 等字段。
