---
type: change
record_id: change-974768db67954bf6afbf551ad31bb99c
date: 2026-08-27
title: 4096 Observer 界面 Linear 极简重构与动态多工程 Guardian 会话发现
status: done
source: QA Guardian Observer UI 体验与跨工程会话发现优化
key_conclusion: 重构 4096 Observer 为 Linear 极简暗黑风格，支持会话树折叠、工具调用手风琴与会话 ID 复制，并通过 /api/guardian-projects 动态发现换绑项目及隔离工作区会话，全量 836 测试通过。
topics: [qa-guardian, observer, frontend, ux]
author: Sisyphus
related_files: [tools/guardian/observer-server.mjs, tools/guardian/observer-web/app.js, tools/guardian/observer-web/index.html, tools/guardian/observer-web/styles.css, tests/guardian/observer-server.test.mjs]
---

## Change Content

- **会话多工程与工作区动态发现**：
  - 在 `observer-server.mjs` 新增 `/api/guardian-projects` 端点，实时读取 `scheduler.config.json` 中的换绑目标项目；
  - 前端 `app.js` 初始化时并发拉取 OpenCode `/project` 与 `/api/guardian-projects`，自动聚合基础工程与 Guardian 隔离工作区（`.qa-guardian-qa`、`.qa-guardian-control`）目录；
  - 并发获取 `/session?directory=<path>`，彻底解决换绑或跨项目时 Guardian 专家会话不可见的问题。
- **4096 极简暗黑界面（Linear 风格）重设计**：
  - 配色体系重塑为黑曜石底色（`#0b0d13`）、微光卡片与电光蓝焦点边框，配合专属角色微标签；
  - 会话树支持层级折叠 / 展开，左侧栏新增项目筛选下拉选择器；
  - 工具调用及输出自动收纳为可折叠手风琴面板（Tool Accordion），默认显示摘要避免信息刷屏；
  - 增加一键复制 Session ID、搜索快速清空与自适应贴底滚动。

## Reason for Change

1. 此前 Observer 写死请求未带 directory 参数的 `/session`，OpenCode 默认只返回服务启动根目录会话，导致 Guardian 在 `tuantuanrent.qa-guardian-qa` 等工作区发起的专家和规划会话完全无法显示。
2. 原有界面配色生硬、缺乏子会话折叠与工具调用面板，信息过载且在大量子 agent 场景下难以浏览。

## Impact Scope

- 仅影响本地只读 Observer Web 端与代理服务的静态资源/项目列表路由；
- 不影响 Guardian 核心调度、N=1 状态机、GitHub 交互与独立 QA 验收。

## Test Verification

- `node --test tests/guardian/observer-server.test.mjs` → 7/7 pass。
- `node --test "tests/guardian/*.test.mjs"` → 836/836 pass。
- Playwright 浏览器实测 578 个跨工程会话正常聚合，#366 专家与 plan 会话渲染正确，手风琴与折叠交互顺畅。
