---
type: change
record_id: change-559f7f25f2834bb2b50e4b7bcf9a3bfb
date: 2026-08-18
title: 强化 Guardian Phase 1：Evidence Contract
status: done
source: 强化无人值守 Guardian 方案 Phase 1
key_conclusion: 新增 evidence.mjs 结构化证据、假设评分、dossier 校验和决策就绪判断，覆盖 bug/request、证据 provenance、未确定事实与 request 验收标准，158/158 测试通过。
topics: [qa-guardian, evidence, unattended-quality]
author: Sisyphus
related_files: [tools/guardian/evidence.mjs, tests/guardian/evidence.test.mjs]
---

## Change Content

建立无人值守调查的第一层数据契约：

- evidence strength 按 runtime reproduction/regression/source invariant/git history/official docs/codegraph/static search 分级；
- hypothesis 按支持证据减反驳证据评分排序；
- dossier 校验 issue class、hypotheses、evidence、unresolved facts、request acceptance criteria 和 selected hypothesis；
- isDecisionReady 阻断未验证根因、未确定事实和无正证据假设；
- 纯模块，无外部 I/O，不改变现有 Guardian routing。

## Reason for Change

当前 qa-guardian 调查结果主要是非结构化文本，难以在无人值守场景中比较多个假设、保留证据 provenance、验证方案是否真正决策完备。Phase 1 先建立可测试的数据契约，再逐阶段接入 specialist、plan validator 和主流程。

## Impact Scope

仅新增 evidence contract 和测试，现有业务状态流转不变。request 现在在 dossier 层要求 acceptance criteria；未确定事实不能进入 decision-ready。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 158/158 pass。

## Notes

后续 Phase 2 将基于此契约实现 plan-validator；Phase 3 扩展 state/artifact 持久化。
