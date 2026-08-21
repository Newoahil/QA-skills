---
type: change
record_id: change-30d32899761b40d8ac9f442695dfec62
date: 2026-08-21
title: Fixer/QA 会话 deadline 可配置且默认拉长到 60 分钟
status: done
key_conclusion: 将 Fixer/QA SDK 会话的硬编码 20 分钟 deadline 改为可配置（fixer_deadline_ms/qa_deadline_ms），默认拉长到 60 分钟；用 resolveSessionDeadlineMs 保证始终为正（child_timeout_ms=0 的“调查不限时”不会把会话 deadline 归零），保留轮询运行器的有限上界语义。
topics: [guardian-timeout, config, fixer-qa-session]
related_files:
  - tools/guardian/budgets.mjs
  - tools/guardian/scheduler.mjs
  - tools/guardian/qa-session-runner.mjs
  - tools/guardian/fixer-session-runner.mjs
  - tools/guardian/README.md
---

## Change Content
- budgets：新增 `DEFAULT_SESSION_DEADLINES`（fixer/qa 各 60 分钟）与 `resolveSessionDeadlineMs(config, key)`：优先取显式 key → 其次正的 `child_timeout_ms`（向后兼容）→ 否则拉长默认；始终返回正值，绝不返回 0。
- scheduler：Fixer 用 `resolveSessionDeadlineMs(config,'fixer_deadline_ms')`，QA 用 `'qa_deadline_ms'`，替换原来的 `config.child_timeout_ms ?? 20*60*1000`。
- 运行器默认值：`runQaSession`/`runFixerSession` 的 `deadlineMs` 默认 20min → 60min。
- README：config 表补充 `specialist_timeout_ms/investigation_budget_ms/child_timeout_ms`（0=不限时）、`fixer_deadline_ms`、`qa_deadline_ms`（默认 60min，必须 >0）。

## Reason for Change
上一次改动把调查阶段超时改为不限时（budgets 默认 0），但 Fixer/QA 的 SDK 会话仍共享硬编码 20 分钟、且原来复用 `child_timeout_ms`；这既不一致，也偏短。用户要求把这两处也改成可配置并把时长拉长。Fixer/QA 是轮询等待完成消息的运行器，`raceDeadline(0)` 语义是“立即放弃”，所以不能像调查那样设 0/无限——必须给一个可配置的、更长的有限上界。

## Impact Scope
仅影响 Fixer/QA SDK 会话 deadline 的取值与默认；不改其轮询/中止/恢复逻辑。`child_timeout_ms` 仍作为向后兼容来源（正值时生效），但 `child_timeout_ms=0`（调查不限时）不会再误把会话 deadline 归零——回退到 60min 默认。legacy runInvocation 路径仍用 `child_timeout_ms ?? 0`（不限时），与本次会话 deadline 独立。

## Implementation
见 related_files；核心是 `resolveSessionDeadlineMs` 的三级回退 + 非零保证。

## Test Verification
- 新增单测：resolveSessionDeadlineMs 显式 key 优先、legacy child_timeout_ms 正值生效、child_timeout_ms=0 回退默认、无配置回退 60min。
- budgets.test：6/6 通过。
- full Guardian suite：511/511 通过。
- `node --check` 全部通过。

## Notes
- 需要重启 scheduler 才生效（旧进程仍是旧默认）。
- 想进一步拉长/缩短：在 `.qa/guardian/config.json` 设 `fixer_deadline_ms` / `qa_deadline_ms`（毫秒）。
