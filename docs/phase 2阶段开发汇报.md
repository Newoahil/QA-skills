# QA Skill Phase 2 阶段开发汇报
**更新日期：** 2026-08-04
**项目：** QA Skill Pack
**阶段结论：** Phase 2 M1-M7 基线（合同、受控 fixture、窄范围 Node 真实项目 harness）已完成并保留历史证据，真实项目 benchmark harness 与语料也已实现并完成尝试，但因外部 CPA/OpenCode 证书不稳定，Skill 效果仍未被验证，当前没有任何 benchmark 证明的 Skill 变更

## 一、执行摘要

Phase 2 将 Phase 1 的单次需求、修复、Diff QA 闭环扩展为全项目 QA 方法论与基线，同时保留证据优先、只读边界、四种状态和 authority 分工。M1 到 M7 七个里程碑都已实现并完成开发验证；在 2026-08-04 冻结的 M1-M7 历史快照中，确定性测试为 108 项，结果是 107 pass、1 skip。窄范围 Node 真实项目 opt-in 运行在隔离副本中通过全部六项 M7 测试，目标项目原始文件零变更。随后又补上了真实项目 benchmark harness 和 corpus，但 benchmark 结论仍停在“已实施、已尝试、未证实有效”。

当前结论：Phase 2 M1-M7 基线仍然成立，最终 post-change five-lane quality review 已全部 PASS。M7 真实执行只证明受控工作流、安全边界和 authority 完整性，不证明真实项目 QA 有效性，也不证明 Skill 相对 Baseline 的优势。真实项目 benchmark 已跑到外部证书不稳定这一上限，当前没有可据此下结论的 Skill 提升证据。下一发布门仍是冻结的真实公开 issue 修复前、修复后快照配对，在完全相同的 Baseline 与 Skill 条件下按既定八项指标评分。

## 二、Phase 2 目标

Phase 1 解决的是"这次改动到底验证了什么、没验证什么、为什么能/不能下结论"。Phase 2 把同一套方法应用到整个当前项目：以项目当前实际代码状态（含未提交变更）为验证对象，自动盘点模块、识别重要模块和关键流程、按风险驱动编排验证、在隔离副本中执行只读 QA、生成可复查的项目级风险/覆盖/证据/剩余风险报告。

核心约束不变：证据优先、只读边界、四种 canonical 状态（PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW）、authority 分工、Human Gate、不自动修改产品文件、不自动提交/推送/发布。

## 三、里程碑交付

### M1：项目级入口与 authority 骨架

新增 `using-project-qa` 入口 Skill、`project-qa-run-contract.md` 运行合同和 `project-qa-report.md` 报告模板。入口仅在显式全项目 QA 请求时触发，默认 `PROJECT_QA_ONLY` 模式，要求显式提供并解析 skill source path 和 product target path 两个独立值，禁止从 skill 路径、cwd 或祖先仓库推断目标。定义了 `qa_session_id`/`run_id`/`parent_run_id` 运行身份、快照身份字段、`.qa/runs/<run_id>/` 存储决策（仅当已忽略/本地排除且不修改受跟踪文件时可用，否则强制宿主持有外部存储）、四种 authority 域（Evidence/Report-semantic/Run-state/Delivery）及其不一致时 fail-closed 规则。

### M2：模块盘点、风险分类与计划门

新增 `project-qa-plan` Skill 和 `project-risk-classification.md` 风险分类参考。Coordinator 在 intake/snapshot/storage 之后路由到计划阶段，完成项目盘点（模块、入口、测试、共享依赖）、重要模块和关键流程识别（每项记录依据和来源）、`Must Verify` 分类、跨模块关键流程分析和 Plan Gate。Plan Gate 在缺少客观验收前提时 `BLOCKED` 并记录精确重跑条件；主观业务/安全决策进入 `NEEDS_HUMAN_REVIEW` 而非误标 `BLOCKED` 或 `FAIL`。非 Web 项目不强制浏览器/Playwright 检查。

