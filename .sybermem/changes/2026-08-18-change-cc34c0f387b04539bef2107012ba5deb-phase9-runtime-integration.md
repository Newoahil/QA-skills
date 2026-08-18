---
type: change
record_id: change-cc34c0f387b04539bef2107012ba5deb
date: 2026-08-18
title: 强化 Guardian Phase 9：investigation runtime 接入真实 scheduler
status: done
source: 强化无人值守 Guardian 方案 Phase 9
key_conclusion: 将 investigation-process/investigation-runtime 接入 scheduler 的 shadow/enforced 路径：真实执行只读 specialist 子进程、写 dossier/plan artifact、执行 plan gate，失败或不完整计划不启动 write-capable Guardian；192/192 测试通过。
topics: [qa-guardian, runtime-integration, plan-gate]
author: Sisyphus
related_files: [tools/guardian/investigation-process.mjs, tools/guardian/investigation-runtime.mjs, tools/guardian/scheduler.mjs, tests/guardian/investigation-runtime.test.mjs, tests/guardian/scheduler-plan-gate.test.mjs]
related: [change-0071a9a0e32c40c28601c3ff7d6ad8b6, change-260993fcf6504e8eb9e54f84f0dd45f4]
---

## Change Content

- 新增 `investigation-process.mjs`：通过 `opencode run --agent <named-specialist>` 的 argv 方式执行只读 specialist，要求 JSON structured DATA，并支持 timeout。
- `scheduler.mjs` 在 `investigation_mode=shadow/enforced` 且缺 dossier/plan 时调用 `prepareInvestigation`。
- `prepareInvestigation` 选择 specialist、收集结果、合成 dossier、原子写 dossier/plan，并校验 plan。
- plan gate 失败、specialist JSON 失败或执行失败会释放 N=1 lock，不启动 write-capable Guardian。
- legacy mode 保持旧行为，便于逐步迁移和回滚。

## Reason for Change

Phase 11 review 指出此前 Phase 5-9 只是纯 core/harness，真实 scheduler 仍直接启动 qa-guardian，dossier/plan/specialist/plan-gate 没有接入无人值守路径。该批完成第一条真实 vertical slice。

## Impact Scope

当 `investigation_mode` 为 shadow/enforced 时，scheduler 在 write-capable Guardian 前增加真实调查/计划阶段；默认 legacy 保持兼容。specialist 只能通过指定 agent 名称和 argv 执行，不使用 shell，不改变 GitHub merge/close 或独立 qa 边界。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 192/192 pass。

## Notes

Phase 9 后仍需继续验证真实 opencode specialist 输出、timeout/预算 enforcement、QA verdict 的机器化持久化，以及最终 review-work。不要在真实生产项目直接启用 enforced，先用 shadow 验证 artifact。
