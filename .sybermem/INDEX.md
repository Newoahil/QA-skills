# SyberMem Index

This file summarizes all project changes, decisions, requirements, and bug records.

---

## Key Conclusions

<!-- One-line core conclusion per record. Format: [id] #topic1 #topic2 — description (date) -->
<!-- add new conclusions here -->
- [bug-1a88afaf58fe4f13859d209b49b49027] #qa-guardian #deployment #docker — docker-compose.yml 用 ports 8787:8787 硬绑宿主端口，在共享 Dokploy 主机上 8787 已被占用导致 "port is already allocated" 启动失败；改为仅 expose 8787、由 Dokploy Domain 反代路由到容器端口，部署不再抢宿主端口。 (2026-08-18)
- [bug-541a9d6211594221a5ceb08950e80881] #qa-guardian #windows #encoding — Windows bat 的分支 fall-through 会重复调用 PowerShell 并产生大量命令未找到错误；无 BOM UTF-8 的 PowerShell 中文脚本在 PS5.1 解析失败，纯 BOM/控制台编码不一致又导致中文乱码；改为显式 goto 分支、PowerShell 脚本 UTF-8 BOM、bat chcp 65001，cmd 冒烟只执行一次且中文引导可读。 (2026-08-18)
- [bug-9df5a75c67504f4fac0d315dd7cef2dd] #qa-guardian #windows #launcher — scheduler-start.bat 的 if 分支执行 PowerShell 后没有 goto done，cmd 继续落入后续 start_target/start_init 标签，重复启动脚本并将参数/文本当命令，导致大量“不是内部或外部命令”错误；改为显式 goto 分支收尾后 cmd 冒烟只执行一次。 (2026-08-18)
- [bug-addaeb3484574da4898bc2d0d5a022d6] #qa-guardian #windows #configuration — 启动脚本从 tools/guardian 双击时把 QA-skills 工具目录作为当前工作目录并默认 target_repo，导致寻找错误的 .qa/guardian/config.json；现在只有当前目录已配置 Guardian 才回退使用，否则要求输入真实业务项目目录，并同步保护 scheduler.mjs 直接启动路径。 (2026-08-18)
- [change-39d97b0a4c854e3893e13ba9e9a5859d] #qa-guardian #documentation #deployment — 修复 review-work 文档缺口——README 更正 scheduler 已交付状态+补运行段+config 键表+作者授权安全项，验收用例新增 UC-H..UC-K（授权/N=1/通知/飞书回调）并把测试数更新到 128，设计文档 §11B.5-a 补记飞书通道/回调/command_authors/FR-21 接线为已交付范围，文档与代码对齐。 (2026-08-18)
- [change-5abf095ac5524443a5d7a9038a01a1e8] #qa-guardian #security #concurrency — 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。 (2026-08-18)
- [change-66dd4c4f08114b48899480c39d8052a7] #qa-guardian #watch-mode #followup — 增加 watch_mode=new-open 自动发现值守启动后新建 issue、scheduler 领取标签投影和 /guardian followup 新验收轮次；DONE/GATE_2_WAIT 不再静默重复处理，146/146 测试通过。 (2026-08-18)
- [change-6ff6c658477b423eae1d6e18a33f92b9] #qa-guardian #observability #windows — 新增 runtime-io 统一 BOM-safe JSON 读取、stderr JSONL 结构化日志和 DEVer banner，runtime/scheduler/WS/HTTP server 接入阶段/错误事件且不泄露密钥；PowerShell 生成的 BOM config 现在可加载，测试 139/139 通过。 (2026-08-18)
- [change-c4f7796c3fa940589c4c90921c26455c] #qa-guardian #notification #deployment — 修复 review-work 阻塞项——新增 notify-io.mjs 把通知投递（gh 评论+curl webhook，幂等持久化 last_notified_state）真正接进 scheduler tick 满足 FR-21，并补 DEPLOY.md + bootstrap 指引让常驻 scheduler 与飞书回调可被新用户部署，128/128 测试通过。 (2026-08-18)
- [change-c783251f5b134af9b8bd7e15628fc7c6] #qa-guardian #deployment #usability — 新增 scheduler-start.ps1/.sh 一键启动（自动补 PATH/解析 node/校验 command_authors），目标仓库支持三级注入（CLI --repo > env QA_GUARDIAN_REPO > 旁置 scheduler.config.json > cwd，scheduler.mjs 抽出可测的 resolveRepoDir），并补 .env.example + DEPLOY 回调部署清单（本地 compose 自测 + Dokploy），129/129 测试通过。 (2026-08-18)
- [change-c79535dd171745ee98a74bae8ca3c2ba] #qa-guardian #review #followup — 将 DONE followup、Gate 通知和跨轮次 DONE 幂等的 focused injected regression 纳入正式测试，完整 Guardian suite 达到 153/153 pass，避免审查证据依赖未跟踪临时文件。 (2026-08-18)
- [change-c9452e10a1264645a06915267c49e44d] #qa-guardian #feishu #followup — 修复 DONE 飞书 followup 的空输入漏洞、Gate 1/Gate 2 卡片通知不可达、跨轮次 DONE 通知幂等标记继承问题，并补 UC-L 与回归测试，149/149 测试通过。 (2026-08-18)
- [change-d4732a411e254c618517828d62e5ed70] #qa-guardian #usability #deployment — scheduler-start.ps1 增 -Init/-CommandAuthors/-BaseBranch，config 不存在时一步创建（BOM-free UTF-8，修 PS5.1 Set-Content BOM 导致 node JSON.parse 失败）或交互提示，已存在则直接启动；新增 scheduler-start.bat 双击入口（自动 ExecutionPolicy Bypass 调 ps1 并转发参数），129/129 测试通过、init 冒烟验证 config 可被 node 解析。 (2026-08-18)

