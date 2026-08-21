---
type: change
record_id: change-60858dbd238d4a13a5190dc40a7a1965
date: 2026-08-21
title: 修复 Guardian scheduler 启动后 ReferenceError 与 Windows 中文标签重复显示
status: done
key_conclusion: scheduler 调查失败路径不再因 catch 中访问 try 内局部 investigationState 而抛 ReferenceError；启动器可见状态标签改为 ASCII，避免 Windows batch + PowerShell UTF-8 控制台中出现“目目录录/目目标标项项目目”等重复 CJK 标签。
topics: [guardian-scheduler, windows-launcher, runtime-debugging]
related_files:
  - tools/guardian/scheduler.mjs
  - tools/guardian/scheduler-start.ps1
  - tests/guardian/bat-launchers.test.mjs
---

## Change Content
- `scheduler.mjs`：将 `investigationState` 提到 `try/catch` 外层作用域，保证 `catch` 能读取当前 state/opencode session 元数据并写入 `investigation.failed`，不再用 `ReferenceError: investigationState is not defined` 覆盖真实调查错误。
- `scheduler-start.ps1`：把启动 banner、仓库状态、OpenCode URL、progress dir、启动提示、dirty/upstream 错误等可见启动流标签改为 ASCII，降低 Windows Terminal/cmd/PowerShell 编码组合下 CJK 标签重复渲染风险。
- `bat-launchers.test.mjs`：新增回归断言，确保 failure handler 可见 `investigationState`，且启动器可见状态块使用 ASCII 标签，不再包含易重复的中文标签。

## Runtime Evidence
- 复现：`node tools/guardian/scheduler.mjs --repo D:\tuantuanrent.qa-guardian-control` 旧行为每 tick 报 `tick.error` / `investigationState is not defined`。
- 修复后同一路径不再出现该 ReferenceError；实际失败被保留为 `investigation.failed`，当前环境中的真实错误为 `Unexpected end of JSON input`。
- `scheduler-start.ps1 -TargetRepo D:\tuantuanrent -Yes -DryRun ...` 在 dirty tools repo 下输出 ASCII banner/error：`Guardian dir`, `Target repo`, `Command authors`, `Guardian tools repo worktree is dirty...`，不再输出截图中的重复中文标签。

## Verification
- `node --test "tests/guardian/*.test.mjs"`：524/524 pass。
- `node --check tools/guardian/scheduler.mjs`：pass。
- PowerShell parser check for `scheduler-start.ps1`：parse ok。
- `git diff --check`：pass。

## Notes
- 这次修复只解决启动后 scheduler 崩溃被 ReferenceError 覆盖、以及启动状态标签的 Windows 可读性问题；当前真实调查失败 `Unexpected end of JSON input` 是后续独立问题，至少现在会被正常记录/展示而不是被 ReferenceError 掩盖。
