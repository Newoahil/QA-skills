# SyberMem Index

This file summarizes all project changes, decisions, requirements, and bug records.

---

## Key Conclusions

<!-- One-line core conclusion per record. Format: [id] #topic1 #topic2 — description (date) -->
<!-- add new conclusions here -->
- [bug-19e5ffff30db46ccbca9f8ca73551ad1] #qa-guardian #security #runtime — Phase 11 发现生产镜像可能包含本地 secrets、unattended 默认 legacy 绕过 plan gate、stale lock takeover 非原子和 non-idempotent STALLED rerun 风险；本批已加 .dockerignore/env-only production loader、enforced 默认、原子 stale-lock takeover 和 stall guard，仍待 QA machine enforcement/timeout/state persistence。 ()
- [bug-1a88afaf58fe4f13859d209b49b49027] #qa-guardian #deployment #docker — docker-compose.yml 用 ports 8787:8787 硬绑宿主端口，在共享 Dokploy 主机上 8787 已被占用导致 "port is already allocated" 启动失败；改为仅 expose 8787、由 Dokploy Domain 反代路由到容器端口，部署不再抢宿主端口。 (2026-08-18)
- [bug-541a9d6211594221a5ceb08950e80881] #qa-guardian #windows #encoding — Windows bat 的分支 fall-through 会重复调用 PowerShell 并产生大量命令未找到错误；无 BOM UTF-8 的 PowerShell 中文脚本在 PS5.1 解析失败，纯 BOM/控制台编码不一致又导致中文乱码；改为显式 goto 分支、PowerShell 脚本 UTF-8 BOM、bat chcp 65001，cmd 冒烟只执行一次且中文引导可读。 (2026-08-18)
- [bug-9df5a75c67504f4fac0d315dd7cef2dd] #qa-guardian #windows #launcher — scheduler-start.bat 的 if 分支执行 PowerShell 后没有 goto done，cmd 继续落入后续 start_target/start_init 标签，重复启动脚本并将参数/文本当命令，导致大量“不是内部或外部命令”错误；改为显式 goto 分支收尾后 cmd 冒烟只执行一次。 (2026-08-18)
- [bug-addaeb3484574da4898bc2d0d5a022d6] #qa-guardian #windows #configuration — 启动脚本从 tools/guardian 双击时把 QA-skills 工具目录作为当前工作目录并默认 target_repo，导致寻找错误的 .qa/guardian/config.json；现在只有当前目录已配置 Guardian 才回退使用，否则要求输入真实业务项目目录，并同步保护 scheduler.mjs 直接启动路径。 (2026-08-18)
- [change-0071a9a0e32c40c28601c3ff7d6ad8b6] #qa-guardian #plan-gate #runtime — scheduler 现在消费 investigation_mode，在 shadow/enforced 模式读取 dossier/plan 并调用 assessFixingEntry，未通过计划门不启动 write-capable Guardian；legacy 保持兼容，190/190 测试通过。 (2026-08-18)
- [change-0fcf1b08d1784c49b5e6ec1c2d6c527f] #qa-guardian #artifacts #state — 新增 dossier/plan 原子 artifact store，state schema 增加调查阶段、specialist、evidence、plan、生产依赖、round 元数据并兼容旧记录，167/167 测试通过。 (2026-08-18)
- [change-12b834a1483f4fad8368e33dfe64947a] #qa-guardian #qa #state — 新增 machine-readable qa-verdict contract，要求 PASS 前置 PR；scheduler 启动 command-driven run 前持久化 consumed comment、clearFixRounds 和 stall_retries；196/196 测试通过。 (2026-08-18)
- [change-260993fcf6504e8eb9e54f84f0dd45f4] #qa-guardian #integration #investigation — 新增 investigation-runtime.mjs，把注入的 specialist runner、coordinator dossier synthesis、artifact persistence、plan builder 和 plan validation 串成可调用 runtime adapter，192/192 测试通过。 ()
- [change-2955e2780a8b4097bfdf09d765453605] #qa-guardian #reliability #timeout — scheduler child invocation 增加 child_timeout_ms 与 kill/timeout code，investigation failure 写入 dossier/plan failed、attempts/error/phase 状态，192/192 测试通过。 (2026-08-18)
- [change-39d97b0a4c854e3893e13ba9e9a5859d] #qa-guardian #documentation #deployment — 修复 review-work 文档缺口——README 更正 scheduler 已交付状态+补运行段+config 键表+作者授权安全项，验收用例新增 UC-H..UC-K（授权/N=1/通知/飞书回调）并把测试数更新到 128，设计文档 §11B.5-a 补记飞书通道/回调/command_authors/FR-21 接线为已交付范围，文档与代码对齐。 (2026-08-18)
- [change-41675aeea2c446eea10506e55cbbd08d] #qa-guardian #documentation #migration — README/DEPLOY/验收文档补充 investigation_mode legacy/shadow/enforced、dossier/plan artifact 和 rollback 说明，187/187 测试通过。 (2026-08-18)
- [change-47dc8b8da91e4b6fa99315f0e3712686] #qa-guardian #specialists #read-only — 新增 guardian-code/business/runtime/docs 四类只读 specialist agent，扩展 qa-guardian 仅允许这些指定只读角色和 qa/explore，所有写入/安装/生产/网络越权保持拒绝，167/167 测试通过。 (2026-08-18)
- [change-494b8d8a5ef14682bd96aeefdd945693] #qa-guardian #planning #safety-gate — 新增 plan-validator.mjs，要求根因证据、影响文件、非目标、测试/验收、回滚、风险和 evidence_ids 完整；request 不可默认 LOW，未确定事实和无效 dossier 不得进入 autonomous-ready，164/164 测试通过。 (2026-08-18)
- [change-559f7f25f2834bb2b50e4b7bcf9a3bfb] #qa-guardian #evidence #unattended-quality — 新增 evidence.mjs 结构化证据、假设评分、dossier 校验和决策就绪判断，覆盖 bug/request、证据 provenance、未确定事实与 request 验收标准，158/158 测试通过。 (2026-08-18)
- [change-5abf095ac5524443a5d7a9038a01a1e8] #qa-guardian #security #concurrency — 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。 (2026-08-18)
- [change-66dd4c4f08114b48899480c39d8052a7] #qa-guardian #watch-mode #followup — 增加 watch_mode=new-open 自动发现值守启动后新建 issue、scheduler 领取标签投影和 /guardian followup 新验收轮次；DONE/GATE_2_WAIT 不再静默重复处理，146/146 测试通过。 (2026-08-18)
- [change-6ff6c658477b423eae1d6e18a33f92b9] #qa-guardian #observability #windows — 新增 runtime-io 统一 BOM-safe JSON 读取、stderr JSONL 结构化日志和 DEVer banner，runtime/scheduler/WS/HTTP server 接入阶段/错误事件且不泄露密钥；PowerShell 生成的 BOM config 现在可加载，测试 139/139 通过。 (2026-08-18)
- [change-a1a8b1267e6946a098431b0dfbd102b6] #qa-guardian #security #reliability — 修复 specialist JSON 尾部对象注入风险，并将 scheduler 获取锁后的 investigation/plan/claim/run 全部置于统一 finally 释放锁，192/192 测试通过。 (2026-08-18)
- [change-a43b7803dba74e9bae48e0bed222011c] #qa-guardian #integration #recovery — 补齐此前遗漏未提交的 capability discovery、pipeline harness 及 followup schema_version 测试修正，192/192 测试通过，确保 auto-qa 工作区与阶段记录一致。 (2026-08-18)
- [change-a4cb962beea34d6491bc3c850bbd7590] #qa-guardian #artifacts #reliability — dossier 与 plan 现在共享 investigation_id，scheduler 通过 readArtifactPair 校验完整性和 revision，不一致/半套 artifact 会 quarantine 后重建，193/193 测试通过。 (2026-08-18)
- [change-ab75b9ee58354673b48b9c875f91a889] #qa-guardian #investigation #orchestration — 新增 investigation-coordinator 纯核心，按 issue complexity 选择正交只读 specialist，生成实际 capability-aware prompt，合并 hypotheses/evidence/unresolved facts 为 dossier 并计算 decision readiness，175/175 测试通过。 (2026-08-18)
- [change-c4f7796c3fa940589c4c90921c26455c] #qa-guardian #notification #deployment — 修复 review-work 阻塞项——新增 notify-io.mjs 把通知投递（gh 评论+curl webhook，幂等持久化 last_notified_state）真正接进 scheduler tick 满足 FR-21，并补 DEPLOY.md + bootstrap 指引让常驻 scheduler 与飞书回调可被新用户部署，128/128 测试通过。 (2026-08-18)
- [change-c783251f5b134af9b8bd7e15628fc7c6] #qa-guardian #deployment #usability — 新增 scheduler-start.ps1/.sh 一键启动（自动补 PATH/解析 node/校验 command_authors），目标仓库支持三级注入（CLI --repo > env QA_GUARDIAN_REPO > 旁置 scheduler.config.json > cwd，scheduler.mjs 抽出可测的 resolveRepoDir），并补 .env.example + DEPLOY 回调部署清单（本地 compose 自测 + Dokploy），129/129 测试通过。 (2026-08-18)
- [change-c79535dd171745ee98a74bae8ca3c2ba] #qa-guardian #review #followup — 将 DONE followup、Gate 通知和跨轮次 DONE 幂等的 focused injected regression 纳入正式测试，完整 Guardian suite 达到 153/153 pass，避免审查证据依赖未跟踪临时文件。 (2026-08-18)
- [change-c9452e10a1264645a06915267c49e44d] #qa-guardian #feishu #followup — 修复 DONE 飞书 followup 的空输入漏洞、Gate 1/Gate 2 卡片通知不可达、跨轮次 DONE 通知幂等标记继承问题，并补 UC-L 与回归测试，149/149 测试通过。 (2026-08-18)
- [change-cc34c0f387b04539bef2107012ba5deb] #qa-guardian #runtime-integration #plan-gate — 将 investigation-process/investigation-runtime 接入 scheduler 的 shadow/enforced 路径：真实执行只读 specialist 子进程、写 dossier/plan artifact、执行 plan gate，失败或不完整计划不启动 write-capable Guardian；192/192 测试通过。 (2026-08-18)
- [change-d4732a411e254c618517828d62e5ed70] #qa-guardian #usability #deployment — scheduler-start.ps1 增 -Init/-CommandAuthors/-BaseBranch，config 不存在时一步创建（BOM-free UTF-8，修 PS5.1 Set-Content BOM 导致 node JSON.parse 失败）或交互提示，已存在则直接启动；新增 scheduler-start.bat 双击入口（自动 ExecutionPolicy Bypass 调 ps1 并转发参数），129/129 测试通过、init 冒烟验证 config 可被 node 解析。 (2026-08-18)
- [change-d9e9344cce4a4afbb937c6c637a7931c] #qa-guardian #plan-gate #safety — 新增 plan-gate.mjs，把 legacy/shadow/enforced 三种调查模式映射为是否允许写入，enforced 下只有 dossier-backed decision-complete LOW plan 可自主进入 FIXING，183/183 测试通过。 (2026-08-18)
- [change-e34b035b981b4224a44621ba7457d5b2] #qa-guardian #budgets #reliability — 新增 budgets.mjs 纯预算核心，支持标准/复杂调查预算、specialist 数量/截止时间、剩余预算和 timeout 分类，179/179 测试通过；尚未接入 runtime。 (2026-08-18)

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
| change-0071a9a0e32c40c28601c3ff7d6ad8b6 | 2026-08-18 | 强化 Guardian Phase 8：真实 scheduler plan gate 接入 | done | [link](changes/2026-08-18-change-0071a9a0e32c40c28601c3ff7d6ad8b6-plan-gate-runtime.md) |
| change-0fcf1b08d1784c49b5e6ec1c2d6c527f | 2026-08-18 | 强化 Guardian Phase 3：调查 artifact 持久化与状态扩展 | done | [link](changes/2026-08-18-change-0fcf1b08d1784c49b5e6ec1c2d6c527f-artifact-state.md) |
| change-12b834a1483f4fad8368e33dfe64947a | 2026-08-18 | QA verdict contract 与 scheduler state reconciliation | done | [link](changes/2026-08-18-change-12b834a1483f4fad8368e33dfe64947a-qa-verdict-state.md) |
| change-260993fcf6504e8eb9e54f84f0dd45f4 |  |  | done | [link](changes/2026-08-18-change-260993fcf6504e8eb9e54f84f0dd45f4-investigation-runtime.md) |
| change-2955e2780a8b4097bfdf09d765453605 | 2026-08-18 | 修复 Strong Guardian runtime timeout 与调查失败持久化 | done | [link](changes/2026-08-18-change-2955e2780a8b4097bfdf09d765453605-runtime-reliability.md) |
| change-39d97b0a4c854e3893e13ba9e9a5859d | 2026-08-18 | QA Guardian 文档收尾第三批（README/验收用例/设计文档对齐） | done | [link](changes/2026-08-18-change-39d97b0a4c854e3893e13ba9e9a5859d-guardian-docs-batch3.md) |
| change-41675aeea2c446eea10506e55cbbd08d | 2026-08-18 | 强化 Guardian Phase 10：dossier/plan 迁移文档与 shadow/enforced 回滚说明 | done | [link](changes/2026-08-18-change-41675aeea2c446eea10506e55cbbd08d-phase10-docs.md) |
| change-47dc8b8da91e4b6fa99315f0e3712686 | 2026-08-18 | 强化 Guardian Phase 4：只读调查 specialist 角色 | done | [link](changes/2026-08-18-change-47dc8b8da91e4b6fa99315f0e3712686-specialists.md) |
| change-494b8d8a5ef14682bd96aeefdd945693 | 2026-08-18 | 强化 Guardian Phase 2：Plan Validator | done | [link](changes/2026-08-18-change-494b8d8a5ef14682bd96aeefdd945693-plan-validator.md) |
| change-559f7f25f2834bb2b50e4b7bcf9a3bfb | 2026-08-18 | 强化 Guardian Phase 1：Evidence Contract | done | [link](changes/2026-08-18-change-559f7f25f2834bb2b50e4b7bcf9a3bfb-evidence-contract.md) |
| change-5abf095ac5524443a5d7a9038a01a1e8 | 2026-08-18 | QA Guardian 安全+并发修复第一批（授权/锁/去 shell/回调硬化） | done | [link](changes/2026-08-18-change-5abf095ac5524443a5d7a9038a01a1e8-guardian-security-concurrency-batch1.md) |
| change-66dd4c4f08114b48899480c39d8052a7 | 2026-08-18 | QA Guardian new-open 自动发现与 followup 多轮验收 | done | [link](changes/2026-08-18-change-66dd4c4f08114b48899480c39d8052a7-new-open-followup.md) |
| change-6ff6c658477b423eae1d6e18a33f92b9 | 2026-08-18 | QA Guardian BOM 兼容、结构化日志与 DEVer 启动体验 | done | [link](changes/2026-08-18-change-6ff6c658477b423eae1d6e18a33f92b9-runtime-logging.md) |
| change-a1a8b1267e6946a098431b0dfbd102b6 | 2026-08-18 | 修复 Phase 11 runtime review 发现的计划输出与锁释放风险 | done | [link](changes/2026-08-18-change-a1a8b1267e6946a098431b0dfbd102b6-review-runtime-fixes.md) |
| change-a43b7803dba74e9bae48e0bed222011c | 2026-08-18 | 补齐 Phase 5 capability、Phase 9 pipeline harness 与 schema regression | done | [link](changes/2026-08-18-change-a43b7803dba74e9bae48e0bed222011c-recovered-phase-files.md) |
| change-a4cb962beea34d6491bc3c850bbd7590 | 2026-08-18 | 修复 dossier/plan 半套 artifact 与调查 revision 混用风险 | done | [link](changes/2026-08-18-change-a4cb962beea34d6491bc3c850bbd7590-artifact-quarantine.md) |
| change-ab75b9ee58354673b48b9c875f91a889 | 2026-08-18 | 强化 Guardian Phase 6：调查 specialist coordinator | done | [link](changes/2026-08-18-change-ab75b9ee58354673b48b9c875f91a889-investigation-coordinator.md) |
| change-c4f7796c3fa940589c4c90921c26455c | 2026-08-18 | QA Guardian 运维就绪第二批（通知投递接线 + DEPLOY + bootstrap 指引） | done | [link](changes/2026-08-18-change-c4f7796c3fa940589c4c90921c26455c-guardian-notify-wiring-deploy-batch2.md) |
| change-c783251f5b134af9b8bd7e15628fc7c6 | 2026-08-18 | QA Guardian scheduler 一键启动脚本 + 目标仓库可注入 + 回调部署清单 | done | [link](changes/2026-08-18-change-c783251f5b134af9b8bd7e15628fc7c6-guardian-oneclick-start-target-injection.md) |
| change-c79535dd171745ee98a74bae8ca3c2ba | 2026-08-18 | DONE followup/Gate 通知 review 回归测试正式纳入 | done | [link](changes/2026-08-18-change-c79535dd171745ee98a74bae8ca3c2ba-followup-review-regression.md) |
| change-c9452e10a1264645a06915267c49e44d | 2026-08-18 | 修复 DONE followup 卡片 review 阻塞项 | done | [link](changes/2026-08-18-change-c9452e10a1264645a06915267c49e44d-followup-review-fixes.md) |
| change-cc34c0f387b04539bef2107012ba5deb | 2026-08-18 | 强化 Guardian Phase 9：investigation runtime 接入真实 scheduler | done | [link](changes/2026-08-18-change-cc34c0f387b04539bef2107012ba5deb-phase9-runtime-integration.md) |
| change-d4732a411e254c618517828d62e5ed70 | 2026-08-18 | QA Guardian scheduler 一键创建 config + 启动 + .bat 双击入口 | done | [link](changes/2026-08-18-change-d4732a411e254c618517828d62e5ed70-guardian-init-and-bat-launcher.md) |
| change-d9e9344cce4a4afbb937c6c637a7931c | 2026-08-18 | 强化 Guardian Phase 8：plan-gated execution core | done | [link](changes/2026-08-18-change-d9e9344cce4a4afbb937c6c637a7931c-plan-gate.md) |
| change-e34b035b981b4224a44621ba7457d5b2 | 2026-08-18 | 强化 Guardian Phase 7：调查与子任务预算核心 | done | [link](changes/2026-08-18-change-e34b035b981b4224a44621ba7457d5b2-runtime-budgets.md) |

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
| bug-19e5ffff30db46ccbca9f8ca73551ad1 |  |  | high | [link](bugs/2026-08-18-bug-19e5ffff30db46ccbca9f8ca73551ad1-security-review-blockers.md) |
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
- artifacts: change-0fcf1b08d1784c49b5e6ec1c2d6c527f, change-a4cb962beea34d6491bc3c850bbd7590
- budgets: change-e34b035b981b4224a44621ba7457d5b2
- concurrency: change-5abf095ac5524443a5d7a9038a01a1e8
- configuration: bug-addaeb3484574da4898bc2d0d5a022d6
- deployment: bug-1a88afaf58fe4f13859d209b49b49027, change-39d97b0a4c854e3893e13ba9e9a5859d, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- docker: bug-1a88afaf58fe4f13859d209b49b49027
- documentation: change-39d97b0a4c854e3893e13ba9e9a5859d, change-41675aeea2c446eea10506e55cbbd08d
- encoding: bug-541a9d6211594221a5ceb08950e80881
- evidence: change-559f7f25f2834bb2b50e4b7bcf9a3bfb
- feishu: change-c9452e10a1264645a06915267c49e44d
- followup: change-66dd4c4f08114b48899480c39d8052a7, change-c79535dd171745ee98a74bae8ca3c2ba, change-c9452e10a1264645a06915267c49e44d
- integration: change-260993fcf6504e8eb9e54f84f0dd45f4, change-a43b7803dba74e9bae48e0bed222011c
- investigation: change-260993fcf6504e8eb9e54f84f0dd45f4, change-ab75b9ee58354673b48b9c875f91a889
- launcher: bug-9df5a75c67504f4fac0d315dd7cef2dd
- migration: change-41675aeea2c446eea10506e55cbbd08d
- notification: change-c4f7796c3fa940589c4c90921c26455c
- observability: change-6ff6c658477b423eae1d6e18a33f92b9
- orchestration: change-ab75b9ee58354673b48b9c875f91a889
- plan-gate: change-0071a9a0e32c40c28601c3ff7d6ad8b6, change-cc34c0f387b04539bef2107012ba5deb, change-d9e9344cce4a4afbb937c6c637a7931c
- planning: change-494b8d8a5ef14682bd96aeefdd945693
- qa: change-12b834a1483f4fad8368e33dfe64947a
- qa-guardian: bug-19e5ffff30db46ccbca9f8ca73551ad1, bug-1a88afaf58fe4f13859d209b49b49027, bug-541a9d6211594221a5ceb08950e80881, bug-9df5a75c67504f4fac0d315dd7cef2dd, bug-addaeb3484574da4898bc2d0d5a022d6, change-0071a9a0e32c40c28601c3ff7d6ad8b6, change-0fcf1b08d1784c49b5e6ec1c2d6c527f, change-12b834a1483f4fad8368e33dfe64947a, change-260993fcf6504e8eb9e54f84f0dd45f4, change-2955e2780a8b4097bfdf09d765453605, change-39d97b0a4c854e3893e13ba9e9a5859d, change-41675aeea2c446eea10506e55cbbd08d, change-47dc8b8da91e4b6fa99315f0e3712686, change-494b8d8a5ef14682bd96aeefdd945693, change-559f7f25f2834bb2b50e4b7bcf9a3bfb, change-5abf095ac5524443a5d7a9038a01a1e8, change-66dd4c4f08114b48899480c39d8052a7, change-6ff6c658477b423eae1d6e18a33f92b9, change-a1a8b1267e6946a098431b0dfbd102b6, change-a43b7803dba74e9bae48e0bed222011c, change-a4cb962beea34d6491bc3c850bbd7590, change-ab75b9ee58354673b48b9c875f91a889, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-c79535dd171745ee98a74bae8ca3c2ba, change-c9452e10a1264645a06915267c49e44d, change-cc34c0f387b04539bef2107012ba5deb, change-d4732a411e254c618517828d62e5ed70, change-d9e9344cce4a4afbb937c6c637a7931c, change-e34b035b981b4224a44621ba7457d5b2
- read-only: change-47dc8b8da91e4b6fa99315f0e3712686
- recovery: change-a43b7803dba74e9bae48e0bed222011c
- reliability: change-2955e2780a8b4097bfdf09d765453605, change-a1a8b1267e6946a098431b0dfbd102b6, change-a4cb962beea34d6491bc3c850bbd7590, change-e34b035b981b4224a44621ba7457d5b2
- review: change-c79535dd171745ee98a74bae8ca3c2ba
- runtime: bug-19e5ffff30db46ccbca9f8ca73551ad1, change-0071a9a0e32c40c28601c3ff7d6ad8b6
- runtime-integration: change-cc34c0f387b04539bef2107012ba5deb
- safety: change-d9e9344cce4a4afbb937c6c637a7931c
- safety-gate: change-494b8d8a5ef14682bd96aeefdd945693
- security: bug-19e5ffff30db46ccbca9f8ca73551ad1, change-5abf095ac5524443a5d7a9038a01a1e8, change-a1a8b1267e6946a098431b0dfbd102b6
- specialists: change-47dc8b8da91e4b6fa99315f0e3712686
- state: change-0fcf1b08d1784c49b5e6ec1c2d6c527f, change-12b834a1483f4fad8368e33dfe64947a
- timeout: change-2955e2780a8b4097bfdf09d765453605
- unattended-quality: change-559f7f25f2834bb2b50e4b7bcf9a3bfb
- usability: change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- watch-mode: change-66dd4c4f08114b48899480c39d8052a7
- windows: bug-541a9d6211594221a5ceb08950e80881, bug-9df5a75c67504f4fac0d315dd7cef2dd, bug-addaeb3484574da4898bc2d0d5a022d6, change-6ff6c658477b423eae1d6e18a33f92b9