## Archived Conclusions

<!-- Not injected at session start; findable via /sybermem-search -->
<!-- Suffix each line with: [superseded by <id>] or [compressed in <id>] or [archived] -->
<!-- add new archived conclusions here -->

---

## Phase Digests

| Number | Date | Title | Status | Coverage | Link |
|--------|------|-------|--------|----------|------|
<!-- add new digest records here -->

---

## Theme Digests

| Number | Date | Theme | Status | Coverage | Link |
|--------|------|-------|--------|----------|------|
<!-- add new theme digest records here -->

---

## Feature Changes

| ID | Date | Title | Status | Link |
|----|------|-------|--------|------|
<!-- add new records here -->
| change-39d97b0a4c854e3893e13ba9e9a5859d | 2026-08-18 | QA Guardian 文档收尾第三批（README/验收用例/设计文档对齐） | done | [link](changes/2026-08-18-change-39d97b0a4c854e3893e13ba9e9a5859d-guardian-docs-batch3.md) |
| change-5abf095ac5524443a5d7a9038a01a1e8 | 2026-08-18 | QA Guardian 安全+并发修复第一批（授权/锁/去 shell/回调硬化） | done | [link](changes/2026-08-18-change-5abf095ac5524443a5d7a9038a01a1e8-guardian-security-concurrency-batch1.md) |
| change-66dd4c4f08114b48899480c39d8052a7 | 2026-08-18 | QA Guardian new-open 自动发现与 followup 多轮验收 | done | [link](changes/2026-08-18-change-66dd4c4f08114b48899480c39d8052a7-new-open-followup.md) |
| change-6ff6c658477b423eae1d6e18a33f92b9 | 2026-08-18 | QA Guardian BOM 兼容、结构化日志与 DEVer 启动体验 | done | [link](changes/2026-08-18-change-6ff6c658477b423eae1d6e18a33f92b9-runtime-logging.md) |
| change-c4f7796c3fa940589c4c90921c26455c | 2026-08-18 | QA Guardian 运维就绪第二批（通知投递接线 + DEPLOY + bootstrap 指引） | done | [link](changes/2026-08-18-change-c4f7796c3fa940589c4c90921c26455c-guardian-notify-wiring-deploy-batch2.md) |
| change-c783251f5b134af9b8bd7e15628fc7c6 | 2026-08-18 | QA Guardian scheduler 一键启动脚本 + 目标仓库可注入 + 回调部署清单 | done | [link](changes/2026-08-18-change-c783251f5b134af9b8bd7e15628fc7c6-guardian-oneclick-start-target-injection.md) |
| change-c79535dd171745ee98a74bae8ca3c2ba | 2026-08-18 | DONE followup/Gate 通知 review 回归测试正式纳入 | done | [link](changes/2026-08-18-change-c79535dd171745ee98a74bae8ca3c2ba-followup-review-regression.md) |
| change-c9452e10a1264645a06915267c49e44d | 2026-08-18 | 修复 DONE followup 卡片 review 阻塞项 | done | [link](changes/2026-08-18-change-c9452e10a1264645a06915267c49e44d-followup-review-fixes.md) |
| change-d4732a411e254c618517828d62e5ed70 | 2026-08-18 | QA Guardian scheduler 一键创建 config + 启动 + .bat 双击入口 | done | [link](changes/2026-08-18-change-d4732a411e254c618517828d62e5ed70-guardian-init-and-bat-launcher.md) |

