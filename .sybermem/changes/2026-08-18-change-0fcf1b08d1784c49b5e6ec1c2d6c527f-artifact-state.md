---
type: change
record_id: change-0fcf1b08d1784c49b5e6ec1c2d6c527f
date: 2026-08-18
title: 强化 Guardian Phase 3：调查 artifact 持久化与状态扩展
status: done
source: 强化无人值守 Guardian 方案 Phase 3
key_conclusion: 新增 dossier/plan 原子 artifact store，state schema 增加调查阶段、specialist、evidence、plan、生产依赖、round 元数据并兼容旧记录，167/167 测试通过。
topics: [qa-guardian, artifacts, state]
author: Sisyphus
related_files: [tools/guardian/artifacts.mjs, tools/guardian/state.mjs, tests/guardian/artifacts.test.mjs]
related: [change-494b8d8a5ef14682bd96aeefdd945693]
---

## Change Content

- 新增 `artifacts.mjs`：按 issue 保存 `dossier.json`/`plan.json`，临时文件写入后 rename，读取兼容 BOM。
- state schema 增加 schema_version 3 的 dossier/plan/phase/specialist/evidence/acceptance/production/error 字段默认值。
- 旧 state 通过 normalizeState 保持可读取，新增 artifact round-trip/BOM/旧状态迁移测试。

## Reason for Change

强化无人值守调查需要 durable dossier/plan，而不是只依赖 agent prompt 和 issue comment；Phase 3 为后续 specialist 和 plan-gated execution 提供持久化基础。

## Impact Scope

只扩展状态和 artifact 存储，不改变现有路由行为；旧 `.qa/guardian/<n>.json` 仍支持读取。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 167/167 pass。

## Notes

下一阶段创建 guardian-code/business/runtime/docs 只读 specialist agent。
