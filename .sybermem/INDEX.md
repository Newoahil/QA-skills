# SyberMem Index

This file summarizes all project changes, decisions, requirements, and bug records.

---

## Key Conclusions

<!-- One-line core conclusion per record. Format: [id] #topic1 #topic2 — description (date) -->
<!-- add new conclusions here -->
- [bug-1a88afaf58fe4f13859d209b49b49027] #qa-guardian #deployment #docker — docker-compose.yml 用 ports 8787:8787 硬绑宿主端口，在共享 Dokploy 主机上 8787 已被占用导致 "port is already allocated" 启动失败；改为仅 expose 8787、由 Dokploy Domain 反代路由到容器端口，部署不再抢宿主端口。 (2026-08-18)
- [change-39d97b0a4c854e3893e13ba9e9a5859d] #qa-guardian #documentation #deployment — 修复 review-work 文档缺口——README 更正 scheduler 已交付状态+补运行段+config 键表+作者授权安全项，验收用例新增 UC-H..UC-K（授权/N=1/通知/飞书回调）并把测试数更新到 128，设计文档 §11B.5-a 补记飞书通道/回调/command_authors/FR-21 接线为已交付范围，文档与代码对齐。 (2026-08-18)
- [change-5abf095ac5524443a5d7a9038a01a1e8] #qa-guardian #security #concurrency — 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。 (2026-08-18)
- [change-c4f7796c3fa940589c4c90921c26455c] #qa-guardian #notification #deployment — 修复 review-work 阻塞项——新增 notify-io.mjs 把通知投递（gh 评论+curl webhook，幂等持久化 last_notified_state）真正接进 scheduler tick 满足 FR-21，并补 DEPLOY.md + bootstrap 指引让常驻 scheduler 与飞书回调可被新用户部署，128/128 测试通过。 (2026-08-18)
- [change-c783251f5b134af9b8bd7e15628fc7c6] #qa-guardian #deployment #usability — 新增 scheduler-start.ps1/.sh 一键启动（自动补 PATH/解析 node/校验 command_authors），目标仓库支持三级注入（CLI --repo > env QA_GUARDIAN_REPO > 旁置 scheduler.config.json > cwd，scheduler.mjs 抽出可测的 resolveRepoDir），并补 .env.example + DEPLOY 回调部署清单（本地 compose 自测 + Dokploy），129/129 测试通过。 (2026-08-18)
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
| change-c4f7796c3fa940589c4c90921c26455c | 2026-08-18 | QA Guardian 运维就绪第二批（通知投递接线 + DEPLOY + bootstrap 指引） | done | [link](changes/2026-08-18-change-c4f7796c3fa940589c4c90921c26455c-guardian-notify-wiring-deploy-batch2.md) |
| change-c783251f5b134af9b8bd7e15628fc7c6 | 2026-08-18 | QA Guardian scheduler 一键启动脚本 + 目标仓库可注入 + 回调部署清单 | done | [link](changes/2026-08-18-change-c783251f5b134af9b8bd7e15628fc7c6-guardian-oneclick-start-target-injection.md) |
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
- deployment: bug-1a88afaf58fe4f13859d209b49b49027, change-39d97b0a4c854e3893e13ba9e9a5859d, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- docker: bug-1a88afaf58fe4f13859d209b49b49027
- documentation: change-39d97b0a4c854e3893e13ba9e9a5859d
- notification: change-c4f7796c3fa940589c4c90921c26455c
- qa-guardian: bug-1a88afaf58fe4f13859d209b49b49027, change-39d97b0a4c854e3893e13ba9e9a5859d, change-5abf095ac5524443a5d7a9038a01a1e8, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- security: change-5abf095ac5524443a5d7a9038a01a1e8
- usability: change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
