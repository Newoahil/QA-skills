---
type: change
record_id: change-50ac1b7b0ba245bca6892a771e308eb1
date: 2026-08-18
title: QA verdict machine contract 与 PR gate 接口
status: done
source: Strong Guardian final review blocker
key_conclusion: 新增 qa-gate/pr-io 契约与测试，要求 PASS verdict 绑定 issue/branch/plan hash 才允许创建 PR，并把 validated dossier/plan 路径传入 fixer prompt；204/204 测试通过，但 PR 创建尚未从 qa-guardian agent 主流程移出。
topics: [qa-guardian, qa, pr-gate]
author: Sisyphus
related_files: [tools/guardian/qa-gate.mjs, tools/guardian/pr-io.mjs, tools/guardian/qa-verdict.mjs, tools/guardian/poll.mjs, tests/guardian/qa-gate.test.mjs, tests/guardian/pr-io.test.mjs]
---

## Change Content

- `qa-gate.mjs` 校验 QA PASS、issue、fix branch、plan hash；
- `pr-io.mjs` 提供 shell-free `gh pr create` adapter；
- `qa-verdict.mjs` 提供 report hash/build/audit；
- fixer invocation 明确携带 validated dossier/plan 路径；
- 204/204 测试通过。

## Reason for Change

review 指出 QA PASS 和 PR 创建仍主要依赖 qa-guardian prose，需要机器可读 QA artifact 和明确 PR gate contract。

## Impact Scope

新增可测试 contract/adapter；当前 PR 创建仍由现有 qa-guardian agent contract 完成，下一阶段需将 fixer、qa、PR 创建拆成 scheduler-owned phases 才能形成完整机器拦截。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 204/204 pass。

## Notes

未把 contract 误称为完整 runtime enforcement；真正的 PR 创建移出 agent 是下一项 critical integration。
