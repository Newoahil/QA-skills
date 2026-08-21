---
type: change
record_id: change-7e6fdf97764f412c921e2d9ab581c7b1
date: 2026-08-21
title: TUI 新增实时专员事件视图（官方 SSE，免轮询）
status: done
key_conclusion: 用官方 client.event.subscribe() SSE 事件流为只读 TUI 增加“5 实时”标签，流式显示专员每一步（工具调用/文本/会话空闲/错误），按选中 issue 的 session id 过滤、有界缓冲、断线自动重连；需 --base-url 指向共享 serve，否则该标签给出启用指引。
topics: [opencode-events, tui-live-view, session-viewing]
related_files:
  - tools/guardian/opencode-client.mjs
  - tools/guardian/dashboard-tui-events.mjs
  - tools/guardian/dashboard-tui.mjs
  - tools/guardian/dashboard-tui-model.mjs
  - tools/guardian/dashboard-tui-input.mjs
  - tools/guardian/dashboard-tui-render.mjs
---

## Change Content
- opencode-client：新增 `subscribeEvents()`，调用官方 `client.event.subscribe()` 返回 `{ kind:'ok', stream, cancel }`，错误归一化为 retryable/unusable。
- 新模块 `dashboard-tui-events.mjs`（纯函数）：`mapEventToLine`（把 `message.part.updated` 的 tool/text、`message.part.delta`、`session.idle/error/status`、`tool.execute.before/after` 映射为一行中文）、`eventSessionId`（兼容 properties/payload 与 part/info 形状）、`eventMatchesSessions`（按 session id 过滤，server 级事件恒放行）、`createEventBuffer`（有界 FIFO，默认 200 行）。
- TUI：新增 `5 实时` 标签（input TAB_KEYS `5`、render 标签/help）。CLI 在有 `--base-url` 时创建事件 client 与 buffer，后台 `runEventSubscription` 订阅 SSE、过滤到当前 issue 的 session、push 到 buffer；在实时标签下收到事件即 `refreshNow('live')` 免轮询刷新；流结束/错误自动重连（默认 3s，可注入 `eventReconnectMs`）；cleanup 时取消订阅。model `loadDashboardTuiSnapshot` 接收 `liveLines`，实时标签渲染缓冲行，未启用时给出中文启用指引。

## Reason for Change
用户要“能看到专员具体工作过程”，倾向方案 B。上一步已让组合 launcher 起共享 opencode serve。本步接官方实时事件流，让 TUI 不再只靠轮询/落盘日志，而是流式显示专员每一步，贴合 OpenCode 官方 client/server + SSE 设计。

## Impact Scope
仅影响只读 TUI 的查看能力与 opencode-client 只读事件订阅；不改 scheduler 决策、agent 权限、状态机。实时视图为增量，未连共享 serve 时零影响（标签显示指引），只读边界不变（仅订阅事件、不写任何东西）。

## Implementation
纯映射/过滤/缓冲在 `dashboard-tui-events.mjs`；订阅生命周期在 CLI（后台循环 + 重连 + cleanup 取消）；渲染经 model 的 `liveLines`。事件 client 与重连间隔可注入以便测试。

## Test Verification
- 新增单测：mapEventToLine（tool/text/lifecycle/v2 payload/噪声 null）、eventSessionId、eventMatchesSessions、createEventBuffer 有界；model 实时标签启用/未启用两态；CLI 端到端把注入的 tool 事件流式写入 buffer 并在实时标签可见。
- 相关文件与全量：full Guardian suite 521/521 通过；`node --check` 全通过；`git diff --check` 通过。

## Notes
- 官方对齐：已用官方 `event.subscribe()`；`prompt` 仍绕过 `session.chat()`（SDK 1.18.18 codegen bug，注释在案），SDK 升级后应回归官方方法。
- 使用：`guardian-start.bat` 默认起共享 serve 并给 TUI 传 `--base-url`；进 TUI 按 `5` 看实时；或 `opencode attach http://127.0.0.1:4096` 看官方原生视图。
- 需重启 scheduler/TUI 用新代码生效。
