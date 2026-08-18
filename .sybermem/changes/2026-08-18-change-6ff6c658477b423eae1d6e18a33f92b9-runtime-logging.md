---
type: change
record_id: change-6ff6c658477b423eae1d6e18a33f92b9
date: 2026-08-18
title: QA Guardian BOM 兼容、结构化日志与 DEVer 启动体验
status: done
source: 用户真实启动反馈（BOM JSON.parse 错误 + 需要规范进展/错误日志和 DEVer Logo）
key_conclusion: 新增 runtime-io 统一 BOM-safe JSON 读取、stderr JSONL 结构化日志和 DEVer banner，runtime/scheduler/WS/HTTP server 接入阶段/错误事件且不泄露密钥；PowerShell 生成的 BOM config 现在可加载，测试 139/139 通过。
topics: [qa-guardian, observability, windows]
author: Sisyphus
related_files: [tools/guardian/runtime-io.mjs, tools/guardian/guardian-runtime.mjs, tools/guardian/scheduler.mjs, tools/guardian/feishu-ws.mjs, tools/guardian/callback-server.mjs, tools/guardian/secrets.mjs, tools/guardian/poll.mjs, tools/guardian/state.mjs]
---

## Change Content

- `runtime-io.mjs`: strip UTF-8 BOM + path-aware JSON parse;统一 `ts/level/component/event` JSONL logger 写 stderr；DEVer banner ASCII/Unicode mode。
- 所有配置/secret/state/lock 读取统一 BOM-safe，修复 PowerShell 5.1 生成 config 触发 Node `Unexpected token '﻿'`。
- runtime、scheduler、Feishu WS、HTTP callback server 输出启动/阶段/进度/错误日志；poll stdout 单行 JSON 契约保留。
- `DEPLOY.md` 补日志样式、字段边界和 banner 控制说明。

## Reason for Change

用户真实运行 scheduler-start 后，组合 runtime 因 BOM config 解析失败；同时要求命令行启动有规范中文引导、DEVer logo、可表达进展和错误。

## Impact Scope

运行时可观测性、Windows 编码兼容和 CLI UX；不改业务流程/状态路由/安全边界。日志禁止 secret、签名、原始 body、完整意见文本。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 139/139 pass；runtime-io 测试覆盖 BOM JSON、日志必需字段、banner 模式；全模块 syntax check 通过。

## Notes

`QA_GUARDIAN_BANNER_MODE=ascii|unicode` 可控 banner；Windows 默认 ASCII。`poll.mjs` stdout 保持机器消费契约，运行日志统一走 stderr。
