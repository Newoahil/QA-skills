---
type: change
record_id: change-76c5d0ed9fac48cb970da4f0329c2454
date: 2026-08-21
title: 组合 launcher 启动共享 opencode serve，专员会话可原生查看（方案 B）
status: done
key_conclusion: 按 OpenCode 官方 client/server 架构，让 guardian-start.bat 自动起一个共享 opencode serve 并把 scheduler(SDK 会话) 与只读 TUI(--base-url) 都指向它，从而专员/修复者/QA 会话可在 TUI Transcript 原生查看、也可 opencode attach；serve 不可用时自动降级为子进程模式（--NoSharedServer 可关闭）。
topics: [opencode-serve, session-viewing, guardian-launcher]
related_files:
  - tools/guardian/guardian-start.ps1
  - tools/guardian/scheduler-start.ps1
  - tests/guardian/guardian-start.test.mjs
---

## Change Content
- guardian-start.ps1：新增 `-ServerPort`(默认 4096) 与 `-NoSharedServer`；新增 `Resolve-OpencodeBin`/`Start-SharedOpencodeServer`（起 `opencode serve --port --hostname 127.0.0.1`，轮询 `/global/health` 就绪）。默认把 `-OpenCodeServerUrl` 传给 scheduler、把 `--base-url` 传给 TUI；serve 起不来时从两处参数中剔除 URL，自动降级为子进程模式。dry-run 输出新增 `shared_server_url`。启动成功后提示可 `opencode attach <url>`。
- scheduler-start.ps1：把共享 server 健康检查 + `QA_GUARDIAN_OPENCODE_SERVER_URL` 与 `QA_GUARDIAN_PROGRESS_DIR` 的设置从 `if ($SchedulerOnly)` 分支内**上提到分支之外**，使 polling-only 与组合(飞书)两种运行时都继承共享 server 与进度目录（原来只有 SchedulerOnly 生效）。
- 测试：断言 launcher 起共享 serve、透传 `-OpenCodeServerUrl`/`--base-url`、可 attach、可 `-NoSharedServer` 降级；断言 scheduler-start 的 env 设置在分支之前。

## Reason for Change
用户要“能看到专员具体工作视图”，并倾向方案 B（更贴近想法）。经 Context7 核实 OpenCode 官方模式：`opencode serve` + `createOpencodeClient({baseUrl})` + `opencode attach`，会话通过 `session.messages`/`event.subscribe` 原生可读。之前是子进程模式（`QA_GUARDIAN_OPENCODE_SERVER_URL` 空），专员是独立 `opencode run` 子进程，其会话不在共享 server 上、session_id 也拿不到，导致 TUI Transcript/session-view 查不到。方案 B 让所有 agent 会话落到同一个可被查看/attach 的 server。

## Impact Scope
仅影响 Windows 组合/scheduler 启动路径与其参数透传；运行时行为：默认改为共享 serve 模式（SDK 会话），失败自动回退子进程；不改状态机、不改 agent 权限、只读 TUI 只读边界不变。

## Implementation
见 related_files。核心：launcher 起 serve→健康检查→注入 scheduler/TUI；scheduler-start 把 server/progress env 提到分支外覆盖两种运行时。

## Test Verification
- 新增 launcher 单测：共享 serve 起动/透传/attach/降级；scheduler-start env 位置。
- PowerShell 解析：guardian-start.ps1 / scheduler-start.ps1 均通过（期间修复了一处中文字符串闭合被编码破坏的问题，改为 ASCII 提示）。
- dry-run：默认含 `shared_server_url + -OpenCodeServerUrl + --base-url`；`-NoSharedServer` 为 null 且不带 server 参数。
- full Guardian suite：513/513 通过；`git diff --check` 通过。

## Notes
- 官方模式核对结论：我们已用官方 `createOpencodeClient`；但 `prompt` 仍绕过 `client.session.chat()` 直接 POST `/session/{id}/message`（注释称 SDK 1.18.18 codegen 路径 bug），SDK 升级后应回归官方方法；且尚未使用官方 `client.event.subscribe()` 实时事件流（后续可做“实时专员视图”）。
- 生效需重启：用 `guardian-start.bat` 重新启动即可默认共享 serve；查看用 TUI `2 Transcript` 或 `opencode attach http://127.0.0.1:4096`。
- 需要 `opencode` 在 PATH（或 APPDATA\npm）可解析；否则自动降级并给出 warning。
