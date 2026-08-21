---
type: decision
record_id: decision-038091b9b1ca447db6c8a2d2a86719b4
date: 2026-08-21
title: 本项目每次修改完必须 commit 干净
status: active
supersedes:
key_conclusion: 约定 QA-skills 每次修改（含 SyberMem 记录与重建的 INDEX.md）完成后必须立即 commit 到工作区 clean，因为 Guardian scheduler preflight 要求 tools 仓库干净才能启动，dirty 会直接阻断 guardian-start。
topics: [workflow, guardian-launcher, commit-discipline]
---

## Context
Guardian 组合 launcher (`guardian-start.ps1`) 启动前会跑 scheduler preflight，`scheduler-start.ps1` 强制校验 tools 仓库 (`D:\QA-skills`) 工作区必须 clean（`Guardian工具仓库 工作区不干净，请先提交/暂存/清理后再启动`），否则 fail-closed，TUI 也不会打开。这是防止“监控到未提交的工具版本”的安全设计。实际使用中多次出现：改完代码或写完 SyberMem 记录后忘记 commit，导致下次启动被阻断。用户明确要求：以后本项目每次修改完都要 commit 干净。

## Considered Options
- 放宽 preflight，允许 dirty tools 仓库启动：破坏安全保证，会监控到未提交/不一致的工具版本，否决。
- 增加 `-AllowDirty` 之类开关：增加复杂度且容易被滥用，削弱安全默认，暂不采用。
- 约定“每次修改完立即 commit 干净”作为工作流纪律：保留安全保证，成本低，采纳。

## Final Decision
在 QA-skills 项目采用工作流约定：任何修改（源码、测试、文档、SyberMem 记录 + 重建的 `.sybermem/INDEX.md`）完成后，必须立即 commit 使工作区 clean，再进行 Guardian 启动或交付。SyberMem 记录随同代码提交（沿用仓库既有 `Record ...` commit 风格）。preflight 的 clean-tools 校验保持不变。

## Impact and Consequences
- 每轮交付的收尾步骤固定包含：`git status` 确认 clean；若有未提交产物（尤其 SyberMem 记录/INDEX）先 commit。
- `guardian-start.bat` 启动不再被“自产 dirty 文件”阻断。
- 代价：SyberMem 记录后需要额外一次 commit；这是刻意为之，换取安全默认不被削弱。

## Related Changes
- change-f78313d32e614657bce29b72264e20fb（Guardian TUI current-issue filter）记录后触发过一次 dirty-block，随后以 `Record Guardian TUI current-issue filter` 提交修复。
- guardian-start.ps1 的 scheduler preflight（fail-closed）是本约定的技术触发点。

## Notes
- 适用范围：本项目 `D:\QA-skills`（tools 仓库）。canonical target `D:\tuantuanrent` 及其 control/QA worktree 不在本约定范围内，且严禁被 reset/stash/清理。
- 该记录本身完成后也需按本约定 commit 干净。
