---
type: change
record_id: change-c4f7796c3fa940589c4c90921c26455c
date: 2026-08-18
title: QA Guardian 运维就绪第二批（通知投递接线 + DEPLOY + bootstrap 指引）
status: done
source: review-work 5-agent 评审（上下文挖掘 FAIL：FR-21 未接线、bootstrap 不可用）
key_conclusion: 修复 review-work 阻塞项——新增 notify-io.mjs 把通知投递（gh 评论+curl webhook，幂等持久化 last_notified_state）真正接进 scheduler tick 满足 FR-21，并补 DEPLOY.md + bootstrap 指引让常驻 scheduler 与飞书回调可被新用户部署，128/128 测试通过。
topics: [qa-guardian, notification, deployment]
author: Sisyphus
related_files: [tools/guardian/notify-io.mjs, tools/guardian/scheduler.mjs, tools/guardian/DEPLOY.md, tools/guardian/bootstrap.ps1, tools/guardian/bootstrap.sh, tests/guardian/notify-io.test.mjs]
related: [change-5abf095ac5524443a5d7a9038a01a1e8]
---

## Change Content

review-work 上下文挖掘判 FAIL 的两个运维就绪阻塞项，本批修复：

1. 通知投递接线（FR-21 / §11B.5）：新增 `notify-io.mjs`——`defaultGhComment`（gh issue comment）+ `defaultCurlPost`（curl webhook）两个真实通道，`deliverNotifications` 编排器对每个 gate/STALLED/HANDED_BACK 决策调用 notify.mjs 的幂等决策，命中后持久化 `last_notified_state`（`touch:false` 不刷心跳），best-effort per-issue（单个失败不阻断其他、失败不写幂等标记以便下轮重试）。`scheduler.mjs` 的 tick 现在真正调用它——此前只有 planTick 产出 notify 候选但从未投递。
2. 部署文档 + bootstrap 指引：新增 `tools/guardian/DEPLOY.md`（中文，覆盖常驻 scheduler 运行、飞书自建应用+PAT、Dokploy/docker-compose 部署、回调 URL 回填、完整 config/env 参考表、安全边界说明、端到端链路图）；`bootstrap.ps1`/`bootstrap.sh` next-steps 增加 scheduler 运行命令、飞书回调部署指引、`command_authors` 必填提醒。

## Reason for Change

评审指出：scheduler-core 产出 notify 候选、notify.mjs 有投递逻辑，但 scheduler.mjs 从未执行投递路径——gate/STALLED/HANDED_BACK 事件不会真发通知，违反 FR-21。另外 bootstrap 只装 agent/skill，新用户无法从文档路径把常驻 scheduler + 飞书回调跑起来（无 DEPLOY 指南、config 键未文档化）。

## Impact Scope

QA Guardian 值守通知链与部署可用性。不影响业务仓库代码。行为变化：scheduler 每轮会对停滞/交回事件发通知（幂等，同状态不重复）。

## Implementation

见 related_files。`notify-io.mjs` 复用 notify.mjs 纯决策 + 注入 io（可测）；scheduler tick 在处理 run 前先投递通知（独立于 N=1 锁）。DEPLOY.md 提供 config 键表 + 飞书环境变量表 + 安全边界。bootstrap 只做“指引”，不自动部署云服务（部署是显式人工步骤）。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 128/128 pass（新增 notify-io 7 用例：STALLED/HANDED_BACK 映射、幂等跳过、飞书卡片 body、缺记录跳过、best-effort 单失败不阻断、非通知决策忽略）。全模块 `node --check` clean。bootstrap.ps1 Parser 解析 OK，bootstrap.sh `bash -n` 通过。

## Notes

三批修复的第二批（运维就绪）。前置：第一批安全+并发（change-5abf095ac5524443a5d7a9038a01a1e8）。下一批第三批：文档收尾（README scheduler 状态、config 键、飞书 env、验收用例、设计文档补飞书）。全程 auto-qa 分支。
