---
type: change
record_id: change-fc28793f11104036ad20f0cb288bda6f
date: 2026-08-21
title: 修复 Guardian 组合启动器 Windows 启动回归
status: done
key_conclusion: 组合启动器在 Windows 上优先使用 npm opencode.cmd，避免把 opencode.ps1 shim 直接交给 Start-Process 导致打开为文本；scheduler-start 的 CommandAuthors 预检现在接受逗号/空格字符串并规范化为数组，避免 -CommandAuthors goudaren 在 dry-run/preflight 被误判为非法。
topics: [guardian-launcher, windows-powershell, startup]
related_files:
  - tools/guardian/guardian-start.ps1
  - tools/guardian/scheduler-start.ps1
  - tests/guardian/guardian-start.test.mjs
  - tests/guardian/bat-launchers.test.mjs
---

## Change Content
- `Resolve-OpencodeBin` 改为先查 `APPDATA\npm\opencode.cmd`，再查 `opencode.ps1` 和真实 `opencode.exe`，最后才走 `Get-Command opencode`，避免当前环境中 `Get-Command` 命中 `opencode.ps1` 后 `Start-Process` 按文件关联打开脚本文本。
- `Normalize-CommandAuthors` 支持字符串输入，把逗号/空格分隔的 `-CommandAuthors goudaren` 规范化为数组；修复组合启动器 preflight 调 scheduler-start 时把字符串当 malformed array 拒绝。
- 新增 launcher 回归测试：确认组合启动器避免直接优先 npm PowerShell shim；确认 scheduler 对 `CommandAuthors` 先走 prompt/参数字符串再 normalize。

## Runtime Evidence
- 复现用户现象时 `Get-Command opencode` 返回 `ExternalScript C:\Users\ttx\AppData\Roaming\npm\opencode.ps1`，该文件内容就是 `#!/usr/bin/env pwsh ... opencode.exe` shim；这解释了“用 txt 打开”。
- 复现 preflight：`scheduler-start.ps1 ... -CommandAuthors goudaren` 旧行为报 `command_authors 必须是非空登录名数组。`；修复后该错误消失，preflight 继续到 Guardian 工具仓库 clean gate（修复未提交前符合预期）。

## Verification
- `node --test "tests/guardian/*.test.mjs"`：522/522 pass。
- PowerShell parser checks：`guardian-start.ps1` 和 `scheduler-start.ps1` parse ok。
- `git diff --check`：pass。

## Notes
- 修复不改变启动器只读/既有 binding 策略，也不改变 scheduler 状态机。
- 修复提交后仍需从 clean worktree 再跑一次实际 preflight/launcher 验证。
