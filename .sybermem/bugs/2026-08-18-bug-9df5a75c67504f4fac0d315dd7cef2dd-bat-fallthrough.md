---
type: bug
record_id: bug-9df5a75c67504f4fac0d315dd7cef2dd
date: 2026-08-18
title: Windows scheduler-start.bat fall-through 重复执行导致大量命令未找到错误
source: 用户真实运行 scheduler-start.bat 报错
severity: high
status: resolved
key_conclusion: scheduler-start.bat 的 if 分支执行 PowerShell 后没有 goto done，cmd 继续落入后续 start_target/start_init 标签，重复启动脚本并将参数/文本当命令，导致大量“不是内部或外部命令”错误；改为显式 goto 分支收尾后 cmd 冒烟只执行一次。
topics: [qa-guardian, windows, launcher]
---

## Bug Description

用户使用 Windows 批处理入口时，反复出现 `'uardian'`、`'ns'`、`'M'`、`'Double-click'` 等“不是内部或外部命令”错误，并需要 Ctrl-C 终止。

## Root Cause

原 `scheduler-start.bat` 使用括号 `if/else` 分支。每个分支执行 PowerShell 后没有跳转到共同结束标签，cmd 会继续向下执行后续标签 `start_target`、`start_init`，导致 scheduler-start.ps1 被重复调用；重复调用中的参数/输出文本被 cmd 进一步解释为命令。

## Solution

重写为纯 ASCII、显式标签和 `goto done` 控制流：无参进入 `start_default`，一个参数进入 `start_target`，两个参数进入 `start_init`，每个分支执行一次 PowerShell 后立即跳到 `done`。保留 `ExecutionPolicy Bypass` 和参数转发。

## Prevention Measures

Windows `.bat` 分支必须显式跳转结束，避免标签 fall-through；新增/修改 bat 后用 `cmd.exe /d /c call scheduler-start.bat <invalid-path>` 冒烟验证只执行一次。

## Related Changes

修复提交与 `scheduler-start.bat`；PS1/Node 逻辑未修改。
