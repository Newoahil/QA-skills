# SyberMem Index

This file summarizes all project changes, decisions, requirements, and bug records.

---

## Key Conclusions

<!-- One-line core conclusion per record. Format: [id] #topic1 #topic2 — description (date) -->
<!-- add new conclusions here -->
- [bug-01f49ed7e02b41eba58ccc630c6170d0] #qa-guardian #launcher #powershell — scheduler-start.ps1 now captures git stderr without PowerShell promoting successful fetch progress to a terminating error, so launcher preflight can continue after benign fetch output. (2026-08-20)
- [bug-09c23cce8bb443d7aadb0f5dea5ce3b7] #opencode-sdk #session-continuity #qa-guardian — Fixed SDK session operations by unwrapping createSession's data.id and using the SDK low-level client with explicit /session/<id>/ URLs, because the generated 1.18.18 path methods request /session/%7Bid%7D/... and fail every prompt. (2026-08-19)
- [bug-19e5ffff30db46ccbca9f8ca73551ad1] #qa-guardian #security #runtime — Phase 11 发现生产镜像可能包含本地 secrets、unattended 默认 legacy 绕过 plan gate、stale lock takeover 非原子和 non-idempotent STALLED rerun 风险；本批已加 .dockerignore/env-only production loader、enforced 默认、原子 stale-lock takeover 和 stall guard，仍待 QA machine enforcement/timeout/state persistence。 ()
- [bug-1a88afaf58fe4f13859d209b49b49027] #qa-guardian #deployment #docker — docker-compose.yml 用 ports 8787:8787 硬绑宿主端口，在共享 Dokploy 主机上 8787 已被占用导致 "port is already allocated" 启动失败；改为仅 expose 8787、由 Dokploy Domain 反代路由到容器端口，部署不再抢宿主端口。 (2026-08-18)
- [bug-1a8b3cf22fc9424ba73e009dd9c4556d] #qa-guardian #launcher #authorization — scheduler-start.ps1 now repairs an existing control config with empty command_authors by asking once for the trusted GitHub login and persisting it, so first-run worktree setup can continue safely after an interrupted attempt. (2026-08-20)
- [bug-26ad869551cf43f585bbfc062876eccc] #qa-guardian #json-schema #validation — Tightened specialist and plan json_schema definitions to match the existing evidence/plan validators, so SDK output is valid by construction \(evidence provenance fields + allowed kinds; risk restricted to LOW/HIGH\). (2026-08-19)
- [bug-541a9d6211594221a5ceb08950e80881] #qa-guardian #windows #encoding — Windows bat 的分支 fall-through 会重复调用 PowerShell 并产生大量命令未找到错误；无 BOM UTF-8 的 PowerShell 中文脚本在 PS5.1 解析失败，纯 BOM/控制台编码不一致又导致中文乱码；改为显式 goto 分支、PowerShell 脚本 UTF-8 BOM、bat chcp 65001，cmd 冒烟只执行一次且中文引导可读。 (2026-08-18)
- [bug-5a7a143fe7f84b4e9ab88dc922c2511b] #qa-guardian #worktree #launcher — scheduler-start.ps1 now treats .qa/guardian and .sybermem state as Guardian-owned when checking control worktree cleanliness, so an empty-author config written during a first-run setup no longer blocks a restart as an external dirty change. (2026-08-20)
- [bug-682f269c0050412797459f52712af366] #opencode-sdk #permissions #qa-guardian — Added complete role-specific no-ask permission matrices for SDK sessions, allowing fixer edits while denying irreversible/install operations and keeping QA/specialists read-only, so headless sessions cannot hang on permission prompts. (2026-08-19)
- [bug-68ea53ff66ef4f62b7f680db1ecebf19] #qa-guardian #gate1 #human-approval — Fixed the SDK-mode plan gate so non-autonomous plans persist GATE_1_WAIT, promote uncertainty to HIGH, write a structured human-approval comment, and exit instead of silently leaving the issue DISCOVERED. (2026-08-19)
- [bug-7cebbfc6c8794207aee4ccebd7974edf] #qa-guardian #gate1 #session-continuity — Persist trusted approve/revise authorization in issue state and let structurally valid plans enter FIXING after human approval, preventing consumed commands from being lost across scheduler restart or a second plan-gate evaluation. (2026-08-19)
- [bug-83b7d5b7c85e4316adc6fa751321262a] #qa-guardian #windows #launcher — dashboard-start.ps1 now uses a PowerShell 5.1 parser-safe ASCII wrapper while the Node dashboard remains Chinese, and first-run worktree setup now asks only for the mode with safe default paths and automatic test-env detection. (2026-08-20)
- [bug-8a392be541a943bdad199b2dd863ca7c] #qa-guardian #json-schema #plan-validation — Made the plan json_schema derive evidence_ids.items.enum from the dossier's known evidence IDs, preventing the model from returning "ID + prose" strings rejected by the plan validator. (2026-08-19)
- [bug-8a5db6c7aa0447189f0e23d02741516c] #qa-guardian #gate2 #state-consistency — Re-read issue state after persisting the QA verdict and before writing GATE_2_WAIT so the PR transition preserves qa_verdict_path, status, and hash. (2026-08-19)
- [bug-8c8b03fc6c9c4adbb115442b042dd400] #opencode-server #windows #qa-guardian — Made the standalone OpenCode server launcher resolve and inject absolute Node, npm, and Git paths so attached fixer/QA/specialist sessions can test, branch, commit, and push without depending on another window's PATH mutations. (2026-08-19)
- [bug-95af95c0c87348659c6d36a12974beb0] #opencode-sdk #qa-session #session-continuity — QA session completion now converges from completed assistant messages when the synchronous prompt HTTP request remains open, with baseline message IDs and cancellation ensuring correct round isolation and no leaked polling timers. (2026-08-19)
- [bug-986e8e7b64f046c1bedbacbcbc65a083] #qa-guardian #launcher #git — scheduler-start.ps1 now checks the Guardian tools repository against the current branch upstream instead of hardcoding main, because local auto-qa launcher fixes must be runnable before they are merged to main. (2026-08-20)
- [bug-99e2cc66c7d34cd28e3bf20ea38814cd] #qa-guardian #powershell #authorization — scheduler-start.ps1 now adds a missing command_authors JSON property with Add-Member -Force instead of direct assignment, so Windows PowerShell 5.1 can persist the trusted author during worktree bootstrap. (2026-08-20)
- [bug-9df5a75c67504f4fac0d315dd7cef2dd] #qa-guardian #windows #launcher — scheduler-start.bat 的 if 分支执行 PowerShell 后没有 goto done，cmd 继续落入后续 start_target/start_init 标签，重复启动脚本并将参数/文本当命令，导致大量“不是内部或外部命令”错误；改为显式 goto 分支收尾后 cmd 冒烟只执行一次。 (2026-08-18)
- [bug-9ea4fabc7f0948ac9dcdf159659e61de] #qa-guardian #git #worktree — scheduler-start.ps1 now parses trimmed git porcelain output from the correct status-column offset, so Guardian-owned .qa/guardian state is ignored without hiding real external control-worktree changes. (2026-08-20)
- [bug-a47057aaf97145de807476aef76844e3] #qa-guardian #qa-verdict #scheduler — Imported writeArtifact in the scheduler so a completed independent QA PASS can be persisted and continue through the QA gate and PR creation. (2026-08-19)
- [bug-addaeb3484574da4898bc2d0d5a022d6] #qa-guardian #windows #configuration — 启动脚本从 tools/guardian 双击时把 QA-skills 工具目录作为当前工作目录并默认 target_repo，导致寻找错误的 .qa/guardian/config.json；现在只有当前目录已配置 Guardian 才回退使用，否则要求输入真实业务项目目录，并同步保护 scheduler.mjs 直接启动路径。 (2026-08-18)
- [bug-aebf3f8b068f48b59ce275467409fa20] #qa-guardian #fixer #qa-verdict — Made the fixer commit/push its issue branch, synchronized the actual Git branch into state, and fixed QA verdict hashing so an independent QA PASS can reach the machine gate and PR creation. (2026-08-19)
- [bug-b963cb3902ec472fba0747de51688475] #opencode-sdk #structured-output #qa-guardian — Fixed SDK wrapper response handling: createSession now unwraps data.id, prompt/get/abort bypass the broken 1.18.18 path template using explicit low-level URLs, and json_schema results are read from data.info.structured rather than text parts. (2026-08-19)
- [change-0071a9a0e32c40c28601c3ff7d6ad8b6] #qa-guardian #plan-gate #runtime — scheduler 现在消费 investigation_mode，在 shadow/enforced 模式读取 dossier/plan 并调用 assessFixingEntry，未通过计划门不启动 write-capable Guardian；legacy 保持兼容，190/190 测试通过。 (2026-08-18)
- [change-09acc786cc4c4b53b58d1e9a5b7267ef] #qa-guardian #opencode-sdk #session-continuity — Added independent fixer and QA OpenCode SDK session runners with create-or-reuse session continuity, human-note-as-untrusted-data injection, and deadline-abort, so the same issue's fixer/QA sessions are reused across human approval and rework/followup flows. (2026-08-19)
- [change-0fcf1b08d1784c49b5e6ec1c2d6c527f] #qa-guardian #artifacts #state — 新增 dossier/plan 原子 artifact store，state schema 增加调查阶段、specialist、evidence、plan、生产依赖、round 元数据并兼容旧记录，167/167 测试通过。 (2026-08-18)
- [change-12b834a1483f4fad8368e33dfe64947a] #qa-guardian #qa #state — 新增 machine-readable qa-verdict contract，要求 PASS 前置 PR；scheduler 启动 command-driven run 前持久化 consumed comment、clearFixRounds 和 stall_retries；196/196 测试通过。 (2026-08-18)
- [change-1a149adf92854c34938da07409ba28a9] #qa-guardian #opencode-sdk #bug — Fixed a leftover spawn--attach path where the plan builder hung under a shared server, by routing it through an SDK session with json_schema output \(matching the specialists\). (2026-08-19)
- [change-24402a071a3a4c84a3a6f56e78cca33b] #qa-guardian #architecture #role-split — Split QA Guardian into QA/Fixer/Supervisor roles as docs-only contracts \(scheme A, zero runtime change\) so later phases can separate identities without reopening frozen invariants. (2026-08-19)
- [change-260993fcf6504e8eb9e54f84f0dd45f4] #qa-guardian #integration #investigation — 新增 investigation-runtime.mjs，把注入的 specialist runner、coordinator dossier synthesis、artifact persistence、plan builder 和 plan validation 串成可调用 runtime adapter，192/192 测试通过。 ()
- [change-2955e2780a8b4097bfdf09d765453605] #qa-guardian #reliability #timeout — scheduler child invocation 增加 child_timeout_ms 与 kill/timeout code，investigation failure 写入 dossier/plan failed、attempts/error/phase 状态，192/192 测试通过。 (2026-08-18)
- [change-2d00718e55fc479195377618f8fe8527] #qa-guardian #opencode-sdk #session-continuity — Replaced the unreliable multi-process `opencode run --attach` fan-out with the official one-serve + @opencode-ai/sdk pattern, and added per-issue OpenCode session metadata so human-approval and rework/followup flows continue the prior fixer/QA session with full context. (2026-08-19)
- [change-39d97b0a4c854e3893e13ba9e9a5859d] #qa-guardian #documentation #deployment — 修复 review-work 文档缺口——README 更正 scheduler 已交付状态+补运行段+config 键表+作者授权安全项，验收用例新增 UC-H..UC-K（授权/N=1/通知/飞书回调）并把测试数更新到 128，设计文档 §11B.5-a 补记飞书通道/回调/command_authors/FR-21 接线为已交付范围，文档与代码对齐。 (2026-08-18)
- [change-41675aeea2c446eea10506e55cbbd08d] #qa-guardian #documentation #migration — README/DEPLOY/验收文档补充 investigation_mode legacy/shadow/enforced、dossier/plan artifact 和 rollback 说明，187/187 测试通过。 (2026-08-18)
- [change-47dc8b8da91e4b6fa99315f0e3712686] #qa-guardian #specialists #read-only — 新增 guardian-code/business/runtime/docs 四类只读 specialist agent，扩展 qa-guardian 仅允许这些指定只读角色和 qa/explore，所有写入/安装/生产/网络越权保持拒绝，167/167 测试通过。 (2026-08-18)
- [change-494b8d8a5ef14682bd96aeefdd945693] #qa-guardian #planning #safety-gate — 新增 plan-validator.mjs，要求根因证据、影响文件、非目标、测试/验收、回滚、风险和 evidence_ids 完整；request 不可默认 LOW，未确定事实和无效 dossier 不得进入 autonomous-ready，164/164 测试通过。 (2026-08-18)
- [change-4e17ae8322d944be9acbbd5f14780594] #qa-guardian #opencode-sdk #security #review-remediation — Replaced child-agent shell authority with supervisor-owned direct argv operations, made SDK sessions and Gate 1 approvals context-bound and fail-closed, enforced actor capabilities at mutation seams, bound Feishu actions to trusted users, and hardened state/GitHub I/O; the Guardian suite passes 396/396. (2026-08-19)
- [change-50ac1b7b0ba245bca6892a771e308eb1] #qa-guardian #qa #pr-gate — 新增 qa-gate/pr-io 契约与测试，要求 PASS verdict 绑定 issue/branch/plan hash 才允许创建 PR，并把 validated dossier/plan 路径传入 fixer prompt；204/204 测试通过，但 PR 创建尚未从 qa-guardian agent 主流程移出。 (2026-08-18)
- [change-559f7f25f2834bb2b50e4b7bcf9a3bfb] #qa-guardian #evidence #unattended-quality — 新增 evidence.mjs 结构化证据、假设评分、dossier 校验和决策就绪判断，覆盖 bug/request、证据 provenance、未确定事实与 request 验收标准，158/158 测试通过。 (2026-08-18)
- [change-5abf095ac5524443a5d7a9038a01a1e8] #qa-guardian #security #concurrency — 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。 (2026-08-18)
- [change-5cb23fed3750411f9d0a01fddae5f6de] #qa-guardian #launcher #multi-project — Guardian launcher bindings are now stored independently per canonical target path, so explicitly switching projects selects only that project's mode, control worktree, QA snapshot, and configuration while no-argument launches reuse the last target. (2026-08-20)
- [change-5e5f9e3456464cb598ba51d705ffc945] #qa-guardian #webhook #idempotency — Locked the Oracle-approved Phase 4 design \(webhook = durable wake-up producer only, scheduler stays sole writer\) and implemented the pure 3-layer idempotency ledger, so later webhook wiring cannot violate single-writer state or comment-chronology authorization. (2026-08-19)
- [change-62abfd75f0104cce826232f15679e2d3] #qa-guardian #authorization #actor-routing — Introduced a reversible actor-routing policy layer and a bot denylist so machine actors can never authorize or perform out-of-role GitHub effects, enforcing the QA/Fixer/Supervisor identity boundaries in code without a per-App-token cutover. (2026-08-19)
- [change-66dd4c4f08114b48899480c39d8052a7] #qa-guardian #watch-mode #followup — 增加 watch_mode=new-open 自动发现值守启动后新建 issue、scheduler 领取标签投影和 /guardian followup 新验收轮次；DONE/GATE_2_WAIT 不再静默重复处理，146/146 测试通过。 (2026-08-18)
- [change-6ff6c658477b423eae1d6e18a33f92b9] #qa-guardian #observability #windows — 新增 runtime-io 统一 BOM-safe JSON 读取、stderr JSONL 结构化日志和 DEVer banner，runtime/scheduler/WS/HTTP server 接入阶段/错误事件且不泄露密钥；PowerShell 生成的 BOM config 现在可加载，测试 139/139 通过。 (2026-08-18)
- [change-856058c87cf3450e8460263aeef5cb2a] #qa-guardian #capabilities #sybermem — Added config-gated Guardian investigation specialists and optional non-blocking SyberMem recall/record integration so repository users can enable stronger investigation and engineering memory without making external OMO/SyberMem capabilities mandatory. (2026-08-20)
- [change-8566e0c1beed41e28dc4c9b6eed93fa8] #qa-guardian #worktree #runtime-qa — QA Guardian now supports a one-time persisted launcher choice that isolates dirty target projects into a clean control worktree plus selected QA runtime snapshot, so unattended fixing remains safe while QA can test an explicit current snapshot. (2026-08-20)
- [change-9075ddb15f55461cba237c8f6c302f95] #qa-guardian #windows #spawn — Fixed a Windows-only bug where the QA Guardian scheduler could not spawn the opencode agent \(ENOENT/EINVAL on shell:false\), by resolving the real opencode.exe per platform, so the enforced investigation/fixer chain actually runs on Windows. (2026-08-19)
- [change-9c651671735d41ca84cb71a1c1bd2213] #qa-guardian #opencode-sdk #session-continuity — The scheduler now runs the fixer through a persistent SDK session and invokes QA through an independent SDK session \(instead of fixer-internal dispatch\), so both roles keep context across human approval and rework/followup flows and QA is truly independent of the fixer. (2026-08-19)
- [change-a1a8b1267e6946a098431b0dfbd102b6] #qa-guardian #security #reliability — 修复 specialist JSON 尾部对象注入风险，并将 scheduler 获取锁后的 investigation/plan/claim/run 全部置于统一 finally 释放锁，192/192 测试通过。 (2026-08-18)
- [change-a42d82b9641948eab4109dd13795f675] #qa-guardian #qa #verdict — 新增 qa-verdict PASS/FAIL/BLOCKED 契约及 report hash 校验，scheduler child run 结束后读取 qa-verdict artifact、写入 state 审计字段并记录未批准结果，199/199 测试通过；真正 PR 前分阶段拦截仍待后续实现。 (2026-08-18)
- [change-a43b7803dba74e9bae48e0bed222011c] #qa-guardian #integration #recovery — 补齐此前遗漏未提交的 capability discovery、pipeline harness 及 followup schema_version 测试修正，192/192 测试通过，确保 auto-qa 工作区与阶段记录一致。 (2026-08-18)
- [change-a4cb962beea34d6491bc3c850bbd7590] #qa-guardian #artifacts #reliability — dossier 与 plan 现在共享 investigation_id，scheduler 通过 readArtifactPair 校验完整性和 revision，不一致/半套 artifact 会 quarantine 后重建，193/193 测试通过。 (2026-08-18)
- [change-ab75b9ee58354673b48b9c875f91a889] #qa-guardian #investigation #orchestration — 新增 investigation-coordinator 纯核心，按 issue complexity 选择正交只读 specialist，生成实际 capability-aware prompt，合并 hypotheses/evidence/unresolved facts 为 dossier 并计算 decision readiness，175/175 测试通过。 (2026-08-18)
- [change-abb444d029c440fba6895ca3d3dc1946] #qa-guardian #qa-gate #pr — enforced 模式下 qa-guardian 只生成 qa-verdict.json，scheduler 使用 qa-gate 校验 issue/branch/plan hash/Overall Status PASS 后通过 pr-io 创建 PR 并写 GATE_2_WAIT；204/204 测试通过。 (2026-08-18)
- [change-bcabf0f8e62b4a45b47b7823b934848e] #qa-guardian #verdict-protocol #injection-safety — Implemented the verdict->Supervisor->GitHub comment protocol so the Supervisor is the only writer of \[QA_VERIFIED\]/\[QA_FAILED\] comments, keeping QA zero-side-effect and proving a verdict marker can never be re-parsed as an authorization command. (2026-08-19)
- [change-bf2f029768594b7097870069da715a0a] #qa-guardian #opencode-sdk #bug — Fixed a bug where SDK sessions were created in the scheduler's cwd \(QA-skills\) instead of the target repo, causing specialists/fixer/qa to work in the wrong directory. (2026-08-19)
- [change-c4f7796c3fa940589c4c90921c26455c] #qa-guardian #notification #deployment — 修复 review-work 阻塞项——新增 notify-io.mjs 把通知投递（gh 评论+curl webhook，幂等持久化 last_notified_state）真正接进 scheduler tick 满足 FR-21，并补 DEPLOY.md + bootstrap 指引让常驻 scheduler 与飞书回调可被新用户部署，128/128 测试通过。 (2026-08-18)
- [change-c783251f5b134af9b8bd7e15628fc7c6] #qa-guardian #deployment #usability — 新增 scheduler-start.ps1/.sh 一键启动（自动补 PATH/解析 node/校验 command_authors），目标仓库支持三级注入（CLI --repo > env QA_GUARDIAN_REPO > 旁置 scheduler.config.json > cwd，scheduler.mjs 抽出可测的 resolveRepoDir），并补 .env.example + DEPLOY 回调部署清单（本地 compose 自测 + Dokploy），129/129 测试通过。 (2026-08-18)
- [change-c79535dd171745ee98a74bae8ca3c2ba] #qa-guardian #review #followup — 将 DONE followup、Gate 通知和跨轮次 DONE 幂等的 focused injected regression 纳入正式测试，完整 Guardian suite 达到 153/153 pass，避免审查证据依赖未跟踪临时文件。 (2026-08-18)
- [change-c9452e10a1264645a06915267c49e44d] #qa-guardian #feishu #followup — 修复 DONE 飞书 followup 的空输入漏洞、Gate 1/Gate 2 卡片通知不可达、跨轮次 DONE 通知幂等标记继承问题，并补 UC-L 与回归测试，149/149 测试通过。 (2026-08-18)
- [change-cc34c0f387b04539bef2107012ba5deb] #qa-guardian #runtime-integration #plan-gate — 将 investigation-process/investigation-runtime 接入 scheduler 的 shadow/enforced 路径：真实执行只读 specialist 子进程、写 dossier/plan artifact、执行 plan gate，失败或不完整计划不启动 write-capable Guardian；192/192 测试通过。 (2026-08-18)
- [change-d4732a411e254c618517828d62e5ed70] #qa-guardian #usability #deployment — scheduler-start.ps1 增 -Init/-CommandAuthors/-BaseBranch，config 不存在时一步创建（BOM-free UTF-8，修 PS5.1 Set-Content BOM 导致 node JSON.parse 失败）或交互提示，已存在则直接启动；新增 scheduler-start.bat 双击入口（自动 ExecutionPolicy Bypass 调 ps1 并转发参数），129/129 测试通过、init 冒烟验证 config 可被 node 解析。 (2026-08-18)
- [change-d68ddced82a4440492d038e2b4aa8975] #qa-guardian #lock #n1-concurrency — Fixed a second real bug found by the E2E run: the N=1 lease heartbeat only covered the fixer spawn, so a long investigation went lease-stale mid-run and was judged STALLED; the heartbeat now covers the whole critical section \(investigation + fixer + QA + PR\). (2026-08-19)
- [change-d9e9344cce4a4afbb937c6c637a7931c] #qa-guardian #plan-gate #safety — 新增 plan-gate.mjs，把 legacy/shadow/enforced 三种调查模式映射为是否允许写入，enforced 下只有 dossier-backed decision-complete LOW plan 可自主进入 FIXING，183/183 测试通过。 (2026-08-18)
- [change-df0e3cad054847b7a529c6246bd4d603] #qa-guardian #webhook #scheduler — Added the final pure/local Phase 4 seam that merges relay wake targets into the scheduler's existing candidate list, returning the list unchanged when no relay is wired, so the only remaining webhook work is the deployment-coupled live relay connection. (2026-08-19)
- [change-e34b035b981b4224a44621ba7457d5b2] #qa-guardian #budgets #reliability — 新增 budgets.mjs 纯预算核心，支持标准/复杂调查预算、specialist 数量/截止时间、剩余预算和 timeout 分类，179/179 测试通过；尚未接入 runtime。 (2026-08-18)
- [change-eb83465c334b4e88b55e83d019123930] #qa-guardian #webhook #idempotency — Implemented the webhook ingest \(cloud, durable dedupe by delivery_id, never a state writer\) and the scheduler wake-drain planner \(coalesce + application-token guard\) so webhook and compensation-poll triggers converge to exactly one application without breaking single-writer N=1 or comment-chronology authorization. (2026-08-19)

