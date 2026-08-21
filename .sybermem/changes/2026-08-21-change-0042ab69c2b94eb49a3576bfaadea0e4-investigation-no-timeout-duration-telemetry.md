---
type: change
record_id: change-0042ab69c2b94eb49a3576bfaadea0e4
date: 2026-08-21
title: 调查阶段取消强制超时，改为记录耗时并在失败时保留会话
status: done
key_conclusion: 按产品决策取消 investigation/specialist 的强制超时（budgets 默认 0=不限时），改为记录每角色与整体调查耗时作为后续调优依据；失败路径也持久化 specialist 会话与耗时以支持重试恢复与 TUI 可见；investigation 与 fixer run 现在可被 Ctrl+C/abort 透传中止。
topics: [guardian-investigation, timeout-policy, telemetry, abort]
related_files:
  - tools/guardian/budgets.mjs
  - tools/guardian/investigation-process.mjs
  - tools/guardian/investigation-runtime.mjs
  - tools/guardian/opencode-client.mjs
  - tools/guardian/scheduler.mjs
  - tools/guardian/state.mjs
  - tools/guardian/dashboard-tui-progress.mjs
---

## Change Content
- budgets：时间预算默认改为 0 = 不限时；新增 `hasTimeout(ms)`（仅正有限值才启用超时）。`investigation_ms/specialist_timeout_ms/child_timeout_ms` 默认 0。
- runAgentJson（子进程路径）：`timeoutMs<=0` 不再安装强杀定时器；新增 `signal` 支持，abort 时 kill 子进程；finish 时清理监听。
- processSpecialistRunner：SDK 与子进程两路都测量耗时并写回 `state.opencode.specialists[role]`；成功=ok、失败=failed，均带 `duration_ms/started_at/last_error`；prompt 前先落 running 会话 id，便于中止后仍可恢复。
- opencode-client.prompt：接受并透传 `signal`，abort 时调用 `session.abort` 并把 signal 传给底层 post。
- prepareInvestigation：记录整体 `investigation_started_at/completed_at/investigation_duration_ms/plan_duration_ms` 与 `specialist_durations_ms`，通过 `timing` 返回；透传 `signal`；`now()` 可注入以便测试。
- state.mjs：新增 `investigation_duration_ms/plan_duration_ms/specialist_durations_ms` 字段（normalizeState 自动回填）。
- scheduler：成功与失败路径都持久化 timing 与 specialist 会话；失败路径额外写 `specialist_failures/specialist_durations_ms/opencode`；`tick` 与 `runInvocation` 透传 abort signal；`runInvocation` 默认不限时。
- TUI：`dashboard-tui-progress` 显示“调查耗时/计划耗时/各角色耗时”，新增 `formatDuration`。

## Reason for Change
205 调查失败根因是 `guardian-code` specialist 命中 10 分钟 `specialist_timeout_ms` 被强杀（`plan_validation_errors: ["specialist guardian-code timed out"]`）。用户明确要求：不应限制处理时间，而应记录每次处理时长作为后续改进依据。同时用户要求确认任务可中止、并希望下次处理能恢复上次会话——原失败路径不落 `opencode`，导致 TUI 角色为空且无法恢复。

## Impact Scope
仅影响 Guardian 调查/运行时与其只读展示：budgets、investigation-process/runtime、opencode-client、scheduler、state、dashboard-tui-progress。默认行为变化：调查不再被计时强杀（除非 config 显式设正值）。QA/fixer session-runner 的 20 分钟 deadline 语义未改（其 `raceDeadline(0)` 语义是 load-bearing，本次不动，避免破坏轮询契约）。

## Implementation
见 related_files。超时改为 opt-in（正值才启用）；耗时为纯遥测；失败会话持久化用 `stampSpecialistSession` 在成功/失败两路统一写回。

## Test Verification
- 新增/更新单测：budgets 默认 0 + hasTimeout；prepareInvestigation 记录 timing 且 specialist 收到 timeout_ms=0；runAgentJson 无超时+abort kill；processSpecialistRunner 失败仍 stamp duration/failed；TUI 显示调查/角色耗时。
- 相关文件单测：19/19 通过；dashboard 相关：15/15。
- full Guardian suite：510/510 通过。
- `node --check` 全部通过；`git diff --check` 通过（仅 CRLF warning）。

## Notes
- QA/fixer SDK deadline（20min）本次未改：其 `timeoutMs<=0` 会立即 DeadlineError、`attempts=ceil(deadlineMs/interval)` 是轮询上界，改“无限”需重设语义，风险大，超出本次范围。
- 中止边界：scheduler 主循环、runInvocation、investigation specialist（SDK+子进程）现均接 abort；SDK 侧通过 `session.abort` 协作式中止。
- 该仓库 TS/JS LSP 未安装（先前 declined），以 node --check + 全量测试替代类型验证。
