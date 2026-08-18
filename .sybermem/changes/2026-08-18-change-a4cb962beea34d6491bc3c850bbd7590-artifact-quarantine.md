---
type: change
record_id: change-a4cb962beea34d6491bc3c850bbd7590
date: 2026-08-18
title: 修复 dossier/plan 半套 artifact 与调查 revision 混用风险
status: done
source: Phase 11 runtime/code review
key_conclusion: dossier 与 plan 现在共享 investigation_id，scheduler 通过 readArtifactPair 校验完整性和 revision，不一致/半套 artifact 会 quarantine 后重建，193/193 测试通过。
topics: [qa-guardian, artifacts, reliability]
author: Sisyphus
related_files: [tools/guardian/artifacts.mjs, tools/guardian/investigation-runtime.mjs, tools/guardian/scheduler.mjs]
---

## Change Content

- investigation runtime 为每次调查生成 investigation_id，并写入 dossier/plan；
- artifacts 新增 readArtifactPair 和 quarantineArtifacts；
- scheduler 在 shadow/enforced 读取 artifact pair，缺失或 revision mismatch 时隔离旧文件后重建；
- 保持原子单文件写入和 legacy 状态兼容。

## Reason for Change

review 发现 dossier 写入后 plan 生成失败或不同调查 revision 混用时，scheduler 可能读取半套/混代 artifact，导致计划来源不一致。

## Impact Scope

调查 artifact 读取和重建安全；不改变 legacy 模式和现有 plan gate 逻辑。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 193/193 pass。

## Notes

下一项是独立 QA verdict 的机器化契约和 PR 前检查。