## Technical Decisions

| ID | Date | Title | Status | Link |
|----|------|-------|--------|------|
<!-- add new records here -->

## Requirements / Discussions

| ID | Date | Title | Source | Priority | Link |
|----|------|-------|--------|----------|------|
<!-- add new records here -->

## Bug Fix Records

| ID | Date | Title | Severity | Link |
|----|------|-------|----------|------|
<!-- add new records here -->
| bug-1a88afaf58fe4f13859d209b49b49027 | 2026-08-18 | 飞书回调服务 Dokploy 部署失败——compose 硬绑宿主端口 8787 冲突 | high | [link](bugs/2026-08-18-bug-1a88afaf58fe4f13859d209b49b49027-dokploy-port-collision.md) |
| bug-541a9d6211594221a5ceb08950e80881 | 2026-08-18 | Windows bat/PowerShell 启动引导乱码与分支重复执行 | medium | [link](bugs/2026-08-18-bug-541a9d6211594221-bat-chinese-output.md) |
| bug-9df5a75c67504f4fac0d315dd7cef2dd | 2026-08-18 | Windows scheduler-start.bat fall-through 重复执行导致大量命令未找到错误 | high | [link](bugs/2026-08-18-bug-9df5a75c67504f4fac0d315dd7cef2dd-bat-fallthrough.md) |
| bug-addaeb3484574da4898bc2d0d5a022d6 | 2026-08-18 |  | high | [link](bugs/2026-08-18-bug-addaeb3484574da4898bc2d0d5a022d6-target-repo-fallback.md) |

## Usage

- **changes/**: Record all feature changes
- **decisions/**: Record important technical decisions and their rationale
- **requirements/**: Record discussion processes, requirement sources, and design reasoning
- **bugs/**: Record bug analysis and fix approaches
- **analysis/phase-index.md**: Persistent project phase analysis state used to track candidates, confirmed phases, and incremental analysis progress

`.sybermem/INDEX.md` is derived from canonical record files. Use `sybermem project index build` to regenerate it and `sybermem project index check` to verify it is current.

---

## Topic Index

<!-- Auto-maintained: maps topic tags to record IDs for fast lookup -->
- concurrency: change-5abf095ac5524443a5d7a9038a01a1e8
- configuration: bug-addaeb3484574da4898bc2d0d5a022d6
- deployment: bug-1a88afaf58fe4f13859d209b49b49027, change-39d97b0a4c854e3893e13ba9e9a5859d, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- docker: bug-1a88afaf58fe4f13859d209b49b49027
- documentation: change-39d97b0a4c854e3893e13ba9e9a5859d
- encoding: bug-541a9d6211594221a5ceb08950e80881
- feishu: change-c9452e10a1264645a06915267c49e44d
- followup: change-66dd4c4f08114b48899480c39d8052a7, change-c79535dd171745ee98a74bae8ca3c2ba, change-c9452e10a1264645a06915267c49e44d
- launcher: bug-9df5a75c67504f4fac0d315dd7cef2dd
- notification: change-c4f7796c3fa940589c4c90921c26455c
- observability: change-6ff6c658477b423eae1d6e18a33f92b9
- qa-guardian: bug-1a88afaf58fe4f13859d209b49b49027, bug-541a9d6211594221a5ceb08950e80881, bug-9df5a75c67504f4fac0d315dd7cef2dd, bug-addaeb3484574da4898bc2d0d5a022d6, change-39d97b0a4c854e3893e13ba9e9a5859d, change-5abf095ac5524443a5d7a9038a01a1e8, change-66dd4c4f08114b48899480c39d8052a7, change-6ff6c658477b423eae1d6e18a33f92b9, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-c79535dd171745ee98a74bae8ca3c2ba, change-c9452e10a1264645a06915267c49e44d, change-d4732a411e254c618517828d62e5ed70
- review: change-c79535dd171745ee98a74bae8ca3c2ba
- security: change-5abf095ac5524443a5d7a9038a01a1e8
- usability: change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- watch-mode: change-66dd4c4f08114b48899480c39d8052a7
- windows: bug-541a9d6211594221a5ceb08950e80881, bug-9df5a75c67504f4fac0d315dd7cef2dd, bug-addaeb3484574da4898bc2d0d5a022d6, change-6ff6c658477b423eae1d6e18a33f92b9
