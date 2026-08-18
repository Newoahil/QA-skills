---
type: change
record_id: change-386571099b534df8bf7ef7ae67be6c86
date: 2026-08-18
title: 本机单进程 Scheduler + 飞书 WebSocket 长连接运行时
status: done
source: 用户决定从 HTTP callback 切换长连接，与 scheduler 一起本机运行
key_conclusion: 引入官方 Feishu Node SDK WebSocket（card.action.trigger）与共享 action executor，新 guardian-runtime 一进程启动一个 scheduler+一个 WS，启动脚本同步切换，HTTP callback 保留兼容；官方 SDK 可导入，135/135 测试通过。
topics: [qa-guardian, feishu, websocket]
author: Sisyphus
related_files: [package.json, package-lock.json, tools/guardian/feishu-ws.mjs, tools/guardian/guardian-runtime.mjs, tools/guardian/action-executor.mjs, tools/guardian/scheduler.mjs, tools/guardian/scheduler-start.ps1, tools/guardian/scheduler-start.sh]
related: [change-d4732a411e254c618517828d62e5ed70]
---

## Change Content

把主流程从云端 HTTP callback 切到本机长连接：官方 `@larksuiteoapi/node-sdk` 的 `WSClient + EventDispatcher` 监听 `card.action.trigger`；卡片按钮（含 revise/rework 输入意见）复用既有 verb/issue 校验和 `commandToCommentBody`，通过共享 `action-executor.mjs` 写 GitHub `/guardian <verb> <text>` 评论。新 `guardian-runtime.mjs` 同时启动一个 scheduler 与一个 WS，不启动第二个 scheduler；HTTP callback 保留为可选兼容 transport。

## Reason for Change

用户要求不再依赖公网回调服务，把 Feishu 长连接与 scheduler 一起跑在本机，并通过启动脚本一次启动。官方 SDK 已确认 API：`new Lark.WSClient`、`new Lark.EventDispatcher().register({'card.action.trigger': ...})`、`wsClient.start({eventDispatcher})`。

## Impact Scope

QA Guardian 本机运行时、Feishu 交互 transport、Node 依赖/锁文件、启动脚本与部署文档。安全边界保持：`command_authors` fail-closed、只写 GitHub issue 评论、不 merge/close、N=1 scheduler 不变。HTTP callback files 保留。

## Implementation

- `package.json`/`package-lock.json`:官方 SDK 1.73.0。
- `feishu-ws.mjs`:WSClient + EventDispatcher card.action.trigger；SDK 负责 WS 认证/回调校验；复用 action 校验与 executor。
- `action-executor.mjs`:HTTP/WS 共用 event_id 去重、失败回滚、GitHub comment。
- `guardian-runtime.mjs`:单进程 scheduler + WS，WS 可选/FEISHU_WS_ENABLED=false scheduler-only。
- `scheduler.mjs`:runScheduler 可导入，组合 runtime 可优雅 abort。
- start.ps1/sh/bat:启动组合 runtime；README/DEPLOY 文档更新。

## Test Verification

`npm install`（SDK 加载成功，npm audit 0 vulnerabilities）；`node --test "tests/guardian/*.test.mjs"` → 135/135 pass；WS 专项 mock 覆盖 SDK 初始化、card.action.trigger、approve、revise input、非法 verb、event dedup；runtime 专项覆盖 WS-disabled、单 scheduler + 单 WS、shutdown close。

## Notes

HTTP callback 仍可单独部署，但不要让同一飞书卡片同时走 HTTP 与 WS，否则可能重复评论。启动组合 runtime 前需本机执行 `npm install`，并通过环境变量或 gitignored secrets 注入 FEISHU_APP_ID/FEISHU_APP_SECRET。
