---
type: change
record_id: change-a1a8b1267e6946a098431b0dfbd102b6
date: 2026-08-18
title: 修复 Phase 11 runtime review 发现的计划输出与锁释放风险
status: done
source: Phase 11 final runtime/security/code review
key_conclusion: 修复 specialist JSON 尾部对象注入风险，并将 scheduler 获取锁后的 investigation/plan/claim/run 全部置于统一 finally 释放锁，192/192 测试通过。
topics: [qa-guardian, security, reliability]
author: Sisyphus
related_files: [tools/guardian/investigation-process.mjs, tools/guardian/scheduler.mjs]
---

## Change Content

- specialist/process JSON 解析改为“完整输出必须是一个 JSON object”，不再从模型输出最后一个 `{` 截取，避免尾部 JSON-like 内容替换权威 plan。
- scheduler 在 acquireLock 后将 investigation、artifact/plan 读取、plan gate、claim、followup state 和 child run 统一包在 try/finally，任一异常都释放 owner lock。
- child run error 记录结构化 `run.error` 后重新抛出，由 resident loop 统一处理。

## Reason for Change

Phase 11 review 指出：模型输出尾部对象截取可能产生计划替换；scheduler pre-run 阶段异常可能绕过原有 finally，导致 N=1 锁租约阻塞无人值守恢复。

## Impact Scope

specialist 输出安全、scheduler 锁生命周期；不改变 plan-gate、trusted author、N=1 目标。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 192/192 pass；scheduler/investigation-process syntax check clean。

## Notes

完成后重新执行 Phase 11 review-work；仍需关注真实 opencode specialist 输出和外部服务联调。
