---
type: bug
record_id: bug-addaeb3484574da4898bc2d0d5a022d6
date: 2026-08-18
source: 用户真实启动输出
severity: high
status: resolved
key_conclusion: 启动脚本从 tools/guardian 双击时把 QA-skills 工具目录作为当前工作目录并默认 target_repo，导致寻找错误的 .qa/guardian/config.json；现在只有当前目录已配置 Guardian 才回退使用，否则要求输入真实业务项目目录，并同步保护 scheduler.mjs 直接启动路径。
topics: [qa-guardian, windows, configuration]
---

## Bug Description

启动输出显示 `target repo: D:\QA-skills\tools\guardian` 或 `D:\QA-skills`，随后在工具仓库下寻找 `.qa\guardian\config.json`。

## Root Cause

启动脚本的最低优先级回退是当前目录；双击 `.bat` 时当前目录可能是 QA-skills 或 tools/guardian，而这些不是被监控的业务项目。

## Solution

目标解析改为：参数 > `QA_GUARDIAN_REPO` > `scheduler.config.json` > 仅当当前目录已有 `.qa/guardian/config.json` 才使用当前目录；否则中文提示输入业务项目目录。底层 scheduler 直接运行也要求目标目录已有 config，不再静默运行工具仓库。

## Prevention Measures

文档明确 `target_repo` 是被监控的业务仓库；双击启动优先使用 env/旁置配置；未指定时交互询问，不做危险的静默回退。

## Related Changes

`scheduler-start.ps1`、`scheduler-start.sh`、`scheduler.mjs`、`DEPLOY.md`。