### M3：只读模块执行与项目调和

新增 `project-qa-execute` 和 `project-qa-conclude` Skill，以及 `project-evidence-guide.md` 证据参考。Coordinator 保持只读，Module QA Agents 是独立只读 worker，接收显式模块 scope、允许的验证项、声明的资源、目标快照指纹和结果合同。模块结果记录 module ID、verification ID、command/tool、observation、exit/status、artifact reference/hash、timestamp 和 snapshot fingerprint。独立资源模块可并行，共享资源模块显式序列化。项目结论遵循 canonical 优先级，基础设施完整性失败（artifact hash 不匹配、authority 不一致）fail-closed 为 `BLOCKED` 且禁止 `PASS`。交付通过 `validateExactDelivery` 确保 report/delivered-payload/manifest 精确一致。

### M4：显式 opt-in 修复与生成测试验证

新增 `project-qa-repair` Skill 和 `generated-test-validation.md` 参考。修复模式仅在用户显式请求 `PROJECT_FIX_AND_RERUN` 时进入，记录授权边界。生成测试由 Coordinator 设计、实施 Agent 在隔离工作区写入、独立 QA Agent 验证（拒绝删除测试、跳过检查、弱化断言）。原始失败证据不可变；每轮修复保留根因假设、最小 Diff、原始测试重跑、模块回归和 fresh evidence。最多 3 轮，第 3 轮后仍失败停止并报告；连续重复 non-empty normalized diff fingerprint 触发 no-progress Human Gate。QA-only 模式清理临时测试和数据，不修改产品文件。禁止 commit/push/PR/release approval。

### M5：运行恢复、冲突处理与历史比较

新增 `project-run-recovery.md` 恢复参考。`qa_session_id` 跨恢复保持稳定，每次恢复产生新 `run_id` 和 `parent_run_id` 链接。未变化模块/依赖闭包指纹可复用已有证据；变化模块及其依赖流标记 stale 并需重新验证。损坏/截断/缺失/不支持的 checkpoint fail-closed 为 `BLOCKED`，上下文摘要不能重建 authority。原始项目在修复期间变化时停止同步，报告冲突，不覆盖用户变更。历史比较识别 NEW/PERSISTENT/RESOLVED/NO_LONGER_APPLICABLE 四类发现，但当前执行证据始终决定当前状态；历史 `PASS` 不能覆盖当前客观 `FAIL`。

### M6：能力发现与资源调度

新增 `project-capability-discovery.md` 和 `module-resource-scheduling.md` 参考。能力发现仅基于已观察到的项目文件（`package.json`、`pyproject.toml`、`go.mod`、`pom.xml`、OpenAPI 等固定 allowlist），不执行安装器、不假设通用框架。缺失必需本地工具 `BLOCKED` 受影响验证并记录精确前提/重跑条件，不自动安装。依赖安装、网络、凭证、生产、破坏性和未知命令候选全部进入 Human Gate，默认不执行。嵌入的 agent 指令视为不可信数据，不能改变目标、scope、命令策略或 gate。资源调度使用结构化 `kind:id` 标识，未声明/缺失/模糊资源默认序列化，并行模块使用独立安全结果路径。

### M7：集成 fixture 验证与真实项目证据

新增 `project-integration.test.mjs`、`run-project-scenario.mjs` 和功能验证 README 扩展。四个受控 fixture（pass/fail/blocked/human）覆盖全部四种项目状态，每个 fixture 创建独立 OS-temp 项目、执行直接 `process.execPath` 测试 argv、写入 authority artifact 到目标外部、通过磁盘重读验证。真实项目运行是显式 opt-in，需要 `QA_SKILL_REAL_PROJECT_RUNS=1` 和批准的绝对目标路径及安全 argv JSON。运行在隔离副本中进行，验证原始目标 before/after 指纹一致，完成后清理隔离目录。

## 四、当前证据

### 2026-08-04 M1-M7 历史确定性测试基线