## Archived Conclusions

<!-- add new archived conclusions here -->
<!-- Not injected at session start; findable via /sybermem-search -->
<!-- Suffix each line with: [superseded by <id>] or [compressed in <id>] or [archived] -->
- [bug-09c23cce8bb443d7aadb0f5dea5ce3b7] #opencode-sdk #session-continuity #qa-guardian — Fixed SDK session operations by unwrapping createSession's data.id and using the SDK low-level client with explicit /session/<id>/ URLs, because the generated 1.18.18 path methods request /session/%7Bid%7D/... and fail every prompt. (2026-08-19) [compressed in digest-003]
- [bug-19e5ffff30db46ccbca9f8ca73551ad1] #qa-guardian #security #runtime — Phase 11 发现生产镜像可能包含本地 secrets、unattended 默认 legacy 绕过 plan gate、stale lock takeover 非原子和 non-idempotent STALLED rerun 风险；本批已加 .dockerignore/env-only production loader、enforced 默认、原子 stale-lock takeover 和 stall guard，仍待 QA machine enforcement/timeout/state persistence。 () [compressed in digest-001]
- [bug-1a88afaf58fe4f13859d209b49b49027] #qa-guardian #deployment #docker — docker-compose.yml 用 ports 8787:8787 硬绑宿主端口，在共享 Dokploy 主机上 8787 已被占用导致 "port is already allocated" 启动失败；改为仅 expose 8787、由 Dokploy Domain 反代路由到容器端口，部署不再抢宿主端口。 (2026-08-18) [compressed in digest-002]
- [bug-26ad869551cf43f585bbfc062876eccc] #qa-guardian #json-schema #validation — Tightened specialist and plan json_schema definitions to match the existing evidence/plan validators, so SDK output is valid by construction \(evidence provenance fields + allowed kinds; risk restricted to LOW/HIGH\). (2026-08-19) [compressed in digest-002]
- [bug-541a9d6211594221a5ceb08950e80881] #qa-guardian #windows #encoding — Windows bat 的分支 fall-through 会重复调用 PowerShell 并产生大量命令未找到错误；无 BOM UTF-8 的 PowerShell 中文脚本在 PS5.1 解析失败，纯 BOM/控制台编码不一致又导致中文乱码；改为显式 goto 分支、PowerShell 脚本 UTF-8 BOM、bat chcp 65001，cmd 冒烟只执行一次且中文引导可读。 (2026-08-18) [compressed in digest-002]
- [bug-682f269c0050412797459f52712af366] #opencode-sdk #permissions #qa-guardian — Added complete role-specific no-ask permission matrices for SDK sessions, allowing fixer edits while denying irreversible/install operations and keeping QA/specialists read-only, so headless sessions cannot hang on permission prompts. (2026-08-19) [compressed in digest-003]
- [bug-68ea53ff66ef4f62b7f680db1ecebf19] #qa-guardian #gate1 #human-approval — Fixed the SDK-mode plan gate so non-autonomous plans persist GATE_1_WAIT, promote uncertainty to HIGH, write a structured human-approval comment, and exit instead of silently leaving the issue DISCOVERED. (2026-08-19) [compressed in digest-002]
- [bug-7cebbfc6c8794207aee4ccebd7974edf] #qa-guardian #gate1 #session-continuity — Persist trusted approve/revise authorization in issue state and let structurally valid plans enter FIXING after human approval, preventing consumed commands from being lost across scheduler restart or a second plan-gate evaluation. (2026-08-19) [compressed in digest-002]
- [bug-8a392be541a943bdad199b2dd863ca7c] #qa-guardian #json-schema #plan-validation — Made the plan json_schema derive evidence_ids.items.enum from the dossier's known evidence IDs, preventing the model from returning "ID + prose" strings rejected by the plan validator. (2026-08-19) [compressed in digest-002]
- [bug-8a5db6c7aa0447189f0e23d02741516c] #qa-guardian #gate2 #state-consistency — Re-read issue state after persisting the QA verdict and before writing GATE_2_WAIT so the PR transition preserves qa_verdict_path, status, and hash. (2026-08-19) [compressed in digest-002]
- [bug-95af95c0c87348659c6d36a12974beb0] #opencode-sdk #qa-session #session-continuity — QA session completion now converges from completed assistant messages when the synchronous prompt HTTP request remains open, with baseline message IDs and cancellation ensuring correct round isolation and no leaked polling timers. (2026-08-19) [compressed in digest-003]
- [bug-9df5a75c67504f4fac0d315dd7cef2dd] #qa-guardian #windows #launcher — scheduler-start.bat 的 if 分支执行 PowerShell 后没有 goto done，cmd 继续落入后续 start_target/start_init 标签，重复启动脚本并将参数/文本当命令，导致大量“不是内部或外部命令”错误；改为显式 goto 分支收尾后 cmd 冒烟只执行一次。 (2026-08-18) [compressed in digest-002]
- [bug-a47057aaf97145de807476aef76844e3] #qa-guardian #qa-verdict #scheduler — Imported writeArtifact in the scheduler so a completed independent QA PASS can be persisted and continue through the QA gate and PR creation. (2026-08-19) [compressed in digest-002]
- [bug-addaeb3484574da4898bc2d0d5a022d6] #qa-guardian #windows #configuration — 启动脚本从 tools/guardian 双击时把 QA-skills 工具目录作为当前工作目录并默认 target_repo，导致寻找错误的 .qa/guardian/config.json；现在只有当前目录已配置 Guardian 才回退使用，否则要求输入真实业务项目目录，并同步保护 scheduler.mjs 直接启动路径。 (2026-08-18) [compressed in digest-002]
- [bug-aebf3f8b068f48b59ce275467409fa20] #qa-guardian #fixer #qa-verdict — Made the fixer commit/push its issue branch, synchronized the actual Git branch into state, and fixed QA verdict hashing so an independent QA PASS can reach the machine gate and PR creation. (2026-08-19) [compressed in digest-002]
- [bug-b963cb3902ec472fba0747de51688475] #opencode-sdk #structured-output #qa-guardian — Fixed SDK wrapper response handling: createSession now unwraps data.id, prompt/get/abort bypass the broken 1.18.18 path template using explicit low-level URLs, and json_schema results are read from data.info.structured rather than text parts. (2026-08-19) [compressed in digest-003]
- [change-0071a9a0e32c40c28601c3ff7d6ad8b6] #qa-guardian #plan-gate #runtime — scheduler 现在消费 investigation_mode，在 shadow/enforced 模式读取 dossier/plan 并调用 assessFixingEntry，未通过计划门不启动 write-capable Guardian；legacy 保持兼容，190/190 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-09acc786cc4c4b53b58d1e9a5b7267ef] #qa-guardian #opencode-sdk #session-continuity — Added independent fixer and QA OpenCode SDK session runners with create-or-reuse session continuity, human-note-as-untrusted-data injection, and deadline-abort, so the same issue's fixer/QA sessions are reused across human approval and rework/followup flows. (2026-08-19) [compressed in digest-002]
- [change-0fcf1b08d1784c49b5e6ec1c2d6c527f] #qa-guardian #artifacts #state — 新增 dossier/plan 原子 artifact store，state schema 增加调查阶段、specialist、evidence、plan、生产依赖、round 元数据并兼容旧记录，167/167 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-12b834a1483f4fad8368e33dfe64947a] #qa-guardian #qa #state — 新增 machine-readable qa-verdict contract，要求 PASS 前置 PR；scheduler 启动 command-driven run 前持久化 consumed comment、clearFixRounds 和 stall_retries；196/196 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-1a149adf92854c34938da07409ba28a9] #qa-guardian #opencode-sdk #bug — Fixed a leftover spawn--attach path where the plan builder hung under a shared server, by routing it through an SDK session with json_schema output \(matching the specialists\). (2026-08-19) [compressed in digest-002]
- [change-24402a071a3a4c84a3a6f56e78cca33b] #qa-guardian #architecture #role-split — Split QA Guardian into QA/Fixer/Supervisor roles as docs-only contracts \(scheme A, zero runtime change\) so later phases can separate identities without reopening frozen invariants. (2026-08-19) [compressed in digest-002]
- [change-260993fcf6504e8eb9e54f84f0dd45f4] #qa-guardian #integration #investigation — 新增 investigation-runtime.mjs，把注入的 specialist runner、coordinator dossier synthesis、artifact persistence、plan builder 和 plan validation 串成可调用 runtime adapter，192/192 测试通过。 () [compressed in digest-001]
- [change-2955e2780a8b4097bfdf09d765453605] #qa-guardian #reliability #timeout — scheduler child invocation 增加 child_timeout_ms 与 kill/timeout code，investigation failure 写入 dossier/plan failed、attempts/error/phase 状态，192/192 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-2d00718e55fc479195377618f8fe8527] #qa-guardian #opencode-sdk #session-continuity — Replaced the unreliable multi-process `opencode run --attach` fan-out with the official one-serve + @opencode-ai/sdk pattern, and added per-issue OpenCode session metadata so human-approval and rework/followup flows continue the prior fixer/QA session with full context. (2026-08-19) [compressed in digest-002]
- [change-39d97b0a4c854e3893e13ba9e9a5859d] #qa-guardian #documentation #deployment — 修复 review-work 文档缺口——README 更正 scheduler 已交付状态+补运行段+config 键表+作者授权安全项，验收用例新增 UC-H..UC-K（授权/N=1/通知/飞书回调）并把测试数更新到 128，设计文档 §11B.5-a 补记飞书通道/回调/command_authors/FR-21 接线为已交付范围，文档与代码对齐。 (2026-08-18) [compressed in digest-002]
- [change-41675aeea2c446eea10506e55cbbd08d] #qa-guardian #documentation #migration — README/DEPLOY/验收文档补充 investigation_mode legacy/shadow/enforced、dossier/plan artifact 和 rollback 说明，187/187 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-47dc8b8da91e4b6fa99315f0e3712686] #qa-guardian #specialists #read-only — 新增 guardian-code/business/runtime/docs 四类只读 specialist agent，扩展 qa-guardian 仅允许这些指定只读角色和 qa/explore，所有写入/安装/生产/网络越权保持拒绝，167/167 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-494b8d8a5ef14682bd96aeefdd945693] #qa-guardian #planning #safety-gate — 新增 plan-validator.mjs，要求根因证据、影响文件、非目标、测试/验收、回滚、风险和 evidence_ids 完整；request 不可默认 LOW，未确定事实和无效 dossier 不得进入 autonomous-ready，164/164 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-4e17ae8322d944be9acbbd5f14780594] #qa-guardian #opencode-sdk #security #review-remediation — Replaced child-agent shell authority with supervisor-owned direct argv operations, made SDK sessions and Gate 1 approvals context-bound and fail-closed, enforced actor capabilities at mutation seams, bound Feishu actions to trusted users, and hardened state/GitHub I/O; the Guardian suite passes 396/396. (2026-08-19) [compressed in digest-002]
- [change-50ac1b7b0ba245bca6892a771e308eb1] #qa-guardian #qa #pr-gate — 新增 qa-gate/pr-io 契约与测试，要求 PASS verdict 绑定 issue/branch/plan hash 才允许创建 PR，并把 validated dossier/plan 路径传入 fixer prompt；204/204 测试通过，但 PR 创建尚未从 qa-guardian agent 主流程移出。 (2026-08-18) [compressed in digest-002]
- [change-559f7f25f2834bb2b50e4b7bcf9a3bfb] #qa-guardian #evidence #unattended-quality — 新增 evidence.mjs 结构化证据、假设评分、dossier 校验和决策就绪判断，覆盖 bug/request、证据 provenance、未确定事实与 request 验收标准，158/158 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-5abf095ac5524443a5d7a9038a01a1e8] #qa-guardian #security #concurrency — 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-5e5f9e3456464cb598ba51d705ffc945] #qa-guardian #webhook #idempotency — Locked the Oracle-approved Phase 4 design \(webhook = durable wake-up producer only, scheduler stays sole writer\) and implemented the pure 3-layer idempotency ledger, so later webhook wiring cannot violate single-writer state or comment-chronology authorization. (2026-08-19) [compressed in digest-002]
- [change-62abfd75f0104cce826232f15679e2d3] #qa-guardian #authorization #actor-routing — Introduced a reversible actor-routing policy layer and a bot denylist so machine actors can never authorize or perform out-of-role GitHub effects, enforcing the QA/Fixer/Supervisor identity boundaries in code without a per-App-token cutover. (2026-08-19) [compressed in digest-002]
- [change-66dd4c4f08114b48899480c39d8052a7] #qa-guardian #watch-mode #followup — 增加 watch_mode=new-open 自动发现值守启动后新建 issue、scheduler 领取标签投影和 /guardian followup 新验收轮次；DONE/GATE_2_WAIT 不再静默重复处理，146/146 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-6ff6c658477b423eae1d6e18a33f92b9] #qa-guardian #observability #windows — 新增 runtime-io 统一 BOM-safe JSON 读取、stderr JSONL 结构化日志和 DEVer banner，runtime/scheduler/WS/HTTP server 接入阶段/错误事件且不泄露密钥；PowerShell 生成的 BOM config 现在可加载，测试 139/139 通过。 (2026-08-18) [compressed in digest-002]
- [change-9075ddb15f55461cba237c8f6c302f95] #qa-guardian #windows #spawn — Fixed a Windows-only bug where the QA Guardian scheduler could not spawn the opencode agent \(ENOENT/EINVAL on shell:false\), by resolving the real opencode.exe per platform, so the enforced investigation/fixer chain actually runs on Windows. (2026-08-19) [compressed in digest-002]
- [change-9c651671735d41ca84cb71a1c1bd2213] #qa-guardian #opencode-sdk #session-continuity — The scheduler now runs the fixer through a persistent SDK session and invokes QA through an independent SDK session \(instead of fixer-internal dispatch\), so both roles keep context across human approval and rework/followup flows and QA is truly independent of the fixer. (2026-08-19) [compressed in digest-002]
- [change-a1a8b1267e6946a098431b0dfbd102b6] #qa-guardian #security #reliability — 修复 specialist JSON 尾部对象注入风险，并将 scheduler 获取锁后的 investigation/plan/claim/run 全部置于统一 finally 释放锁，192/192 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-a42d82b9641948eab4109dd13795f675] #qa-guardian #qa #verdict — 新增 qa-verdict PASS/FAIL/BLOCKED 契约及 report hash 校验，scheduler child run 结束后读取 qa-verdict artifact、写入 state 审计字段并记录未批准结果，199/199 测试通过；真正 PR 前分阶段拦截仍待后续实现。 (2026-08-18) [compressed in digest-002]
- [change-a43b7803dba74e9bae48e0bed222011c] #qa-guardian #integration #recovery — 补齐此前遗漏未提交的 capability discovery、pipeline harness 及 followup schema_version 测试修正，192/192 测试通过，确保 auto-qa 工作区与阶段记录一致。 (2026-08-18) [compressed in digest-002]
- [change-a4cb962beea34d6491bc3c850bbd7590] #qa-guardian #artifacts #reliability — dossier 与 plan 现在共享 investigation_id，scheduler 通过 readArtifactPair 校验完整性和 revision，不一致/半套 artifact 会 quarantine 后重建，193/193 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-ab75b9ee58354673b48b9c875f91a889] #qa-guardian #investigation #orchestration — 新增 investigation-coordinator 纯核心，按 issue complexity 选择正交只读 specialist，生成实际 capability-aware prompt，合并 hypotheses/evidence/unresolved facts 为 dossier 并计算 decision readiness，175/175 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-abb444d029c440fba6895ca3d3dc1946] #qa-guardian #qa-gate #pr — enforced 模式下 qa-guardian 只生成 qa-verdict.json，scheduler 使用 qa-gate 校验 issue/branch/plan hash/Overall Status PASS 后通过 pr-io 创建 PR 并写 GATE_2_WAIT；204/204 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-bcabf0f8e62b4a45b47b7823b934848e] #qa-guardian #verdict-protocol #injection-safety — Implemented the verdict->Supervisor->GitHub comment protocol so the Supervisor is the only writer of \[QA_VERIFIED\]/\[QA_FAILED\] comments, keeping QA zero-side-effect and proving a verdict marker can never be re-parsed as an authorization command. (2026-08-19) [compressed in digest-002]
- [change-bf2f029768594b7097870069da715a0a] #qa-guardian #opencode-sdk #bug — Fixed a bug where SDK sessions were created in the scheduler's cwd \(QA-skills\) instead of the target repo, causing specialists/fixer/qa to work in the wrong directory. (2026-08-19) [compressed in digest-002]
- [change-c4f7796c3fa940589c4c90921c26455c] #qa-guardian #notification #deployment — 修复 review-work 阻塞项——新增 notify-io.mjs 把通知投递（gh 评论+curl webhook，幂等持久化 last_notified_state）真正接进 scheduler tick 满足 FR-21，并补 DEPLOY.md + bootstrap 指引让常驻 scheduler 与飞书回调可被新用户部署，128/128 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-c783251f5b134af9b8bd7e15628fc7c6] #qa-guardian #deployment #usability — 新增 scheduler-start.ps1/.sh 一键启动（自动补 PATH/解析 node/校验 command_authors），目标仓库支持三级注入（CLI --repo > env QA_GUARDIAN_REPO > 旁置 scheduler.config.json > cwd，scheduler.mjs 抽出可测的 resolveRepoDir），并补 .env.example + DEPLOY 回调部署清单（本地 compose 自测 + Dokploy），129/129 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-c79535dd171745ee98a74bae8ca3c2ba] #qa-guardian #review #followup — 将 DONE followup、Gate 通知和跨轮次 DONE 幂等的 focused injected regression 纳入正式测试，完整 Guardian suite 达到 153/153 pass，避免审查证据依赖未跟踪临时文件。 (2026-08-18) [compressed in digest-002]
- [change-c9452e10a1264645a06915267c49e44d] #qa-guardian #feishu #followup — 修复 DONE 飞书 followup 的空输入漏洞、Gate 1/Gate 2 卡片通知不可达、跨轮次 DONE 通知幂等标记继承问题，并补 UC-L 与回归测试，149/149 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-cc34c0f387b04539bef2107012ba5deb] #qa-guardian #runtime-integration #plan-gate — 将 investigation-process/investigation-runtime 接入 scheduler 的 shadow/enforced 路径：真实执行只读 specialist 子进程、写 dossier/plan artifact、执行 plan gate，失败或不完整计划不启动 write-capable Guardian；192/192 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-d4732a411e254c618517828d62e5ed70] #qa-guardian #usability #deployment — scheduler-start.ps1 增 -Init/-CommandAuthors/-BaseBranch，config 不存在时一步创建（BOM-free UTF-8，修 PS5.1 Set-Content BOM 导致 node JSON.parse 失败）或交互提示，已存在则直接启动；新增 scheduler-start.bat 双击入口（自动 ExecutionPolicy Bypass 调 ps1 并转发参数），129/129 测试通过、init 冒烟验证 config 可被 node 解析。 (2026-08-18) [compressed in digest-002]
- [change-d68ddced82a4440492d038e2b4aa8975] #qa-guardian #lock #n1-concurrency — Fixed a second real bug found by the E2E run: the N=1 lease heartbeat only covered the fixer spawn, so a long investigation went lease-stale mid-run and was judged STALLED; the heartbeat now covers the whole critical section \(investigation + fixer + QA + PR\). (2026-08-19) [compressed in digest-002]
- [change-d9e9344cce4a4afbb937c6c637a7931c] #qa-guardian #plan-gate #safety — 新增 plan-gate.mjs，把 legacy/shadow/enforced 三种调查模式映射为是否允许写入，enforced 下只有 dossier-backed decision-complete LOW plan 可自主进入 FIXING，183/183 测试通过。 (2026-08-18) [compressed in digest-002]
- [change-df0e3cad054847b7a529c6246bd4d603] #qa-guardian #webhook #scheduler — Added the final pure/local Phase 4 seam that merges relay wake targets into the scheduler's existing candidate list, returning the list unchanged when no relay is wired, so the only remaining webhook work is the deployment-coupled live relay connection. (2026-08-19) [compressed in digest-002]
- [change-e34b035b981b4224a44621ba7457d5b2] #qa-guardian #budgets #reliability — 新增 budgets.mjs 纯预算核心，支持标准/复杂调查预算、specialist 数量/截止时间、剩余预算和 timeout 分类，179/179 测试通过；尚未接入 runtime。 (2026-08-18) [compressed in digest-002]
- [change-eb83465c334b4e88b55e83d019123930] #qa-guardian #webhook #idempotency — Implemented the webhook ingest \(cloud, durable dedupe by delivery_id, never a state writer\) and the scheduler wake-drain planner \(coalesce + application-token guard\) so webhook and compensation-poll triggers converge to exactly one application without breaking single-writer N=1 or comment-chronology authorization. (2026-08-19) [compressed in digest-002]

