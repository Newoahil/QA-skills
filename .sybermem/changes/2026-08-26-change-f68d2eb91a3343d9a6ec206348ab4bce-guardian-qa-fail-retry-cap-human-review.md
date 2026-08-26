---
type: change
record_id: change-f68d2eb91a3343d9a6ec206348ab4bce
date: 2026-08-26
title: Guardian QA-FAIL续修至可配置上限并给出人工介入建议
key_conclusion: QA FAIL 现在带上次报告续修同一个 fixer session 直到通过或达到可配置上限（默认5）；达上限 HANDED_BACK 并带 fix-rounds-exceeded-human-review 建议 + 最终 QA 报告/证据；approve 被 gate 拒绝不回滚消费；revise 永不写批准字段并记录审计；QA_VERIFIED 渲染净化 supervisor 证据。
topics: [qa-guardian, state-machine, fix-rounds, qa-fail-retry, human-review, gate]
---

## Change Summary

修复 Guardian 状态机四个行为契约问题（Oracle 复核后落地）：

1. **QA FAIL 续修**：`runQaStage` 现在用 `config.max_fix_rounds`（默认 5）续修 QA FAIL，复用同一 fixer session 并传入上次 QA report/evidence。达到上限后 HANDED_BACK 并带 `fix-rounds-exceeded-human-review` 建议 + 保留最终 QA verdict/report/supervisor evidence，供人工介入。

2. **approve 不吞不 hot-loop**：gate 拒绝（如 plan:unsafe-primary_files）时保留 `last_consumed_comment_id`（不回滚），记录 `last_error_class=plan-gate-rejected` + 保留 `plan_validation_errors`，发 Gate1 提示需 revise 后重新 approve。

3. **revise 永不写批准字段**：`applyGateCommandState` 加 `last_command_verb`/`last_command_comment_id` 审计字段；批准字段仅 `verb==='approve'` 写入，revise 走 INVESTIGATING+superseded。

4. **QA_VERIFIED 带证据**：`summarizeSupervisorEvidence` 净化渲染 supervisor 的 status/diff+测试退出码摘要，进评论 human-readable 区，不进 metadata allowlist。

## Rationale

- Oracle 复核确认：不删 fix-rounds 上限（避免 fixer 无限独占 scheduler），改可配置 + 默认提高；不回滚 approve 消费（避免 poll 热循环 + 跨 plan 批准）。
- `missing-supervisor-evidence` BLOCKED 不消耗 fix_rounds，补独立 `max_evidence_retries`（默认 3）防无限循环。

## Affected Files

- tools/guardian/scheduler.mjs
- tools/guardian/stage-runner.mjs
- tools/guardian/state-router.mjs
- tools/guardian/state.mjs
- tools/guardian/verdict-comment.mjs
- tests/guardian/scheduler-config.test.mjs, scheduler-state.test.mjs, stage-runner.test.mjs, state-router.test.mjs, verdict-comment.test.mjs

## Verification

- 全量 `node --test "tests/guardian/*.test.mjs"` 758/758 通过。
- Targeted 109/109 通过。
- LSP clean。