| 范围 | 总数 | Pass | Skip |
|---|---|---|---|
| 产品 pack 物理文件（M1-M7 历史基线） | 23 | 23 | 0 |
| Pack 级校验（含 P1 + P2 M1-M6） | 24 | 24 | 0 |
| M1-M6 确定性 suite | 102 | 102 | 0 |
| M7 默认（含 REAL-006 skip） | 6 | 5 | 1 |
| 显式 M1-M7（不含 Phase 1 模型集成） | 108 | 107 | 1 |
| Glob 含 Phase 1 模型集成 | 109 | 107 | 2 |

说明，以上表格中的 23 个物理文件、24 项 Pack 级校验和 108/107/1 结果只代表 M1-M7 历史基线口径，不是当前全仓测试快照。后来 Phase 1 先增加 4 个 QA-Lite artifacts，再增加 4 个 Planner product files；Lite、applicability 和 Planner 合同也随之扩展，因此当前 full qa-skill physical pack 是 31 个文件，当前完整 pack suite 是 34 项。当前 Phase 1 deterministic subset 是 83/83，当前 repository-owned explicit suite 是 182 total、180 pass、2 expected opt-in skips、0 fail。benchmark suite 仍单独统计为 39/39，见后文。

### 真实项目证据

| 字段 | 值 |
|---|---|
| 目标 | `C:\works\QA-skills` |
| Run ID | `10a67084-4c2d-4596-8f61-d226d33b824b` |
| 外部证据目录 | `C:\Users\lhw\AppData\Local\Temp\opencode\qa-skill-m7-real-evidence\real-2026-08-03T05-39-56-028Z-V2VBxg` |
| 快照 SHA-256 | `47c152d3da1ed68814db549d8fa20ea33ecf470b45cd6e0e8e9c5bfdfe59f4b7` |
| 文件数 | 22,262 |
| 字节数 | 472,738,131 |
| Source-before / copy / source-after | 文件数和字节数三者相等 |
| 报告/交付 payload SHA-256 | `2cb0a017f193021ad336b62a5bb7f5be58eab64579fe67250170ea6a1bdc1e09` |
| 报告/交付 payload 字节数 | 415 |
| Manifest 状态 | PASS |
| 清理 | attempted=true, completed=true |
| 隔离副本内 102-test 命令 | 102/102 pass |

## 五、Skill-first 真实项目 benchmark

这部分是新增的真实项目 benchmark harness 与语料，采用 draft corpus，不代表审批通过的正式语料。

### 语料与运行设定

- 语料规模，3 对真实项目配对，6 个快照，2 个技术栈
- 构成，2 组 Node 真实 PR 对，1 组 Python 公开修复对
- 固定模型，`cpa/gpt-5.6-sol`
- 对比方式，Baseline vs Skill
- 主运行，12 个 primary runs，按 campaign 组织
- 评分维度，verdict、risk coverage、test command relevance、evidence traceability、blocker/Human Gate handling、read-only compliance、report completeness、cost/time，共 8 项
- 执行策略，无 retries，无 overwrite

### 指纹完整性处理

首次整理时，Python `pycache` 是生成产物，已经移除。最初有 4 个 `treeSha256` pin 无法稳定复现，后经 pinned-commit 的逐文件比对修正，确认 Node 与 Python 的语义内容一致，差异只来自 CRLF 和 cache residue。现在 6 个快照的 pin 都已对齐。

### 运行语料状态

这些修正只说明树指纹已收敛，不表示语料已获批，也不表示 benchmark 已经证明 Skill 有效。

### 三个 campaign

1. `test-results/real-project-benchmark-run-20260804-01`
   无效。所有请求都被拒绝，原因是 provider 配置直接拷贝了不支持的 `reasoningEffort Ultra`。后续只修正了 provider 侧的 `cpa` 映射，把 `Ultra` 规范化为 `max`。