## Phase Digests

| Number | Date | Title | Status | Coverage | Link |
|--------|------|-------|--------|----------|------|
| 001 | 2026-08-20 | undated qa-guardian cluster | completed | 2 records | [link](digests/2026-08-20-001-undated-qa-guardian-cluster.md) |
| 002 | 2026-08-20 | 2026-08 qa-guardian cluster | completed | 52 records | [link](digests/2026-08-20-002-2026-08-qa-guardian-cluster.md) |
| 003 | 2026-08-20 | 2026-08 opencode-sdk cluster | completed | 4 records | [link](digests/2026-08-20-003-2026-08-opencode-sdk-cluster.md) |
<!-- add new digest records here -->

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
| change-09acc786cc4c4b53b58d1e9a5b7267ef | 2026-08-19 | Add fixer and QA SDK session runners \(方案 A\) | done | [link](changes/2026-08-19-change-09acc786cc4c4b53b58d1e9a5b7267ef-fixer-qa-sdk-session-runners.md) |
| change-0fcf1b08d1784c49b5e6ec1c2d6c527f | 2026-08-18 | 强化 Guardian Phase 3：调查 artifact 持久化与状态扩展 | done | [link](changes/2026-08-18-change-0fcf1b08d1784c49b5e6ec1c2d6c527f-artifact-state.md) |
| change-12b834a1483f4fad8368e33dfe64947a | 2026-08-18 | QA verdict contract 与 scheduler state reconciliation | done | [link](changes/2026-08-18-change-12b834a1483f4fad8368e33dfe64947a-qa-verdict-state.md) |
| change-1a149adf92854c34938da07409ba28a9 | 2026-08-19 | Route plan builder through the OpenCode SDK session | done | [link](changes/2026-08-19-change-1a149adf92854c34938da07409ba28a9-plan-builder-sdk.md) |
| change-24402a071a3a4c84a3a6f56e78cca33b | 2026-08-19 | Introduce three-role architecture contract for QA Guardian \(Phase 1\) | done | [link](changes/2026-08-19-change-24402a071a3a4c84a3a6f56e78cca33b-role-architecture-contract.md) |
| change-260993fcf6504e8eb9e54f84f0dd45f4 |  |  | done | [link](changes/2026-08-18-change-260993fcf6504e8eb9e54f84f0dd45f4-investigation-runtime.md) |
| change-2955e2780a8b4097bfdf09d765453605 | 2026-08-18 | 修复 Strong Guardian runtime timeout 与调查失败持久化 | done | [link](changes/2026-08-18-change-2955e2780a8b4097bfdf09d765453605-runtime-reliability.md) |
| change-2d00718e55fc479195377618f8fe8527 | 2026-08-19 | Adopt OpenCode SDK multi-session runtime with session continuity | done | [link](changes/2026-08-19-change-2d00718e55fc479195377618f8fe8527-adopt-opencode-sdk-session-continuity.md) |
| change-39d97b0a4c854e3893e13ba9e9a5859d | 2026-08-18 | QA Guardian 文档收尾第三批（README/验收用例/设计文档对齐） | done | [link](changes/2026-08-18-change-39d97b0a4c854e3893e13ba9e9a5859d-guardian-docs-batch3.md) |
| change-41675aeea2c446eea10506e55cbbd08d | 2026-08-18 | 强化 Guardian Phase 10：dossier/plan 迁移文档与 shadow/enforced 回滚说明 | done | [link](changes/2026-08-18-change-41675aeea2c446eea10506e55cbbd08d-phase10-docs.md) |
| change-47dc8b8da91e4b6fa99315f0e3712686 | 2026-08-18 | 强化 Guardian Phase 4：只读调查 specialist 角色 | done | [link](changes/2026-08-18-change-47dc8b8da91e4b6fa99315f0e3712686-specialists.md) |
| change-494b8d8a5ef14682bd96aeefdd945693 | 2026-08-18 | 强化 Guardian Phase 2：Plan Validator | done | [link](changes/2026-08-18-change-494b8d8a5ef14682bd96aeefdd945693-plan-validator.md) |
| change-4e17ae8322d944be9acbbd5f14780594 | 2026-08-19 | Harden QA Guardian after independent review | completed | [link](changes/2026-08-19-change-4e17ae8322d944be9acbbd5f14780594-review-remediation.md) |
| change-50ac1b7b0ba245bca6892a771e308eb1 | 2026-08-18 | QA verdict machine contract 与 PR gate 接口 | done | [link](changes/2026-08-18-change-50ac1b7b0ba245bca6892a771e308eb1-qa-gate-contract.md) |
| change-559f7f25f2834bb2b50e4b7bcf9a3bfb | 2026-08-18 | 强化 Guardian Phase 1：Evidence Contract | done | [link](changes/2026-08-18-change-559f7f25f2834bb2b50e4b7bcf9a3bfb-evidence-contract.md) |
| change-5abf095ac5524443a5d7a9038a01a1e8 | 2026-08-18 | QA Guardian 安全+并发修复第一批（授权/锁/去 shell/回调硬化） | done | [link](changes/2026-08-18-change-5abf095ac5524443a5d7a9038a01a1e8-guardian-security-concurrency-batch1.md) |
| change-5cb23fed3750411f9d0a01fddae5f6de | 2026-08-20 | Per-project Guardian launcher bindings |  | [link](changes/2026-08-20-change-5cb23fed3750411f9d0a01fddae5f6de-per-project-launcher-bindings.md) |
| change-5e5f9e3456464cb598ba51d705ffc945 | 2026-08-19 | Add Phase 4 webhook architecture doc and unified idempotency ledger core | done | [link](changes/2026-08-19-change-5e5f9e3456464cb598ba51d705ffc945-phase4-webhook-architecture-ledger.md) |
| change-62abfd75f0104cce826232f15679e2d3 | 2026-08-19 | Add actor routing and structural human-only authorization separation \(Phase 3\) | done | [link](changes/2026-08-19-change-62abfd75f0104cce826232f15679e2d3-actor-routing-authorization-separation.md) |
| change-66dd4c4f08114b48899480c39d8052a7 | 2026-08-18 | QA Guardian new-open 自动发现与 followup 多轮验收 | done | [link](changes/2026-08-18-change-66dd4c4f08114b48899480c39d8052a7-new-open-followup.md) |
| change-6ff6c658477b423eae1d6e18a33f92b9 | 2026-08-18 | QA Guardian BOM 兼容、结构化日志与 DEVer 启动体验 | done | [link](changes/2026-08-18-change-6ff6c658477b423eae1d6e18a33f92b9-runtime-logging.md) |
| change-856058c87cf3450e8460263aeef5cb2a | 2026-08-20 | Add configurable Guardian capabilities and optional SyberMem memory integration | done | [link](changes/2026-08-20-change-856058c87cf3450e8460263aeef5cb2a-guardian-capability-memory.md) |
| change-8566e0c1beed41e28dc4c9b6eed93fa8 | 2026-08-20 | Guardian target worktree and QA runtime separation |  | [link](changes/2026-08-20-change-8566e0c1beed41e28dc4c9b6eed93fa8-guardian-target-worktree-runtime.md) |
| change-9075ddb15f55461cba237c8f6c302f95 | 2026-08-19 | Fix Windows spawn of opencode \(resolve opencode.exe\) | done | [link](changes/2026-08-19-change-9075ddb15f55461cba237c8f6c302f95-windows-opencode-spawn-fix.md) |
| change-9c651671735d41ca84cb71a1c1bd2213 | 2026-08-19 | Wire fixer and QA through independent SDK sessions in the scheduler \(方案 A\) | done | [link](changes/2026-08-19-change-9c651671735d41ca84cb71a1c1bd2213-wire-fixer-qa-sdk-sessions.md) |
| change-a1a8b1267e6946a098431b0dfbd102b6 | 2026-08-18 | 修复 Phase 11 runtime review 发现的计划输出与锁释放风险 | done | [link](changes/2026-08-18-change-a1a8b1267e6946a098431b0dfbd102b6-review-runtime-fixes.md) |
| change-a42d82b9641948eab4109dd13795f675 | 2026-08-18 | QA verdict artifact runtime audit | done | [link](changes/2026-08-18-change-a42d82b9641948eab4109dd13795f675-qa-verdict-runtime.md) |
| change-a43b7803dba74e9bae48e0bed222011c | 2026-08-18 | 补齐 Phase 5 capability、Phase 9 pipeline harness 与 schema regression | done | [link](changes/2026-08-18-change-a43b7803dba74e9bae48e0bed222011c-recovered-phase-files.md) |
| change-a4cb962beea34d6491bc3c850bbd7590 | 2026-08-18 | 修复 dossier/plan 半套 artifact 与调查 revision 混用风险 | done | [link](changes/2026-08-18-change-a4cb962beea34d6491bc3c850bbd7590-artifact-quarantine.md) |
| change-ab75b9ee58354673b48b9c875f91a889 | 2026-08-18 | 强化 Guardian Phase 6：调查 specialist coordinator | done | [link](changes/2026-08-18-change-ab75b9ee58354673b48b9c875f91a889-investigation-coordinator.md) |
| change-abb444d029c440fba6895ca3d3dc1946 | 2026-08-18 | enforced runtime QA PASS 到 PR 创建机器闸门接线 | done | [link](changes/2026-08-18-change-abb444d029c440fba6895ca3d3dc1946-prepr-qa-gate.md) |
| change-bcabf0f8e62b4a45b47b7823b934848e | 2026-08-19 | Make the Supervisor sole writer of QA verdict comments \(Phase 2\) | done | [link](changes/2026-08-19-change-bcabf0f8e62b4a45b47b7823b934848e-supervisor-verdict-comment-protocol.md) |
| change-bf2f029768594b7097870069da715a0a | 2026-08-19 | Pass target directory to OpenCode session creation | done | [link](changes/2026-08-19-change-bf2f029768594b7097870069da715a0a-pass-target-directory.md) |
| change-c4f7796c3fa940589c4c90921c26455c | 2026-08-18 | QA Guardian 运维就绪第二批（通知投递接线 + DEPLOY + bootstrap 指引） | done | [link](changes/2026-08-18-change-c4f7796c3fa940589c4c90921c26455c-guardian-notify-wiring-deploy-batch2.md) |
| change-c783251f5b134af9b8bd7e15628fc7c6 | 2026-08-18 | QA Guardian scheduler 一键启动脚本 + 目标仓库可注入 + 回调部署清单 | done | [link](changes/2026-08-18-change-c783251f5b134af9b8bd7e15628fc7c6-guardian-oneclick-start-target-injection.md) |
| change-c79535dd171745ee98a74bae8ca3c2ba | 2026-08-18 | DONE followup/Gate 通知 review 回归测试正式纳入 | done | [link](changes/2026-08-18-change-c79535dd171745ee98a74bae8ca3c2ba-followup-review-regression.md) |
| change-c9452e10a1264645a06915267c49e44d | 2026-08-18 | 修复 DONE followup 卡片 review 阻塞项 | done | [link](changes/2026-08-18-change-c9452e10a1264645a06915267c49e44d-followup-review-fixes.md) |
| change-cc34c0f387b04539bef2107012ba5deb | 2026-08-18 | 强化 Guardian Phase 9：investigation runtime 接入真实 scheduler | done | [link](changes/2026-08-18-change-cc34c0f387b04539bef2107012ba5deb-phase9-runtime-integration.md) |
| change-d4732a411e254c618517828d62e5ed70 | 2026-08-18 | QA Guardian scheduler 一键创建 config + 启动 + .bat 双击入口 | done | [link](changes/2026-08-18-change-d4732a411e254c618517828d62e5ed70-guardian-init-and-bat-launcher.md) |
| change-d68ddced82a4440492d038e2b4aa8975 | 2026-08-19 | Heartbeat the N=1 lease across the whole scheduler critical section | done | [link](changes/2026-08-19-change-d68ddced82a4440492d038e2b4aa8975-heartbeat-critical-section.md) |
| change-d9e9344cce4a4afbb937c6c637a7931c | 2026-08-18 | 强化 Guardian Phase 8：plan-gated execution core | done | [link](changes/2026-08-18-change-d9e9344cce4a4afbb937c6c637a7931c-plan-gate.md) |
| change-df0e3cad054847b7a529c6246bd4d603 | 2026-08-19 | Add unionWakeCandidates local seam for scheduler wake consumption | done | [link](changes/2026-08-19-change-df0e3cad054847b7a529c6246bd4d603-phase4-union-wake-candidates-seam.md) |
| change-e34b035b981b4224a44621ba7457d5b2 | 2026-08-18 | 强化 Guardian Phase 7：调查与子任务预算核心 | done | [link](changes/2026-08-18-change-e34b035b981b4224a44621ba7457d5b2-runtime-budgets.md) |
| change-eb83465c334b4e88b55e83d019123930 | 2026-08-19 | Add Phase 4 webhook ingest and scheduler wake-drain planner | done | [link](changes/2026-08-19-change-eb83465c334b4e88b55e83d019123930-phase4-webhook-ingest-wake-drain.md) |

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
| bug-01f49ed7e02b41eba58ccc630c6170d0 | 2026-08-20 | scheduler-start git fetch stderr |  | [link](bugs/2026-08-20-bug-01f49ed7e02b41eba58ccc630c6170d0-scheduler-start-git-stderr.md) |
| bug-09c23cce8bb443d7aadb0f5dea5ce3b7 | 2026-08-19 | OpenCode SDK 1.18.18 session path template prevents prompt/get/abort | high | [link](bugs/2026-08-19-bug-09c23cce8bb443d7aadb0f5dea5ce3b7-sdk-session-path-template.md) |
| bug-19e5ffff30db46ccbca9f8ca73551ad1 |  |  | high | [link](bugs/2026-08-18-bug-19e5ffff30db46ccbca9f8ca73551ad1-security-review-blockers.md) |
| bug-1a88afaf58fe4f13859d209b49b49027 | 2026-08-18 | 飞书回调服务 Dokploy 部署失败——compose 硬绑宿主端口 8787 冲突 | high | [link](bugs/2026-08-18-bug-1a88afaf58fe4f13859d209b49b49027-dokploy-port-collision.md) |
| bug-1a8b3cf22fc9424ba73e009dd9c4556d | 2026-08-20 | Worktree command authors bootstrap |  | [link](bugs/2026-08-20-bug-1a8b3cf22fc9424ba73e009dd9c4556d-worktree-command-authors-bootstrap.md) |
| bug-26ad869551cf43f585bbfc062876eccc | 2026-08-19 | Structured-output schemas did not match dossier and plan validators | high | [link](bugs/2026-08-19-bug-26ad869551cf43f585bbfc062876eccc-structured-schema-validator-mismatch.md) |
| bug-541a9d6211594221a5ceb08950e80881 | 2026-08-18 | Windows bat/PowerShell 启动引导乱码与分支重复执行 | medium | [link](bugs/2026-08-18-bug-541a9d6211594221-bat-chinese-output.md) |
| bug-5a7a143fe7f84b4e9ab88dc922c2511b | 2026-08-20 | Control worktree clean check ignores Guardian state |  | [link](bugs/2026-08-20-bug-5a7a143fe7f84b4e9ab88dc922c2511b.md) |
| bug-682f269c0050412797459f52712af366 | 2026-08-19 | SDK fixer session hung on pending permission requests | high | [link](bugs/2026-08-19-bug-682f269c0050412797459f52712af366-headless-permission-hang.md) |
| bug-68ea53ff66ef4f62b7f680db1ecebf19 | 2026-08-19 | Plan gate blocked without a visible Gate 1 state or comment | high | [link](bugs/2026-08-19-bug-68ea53ff66ef4f62b7f680db1ecebf19-silent-plan-gate.md) |
| bug-7cebbfc6c8794207aee4ccebd7974edf | 2026-08-19 | Trusted Gate 1 approval was consumed but did not unlock the plan gate | high | [link](bugs/2026-08-19-bug-7cebbfc6c8794207aee4ccebd7974edf-gate1-approval-persistence.md) |
| bug-83b7d5b7c85e4316adc6fa751321262a | 2026-08-20 | Dashboard wrapper parser and worktree prompt overload |  | [link](bugs/2026-08-20-bug-83b7d5b7c85e4316adc6fa751321262a-dashboard-wrapper-and-first-run-prompts.md) |
| bug-8a392be541a943bdad199b2dd863ca7c | 2026-08-19 | Plan evidence_ids contained prose instead of known evidence IDs | medium | [link](bugs/2026-08-19-bug-8a392be541a943bdad199b2dd863ca7c-plan-evidence-id-schema.md) |
| bug-8a5db6c7aa0447189f0e23d02741516c | 2026-08-19 | Gate 2 transition erased persisted QA verdict metadata | medium | [link](bugs/2026-08-19-bug-8a5db6c7aa0447189f0e23d02741516c-gate2-verdict-state-preservation.md) |
| bug-8c8b03fc6c9c4adbb115442b042dd400 | 2026-08-19 | Shared OpenCode server lacked Node npm and Git in its PATH | high | [link](bugs/2026-08-19-bug-8c8b03fc6c9c4adbb115442b042dd400-opencode-server-tool-path.md) |
| bug-95af95c0c87348659c6d36a12974beb0 | 2026-08-19 | Completed SDK session remained blocked on the prompt HTTP request | high | [link](bugs/2026-08-19-bug-95af95c0c87348659c6d36a12974beb0-sdk-prompt-message-convergence.md) |
| bug-986e8e7b64f046c1bedbacbcbc65a083 | 2026-08-20 | scheduler-start tools branch preflight |  | [link](bugs/2026-08-20-bug-986e8e7b64f046c1bedbacbcbc65a083-scheduler-start-tools-branch.md) |
| bug-99e2cc66c7d34cd28e3bf20ea38814cd | 2026-08-20 | PowerShell missing command authors property |  | [link](bugs/2026-08-20-bug-99e2cc66c7d34cd28e3bf20ea38814cd-command-authors-property.md) |
| bug-9df5a75c67504f4fac0d315dd7cef2dd | 2026-08-18 | Windows scheduler-start.bat fall-through 重复执行导致大量命令未找到错误 | high | [link](bugs/2026-08-18-bug-9df5a75c67504f4fac0d315dd7cef2dd-bat-fallthrough.md) |
| bug-9ea4fabc7f0948ac9dcdf159659e61de | 2026-08-20 | Control worktree porcelain path offset |  | [link](bugs/2026-08-20-bug-9ea4fabc7f0948ac9dcdf159659e61de-control-porcelain-offset.md) |
| bug-a47057aaf97145de807476aef76844e3 | 2026-08-19 | Scheduler did not import the QA verdict artifact writer | high | [link](bugs/2026-08-19-bug-a47057aaf97145de807476aef76844e3-missing-verdict-artifact-import.md) |
| bug-addaeb3484574da4898bc2d0d5a022d6 | 2026-08-18 |  | high | [link](bugs/2026-08-18-bug-addaeb3484574da4898bc2d0d5a022d6-target-repo-fallback.md) |
| bug-aebf3f8b068f48b59ce275467409fa20 | 2026-08-19 | Fixer completion did not commit push sync branch or persist QA verdict | high | [link](bugs/2026-08-19-bug-aebf3f8b068f48b59ce275467409fa20-fixer-branch-verdict-finalization.md) |
| bug-b963cb3902ec472fba0747de51688475 | 2026-08-19 | Unwrap OpenCode SDK response envelopes and structured output | high | [link](bugs/2026-08-19-bug-b963cb3902ec472fba0747de51688475-sdk-response-envelope.md) |

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
- actor-routing: change-62abfd75f0104cce826232f15679e2d3
- architecture: change-24402a071a3a4c84a3a6f56e78cca33b
- artifacts: change-0fcf1b08d1784c49b5e6ec1c2d6c527f, change-a4cb962beea34d6491bc3c850bbd7590
- authorization: bug-1a8b3cf22fc9424ba73e009dd9c4556d, bug-99e2cc66c7d34cd28e3bf20ea38814cd, change-62abfd75f0104cce826232f15679e2d3
- budgets: change-e34b035b981b4224a44621ba7457d5b2
- bug: change-1a149adf92854c34938da07409ba28a9, change-bf2f029768594b7097870069da715a0a
- capabilities: change-856058c87cf3450e8460263aeef5cb2a
- concurrency: change-5abf095ac5524443a5d7a9038a01a1e8
- configuration: bug-addaeb3484574da4898bc2d0d5a022d6
- deployment: bug-1a88afaf58fe4f13859d209b49b49027, change-39d97b0a4c854e3893e13ba9e9a5859d, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- docker: bug-1a88afaf58fe4f13859d209b49b49027
- documentation: change-39d97b0a4c854e3893e13ba9e9a5859d, change-41675aeea2c446eea10506e55cbbd08d
- encoding: bug-541a9d6211594221a5ceb08950e80881
- evidence: change-559f7f25f2834bb2b50e4b7bcf9a3bfb
- feishu: change-c9452e10a1264645a06915267c49e44d
- fixer: bug-aebf3f8b068f48b59ce275467409fa20
- followup: change-66dd4c4f08114b48899480c39d8052a7, change-c79535dd171745ee98a74bae8ca3c2ba, change-c9452e10a1264645a06915267c49e44d
- gate1: bug-68ea53ff66ef4f62b7f680db1ecebf19, bug-7cebbfc6c8794207aee4ccebd7974edf
- gate2: bug-8a5db6c7aa0447189f0e23d02741516c
- git: bug-986e8e7b64f046c1bedbacbcbc65a083, bug-9ea4fabc7f0948ac9dcdf159659e61de
- human-approval: bug-68ea53ff66ef4f62b7f680db1ecebf19
- idempotency: change-5e5f9e3456464cb598ba51d705ffc945, change-eb83465c334b4e88b55e83d019123930
- injection-safety: change-bcabf0f8e62b4a45b47b7823b934848e
- integration: change-260993fcf6504e8eb9e54f84f0dd45f4, change-a43b7803dba74e9bae48e0bed222011c
- investigation: change-260993fcf6504e8eb9e54f84f0dd45f4, change-ab75b9ee58354673b48b9c875f91a889
- json-schema: bug-26ad869551cf43f585bbfc062876eccc, bug-8a392be541a943bdad199b2dd863ca7c
- launcher: bug-01f49ed7e02b41eba58ccc630c6170d0, bug-1a8b3cf22fc9424ba73e009dd9c4556d, bug-5a7a143fe7f84b4e9ab88dc922c2511b, bug-83b7d5b7c85e4316adc6fa751321262a, bug-986e8e7b64f046c1bedbacbcbc65a083, bug-9df5a75c67504f4fac0d315dd7cef2dd, change-5cb23fed3750411f9d0a01fddae5f6de
- lock: change-d68ddced82a4440492d038e2b4aa8975
- migration: change-41675aeea2c446eea10506e55cbbd08d
- multi-project: change-5cb23fed3750411f9d0a01fddae5f6de
- n1-concurrency: change-d68ddced82a4440492d038e2b4aa8975
- notification: change-c4f7796c3fa940589c4c90921c26455c
- observability: change-6ff6c658477b423eae1d6e18a33f92b9
- opencode-sdk: bug-09c23cce8bb443d7aadb0f5dea5ce3b7, bug-682f269c0050412797459f52712af366, bug-95af95c0c87348659c6d36a12974beb0, bug-b963cb3902ec472fba0747de51688475, change-09acc786cc4c4b53b58d1e9a5b7267ef, change-1a149adf92854c34938da07409ba28a9, change-2d00718e55fc479195377618f8fe8527, change-4e17ae8322d944be9acbbd5f14780594, change-9c651671735d41ca84cb71a1c1bd2213, change-bf2f029768594b7097870069da715a0a
- opencode-server: bug-8c8b03fc6c9c4adbb115442b042dd400
- orchestration: change-ab75b9ee58354673b48b9c875f91a889
- permissions: bug-682f269c0050412797459f52712af366
- plan-gate: change-0071a9a0e32c40c28601c3ff7d6ad8b6, change-cc34c0f387b04539bef2107012ba5deb, change-d9e9344cce4a4afbb937c6c637a7931c
- plan-validation: bug-8a392be541a943bdad199b2dd863ca7c
- planning: change-494b8d8a5ef14682bd96aeefdd945693
- powershell: bug-01f49ed7e02b41eba58ccc630c6170d0, bug-99e2cc66c7d34cd28e3bf20ea38814cd
- pr: change-abb444d029c440fba6895ca3d3dc1946
- pr-gate: change-50ac1b7b0ba245bca6892a771e308eb1
- qa: change-12b834a1483f4fad8368e33dfe64947a, change-50ac1b7b0ba245bca6892a771e308eb1, change-a42d82b9641948eab4109dd13795f675
- qa-gate: change-abb444d029c440fba6895ca3d3dc1946
- qa-guardian: bug-01f49ed7e02b41eba58ccc630c6170d0, bug-09c23cce8bb443d7aadb0f5dea5ce3b7, bug-19e5ffff30db46ccbca9f8ca73551ad1, bug-1a88afaf58fe4f13859d209b49b49027, bug-1a8b3cf22fc9424ba73e009dd9c4556d, bug-26ad869551cf43f585bbfc062876eccc, bug-541a9d6211594221a5ceb08950e80881, bug-5a7a143fe7f84b4e9ab88dc922c2511b, bug-682f269c0050412797459f52712af366, bug-68ea53ff66ef4f62b7f680db1ecebf19, bug-7cebbfc6c8794207aee4ccebd7974edf, bug-83b7d5b7c85e4316adc6fa751321262a, bug-8a392be541a943bdad199b2dd863ca7c, bug-8a5db6c7aa0447189f0e23d02741516c, bug-8c8b03fc6c9c4adbb115442b042dd400, bug-986e8e7b64f046c1bedbacbcbc65a083, bug-99e2cc66c7d34cd28e3bf20ea38814cd, bug-9df5a75c67504f4fac0d315dd7cef2dd, bug-9ea4fabc7f0948ac9dcdf159659e61de, bug-a47057aaf97145de807476aef76844e3, bug-addaeb3484574da4898bc2d0d5a022d6, bug-aebf3f8b068f48b59ce275467409fa20, bug-b963cb3902ec472fba0747de51688475, change-0071a9a0e32c40c28601c3ff7d6ad8b6, change-09acc786cc4c4b53b58d1e9a5b7267ef, change-0fcf1b08d1784c49b5e6ec1c2d6c527f, change-12b834a1483f4fad8368e33dfe64947a, change-1a149adf92854c34938da07409ba28a9, change-24402a071a3a4c84a3a6f56e78cca33b, change-260993fcf6504e8eb9e54f84f0dd45f4, change-2955e2780a8b4097bfdf09d765453605, change-2d00718e55fc479195377618f8fe8527, change-39d97b0a4c854e3893e13ba9e9a5859d, change-41675aeea2c446eea10506e55cbbd08d, change-47dc8b8da91e4b6fa99315f0e3712686, change-494b8d8a5ef14682bd96aeefdd945693, change-4e17ae8322d944be9acbbd5f14780594, change-50ac1b7b0ba245bca6892a771e308eb1, change-559f7f25f2834bb2b50e4b7bcf9a3bfb, change-5abf095ac5524443a5d7a9038a01a1e8, change-5cb23fed3750411f9d0a01fddae5f6de, change-5e5f9e3456464cb598ba51d705ffc945, change-62abfd75f0104cce826232f15679e2d3, change-66dd4c4f08114b48899480c39d8052a7, change-6ff6c658477b423eae1d6e18a33f92b9, change-856058c87cf3450e8460263aeef5cb2a, change-8566e0c1beed41e28dc4c9b6eed93fa8, change-9075ddb15f55461cba237c8f6c302f95, change-9c651671735d41ca84cb71a1c1bd2213, change-a1a8b1267e6946a098431b0dfbd102b6, change-a42d82b9641948eab4109dd13795f675, change-a43b7803dba74e9bae48e0bed222011c, change-a4cb962beea34d6491bc3c850bbd7590, change-ab75b9ee58354673b48b9c875f91a889, change-abb444d029c440fba6895ca3d3dc1946, change-bcabf0f8e62b4a45b47b7823b934848e, change-bf2f029768594b7097870069da715a0a, change-c4f7796c3fa940589c4c90921c26455c, change-c783251f5b134af9b8bd7e15628fc7c6, change-c79535dd171745ee98a74bae8ca3c2ba, change-c9452e10a1264645a06915267c49e44d, change-cc34c0f387b04539bef2107012ba5deb, change-d4732a411e254c618517828d62e5ed70, change-d68ddced82a4440492d038e2b4aa8975, change-d9e9344cce4a4afbb937c6c637a7931c, change-df0e3cad054847b7a529c6246bd4d603, change-e34b035b981b4224a44621ba7457d5b2, change-eb83465c334b4e88b55e83d019123930
- qa-session: bug-95af95c0c87348659c6d36a12974beb0
- qa-verdict: bug-a47057aaf97145de807476aef76844e3, bug-aebf3f8b068f48b59ce275467409fa20
- read-only: change-47dc8b8da91e4b6fa99315f0e3712686
- recovery: change-a43b7803dba74e9bae48e0bed222011c
- reliability: change-2955e2780a8b4097bfdf09d765453605, change-a1a8b1267e6946a098431b0dfbd102b6, change-a4cb962beea34d6491bc3c850bbd7590, change-e34b035b981b4224a44621ba7457d5b2
- review: change-c79535dd171745ee98a74bae8ca3c2ba
- review-remediation: change-4e17ae8322d944be9acbbd5f14780594
- role-split: change-24402a071a3a4c84a3a6f56e78cca33b
- runtime: bug-19e5ffff30db46ccbca9f8ca73551ad1, change-0071a9a0e32c40c28601c3ff7d6ad8b6
- runtime-integration: change-cc34c0f387b04539bef2107012ba5deb
- runtime-qa: change-8566e0c1beed41e28dc4c9b6eed93fa8
- safety: change-d9e9344cce4a4afbb937c6c637a7931c
- safety-gate: change-494b8d8a5ef14682bd96aeefdd945693
- scheduler: bug-a47057aaf97145de807476aef76844e3, change-df0e3cad054847b7a529c6246bd4d603
- security: bug-19e5ffff30db46ccbca9f8ca73551ad1, change-4e17ae8322d944be9acbbd5f14780594, change-5abf095ac5524443a5d7a9038a01a1e8, change-a1a8b1267e6946a098431b0dfbd102b6
- session-continuity: bug-09c23cce8bb443d7aadb0f5dea5ce3b7, bug-7cebbfc6c8794207aee4ccebd7974edf, bug-95af95c0c87348659c6d36a12974beb0, change-09acc786cc4c4b53b58d1e9a5b7267ef, change-2d00718e55fc479195377618f8fe8527, change-9c651671735d41ca84cb71a1c1bd2213
- spawn: change-9075ddb15f55461cba237c8f6c302f95
- specialists: change-47dc8b8da91e4b6fa99315f0e3712686
- state: change-0fcf1b08d1784c49b5e6ec1c2d6c527f, change-12b834a1483f4fad8368e33dfe64947a
- state-consistency: bug-8a5db6c7aa0447189f0e23d02741516c
- structured-output: bug-b963cb3902ec472fba0747de51688475
- sybermem: change-856058c87cf3450e8460263aeef5cb2a
- timeout: change-2955e2780a8b4097bfdf09d765453605
- unattended-quality: change-559f7f25f2834bb2b50e4b7bcf9a3bfb
- usability: change-c783251f5b134af9b8bd7e15628fc7c6, change-d4732a411e254c618517828d62e5ed70
- validation: bug-26ad869551cf43f585bbfc062876eccc
- verdict: change-a42d82b9641948eab4109dd13795f675
- verdict-protocol: change-bcabf0f8e62b4a45b47b7823b934848e
- watch-mode: change-66dd4c4f08114b48899480c39d8052a7
- webhook: change-5e5f9e3456464cb598ba51d705ffc945, change-df0e3cad054847b7a529c6246bd4d603, change-eb83465c334b4e88b55e83d019123930
- windows: bug-541a9d6211594221a5ceb08950e80881, bug-83b7d5b7c85e4316adc6fa751321262a, bug-8c8b03fc6c9c4adbb115442b042dd400, bug-9df5a75c67504f4fac0d315dd7cef2dd, bug-addaeb3484574da4898bc2d0d5a022d6, change-6ff6c658477b423eae1d6e18a33f92b9, change-9075ddb15f55461cba237c8f6c302f95
- worktree: bug-5a7a143fe7f84b4e9ab88dc922c2511b, bug-9ea4fabc7f0948ac9dcdf159659e61de, change-8566e0c1beed41e28dc4c9b6eed93fa8
