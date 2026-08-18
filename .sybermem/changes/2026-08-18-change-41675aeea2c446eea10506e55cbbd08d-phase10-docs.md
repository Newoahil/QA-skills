---
type: change
record_id: change-41675aeea2c446eea10506e55cbbd08d
date: 2026-08-18
title: 强化 Guardian Phase 10：dossier/plan 迁移文档与 shadow/enforced 回滚说明
status: done
source: 强化无人值守 Guardian 方案 Phase 10
key_conclusion: README/DEPLOY/验收文档补充 investigation_mode legacy/shadow/enforced、dossier/plan artifact 和 rollback 说明，187/187 测试通过。
topics: [qa-guardian, documentation, migration]
author: Sisyphus
related_files: [tools/guardian/README.md, tools/guardian/DEPLOY.md, docs/qa-guardian-acceptance-usecases.md]
related: [change-d9e9344cce4a4afbb937c6c637a7931c]
---

## Change Content

- README/DEPLOY 增加 `investigation_mode` 的 legacy/shadow/enforced 迁移说明；
- 说明 dossier/plan artifact、未确定事实和 rollback 不删除 artifact；
- 验收文档新增 UC-M shadow 模式，验证调查产物生成且不直接修改产品代码；
- 保持现有 launch/config 行为兼容。

## Reason for Change

强化无人值守 Guardian 进入 shadow/enforced 之前，需要运维和验收人员知道如何逐步迁移、观察和回滚。

## Impact Scope

文档和验收用例，无运行时行为变更。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 187/187 pass。

## Notes

Phase 11 将执行 benchmark、全量测试和 review-work。