2. `test-results/real-project-benchmark-run-20260804-02`
   对有效性无效。12 个 process 都跑完了，但 6 个 Skill 和 1 个 Baseline 遇到证书错误或超时。旧 harness 还把这些失败错误地算进分数，得到的 `0 improvement / 2 no_improvement / 4 tie` 不是证据，不能用于证明任何效果。

3. `test-results/real-project-benchmark-run-20260804-03`
   有效的 fail-closed harness 证据。第一条 primary 就在同样的证书错误上停住了，只保留 `failure.json` 和 `cleanup.json`，没有生成 scorecard、comparison 或 summary。

### 相关回归修复

- `RPB-OPENCODE-005C`，provider normalization，修正 provider-only `cpa` 映射中的 `Ultra -> max`
- `RPB-RUN-012B`，infrastructure failure rejection，确保基础设施失败直接拒绝计分
- benchmark suite 当前为 39/39

M1-M7 的历史计数仍然保留在上面的确定性测试基线里，不与 benchmark suite 混算。

## 六、初始真实运行 FAIL 的透明记录

首次真实运行结果为 FAIL：101/102 通过，仅 `FV-SKILL-006` 失败。根因是子进程环境隔离将 `APPDATA` 重映射到隔离工作区内部目录，移除了 Windows 上唯一的原生 OpenCode 可执行文件发现路径（`%APPDATA%\npm\node_modules\opencode-ai\node_modules\opencode-windows-{arch}\bin\opencode.exe`）。A/B 证据确认了因果链：隔离前该路径可解析，隔离后不可解析。

修复方案：父进程只从显式 `QA_SKILL_OPENCODE_BIN`、PATH 或已观察到的 APPDATA npm 原生安装位置解析候选文件，再通过 `resolveOpenCodeInvocation` 校验，并仅向隔离子进程传递最终的 `QA_SKILL_OPENCODE_BIN` 路径。用户的 `APPDATA`、OpenCode config 目录、auth 内容和 provider 凭证变量保持隔离，不传递给子进程。修复后重跑通过全部六项 M7 测试。

这次运行正确阻止了 `PASS` 并保留了完整失败证据。按 M7 窄范围真实运行合同，实际 Node 测试非零退出首先记为 `FAIL`；后续 A/B 调试才确认根因是隔离环境中的可执行文件发现路径，而不是产品行为。修复没有放宽凭证或用户配置隔离，只补充了经安全校验的原生可执行文件路径。

## 七、M7 变更文件

M7 新增或修改的文件：

- `tests/functional-validation/project-integration.test.mjs`：6 项 M7 集成测试
- `tests/functional-validation/run-project-scenario.mjs`：受控和真实项目场景 runner
- `tests/functional-validation/README.md`：M7 harness 文档扩展
- `docs/phase 2阶段开发汇报.md`：本报告

M7 未新增任何 Skill、reference 或产品 pack 文件。M6 的产品 pack 物理文件数 23 和 pack 测试数 24 是历史基线，M7 有意不改变；后来 Phase 1 的 QA-Lite、applicability 和 Planner 扩展使当前 full pack 达到 31 个文件、当前完整 pack suite 达到 34 项，其中 Planner 本身增加了 4 个 product files 和 `P1-PLANNER-017`。

## 八、Authority 制品

每次 M7 运行目录包含七个 authority 制品：

| 制品 | 作用 |
|---|---|
| `project-qa-report.md` | 完整 Markdown 项目 QA 报告，含 scenario/run ID、Overall Status、覆盖、模块结果、发现、Human Gate、完整性、清理 |
| `manifest.json` | 最后写入的运行清单，含 schema、scenario/run ID、status、provenance、report SHA-256/bytes、全部 artifact 引用（kind/path/SHA-256/bytes/status/scenario/run/provenance）、requiredCoverage、snapshotFingerprint、treeIdentity |
| `module-results.json` | 每个模块的 result ID、task ID、status、snapshot fingerprint、verification IDs、evidence 数组（含 command/argv/observation/exitStatus/artifact/output hashes/timestamp） |
| `execution-evidence.json` | 扁平执行证据数组，每条含 scenario/run/provenance/snapshot/module/verification/status/argv/exitStatus/stdout stderr SHA-256 和字节数 |
| `delivered-payload.md` | 与 `project-qa-report.md` 逐字节相等，通过 `validateExactDelivery` 验证 |
| `target-integrity.json` | 原始 before/after 指纹、副本指纹、cleanup 状态、完整性诊断 |
| `cleanup.json` | attempted/completed 状态 |

