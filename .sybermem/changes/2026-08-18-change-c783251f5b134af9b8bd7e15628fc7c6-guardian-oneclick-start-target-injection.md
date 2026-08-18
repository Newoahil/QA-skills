---
type: change
record_id: change-c783251f5b134af9b8bd7e15628fc7c6
date: 2026-08-18
title: QA Guardian scheduler 一键启动脚本 + 目标仓库可注入 + 回调部署清单
status: done
source: 用户要求（一键启动 + 目标仓库配置/变量注入 + 回调部署步骤补全）
key_conclusion: 新增 scheduler-start.ps1/.sh 一键启动（自动补 PATH/解析 node/校验 command_authors），目标仓库支持三级注入（CLI --repo > env QA_GUARDIAN_REPO > 旁置 scheduler.config.json > cwd，scheduler.mjs 抽出可测的 resolveRepoDir），并补 .env.example + DEPLOY 回调部署清单（本地 compose 自测 + Dokploy），129/129 测试通过。
topics: [qa-guardian, deployment, usability]
author: Sisyphus
related_files: [tools/guardian/scheduler-start.ps1, tools/guardian/scheduler-start.sh, tools/guardian/scheduler.mjs, tools/guardian/scheduler.config.example.json, tools/guardian/.env.example, tools/guardian/DEPLOY.md, .gitignore, tests/guardian/poll.test.mjs]
related: [change-39d97b0a4c854e3893e13ba9e9a5859d]
---

## Change Content

1. **一键启动脚本** `scheduler-start.ps1` / `scheduler-start.sh`：自动解析 node（含 nvm 布局）+ 补 gh/git PATH、校验目标仓库与 `.qa/guardian/config.json`（缺 `command_authors` 时警告——fail-closed 安全键），再启动 scheduler。
2. **目标仓库可注入**：`scheduler.mjs` 抽出纯函数 `resolveRepoDir(argv, env)`，优先级 `--repo` 参数 > 环境变量 `QA_GUARDIAN_REPO` > cwd；启动脚本再在其上叠加旁置文件 `scheduler.config.json`（gitignored，参考 `scheduler.config.example.json`）。四级：CLI > env > 文件 > cwd。
3. **回调部署清单**：新增 `.env.example`（回调服务环境变量模板，`.env` 已 gitignore）；DEPLOY.md 补「本地 docker compose 自测」与「Dokploy Compose 部署」两条可照抄路径 + 一键启动段 + 注入优先级说明。
4. gitignore 增加 `tools/guardian/scheduler.config.json`（含本地路径，机器本地）。

## Reason for Change

用户指出：scheduler 只能手敲长命令（要补 PATH + --repo），需要一键脚本；且目标仓库路径应能配置/变量注入而非每次传参。另外原步骤缺可操作的回调服务部署清单（回调必须部署到公网，不能省）。

## Impact Scope

启动易用性 + 部署可操作性。scheduler.mjs 仅新增 resolveRepoDir 并在 main 使用，行为向后兼容（--repo 仍有效）。无业务代码影响。

## Implementation

见 related_files。resolveRepoDir 纯函数 + 注入 argv/env 可测；启动脚本做 node/gh 解析与 config 安全校验；DEPLOY.md 提供本地自测 + Dokploy 两路径。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 129/129 pass（新增 resolveRepoDir 优先级用例）。ps1 Parser 解析 OK，sh `bash -n` 通过，两个 example JSON 可 require。一键脚本冒烟：env 注入解析到目标仓库、node 自动解析（nvm v26）、缺 config 时 fail-fast 并给出 command_authors 指引。

## Notes

承接文档第三批（change-39d97b0a...）。至此值守启动与回调部署对用户可一键/清单化操作。全程 auto-qa 分支。
