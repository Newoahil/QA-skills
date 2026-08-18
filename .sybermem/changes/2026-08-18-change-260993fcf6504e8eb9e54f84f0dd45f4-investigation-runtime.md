---
type: change
record_id: change-260993fcf6504e8eb9e54f84f0dd45f4
status: done
source: 强化无人值守 Guardian 方案 Phase 9
key_conclusion: 新增 investigation-runtime.mjs，把注入的 specialist runner、coordinator dossier synthesis、artifact persistence、plan builder 和 plan validation 串成可调用 runtime adapter，192/192 测试通过。
topics: [qa-guardian, integration, investigation]
author: Sisyphus
related_files: [tools/guardian/investigation-runtime.mjs, tests/guardian/investigation-runtime.test.mjs, tools/guardian/artifacts.mjs, tools/guardian/investigation-coordinator.mjs, tools/guardian/plan-validator.mjs]
related: [change-ab75b9ee58354673b48b9c875f91a889, change-d9e9344cce4a4afbb937c6c637a7931c]
---

## Change Content

新增 `investigation-runtime.mjs` 作为 Phase 9 runtime adapter：

- 根据 issue class/complexity 选择 specialist roles；
- 通过注入的 `runSpecialist` 执行只读 specialist，带 timeout budget；
- 汇总结果生成 dossier；
- 原子写入 `dossier.json` 和 `plan.json`；
- 调用 plan builder 和 plan validator；
- 提供 artifact readiness 检查；
- 不直接执行 GitHub/Feishu/产品写入，便于真实 runtime 和 integration harness 注入。

## Reason for Change

前几个阶段的 coordinator、artifact store 和 plan gate 已分别存在，但还缺少把 specialist 结果、dossier、plan 和 validator 串起来的可调用 runtime 接口。

## Impact Scope

新增 adapter 和 injected tests；现有 scheduler 默认路径保持兼容，后续可将该 adapter 接入 enforced investigation mode。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 192/192 pass。

## Notes

这是 Phase 9 的 integration harness/runtime adapter 增量；下一步继续将它接入真正的 Guardian investigation orchestration，并补 runtime-level end-to-end test。
