---
type: change
record_id: change-c79535dd171745ee98a74bae8ca3c2ba
date: 2026-08-18
title: DONE followup/Gate 通知 review 回归测试正式纳入
status: done
source: review-work 修复后的复审准备
key_conclusion: 将 DONE followup、Gate 通知和跨轮次 DONE 幂等的 focused injected regression 纳入正式测试，完整 Guardian suite 达到 153/153 pass，避免审查证据依赖未跟踪临时文件。
topics: [qa-guardian, review, followup]
author: Sisyphus
related_files: [tests/guardian/followup-gate-injected.test.mjs, tools/guardian/feishu-callback.mjs, tools/guardian/scheduler-core.mjs, tools/guardian/notify-io.mjs, tools/guardian/state.mjs]
---

## Change Content

将 review-work 过程中生成的 `followup-gate-injected.test.mjs` 纳入正式仓库测试，覆盖：

- 空 followup 输入拒绝；
- DONE 卡片 followup input 和 `{issue, verb}` callback value；
- Gate 1/Gate 2 waiting decision 进入 notify list 并映射对应卡片；
- 第一轮 DONE 通知后 followup 开新 round，第二轮 DONE 通知仍能再次发送。

## Reason for Change

上一轮 review 发现相关路径虽然有分散单测，但缺少一条正式、可重复的跨模块 focused regression；该测试当时未跟踪，不能作为长期验收证据。

## Impact Scope

只新增确定性 injected tests，无真实 Feishu/GitHub/network side effect；提高 followup/Gate 通知链的回归覆盖和审查证据完整性。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 153/153 pass。

## Notes

该记录用于 review-work 修复后的正式回归证据；下一步重新执行五路 review-work。
