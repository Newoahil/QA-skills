---
type: change
record_id: change-d4732a411e254c618517828d62e5ed70
date: 2026-08-18
title: QA Guardian scheduler 一键创建 config + 启动 + .bat 双击入口
status: done
source: 用户要求（一键指定并创建 config 后启动；已存在则直接启动；Windows 可 .bat 双击）
key_conclusion: scheduler-start.ps1 增 -Init/-CommandAuthors/-BaseBranch，config 不存在时一步创建（BOM-free UTF-8，修 PS5.1 Set-Content BOM 导致 node JSON.parse 失败）或交互提示，已存在则直接启动；新增 scheduler-start.bat 双击入口（自动 ExecutionPolicy Bypass 调 ps1 并转发参数），129/129 测试通过、init 冒烟验证 config 可被 node 解析。
topics: [qa-guardian, usability, deployment]
author: Sisyphus
related_files: [tools/guardian/scheduler-start.ps1, tools/guardian/scheduler-start.bat, tools/guardian/DEPLOY.md]
related: [change-c783251f5b134af9b8bd7e15628fc7c6]
---

## Change Content

1. `scheduler-start.ps1` 增参数 `-Init`、`-CommandAuthors`、`-BaseBranch`：目标仓库 `.qa/guardian/config.json` **已存在 → 直接启动**；**不存在 → 用 `-Init`/`-CommandAuthors` 一步创建再启动，或交互 `Read-Host` 提示输入可信作者后创建**。创建的 config 用 **UTF-8 无 BOM**（`System.IO.File.WriteAllText` + `UTF8Encoding($false)`）——修复 PS 5.1 `Set-Content -Encoding utf8` 写入 BOM 导致 scheduler 侧 `JSON.parse` 报 `Unexpected token` 的问题。
2. 新增 `scheduler-start.bat` 双击入口：`powershell -NoProfile -ExecutionPolicy Bypass -File scheduler-start.ps1` 并按参数个数转发（无参=env/旁置配置解析或交互建 config；1 参=目标仓库；2 参=目标+首个可信作者一步 init）。
3. `DEPLOY.md` 补 `-Init` 一步创建+启动、`.bat` 双击用法。

## Reason for Change

用户要一个入口：能一键指定并创建 config 后启动、已存在则直接启动，且 Windows 最好能 .bat 双击（免手敲 ExecutionPolicy）。原 ps1 缺 config 时只报错、不创建；也没有双击入口。

## Impact Scope

启动易用性（Windows）。scheduler 运行逻辑与测试不变。config 创建走无 BOM 写入，避免 node 解析失败。

## Implementation

见 related_files。init 分支：参数或交互取得 command_authors → 建 `.qa/guardian` → 写无 BOM JSON → 继续启动。bat 按 %1/%2 转发到 ps1。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 129/129 pass（脚本改动不影响单测）。ps1 Parser 解析 OK。init 冒烟：临时目录 `-Init -CommandAuthors testuser` 建出 config，首字节为 `{`(123) 非 BOM，`node -e require(config)` 解析成功。

## Notes

承接一键启动/目标注入（change-c783251f...）。至此 Windows 用户可双击 .bat 或一条命令完成「建 config + 启动值守」。全程 auto-qa 分支。