Authority 验证从磁盘重读所有文件，核对 manifest 引用的 SHA-256 和字节数，验证 report standalone `Overall Status`、report/delivered-payload 精确相等、module/evidence 的 scenario/run/provenance/snapshot 一致性、execution status 分类正确性、target-integrity 和 cleanup JSON 完整性，并通过 `reconcileProjectStatus` 从磁盘 module results 重新计算状态。任何不一致 fail-closed 为 `BLOCKED`，同时保留可读的底层 product findings。

## 九、安全边界

真实项目运行的安全限制：

- 命令：仅 `process.execPath` + `--test` + 目标相对 `.test.mjs` 文件，`shell: false`
- 禁止：shell 元字符、包管理器、install/update、网络 URL、凭证、token、secret、production、deploy、migration、destructive、delete、remove、release 标记
- 禁止：未知 flag、`project-integration.test.mjs` 递归、`.git`/`test-results` 路径、symlink/junction/reparse point、路径遍历、绝对/UNC/drive-qualified 路径
- 目标副本边界：maxDepth 20、maxFiles 25000、maxFileBytes 32 MiB、maxAggregateBytes 512 MiB
- 禁止：symlink、FIFO、socket、block/character device
- Artifact root 必须在 canonical 原始目标外部
- 原始目标零写入、零 copy-back、零 sync
- 子进程环境：仅传递 allowlist 系统变量，清除 `NODE_OPTIONS` 和 `NODE_TEST_CONTEXT`，隔离 HOME/USERPROFILE/TEMP/APPDATA/XDG 目录，剥离 credential-like 变量
- 超时：Windows 仅对本次注册 child PID 使用 direct `taskkill.exe /T /F`；POSIX 仅终止本次注册 process group，并在短暂 SIGTERM grace 后发送 SIGKILL；absolute fallback 即使未收到 `close` 也会返回 `TIMED_OUT/BLOCKED`，termination evidence 和后续 cleanup 结果均保留

## 十、边界与限制

- 真实项目运行是显式 opt-in，需要 `QA_SKILL_REAL_PROJECT_RUNS=1` 和批准的绝对目标及安全 argv
- M7 仅授权窄范围本地 Node `--test` 执行；不授权其他语言运行时、包管理器、网络调用或外部服务
- Phase 1 模型调用集成（`QA_SKILL_REAL_RUNS`/`QA_SKILL_MODEL`/`QA_SKILL_AGENT`）保持独立 gating，M7 不改变其 opt-in 门槛
- 不自动 commit、push、PR、release、install
- 真实项目修复（project-qa-repair）保持禁用，直至外部证书问题修复并完成新的独立 campaign
- 故障注入仅为后备手段，不能支撑真实 issue 有效性声明
- 未引入任何外部框架或依赖
- 最终 post-change five-lane quality review 已全部 PASS

## 十一、验证命令

| 命令 | 预期结果 | 实际结果 |
|---|---|---|
| `node --test tests/qa-skill-pack.test.mjs` | 当前 34/34 pass | 34/34 pass |
| `node --test tests/functional-validation/contracts.test.mjs tests/functional-validation/project-planning-contracts.test.mjs tests/functional-validation/project-execution-contracts.test.mjs tests/functional-validation/project-repair-contracts.test.mjs tests/functional-validation/project-recovery-contracts.test.mjs tests/functional-validation/project-capability-contracts.test.mjs` | 102/102 pass | 102/102 pass |
| `node --test tests/functional-validation/project-integration.test.mjs` | 6 total, 5 pass, 1 skip | 6 total, 5 pass, 1 skip |
| `$env:QA_SKILL_REAL_PROJECT_RUNS='1'; ... node --test tests/functional-validation/project-integration.test.mjs` | 6/6 pass, 隔离副本内 102/102 pass | 6/6 pass, 隔离副本内 102/102 pass |
| benchmark suite | 39/39 | 39/39 |

## 十二、管理结论与下一步

Phase 2 M1-M7 基线仍然成立，benchmark harness 也已经实现并跑过，但真实项目 benchmark 的有效性还没有被外部证书稳定性支撑起来。2026-08-04 的 M1-M7 历史快照为 108 项中 107 项通过、1 项设计内 opt-in skip；它不替代当前 83/83 Phase 1 deterministic subset 或 182 total、180 pass、2 expected opt-in skips、0 fail 的全仓显式快照。真实项目证据在隔离副本中通过全部验证，目标项目原始文件零变更，authority 制品完整可复核。最终 post-change five-lane quality review 已全部 PASS。

M7 证明的是受控工作流、安全边界和 authority 完整性，而非真实项目 QA 有效性，也未证明 Skill 相对 Baseline 的优势。benchmark 的三个 campaign 里，`-01` 是配置问题无效，`-02` 是被旧 harness 错算的无效有效性证据，`-03` 才是 fail-closed 的有效证据，但它同样只证明基础设施会在证书错误下正确停止。当前版本全项目 QA 有效性仍待证明。

下一步建议：

1. 先停止付费 rerun，直到外部证书问题修好。
2. 证书问题恢复后，再开一个全新的 campaign 重新跑基准，不沿用这次被污染的结果。
3. 继续保留独立 human review 要求，repair 仍保持禁用，不做任何 speculative Skill 编辑。

## 十三、交付说明

坤哥，下午好。

Phase 2 M1-M7 基线已经完成，benchmark harness 也已经实现并跑过，但当前不能把它写成 Skill 有效。核心交付是把 Phase 1 的单次 Diff QA 方法扩展到了全项目 QA 方法论与基线，同时保留证据优先、只读边界、四种状态和 authority 分工这些硬约束。M1 到 M6 之前已经接受，M7 补齐了集成 fixture 验证和窄范围 Node 真实项目证据。2026-08-04 冻结的 M1-M7 历史快照是 108 项里 107 项通过、1 项设计内 opt-in skip；当前全仓快照已经更新为 83/83 Phase 1 deterministic subset 和 182 total、180 pass、2 expected opt-in skips、0 fail。真实项目运行在隔离副本中通过全部六项 M7 测试，目标项目原始文件零变更，authority 制品全部可复核。benchmark 这次只证明了 harness 能分辨配置失败和证书失败，没有证明 Skill 比 Baseline 更好。

初始真实运行有一次 FAIL，根因是子进程环境隔离移除了 Windows 上 OpenCode 可执行文件的唯一发现路径，修复后重跑通过。后面的 benchmark 里又碰到了外部证书不稳定，`-01`、`-02`、`-03` 分别记录了配置拒绝、错误计分和 fail-closed 停止，说明 harness 在收口，但还不能把结果包装成效果证明。

当前产品 pack 是 31 个文件，当前完整 pack suite 是 34 项；M7 自身没有新增 Skill 或 reference 文件，M1-M7 的 23-file/24-test 数字仅保留为历史基线。当前全仓显式 suite 是 182 total、180 pass、2 expected opt-in skips、0 fail；benchmark suite 现在是 39/39，和 M1-M7 历史计数分开看。最终 post-change five-lane quality review 已全部 PASS。下一发布门是冻结的真实公开 issue 修复前、修复后快照配对，覆盖至少两个技术栈，在完全相同的 Baseline 与 Skill 条件下按八项指标评分。故障注入仍然只是后备手段，不能支撑真实 issue 有效性声明。真实项目修复保持禁用，直至外部证书问题被修复并完成新的独立 campaign。Phase 2 产品尚未完成，请按这版口径对外汇报。
