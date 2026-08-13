# QA Skill 项目开发文档

## 项目名称

**QA Skill Pack**

## 文档定位

本文档是 QA Skill 的产品、工程、QA 和 Agent 开发共同参考。它说明 QA Skill 要解决的问题、当前 Phase 1 的实现、四阶段产品路线、内部运行契约、证据与安全边界，以及后续阶段的实现和验收要求。

本文档以仓库当前实现和既定方向为准。关于当前范围、目录和使用方式，可先阅读 [`README.md`](../README.md)；关于产品方向，以 [`QA-skill开发方向.md`](./QA-skill开发方向.md) 为准；关于 MVP 需求，以 [`qa-skill-mvp-requirements.md`](./qa-skill-mvp-requirements.md) 为补充参考。

状态标记约定如下：

| 标记 | 含义 |
|---|---|
| **当前实现** | 已存在于仓库，并由契约测试或真实功能验证覆盖。 |
| **Phase 1 完成** | 当前单次需求、修复或 Diff QA 能力已达到本阶段完成定义，但仍有已知限制。 |
| **计划** | 路线图中明确的后续能力，当前 Skill Pack 不应被描述为已经具备。 |
| **人工边界** | 必须由用户、产品、业务、设计、安全或发布负责人决定。 |

## 项目介绍

QA Skill 是一套面向 Agent 工作流的、技术中立的、以证据为基础的质量验证方法。它把一次需求、修复或代码 Diff 组织成可理解、可执行、可复查的 QA 运行：先确认目标和仓库边界，再检查实际变更，形成风险驱动的验证计划，经过计划门后执行已有检查，记录真实证据，分类发现，最后交付一份有边界的 Markdown QA 报告。

它不是测试框架、测试平台、测试生成器、自动发布系统，也不是替代人工 QA 的自治系统。QA Skill 的价值不在于执行固定数量的测试，而在于让每个结论都有清楚的范围、风险、验证、证据和状态来源。

当前交付形态是一个由主 Agent 手动加载的 Skill Pack，包含六个串联的组件，分别是 `using-qa`、`qa-triage`、`qa-lite`、`qa-plan`、`qa-execute`、`qa-conclude`，再加上共享 references 和报告模板。一次运行只使用一个专用 QA subagent，并在 triage、Lite 或 Full 的后续阶段复用同一会话。

## 产品定位与能力评估口径

QA Skill 的产品定位是：**让通用 Agent 按专业 QA 方法工作，帮助缺少成熟 QA 流程的个人和团队建立标准、可复用、可审计的质量验证过程**。

因此，QA Skill 的核心能力不应主要用“模型是否更会 debug”“是否更接近官方修复 patch”“是否命中 hidden test 名称”来衡量。这些可以作为辅助信号，但不是产品目标。更重要的问题是：同一个模型在加载 QA Skill 后，QA 工作方式和最终 QA 决策是否显著改善。

### 应该被评估的核心能力

后续评估应优先衡量以下能力：

1. **风险链路发现**：Agent 是否能从一个局部需求、Issue 或 Diff 推导出跨模块影响链路，例如状态、缓存、权限、数据一致性、并发、回滚、第三方集成、下游消费者和人工验收面。
2. **Must Verify 覆盖**：Agent 是否能把风险链路转化成必须验证项，并说明每一项为什么属于 `Must Verify`、`Should Verify`、`Optional` 或 `Explicitly Not Verified`。
3. **验证步骤可执行性**：验证项是否包含明确的前置条件、操作步骤、预期结果和证据来源，能够交给开发者、QA 或验收人员直接执行或复核。
4. **证据与结论校准**：Agent 是否基于实际证据输出 `PASS`、`FAIL`、`BLOCKED` 或 `NEEDS_HUMAN_REVIEW`，并避免把计划、推测、外部上下文、memory 或测试名称当成 PASS 证据。
5. **后续开发和验收价值**：QA 报告是否能帮助开发者补测试、帮助 reviewer 识别缺口、帮助产品或发布负责人理解剩余风险，而不是只形成格式完整但不可执行的文档。
6. **项目级 QA memory 学习与复用**：当人工反馈被明确授权沉淀为项目 QA 记忆时，Agent 是否能正确记录触发条件、适用边界和 must-verify，并在后续相关 QA 中主动使用，同时避免在不适用场景中过度泛化。
7. **Issue/PR/commit 外部上下文吸收**：当用户显式提供 Issue、PR 或 commit 引用时，Agent 是否能主动提取变更意图、验收标准、讨论中的风险和约束，并把它们作为 planning input 纳入 QA，而不是当成当前证据或盲目扩展范围。
8. **不过度自信**：当关键上下文、验收标准、环境、数据或证据不足时，Agent 是否明确 `BLOCKED` 或 `NEEDS_HUMAN_REVIEW`，而不是输出看似积极但缺证的 `PASS`。

### 例子：专业 QA 工作方式的差异

如果一个 Issue 的表象是“订单状态更新后，读取到旧状态”，普通 Agent 可能只写：

```text
需要测试订单状态更新后的缓存一致性。
```

QA Skill 期望引导 Agent 进一步识别影响链路和必须验证项：

```text
该变更影响 Payment -> Order -> Redis/cache -> read path。
Must Verify：
1. 支付状态回调后 Order DB 状态更新成功。
2. 订单状态相关 Redis key 被失效或刷新。
3. 失效后重新读取返回最新状态。
4. 并发状态更新时不产生旧缓存覆盖新状态。
5. 回调失败或事务回滚时缓存和 DB 不出现不一致。
风险等级：High，因为状态一致性影响支付、履约和用户可见结果。
```

如果一个 Issue 是“修改密码后旧 Token 仍然有效”，普通 Agent 可能只写：

```text
检查修改密码后旧 Token 是否失效。
```

QA Skill 期望引导 Agent 产出可执行验收流：

```text
1. 使用旧密码登录，获得 Token A。
2. 调用修改密码接口，确认修改成功。
3. 使用 Token A 调用受保护接口。
4. 预期返回 401 或等价未授权结果。
5. 使用新密码重新登录，获得 Token B。
6. 使用 Token B 调用同一受保护接口。
7. 预期请求成功。
8. 记录是否需要覆盖刷新 token、并发会话、多设备登录和审计日志。
```

以上差异才是 QA Skill 的核心价值：不是让模型猜到官方修复代码，而是让模型把需求、风险、验证和证据组织成专业 QA 决策。

### 不应作为主指标的评估方式

以下指标可以作为补充，但不应单独代表 QA Skill 能力：

- 是否命中官方 patch 修改文件。
- 是否猜中 hidden regression test 名称。
- 是否更接近某个 benchmark 的官方修复实现。
- 是否仅因为报告更长、章节更多、文件名更多就判定更好。

这些指标容易把 QA Skill 错评为 debug/bug-fix 增强器，也容易奖励形式主义或 shotgun file listing。后续 benchmark 应同时评估召回和精确性、验证步骤可执行性、风险链路完整性、证据支持程度、人工验收可用性和 memory/context 的正确使用。

## 核心功能

- **手动自然语言入口**：用户可以用自然语言提出 QA 请求，例如“刚刚推进完的开发，帮我做一下 QA”。
- **显式目标隔离**：把 skill source path 与 product target path 作为两类独立输入，产品目标必须显式提供，不能从 Skill 位置或当前工作目录猜测。
- **Repository Preflight**：在 Diff 检查前确认目标、仓库上下文、可用基线和 Diff 限制。
- **实际变更取证**：QA subagent 独立读取目标仓库中的实际可用 Diff，不把主 Agent 的变更摘要当作事实来源。
- **Change Intake**：分离 `Observed Facts`、带置信度和依据的 `Inferred Intent`、带来源或负责人的 `Authoritative Acceptance Criteria` 以及 `Unresolved Questions`。
- **风险驱动验证**：从五个可选验证层中按风险选择，不强制 Web、Playwright、语言、平台或固定测试套餐。
- **计划门与结论门**：没有 `QA Plan Gate: OPEN` 不执行验证，未完成证据和状态调和不完成 `QA Conclusion Gate`。
- **结构化 Planner sidecar**：同一个 QA subagent 维护一份 `qa-plan/v1` JSON sidecar。`plan` 阶段只记录 `method`、`preconditions`、`expectedResult` 和 `requiredEvidence`，不编造实际证据；`conclusion` 阶段再补 `status`、`evidenceRefs` 和 `conclusion`。
- **零依赖 validator CLI**：`qa-skill/tools/validate-qa-plan.mjs` 只做一致性校验。`--json` 对应 plan-stage，`--require-conclusion` 对应 conclusion-stage，退出码是 `0` 通过、`1` 合同不一致、`2` 用法或读取或加载错误。Node 不可用时不安装任何东西，手工执行同一套 schema、rubric 和 gate 规则。
- **实际证据报告**：从计划开始持续维护同一份 Markdown 报告，保留执行命令、观察结果、退出码、产物、阻塞和剩余风险。
- **四种明确状态**：`PASS`、`FAIL`、`BLOCKED`、`NEEDS_HUMAN_REVIEW`。
- **人工保留**：需求歧义、主观体验、敏感资源、高风险操作、范围变化、最终接受和发布决定都保留 Human Gate。
- **Rigor 约束**：`rigor: Standard` 和 `rigor: Audit` 仍然挂在同一条 Full 路线上，`Audit` 需要 `approvalRef` 才能被当作已批准的 rigor。
- **只读边界**：QA 不编辑产品代码、产品测试、fixtures、snapshots、配置或文档，只能写入 QA 报告和获准的临时 QA 产物。
- **报告 authority 交接**：QA subagent 的完整报告必须通过宿主的有效完成结果 payload 交回并完整交付给用户，不能用摘要或模型重构替换报告；原始 parent final message 只保留为诊断证据。

## 解决的痛点

- 需求、变更说明、验收标准和测试命令经常分散，Agent 容易把推测当成要求。
- 只看 Diff 摘要或测试名称，无法确认实际改了什么，也无法知道测试是否真的运行。
- 团队常把“命令成功”误当成“产品通过”，忽略命令覆盖范围、未验证项和环境阻塞。
- 一次 QA 运行缺少明确的开始、停止和交接边界，主 Agent、QA Agent 和用户的责任容易混淆。
- 缺少客观验收前提时，系统可能猜测预期行为并输出误导性的 PASS。
- 失败后修复和重跑经常覆盖原始证据，导致无法判断修复是否真的改变了结果。
- 证据可能含有凭证、个人数据、生产数据或完整日志，报告传播带来隐私和安全风险。

## 应用场景

- 一次功能开发完成后，对核心行为和相邻回归进行 QA。
- 一次缺陷修复完成后，对原始失败路径和相关回归进行 fresh rerun。
- 一次代码 Diff 需要在合并前形成可供产品和工程复核的证据报告。
- 非 Web 项目使用已有单元、API、集成、命令行或领域工具完成验证。
- 验收数据、外部依赖、权限或环境缺失时，清楚输出 `BLOCKED` 和可重跑条件。
- 需要人工判断 UX、视觉、业务意图、安全或隐私时，输出 `NEEDS_HUMAN_REVIEW`，而不是伪造客观通过。

## 目标用户与角色

### 目标用户

- 尚未建立统一 QA 方法的研发团队。
- 希望由 Agent 协助完成一次功能或修复验证的开发、产品和项目负责人。
- 需要了解已验证内容、失败、阻塞和剩余风险的 QA 或交付人员。
- 负责设计 Agent 工具链、Skill Pack 和评估体系的 Agent 开发者。

QA Skill 不假设用户没有 QA 经验。它的目标是提供可复用的过程和证据约束，而不是替代专业判断。

### 角色职责

| 角色 | 主要责任 | 明确不能做的事 |
|---|---|---|
| 用户 | 提出 QA 请求，补充目标、范围、验收和人工决策，决定是否接受风险或授权外部修复。 | 不能把沉默当作批准，不能省略关键验收前提。 |
| 主 Agent | 加载 Skill，收集上下文，交接显式路径和范围，启动并复用一个 QA subagent，转交澄清和 Human Gate，交付完整权威报告。 | 不把自己在父会话中的检查当作 QA 证据，不启动多个 QA subagent，不改写报告。 |
| QA subagent | 独立检查实际 Diff，建立计划，按计划执行，记录证据、发现和结论，持续维护报告。 | 不编辑产品或项目文件，不自动修复，不扩大范围，不做发布决定。 |
| 产品或业务负责人 | 定义权威验收标准，处理业务意图、体验和范围决策。 | 不以历史上下文替代当前证据。 |
| 工程或实现 Agent | 在 QA 之外执行经授权的产品修复，并提供新的变更上下文。 | 不能修改原始 QA 证据，不能用修复后的结果回写旧运行。 |
| QA 或发布负责人 | 复核证据、发现、剩余风险和人工决定，并独立作出接受或发布判断。 | 不能把 QA `PASS` 直接解释为自动发布批准。 |

### 单主 Agent、单 QA subagent 模型

当前模型刻意保持简单：一个主 Agent 负责用户和宿主协调，一个 QA subagent 负责完整 QA 运行。`using-qa`、`qa-triage`、`qa-lite`、`qa-plan`、`qa-execute` 和 `qa-conclude` 都在同一 QA 路径内完成，并复用同一 QA subagent 会话。

```text
User
  -> Main Agent
       -> using-qa
       -> one QA subagent session
            -> qa-plan
            -> QA Plan Gate
            -> qa-execute
            -> qa-conclude
       <- complete QA report
   <- host-delivered authoritative report
```

这不是多 Agent QA 流水线，也不是并行评审系统。单会话连续性保证 triage、Lite 或 Full 的后续阶段共享同一份报告和上下文，同时降低主 Agent 自行执行 QA、重复启动子 Agent 或丢失中间证据的风险。

## 手动自然语言激活

### 用户界面

终端用户不需要了解六个组件的内部名称，也不需要手写内部交接协议。推荐使用自然语言描述目标，例如：

```text
刚刚推进完的开发，帮我做一下 QA。
目标仓库是 C:\\works\\shop-app。
本次关注登录超时修复和相关回归，不做发布决定，也不要修改产品文件。
```

主 Agent 根据用户消息收集目标范围、非目标、验收标准和约束，然后加载 `using-qa` 并启动一次 QA 运行。当当前会话已经明确产品目标时，仅说“刚刚推进完的开发，帮我做一下 QA”即可；只有目标缺失或存在多个候选目标时，主 Agent 才进行针对性澄清。

### 激活语义

**当前实现**是用户手动触发和 Agent 遵循 Skill 规则。它不提供硬编码的确定性语义触发器，不依赖全局 Session Hook，也不要求每次开发活动自动进入 QA。

**计划**是在宿主具备更强编排能力时，可增加确定性命令、快捷动作或 UI 入口。但这些入口只能改善发现和调用方式，不能改变 QA 的证据、人工和只读边界。

### 内部交接

长结构化提示是主 Agent 到 QA subagent 的内部协议，不是终端用户界面。它至少传递以下信息：

| 输入 | 要求 |
|---|---|
| supplied skill source path | 用户或宿主提供的 Skill 来源路径。 |
| resolved skill source path | 宿主解析后的 Skill 来源路径。 |
| supplied product target path | 用户明确指定的产品目标路径。 |
| resolved product target path | 宿主解析后的产品目标路径。 |
| target scope | 本次 QA 要回答的问题和受影响范围。 |
| non-goals | 明确不验证的区域和不做的决策。 |
| user context | 用户意图、背景和关注点。 |
| known constraints | 命令、环境、权限、数据、时间和安全约束。 |

四个路径值必须分开记录。不能因为 Skill Pack 位于某个目录，就把该目录或当前工作目录当作产品目标。

## 架构与目录

### 逻辑架构

```text
自然语言请求
  -> 主 Agent 语义理解和人工澄清
  -> using-qa 入口
  -> 单一 QA subagent 会话
       -> Repository Preflight
       -> 实际 Diff inspection
       -> Change Intake
       -> Objective and Scope
       -> Risk Analysis
       -> Verification Plan
       -> QA Plan Gate
       -> evidence execution
       -> Findings
       -> QA Conclusion Gate
   -> Markdown QA report
   -> 宿主交付完整权威报告
  -> 人工验收或外部修复决定
```

### 当前目录结构

```text
QA-skills/
├── README.md                                      # 入口、当前范围和使用说明
├── LICENSE                                        # 许可声明
├── docs/
│   ├── QA-skill开发方向.md                         # 当前权威产品方向
│   ├── qa-skill-mvp-requirements.md                # MVP 需求与完成定义
│   ├── QA-skill开发文档.md                         # 本文档
│   └── research-sources.md                         # 调研来源索引
├── qa-skill/
│   ├── using-qa/SKILL.md                          # 手动入口、角色与总流程
│   ├── qa-triage/SKILL.md                         # triage 路由、LITE/FULL 判定和升级条件
│   ├── qa-lite/SKILL.md                           # QA-Lite 路径、exact relay 和 lite gate
│   ├── qa-plan/SKILL.md                           # Preflight、Diff、Intake、计划和 Plan Gate
│   ├── qa-execute/SKILL.md                        # 只读执行和证据记录
│   ├── qa-conclude/SKILL.md                       # 发现分类、状态和结论门
│   ├── references/
│   │   ├── qa-principles.md                       # QA 基本原则和状态规则
│   │   ├── qa-lite-triage.md                      # QA-Lite triage 规则
│   │   ├── applicability-rubric.md                # 11 类 applicability、五种 assessment 和 planner 记法
│   │   ├── qa-profiles.md                         # Lite/FULL/Audit 路由和 rigor contract
│   │   ├── risk-checklist.md                      # 风险优先级和验证层
│   │   ├── evidence-guide.md                      # 证据、脱敏和安全执行
│   │   ├── finding-classification.md              # 发现分类和状态映射
│   │   └── human-gates.md                          # 人工门禁
│   ├── templates/
│   │   ├── qa-lite-report.md                      # QA-Lite 报告模板
│   │   └── qa-report.md                            # 贯穿全流程的报告模板
│   ├── schemas/
│   │   └── qa-plan.schema.json                    # qa-plan/v1 JSON schema
│   └── tools/
│       └── validate-qa-plan.mjs                   # zero-dependency planner validator CLI
└── tests/
    ├── qa-skill-pack.test.mjs                     # Skill 包结构和语义契约
    └── functional-validation/
        ├── contracts.test.mjs                     # Harness 和场景合同
        ├── integration.test.mjs                   # 真实 OpenCode opt-in 运行
        ├── qa-plan-validator.test.mjs             # qa-plan/v1 validator contracts
        ├── harness.mjs                             # 功能验证和证据提取逻辑
        ├── scenarios.mjs                           # PASS、FAIL、BLOCKED fixtures
        └── README.md                               # 运行、兼容性和产物说明
```

### 实现文件索引

| 能力 | 实现文件 |
|---|---|
| 手动入口、单会话模型、只读和停止条件 | [`using-qa/SKILL.md`](../qa-skill/using-qa/SKILL.md) |
| triage 路由、LITE/FULL 判定和升级条件 | [`qa-triage/SKILL.md`](../qa-skill/qa-triage/SKILL.md) |
| QA-Lite 路径、exact relay 和 lite gate | [`qa-lite/SKILL.md`](../qa-skill/qa-lite/SKILL.md) |
| Repository Preflight、Diff 顺序、Change Intake、计划门 | [`qa-plan/SKILL.md`](../qa-skill/qa-plan/SKILL.md) |
| applicability rubric | [`applicability-rubric.md`](../qa-skill/references/applicability-rubric.md) |
| profile and rigor contract | [`qa-profiles.md`](../qa-skill/references/qa-profiles.md) |
| 按计划执行、证据和发现记录 | [`qa-execute/SKILL.md`](../qa-skill/qa-execute/SKILL.md) |
| 结论门、四状态和追踪链 | [`qa-conclude/SKILL.md`](../qa-skill/qa-conclude/SKILL.md) |
| 基本原则 | [`qa-principles.md`](../qa-skill/references/qa-principles.md) |
| QA-Lite triage 规则 | [`qa-lite-triage.md`](../qa-skill/references/qa-lite-triage.md) |
| 风险与五层验证 | [`risk-checklist.md`](../qa-skill/references/risk-checklist.md) |
| 证据安全与脱敏 | [`evidence-guide.md`](../qa-skill/references/evidence-guide.md) |
| 发现分类与状态优先级 | [`finding-classification.md`](../qa-skill/references/finding-classification.md) |
| Human Gate | [`human-gates.md`](../qa-skill/references/human-gates.md) |
| qa-plan schema | [`qa-plan.schema.json`](../qa-skill/schemas/qa-plan.schema.json) |
| qa-plan validator CLI | [`validate-qa-plan.mjs`](../qa-skill/tools/validate-qa-plan.mjs) |
| qa-plan validator contracts | [`qa-plan-validator.test.mjs`](../tests/functional-validation/qa-plan-validator.test.mjs) |
| QA-Lite 报告模板 | [`qa-lite-report.md`](../qa-skill/templates/qa-lite-report.md) |
| Markdown 报告字段 | [`qa-report.md`](../qa-skill/templates/qa-report.md) |

## 内部单次运行工作流

一次运行从用户手动触发开始，使用同一份 Markdown 报告从 triage 维护到结论。工作流顺序不是建议，而是当前 Phase 1 的行为契约。

```text
手动自然语言请求
  -> 主 Agent 交接独立路径、范围、非目标、上下文和约束
  -> using-qa
  -> qa-triage
  -> qa-lite OR qa-plan
  -> Repository Preflight
  -> 独立检查实际可用 Diff
  -> named Change Intake
  -> Objective and Scope
  -> Inputs and Assumptions
  -> Risk Analysis
  -> 11-category / five-assessment matrix
  -> Verification Plan
  -> QA Plan Gate: OPEN 或 BLOCKED
  -> qa-execute
  -> qa-conclude
   -> QA Conclusion Gate: COMPLETE 或 BLOCKED
   -> Overall Status
   -> 报告交回主 Agent并由宿主完整交付权威 payload
```

### 1. 产品目标与 Skill 来源分离

主 Agent 必须交接 supplied 和 resolved 的 Skill 来源路径，以及 supplied 和 resolved 的产品目标路径。QA subagent 只验证显式 product target。

以下路径不能自动成为产品目标：

- Skill source path。
- Skill 所在目录。
- 当前工作目录。
- QA 报告位置。
- 方便探测到的祖先仓库。

目标缺失、歧义或不可读时，应提出针对性问题。无法补齐时，记录 `BLOCKED`，不回退到 cwd 或祖先路径。

### 2. Repository Preflight

Repository Preflight 必须发生在 Diff inspection 和 Change Intake 之前。当前 Phase 1 只要求紧凑的行为级契约，不要求把复杂 Git 命令配方写进每次运行。

当前契约包括：

1. 产品目标必须显式存在，Skill 来源和产品目标分开记录。
2. 目标歧义、缺失或不可读时，Preflight 为 `BLOCKED`，并记录澄清问题或重跑条件。
3. Git 上下文通过探测显式产品目标目录，文件目标则探测其包含目录获得。不能用 `.git` 存在性作为仓库判断，也不能执行仓库配置的 helper；宿主无法保证边界时，相关检查阻塞。
4. 祖先仓库只能作为上下文。对于 untracked 或 no-history 产品目标，祖先仓库不能自动视为有效基线。
5. 没有可用 Diff 时，只阻塞依赖 Diff 的验证项。仍可执行有客观方法和证据的非 Diff 验证，但必须记录限制。
6. pack self-tests 和 discovery checks 只证明 Skill Pack 完整性，不是产品 QA 证据。

当前没有把 `literal pathspec`、`fsmonitor`、OID 校验和 worktree topology 等详细 Git 配方作为 Phase 1 最小行为。它们可以在后续增强中加入，但不能被误写成当前每次 QA 的隐含要求。

### 3. 实际 Diff inspection

Repository Preflight 完成后，QA subagent 独立读取目标产品的实际可用 Diff，同时查看相关现有测试覆盖、测试配置和项目提供的验证命令。主 Agent 的 Diff 摘要可以作为上下文，但不构成实际变更证据。

Diff inspection 的最低输出应回答：

- 实际修改了哪些文件、模块或接口。
- 变更直接影响什么行为。
- 是否存在测试、配置、数据或文档伴随变化。
- 可用基线和 scoped Diff 是否足够。
- 哪些影响只能推断，哪些已有权威来源支持。

### 4. Change Intake

Change Intake 是进入范围和风险规划前的命名记录。报告必须分开写下四类内容：

| 字段 | 写法 | 约束 |
|---|---|---|
| `Observed Facts` | 实际 Diff、文件、命令、已有覆盖和观察到的状态。 | 只写可观察事实，不混入意图。 |
| `Inferred Intent` | 对变更目的的推断。 | 必须给出 `Confidence` 和 `Basis`，不能替代验收标准。 |
| `Authoritative Acceptance Criteria` | 定义预期行为的标准。 | 必须记录 `Criterion` 和 `Source or owner`。 |
| `Unresolved Questions` | 影响目标、风险或执行的问题。 | 关键问题未解决时，Plan Gate 保持 `BLOCKED`。 |

### 5. Objective and Scope

计划必须明确本次 QA 要回答的问题、受影响行为、范围、非目标、预期行为和成功条件。范围不能由执行过程中发现的便利检查悄悄扩大。

### 6. Risk Analysis

风险使用四个精确优先级：

| 优先级 | 含义 |
|---|---|
| `Must Verify` | 不验证会使关键需求无法成立，或留下重大影响和阻塞风险。 |
| `Should Verify` | 有意义的相邻或支持风险，可延期，但延期原因和剩余风险必须可见。 |
| `Optional` | 有限影响的额外信心检查，本次省略不会阻止结论。 |
| `Explicitly Not Verified` | 明确超出范围或本次不可行，必须记录边界、理由和剩余风险。 |

风险至少考虑核心行为、相邻回归、数据状态边界、权限安全隐私、环境依赖工具、可靠性性能兼容性，以及 UX 视觉和业务意图。每次运行还必须在执行前完成 11-category / five-assessment matrix，矩阵里的 11 个类别和 5 个 assessment value 都必须显式可见，不能靠静默省略代替判断。

### QA applicability matrix

每次运行都要先完成 11-category / five-assessment matrix，然后才允许选择验证层。评估是显式记录，不是隐含覆盖；任何类别都不能因为没写出来就被当作通过。`Not Applicable` 代表本次不执行，`Blocked` 和 `Deferred` 也不执行，但都必须保留可见理由、前提和重跑条件。

| 类别 | 说明 |
|---|---|
| `Static/build` | 源代码、构建、配置、类型和局部静态行为。 |
| `Unit` | 单元逻辑、分支、计算和局部错误处理。 |
| `Integration` | 组件协作、持久化、队列、缓存和外部边界。 |
| `Contract/API` | HTTP、RPC、事件、CLI、schema 和公开格式。 |
| `E2E` | 关键用户流、系统级可见行为和端到端链路。 |
| `Database/migration` | schema、查询、迁移、回滚和恢复。 |
| `Security` | auth、authz、secrets、privacy、input/output 和依赖边界。 |
| `Performance` | 查询、算法成本、延迟、吞吐、重试和内存。 |
| `Compatibility` | 平台、版本、浏览器、数据格式和升级降级。 |
| `Accessibility/visual` | UI、交互、布局、文本、设计系统和可见工作流。 |
| `Regression` | 变更后可能受影响的相邻行为和配置。 |

评估值只用五个：`Required`、`Recommended`、`Not Applicable`、`Blocked`、`Deferred`。`Required` 和 `Recommended` 是本次是否需要执行的判断，`Blocked` 和 `Deferred` 只表示暂不执行但必须保留原因和后续条件。任何报告都不能靠静默省略来替代一行 assessment。

### 7. 五个可选验证层

验证层是规划选择，不代表已经执行。可按风险选择一层或多层：

| 验证层 | 主要内容 | 当前约束 |
|---|---|---|
| `Static/unit` | 源代码、配置、schema、类型、规则和局部行为。 | 低层通过不证明系统或用户可见行为。 |
| `API/integration` | 服务契约、请求响应、持久化、队列和组件协作。 | 需要实际接口或集成证据。 |
| `E2E/system` | 跨系统边界的完整支持流程。 | 不默认浏览器或 Playwright。 |
| `Specialist non-functional` | 安全、隐私、性能、可靠性、可访问性、兼容性和恢复。 | 使用敏感资源或高风险工具前需 Human Gate。 |
| `Manual acceptance` | UX、视觉、业务意图、歧义和人工接受条件。 | 客观证据不能替代人工决定。 |

### 8. QA Plan Gate

只有以下条件均满足时，才能记录 `QA Plan Gate: OPEN`：

- Repository Preflight 已记录，目标和路径边界明确。
- 实际可用 Diff 已独立检查，或 Diff 依赖限制已明确。
- 命名的 Change Intake 四类字段已完成。
- Objective and Scope、Inputs and Assumptions、Risk Analysis 和 Verification Plan 完整。
- 每个 `Must Verify` 风险都有方法、前置条件、预期结果、证据要求和 Human Gate 说明。
- 五层验证中选择的层和省略的层都有理由。
- 关键权威验收标准已提供，且没有未解决的矛盾。
- 关键上下文问题已回答，或已明确使本次运行 `BLOCKED`。

没有 Plan Gate、Plan Gate 未命名或 Gate 为 `BLOCKED` 时，不执行命令、不声称 PASS、不进入 `qa-execute`。

### 9. Evidence execution

`qa-execute` 只执行已经批准的计划，逐项确认前置条件，使用项目已有命令和工具，观察真实结果，并立即更新同一份报告。

每条证据至少包含：

- Evidence ID。
- 对应 Verification ID 和验收标准。
- 实际命令、请求或观察方法。
- 观察结果和相关输出。
- 退出码或状态。
- 产物、路径、环境或会话信息。
- 遗漏、阻塞、发现和清理结果。
- 必要的 Human Gate 或高风险命令批准引用。

计划、测试名称、dry run、Agent 成功、命令意图和“看起来正常”都不是执行证据。修复、环境变化或其他实质变化后，必须使用 fresh rerun evidence，不能复用旧证据改变状态。每个必须验证项还要在 `Risk -> Verification -> Evidence -> Status` 之前保留对应的 11-category / five-assessment matrix 结果，避免把应用性判断和执行状态混在一起。

### 10. Findings

发现必须使用六个分类之一：

| 分类 | 处理含义 |
|---|---|
| `product defect` | 实际产品行为违反支持的需求或验收标准。交给外部修复流程。 |
| `test or verification issue` | 测试、oracle、断言、过程或解释不可靠。修复验证资产后重跑。 |
| `environment/data/permission/dependency/tooling issue` | 环境、数据、权限、依赖或工具阻止可靠执行。状态为 `BLOCKED`，不是产品 `FAIL`。 |
| `requirement or acceptance-criteria issue` | 需求、预期或验收标准缺失、矛盾或未达成一致。通过人工澄清。 |
| `needs-human-judgment issue` | 证据触及业务、设计、安全、隐私、可访问性或所有者判断边界。状态为 `NEEDS_HUMAN_REVIEW`。 |
| `temporarily unconfirmed issue` | 现象可信，但当前证据不能区分原因。需要定向取证或升级。 |

每条发现记录 Finding ID、分类、观察行为、预期行为、影响、Evidence IDs 和下一步，并连接到风险和验证项。

### 11. QA Conclusion Gate

`qa-conclude` 在输出总体状态前检查：

- 每个发现、未验证项、遗漏、阻塞项和人工项已经分类。
- 每个必须验证项都有 `Risk → Verification → Evidence → Status` 追踪链。
- 每条发现都有 `Finding → Risk / Verification / Evidence` 追踪链。
- 报告使用 fresh evidence 反映外部修复或实质变化。
- 证据已最小化、脱敏，危险命令批准已记录。
- 阻塞、未验证和剩余风险仍然可见。
- 独立的 `Overall Status: ...` 行与总结和追踪表一致。

结论门的 `COMPLETE` 只表示报告已完成调和，不表示产品通过或发布获批。

### 12. 四个状态

| 状态 | 定义 | 不能解释为 |
|---|---|---|
| `PASS` | 当前范围内所有 `Must Verify` 都有实际证据，预期满足，没有未解决阻塞或关键人工判断。 | 全产品正确、穷尽验证、发布批准。 |
| `FAIL` | 实际证据证明关键预期未满足，或已确认的产品缺陷仍未解决。 | 缺少 runner、权限或数据时的替代标签。 |
| `BLOCKED` | 关键上下文、环境、数据、权限、依赖、工具或客观验收前提缺失，导致必须验证项无法完成。 | 产品缺陷或通过。 |
| `NEEDS_HUMAN_REVIEW` | 有客观证据，但不能替代主观、业务、设计、安全、隐私或所有者决定。 | 通过或自动拒绝发布。 |

状态优先级要求如下：缺少或互相矛盾的客观验收前提，且阻止定义预期或执行 `Must Verify` 时，使用 `BLOCKED`。如果同时需要人工判断，仍记录 Human Gate，但受影响验证和总体状态保持 `BLOCKED`。其他情况下，客观证据无法替代主观决定时使用 `NEEDS_HUMAN_REVIEW`。

## 报告交付与数据契约

### Markdown 审计报告

**当前实现**的主要产物是一份从 Repository Preflight 开始持续维护的 Markdown 报告，结构来自 [`qa-report.md`](../qa-skill/templates/qa-report.md)：

```text
Repository Preflight
Change Intake
Objective and Scope
Inputs and Assumptions
Risk Analysis
Verification Plan
QA applicability matrix
QA Plan Gate
Execution and Evidence
Findings
Unverified and Blocked Items
Human Review Items
Residual Risks
QA Conclusion Gate
Overall Status
Conclusion
```

报告必须保持人可读、可复查和可追踪。每个必须验证项形成：

```text
Risk -> Verification -> Evidence -> Status
```

每个发现形成：

```text
Finding -> Risk / Verification / Evidence
```

### 报告来源和 relay

跨宿主的行为契约是：QA subagent 必须把完整报告交回主 Agent，主 Agent 向用户交付时不能造成语义、证据或追踪链丢失。宿主如果能程序化取得有效的已完成 child/subagent result payload，必须直接交付该 exact payload，不能让模型重构或退化为摘要；其他宿主也必须提供不造成语义或内容损失的精确交付机制。不同宿主可以使用不同的子会话和结果传输机制，不要求统一采用某一种 `task` API。

原始 parent model final message 必须作为诊断证据保留。raw mismatch 必须如实记录，但不替代也不使 exact authoritative delivery 失效。比较是在提取后进行 byte/string exact comparison，不是 semantic equivalence；提取只移除 result wrapper 内侧由宿主添加的一层 delimiter newline，报告自身的空白与换行仍是权威字节。引用的 artifact 只是 mirror，必须与 authority 完全一致。

在当前已验证的 OpenCode 功能 harness 中，完整报告位于父 Agent 的完成态 `task` 结果及其 `<task_result>` 载荷中，该载荷被解析为 delivered authority。`final-message.md` 是 raw parent assistant output，`final-report.md` 是 exact host-delivered task-result report，`child-report-relay-evidence.json` 保留 raw hashes/bytes/match 以及 delivered equality fields，`report-source.json` 记录 task-result authority。该参考实现要求提取后的 delivered report 完整交付，不得摘要、重写、重排、加前后缀、改名 Evidence ID 或只复制结论行；这是 OpenCode 1.18.x 参考 harness 说明，不是通用 OpenCode API 合同。

**当前 OpenCode 功能验证已覆盖**以下交接约束：

- 父会话只发起一个 `task` 调用。
- 只存在一个 QA 子会话，并验证父子会话链接和模型配置。
- 父 Agent 不在 QA 任务外执行产品检查、验证命令或报告重写；宿主提供的 todo/checklist 仅可作为协调元数据，不能成为 QA 证据或替代权威报告。
- child report 与 delivered task-result report 做提取后的 byte/string exact comparison；raw parent final report 的差异只进入诊断证据，不阻塞已验证的 delivered equality；若 delivered report 引用 mirror artifact，该文件还必须通过安全路径检查并与 authority 字节一致。
- 独立 `Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW` 行必须唯一、未加 Markdown 包装，并与报告内容一致。
- 引用的报告文件只能是项目根目录下安全的 Markdown 文件，不能穿越路径、指向 `.opencode`、产品 target 或符号链接逃逸位置。

### 结构化 Planner 当前实现与结果输出方向

**当前实现**：`qa-plan/v1` 是计划与结论调和 sidecar。它保存 Profile、scope、11 类 applicability matrix、risk、verification plan，以及结论阶段追加的 status、evidence refs 和 conclusion；它不替代完整 Markdown 审计报告，也不是产品证据或终端用户结果 API。

**计划**：在不削弱完整 Markdown 审计报告的前提下，另行增加紧凑的 outcome summary 和 findings 输出，供宿主、Dashboard 或后续聚合使用。计划字段可以包括 `run_id`、`scope`、`overall_status`、风险统计、验证统计、发现摘要、阻塞项、人工项和报告引用。

**后续迭代方向**：在保持完整 Markdown 审计报告内容为语义来源、并以宿主 delivered result payload 作为交付 authority 的前提下，设计生产可用的 JSON 输出合同、紧凑 findings/summary、CI 消费接口和宿主回调能力，并建立结构化结果与 Markdown 证据逐项一致的校验。当前测试 harness 的 JSON 文件仍只是功能验证产物，不能直接视为终端用户 API。

### 计划中的 outcome summary 契约草案

下表用于指导后续设计，不代表当前实现：

| 字段 | 类型 | 规则 |
|---|---|---|
| `run_id` | string | 每次运行唯一，不能复用旧运行 ID。 |
| `scope` | object | 包含产品目标、范围和非目标。 |
| `overall_status` | enum | 只能是四个 canonical status。 |
| `verifications` | array | 每项必须能回到 Markdown 中的 Risk、Verification、Evidence 和 Status。 |
| `findings` | array | 每项必须包含 canonical category 和证据引用。 |
| `blocked_items` | array | 说明缺失前提、影响项和重跑条件。 |
| `human_review_items` | array | 说明问题、决策 owner、证据和决定状态。 |
| `report_ref` | object | 指向完整 Markdown 报告的安全引用或哈希。 |

结构化输出不能自动产生发布决定，不能隐藏 Markdown 中的未验证项和剩余风险，也不能把上下文当作证据。

## Human Gates 与只读边界

### Human Gate 触发条件

以下情况必须由人决定：

- 关键验收标准缺失或互相矛盾。
- 需求、业务意图、UX、视觉或“高级质量”属于主观判断。
- 需要凭证、个人数据、生产数据或外部敏感环境。
- 需要安装或更新依赖、访问网络或外部服务。
- 需要执行破坏性、不可逆或难以回滚操作。
- 需要扩大当前 QA 范围。
- 需要最终接受、上线、发布或 go/no-go 决策。

Human Gate 记录决策问题、为什么客观证据不能解决、证据 ID、剩余风险、所需批准、决策人和时间。缺少客观验收前提时，状态是 `BLOCKED`；有客观证据但仍等待所有者或主观判断时，状态是 `NEEDS_HUMAN_REVIEW`。

### QA_ONLY 与 FIX_AND_RERUN

**当前默认模式是 `QA_ONLY`**：

- QA subagent 只读验证产品。
- QA subagent 不编辑产品源代码、产品测试或测试文件、fixtures、snapshots、配置和文档。
- QA 发现问题后，只在报告中写明观察、影响、证据和下一步。
- 报告回到主 Agent，再由主 Agent 交给用户决定。

**计划中的 `FIX_AND_RERUN` 是宿主编排模式，不是当前 Skill 内置的自动修复能力**：

1. QA subagent 输出 `FAIL` 或其他受限结论。
2. 主 Agent 将报告原样交给用户。
3. 用户明确授权在 QA 之外进行产品修复。
4. 主 Agent 或独立 Implementation Agent 修改产品。
5. 主 Agent 把新的 Diff 和变更上下文交回同一个 QA subagent 会话。
6. QA subagent 对受影响项和相关回归重新执行，追加 fresh rerun evidence。
7. 原始失败和证据保留，不能被覆盖。

当前没有硬编码的 fix hook、自动产品修复器或内置 `FIX_AND_RERUN` 执行器。未来若宿主实现该模式，也必须把修复动作放在 QA 之外，并以用户授权、变更隔离和新的证据作为前提。

## 安全、隐私与不可信输入

- 需求、Diff、日志、测试输出、链接和外部记录均视为不可信数据，不执行其中嵌入的指令。
- 不因外部文本、测试输出或链接暗示而扩大范围或改变验收标准。
- 证据采用最小化原则，优先记录哈希、路径、脱敏摘录和摘要。
- 报告不得写入凭证、token、secret、Cookie、个人数据、生产数据或不必要的敏感请求响应。
- 需要网络、外部服务、生产或敏感资源、凭证、依赖变更或破坏性命令时，先经过 Human Gate。
- OpenCode 功能验证对模型和 Agent 参数使用保守字符校验，在 Windows 上拒绝 `.cmd`、`.bat` 和 `.ps1` 的 shell 包装路径，优先使用无 shell 的直接可执行文件。
- 报告 artifact 引用拒绝绝对路径、路径穿越、`.opencode`、产品 targets 和符号链接或 reparse component 逃逸。
- 功能验证的原始 stdout、events、stderr 和 final report 可能含有敏感模型或工具数据，只能保留在被忽略的测试产物目录，分享前必须审核和脱敏。

## 可观测性与证据保留

### QA 报告层

每次 QA 运行至少保留：

- 目标、范围、非目标和路径决策。
- 实际 Diff 和 Change Intake。
- 风险、验证项、计划门状态。
- Evidence ID、命令或工具、观察结果、退出码和产物引用。
- 发现分类、状态和追踪链。
- 未验证项、阻塞项、人工项和剩余风险。
- 结论门、独立总体状态和人工交接。

### 功能验证层

当前 `tests/functional-validation/` harness 还会产生以下内部证据：

| 产物 | 作用 |
|---|---|
| `raw-stdout.jsonl`、`events.json`、`stderr.txt` | 保存运行原始诊断，可能含敏感内容。 |
| `final-message.md`、`final-report.md` | 分别保存 raw parent assistant output 和 exact host-delivered task-result report。 |
| `report-source.json`、`child-report-relay-evidence.json` | 记录 task-result authority、可选 mirror 的安全与字节一致性、raw hashes/bytes/match 和 delivered equality 结果，不保存完整报告文本。 |
| `agent-topology.json`、`parent-boundary-evidence.json` | 证明单一 QA 子会话和父会话工具边界。 |
| `nested-session-evidence.json`、`model-command-evidence.json` | 保留最小化的子会话和实际验证命令证据。 |
| `postflight.json`、`oracle.json`、`scenario-assertion.json` | 验证产品、Skill 和运行配置未被修改，并在模型进程结束后复核命令结果。 |
| `infrastructure-status.json`、`manifest.json` | 分离基础设施状态和产品 verdict，并记录产物清单。 |

基础设施状态，例如 `TIMED_OUT`、`PROCESS_FAILED`、`INVALID_JSONL` 或 `MISSING_FINAL_TEXT`，必须与产品 QA 状态分离。基础设施完成不等于产品 PASS。

## 四阶段产品路线

四个阶段共享同一条 QA 闭环。后续阶段可以扩大范围或增加上下文来源，但不能降低当前阶段的证据规则、人工决策规则和只读边界。

```text
Phase 1  单次需求、修复或 Diff QA
   -> Phase 2  项目、子系统或发布级聚合 QA
      -> Phase 3  主动获取相关项目上下文
         -> Phase 4  人工治理的项目知识复用
```

### Phase 1：单次需求、修复或 Diff QA

#### 状态

**当前实现：Phase 1 已完成。** 当前仓库已包含完整 Skill Pack、共享规则、报告模板、确定性契约测试和真实 OpenCode opt-in 功能验证；具体发布或提交状态以版本记录和仓库历史为准。

#### 目标与价值

围绕一次功能、修复或代码 Diff，建立范围清楚、风险可解释、证据可复查、结论有边界的 QA 闭环。它首先服务于没有统一 QA 方法的团队，也为后续项目级聚合提供规范化的单次运行数据。

#### 输入

- 用户手动自然语言 QA 请求。
- supplied 和 resolved 的 Skill source path。
- supplied 和 resolved 的 product target path。
- 需求、Issue、变更说明或预期行为。
- Authoritative Acceptance Criteria 及 owner。
- Diff、受影响范围和相关项目上下文。
- 项目已有测试、构建命令和验证工具。
- 环境、测试数据、账号和权限限制。
- 已知风险、非目标和特殊约束。

#### 工作流

1. 主 Agent 澄清关键输入并启动一个 QA subagent。
2. QA subagent 建立或打开同一份 Markdown 报告。
3. `qa-plan` 先记录 Repository Preflight。
4. 独立检查实际可用 Diff、已有覆盖和项目命令。
5. 记录 named Change Intake。
6. 完成 Objective and Scope、Inputs and Assumptions、Risk Analysis 和 Verification Plan。
7. 打开或阻塞 `QA Plan Gate`。
8. `qa-execute` 按计划执行真实验证，逐项记录证据。
9. `qa-conclude` 分类发现，完成追踪和结论门。
10. 把完整报告交给主 Agent，由宿主使用有效完成结果 payload 完整交付权威报告；raw parent final message 只保留为诊断证据。

#### 输出

- 一份持续维护并可人工复核的 Markdown QA 报告。
- 风险、验证、证据和状态的完整追踪链。
- `PASS`、`FAIL`、`BLOCKED` 或 `NEEDS_HUMAN_REVIEW`。
- 发现、未验证项、阻塞项、Human Gate 和剩余风险。
- 如发生外部修复，保留原始证据并追加 fresh rerun evidence。

#### 边界与非目标

- 不做 CI/CD 集成、自动调度或自动发布门禁。
- 不做自动 Issue、PR、Jira 或 Linear 检索。
- 不做多 QA subagent 流水线、持久化 QA Agent 或 Dashboard。
- 不自动生成或修改产品测试，不自动修复产品。
- 不编辑产品源代码、产品测试、fixtures、snapshots、配置或文档。
- 不强制 Web、Playwright 或任何特定技术。
- 不做最终验收、上线或发布决定。
- 不把 pack self-tests 当作 product-target QA evidence。

#### 依赖

- 宿主能发现并加载完整 Skill Pack，或提供语义等价的 Skill 加载机制；`.opencode/skills` 是当前已验证的 OpenCode 部署方式，而不是跨宿主唯一要求。
- 主 Agent 能启动并持续复用一个 QA subagent 会话。
- 产品目标路径明确且可读。
- 项目提供至少一种可执行的验证能力，或报告能明确记录无法验证的原因。
- 需求或验收标准足以定义关键预期，或者用户能补齐 Human Gate。

#### 风险与缓解

| 风险 | 缓解方式 |
|---|---|
| 把 Skill 目录当成产品目录 | 分离四个 supplied/resolved path，禁止目标推断。 |
| 只看摘要不看实际 Diff | 强制 Preflight 后独立 Diff inspection，再做 Change Intake。 |
| 无证据却输出 PASS | 每个必须验证项要求 Evidence ID 和追踪链，结论门检查独立状态行。 |
| 缺少验收标准时猜测 | 关键客观前提缺失时 Plan Gate 和总体状态为 `BLOCKED`。 |
| 测试失败被误判成产品缺陷 | 使用六类 finding taxonomy，缺少 runner、权限、环境或数据时标记 `BLOCKED`。 |
| QA 自行修改产品 | 明确 QA_ONLY、只读写入面和 postflight 完整性检查。 |
| 主 Agent 改写报告或宿主丢失内容 | delivered task-result report 与 child report 做 byte/string exact 校验；raw parent mismatch 如实保留在诊断证据中。 |
| 证据泄露敏感数据 | 最小化、脱敏、哈希化并限制原始测试产物传播。 |

#### 验收标准

- 包含 `using-qa`、`qa-triage`、`qa-lite`、`qa-plan`、`qa-execute`、`qa-conclude`、references 和报告模板。
- 能对非 Web 项目完成一次真实 QA，不强制 Playwright。
- Repository Preflight 发生在实际 Diff 和 Change Intake 之前。
- 能明确区分 observed facts、inferred intent、authoritative criteria 和 unresolved questions。
- 没有 `QA Plan Gate: OPEN` 时不执行验证。
- 使用一个专用 QA subagent，并在 triage、Lite 或 Full 的后续阶段复用同一会话。
- QA 不修改产品源代码、测试代码或其他产品文件。
- 每个关键结果有实际命令或工具证据，不能用 Agent 成功替代。
- 能输出真实的 `PASS`、`FAIL` 和 `BLOCKED` 场景，且阻塞不是产品失败。
- 报告包含四状态、六类发现、五个验证层和 Human Gate。
- PASS、FAIL、BLOCKED 和人工判断均能追溯到风险、验证和证据。
- 外部修复后必须有 fresh rerun evidence 才能改变结果。
- 宿主完整交付 QA subagent 的权威完成结果报告；raw parent mismatch 可审计且不冒充匹配。

#### 测试策略

当前测试由三层组成：

1. **Pack contracts**：检查结构、frontmatter、语义锚点、政策一致性、Preflight 字段、包内链接、OpenCode discovery 和总体状态标记。
2. **Functional fixtures**：在临时小型 Git 仓库中运行 PASS、FAIL、BLOCKED 三个场景，检查真实 Diff、验证命令、报告证据、状态提取、只读完整性和基础设施状态分离。
3. **Real OpenCode evidence**：通过显式 opt-in 运行真实模型场景，检查一个 QA 子会话、命令执行证据、task-result authority 的 exact delivery、raw parent mismatch diagnostics、oracle、postflight 和最终 verdict。

#### Phase 1 当前验证基线

当前确定性验证基线由 **18 个 pack contract 测试和 65 个 functional contract 测试，共 83 项**组成；其中 65 个 functional contract 里包含 44 个原有 functional contract 和 21 个 runtime validator contract。真实 OpenCode integration 另有一个显式 opt-in gate，未授权时按设计跳过。测试数量和结果属于运行快照，不是永久产品不变量，应以当前命令输出和对应运行产物为准。

`tests/functional-validation/qa-plan-validator.test.mjs` 这 21 项 runtime validator contract 覆盖 `qa-plan/v1` 的两阶段 sidecar、CLI 错误处理、4 MiB regular-file 输入边界、plan-stage / conclusion-stage 一致性、11 类矩阵、引用完整性、Lite / Full 路由边界、Audit 严格度、Schema-Validator 漂移门禁、稳定诊断、非命令 evidence 和输入只读性。Node 不可用时的手工 fallback 由 `P1-PLANNER-017` 文本合同覆盖。

真实 OpenCode harness 设计为依次验证 PASS、FAIL、BLOCKED 场景，并检查单子会话、目标只读、实际验证命令、task-result authority delivery、raw parent diagnostics、oracle 和 postflight。只有保存了对应场景的 `scenario-assertion.json`、`manifest.json` 等运行产物时，才能把某次真实运行描述为当前证据。

当前保留的 PASS、FAIL、BLOCKED 三个真实场景产物使用一致的 `skillSha256`，三份 `scenario-assertion.json` 均通过，且 infrastructure、agent topology、task-result authority、report relay、oracle 和 postflight 检查均有效。任何模型可见 Skill、场景、提取或交付合同发生变化后，都必须重新判断这些产物是否仍适用于当前版本。

#### 已知限制

- 当前是手动入口，依赖主 Agent 正确传递路径、范围和上下文。
- 当前没有项目级跨 Diff 聚合、主动上下文检索或项目知识存储。
- 当前没有 Skill 自己提供的 compact structured summary 或 JSON 输出。
- 当前没有 CI 集成、自动调度、自动修复或发布门禁。
- 当前 Preflight 只提供紧凑行为契约，详细 Git 配方留待后续。
- 真实 OpenCode 兼容性证据基于观察到的 OpenCode 1.18.x JSON 和 export 形状，不代表所有版本或宿主兼容。

#### 进入 Phase 2 的过渡门

只有以下条件满足，才开始 Phase 2 的产品实现：

- Phase 1 pack contracts 在当前版本稳定通过。
- PASS、FAIL、BLOCKED 的真实运行证据可重复生成。
- 报告 relay、只读边界和安全输入验证不出现未解释回归。
- 至少整理一组匿名化的单次 QA 报告样本，能支持聚合字段设计。
- 由 QA、工程和产品确认聚合目标不是把单次 PASS 相加，而是形成风险和覆盖视图。

### Phase 2：项目、子系统或发布级 QA

#### 状态

**计划，当前未实现。** 当前 Skill Pack 不支持跨 Diff 聚合、项目级状态计算或发布级证据汇总。

#### 目标与价值

把 Phase 1 的单次运行扩展到项目、子系统或发布范围，汇总跨 Diff 的风险、覆盖、验证结果和剩余风险。价值是发现共享依赖、跨模块回归、重复变更和覆盖缺口，而不是用通过数量或覆盖率生成一个虚假的质量分数。

#### 输入

- 多次 Phase 1 QA 报告及其 run ID、目标和范围。
- 项目、子系统或发布的明确范围和非目标。
- 变更之间的模块、接口、数据和依赖关系。
- 已验证、未验证、阻塞和人工判断的聚合记录。
- 项目级验收标准、发布说明和风险容忍度。

#### 工作流

1. 建立聚合目标、范围、非目标和发布上下文。
2. 校验每份输入报告的来源、版本、目标和证据完整性。
3. 归并重复风险和验证项，但保留原始 run 追踪。
4. 识别跨 Diff 共享依赖、接口变化和风险传播。
5. 形成项目、子系统或发布风险与覆盖矩阵。
6. 按缺口补充 Phase 1 验证，或记录无法补充的阻塞。
7. 汇总证据、发现、未验证项、人工项和剩余风险。
8. 交给 QA、产品和发布负责人进行人工复核。

#### 输出

- 跨 Diff 的风险与覆盖矩阵。
- 以原始 Evidence ID 和 run ID 为来源的聚合报告。
- 跨模块风险、重复失败、阻塞和覆盖缺口。
- 发布级证据包和仍需人工判断的项目。
- 计划中的 compact structured summary，若宿主已实现相应输出契约。

#### 边界与非目标

- 不宣称穷尽覆盖、质量认证或“所有测试都通过”。
- 不用覆盖率、通过数量、单一分数或历史趋势替代风险判断。
- 不自动批准发布，不替代 QA、验收人或发布负责人。
- 不把不同产品目标或不同版本的证据无条件混合。
- 不因为聚合报告显示 PASS，就隐藏单次报告中的阻塞和人工项。

#### 依赖

- Phase 1 报告字段、状态和证据追踪稳定。
- 运行 ID、目标版本、范围和证据来源可可靠识别。
- 有明确的项目、子系统或发布边界。
- 有数据模型保存聚合关系，并保留原始报告不可变引用。
- 有人工负责人审核聚合后的风险和发布语义。

#### 风险与缓解

| 风险 | 缓解方式 |
|---|---|
| 不同目标的报告被错误聚合 | 强制 target、scope、version 和 run provenance 校验。 |
| 聚合掩盖单次失败 | 保留 drill-down 链接和原始状态，不只保留汇总数字。 |
| 通过数量变成质量分数 | 报告以风险、覆盖缺口和剩余风险为核心，禁止单一分数替代。 |
| 发布级结论被误当作批准 | 明确人工发布负责人和 release decision 不是 Skill 输出。 |
| 旧报告影响当前版本 | 校验版本、时间、适用范围和是否被撤销。 |

#### 验收标准

- 能聚合多个 Phase 1 报告，并保留每个风险、验证、证据和状态的来源。
- 能按项目、子系统或发布范围生成风险与覆盖矩阵。
- 能识别跨 Diff 的共享依赖和跨模块风险。
- 能区分已覆盖、未验证、阻塞、人工判断和不适用项。
- 聚合报告不以覆盖率、通过数量或分数替代风险判断。
- 聚合不能自动输出发布批准或 go/no-go。
- 任何聚合结论可反查原始报告和证据，且旧版本证据不会静默污染当前结论。

#### 测试策略

- 使用多个匿名化 Phase 1 报告 fixture，覆盖不同目标、版本、范围和状态。
- 测试重复风险归并、跨模块依赖、冲突状态和缺失证据。
- 测试旧版本、撤销报告和不适用报告的隔离。
- 测试聚合报告是否保留原始 Evidence ID 和人工项。
- 使用人工评审样本确认聚合结果不会被解释为发布批准。

#### Phase 2 过渡门

- 聚合 schema 经过 QA、工程和产品共同批准。
- 有一组跨 Diff 真实或匿名化样本，能复现覆盖缺口和跨模块风险。
- 聚合结果能稳定回链到 Phase 1 原始证据。
- 已验证发布结论和发布批准的责任分离。
- 在引入主动上下文检索前，Phase 2 能仅凭显式输入正确工作。

### Phase 3：主动获取项目上下文

#### 状态

**计划，当前未实现。** 当前 Skill 不自动读取 GitHub Issue、PR、Jira、Linear、需求、事故、讨论或其他项目记录。

#### 目标与价值

在用户提供的目标之外，主动查找与当前 QA 相关的项目上下文，减少需求分散、历史缺失和风险线索遗漏。上下文获取只改善范围、风险和验证设计，不改变“证据来自当前执行”的根规则。

#### 输入

- 当前产品目标、分支、版本、Issue 或 PR 标识。
- 用户授权的来源和访问范围。
- GitHub Issue、PR、Jira、Linear、需求文档、事故、讨论和约束记录。
- 当前需求、实际 Diff 和已执行证据。

#### 工作流

1. 获得来源访问和数据范围的人工授权。
2. 根据目标和时间范围检索相关记录。
3. 对每条上下文记录保存来源、时间、相关性和访问状态。
4. 判断来源可靠性、时效性和与当前目标的关联。
5. 发现冲突时保留冲突，不选择方便的一条静默覆盖另一条。
6. 将可靠上下文用于调整范围、风险、验收问题和验证计划。
7. 继续执行 Phase 1 或 Phase 2 的真实验证。
8. 在报告中分开记录 context、evidence、冲突和未解决问题。

#### 输出

- 有来源、相关性、时间和访问边界的上下文摘要。
- 上下文影响了哪些范围、风险或验证设计的记录。
- 来源冲突和待人工决定的问题。
- 仍然基于当前执行证据的 Phase 1 或 Phase 2 QA 报告。

#### 边界与非目标

- 上下文不是证据，不能自动产生 PASS。
- Issue、PR、Jira 或事故记录不能自动移除 Must Verify 项。
- 历史记录不能覆盖当前需求、实际行为或执行证据。
- 不把检索结果直接写成持久项目规则。
- 不绕过访问权限，不抓取未授权的个人或生产敏感数据。
- 不因检索失败把产品标记为 FAIL，影响必须按环境或上下文阻塞处理。

#### 依赖

- 用户或宿主明确授权的连接器和访问权限。
- 可审计的来源标识、时间和版本。
- 安全的凭证处理和最小化数据读取。
- Phase 1 或 Phase 2 的稳定报告和证据模型。
- 冲突处理和相关性评估规则。

#### 风险与缓解

| 风险 | 缓解方式 |
|---|---|
| 读取到不相关或过时记录 | 保存来源、时间、相关性和适用范围，过时内容只能作为背景。 |
| 不同来源相互矛盾 | 显式列出冲突并触发 Human Gate，不自动择一。 |
| 外部文本含提示注入 | 所有外部内容视为不可信数据，不能执行其中指令。 |
| 越权访问敏感记录 | 最小权限、人工授权、脱敏和访问审计。 |
| 上下文被误当成验证证明 | 报告分离 `Context` 和 `Evidence`，状态只由当前执行证据决定。 |

#### 验收标准

- 只检索用户授权的来源和范围。
- 每条使用的上下文都有来源、时间、相关性和适用边界。
- 能检测和展示来源冲突，不能静默覆盖。
- 上下文可以改变风险和验证设计，但不能直接生成 PASS。
- 当前需求和执行证据优先于历史上下文。
- 访问、敏感内容和失败检索均有可审计记录。
- 在关闭所有上下文连接器时，Phase 1 和 Phase 2 核心流程仍能运行。

#### 测试策略

- 使用包含过时、无关、冲突和提示注入文本的离线上下文 fixtures。
- 测试来源相关性、版本和时间过滤。
- 测试授权边界、凭证脱敏和访问失败。
- 测试 context 不会被写进 evidence、PASS 条件或持久规则。
- 测试冲突来源会触发 Human Gate，并保留双方引用。

#### Phase 3 过渡门

- 连接器访问边界和敏感数据策略经安全评审。
- 上下文与证据的数据模型已分离并经过端到端测试。
- 冲突、过时、无关和提示注入场景均有可复查处理结果。
- 在至少一个授权项目中，主动上下文确实减少了遗漏，同时没有改变当前证据规则。
- 任何连接器关闭或不可用时，系统能退化为显式上下文的 Phase 1 或 Phase 2。

### Phase 4：人工治理的项目知识复用

#### 状态

**计划，当前未实现。** 当前 Skill 不保存项目规则、不自动学习、不跨运行持久化经验，也不提供项目知识库。

#### 目标与价值

把反复验证、已经确认并有清晰边界的项目经验沉淀为可复用知识，减少重复理解，同时保持来源、版本、适用条件、修正和撤销能力。知识是辅助判断的输入，不是当前验证和人工决策的替代品。

#### 输入

- 当前 QA 报告、执行证据和人工决定。
- 人工提出的规则候选或修正建议。
- 知识来源、适用项目、范围、版本和有效期。
- 批准人、批准时间、限制和撤销记录。

#### 工作流

1. 从当前证据中提出知识候选，不直接生效。
2. 由项目 owner、QA 或其他指定负责人审查候选来源和适用范围。
3. 明确 `provenance`、`scope`、`version`、`applicability`、限制和失效条件。
4. 人工批准后才允许后续运行读取。
5. 使用知识时仍对照当前需求、实际 Diff 和当前执行证据。
6. 发现错误时人工纠正，保留修正前后版本和原因。
7. 规则不再适用时人工撤销或过期，撤销不能删除原始历史。

#### 输出

- 经人工批准的可复用项目知识条目。
- 知识来源、版本、适用范围和限制。
- 批准、修正、撤销和过期审计记录。
- 使用知识对当前计划产生影响的可解释记录。

#### 边界与非目标

- 不受控自我学习，不静默改变 QA 政策。
- 不未经批准自动保存或生效项目规则。
- 不让历史知识覆盖当前需求、当前证据或新的人工决定。
- 不把知识命中当成验证执行，不因知识存在而跳过 Must Verify。
- 不跨项目共享没有明确适用范围的规则。
- 不提供自动发布授权或自动风险豁免。

#### 依赖

- Phase 3 的上下文来源和 provenance 能力，或等价的证据来源。
- 稳定的报告、证据、项目和版本标识。
- 项目 owner、QA 或指定审批人的治理流程。
- 可审计的知识版本、生命周期和权限模型。
- 能在运行前展示生效知识，并允许人工纠正。

#### 风险与缓解

| 风险 | 缓解方式 |
|---|---|
| 错误经验长期影响 QA | 必须有来源、版本、适用条件、审批和撤销。 |
| 项目规则静默扩散到其他项目 | project scope 和 applicability 强制校验。 |
| 知识替代当前验证 | 每次仍要求当前 Risk、Verification 和 Evidence。 |
| 自我学习改变政策 | 只允许生成候选，人工批准后才生效。 |
| 撤销后仍被旧缓存使用 | 使用版本和状态校验，撤销条目不能作为有效输入。 |

#### 验收标准

- 知识候选不会自动生效。
- 每条有效知识都有 provenance、scope、version、applicability、限制和 owner。
- 批准、修正、撤销和过期均可追溯。
- 当前需求和证据可以覆盖历史知识建议。
- 任何知识复用都不能跳过当前 Must Verify 或人工 Gate。
- 跨项目、跨版本和过期知识默认拒绝或进入人工复核。
- 删除、撤销和纠正不会破坏原始报告和证据历史。

#### 测试策略

- 测试未经批准候选不可见于有效规则集。
- 测试 project scope、version 和 applicability 隔离。
- 测试错误知识的纠正、撤销和过期传播。
- 测试当前需求和证据覆盖历史规则。
- 测试知识命中不会自动变更状态、跳过验证或产生发布决定。

#### Phase 4 完成门

- 知识生命周期、权限和审批 owner 已确定。
- provenance、scope、version、applicability 数据模型经过安全和产品评审。
- 候选、批准、纠正和撤销均可回放。
- 至少一组真实项目复用案例显示重复理解成本下降，且没有隐藏风险。
- 通过审计确认不存在未授权自学习、静默政策变更或无边界跨项目复用。

## 测试与评估

### Pack contracts

[`tests/qa-skill-pack.test.mjs`](../tests/qa-skill-pack.test.mjs) 检查当前 Phase 1 Pack 的结构和关键语义，包括：

- 六个组件、共享 references 和报告模板是否完整。
- Skill frontmatter 和目录结构是否符合发现要求。
- 手动触发、单一 QA subagent、主 Agent 交接和用户上下文语义是否存在。
- Repository Preflight 是否先于实际 Diff、Change Intake 和风险规划。
- 四种优先级、五个验证层、六类发现和四种状态是否一致。
- 只读、Human Gate、fresh rerun、无证据不 PASS 和发布边界是否保留。
- 报告字段、状态行、追踪链和包内 Markdown 链接是否有效。
- OpenCode 隔离 discovery 是否发现全部六个组件。

### Functional fixtures

[`tests/functional-validation/README.md`](../tests/functional-validation/README.md) 说明了无模型调用的合同测试和显式 opt-in 的真实 OpenCode harness。确定性测试覆盖：

- 临时真实 Git 仓库、baseline 和 scoped Diff。
- PASS、FAIL、BLOCKED 三个中立场景。
- 严格 UTF-8 JSONL 解析和最终文本提取。
- 报告 verdict、Evidence、Risk、Verification 和 Status 的关联。
- 缺少验收数据时的 `BLOCKED`，而不是产品 `FAIL`。
- 只读 wrapper、命令证据和 post-run oracle。
- 模型和 Agent 输入校验、无 shell 启动和符号链接边界。
- 单一子会话、父边界、报告 authority、raw mismatch diagnostics 和 delivered byte/string exact equality。
- 敏感元数据脱敏、源和 artifact manifest、基础设施状态分离。

确定性合同运行方式：

```powershell
node --test tests/functional-validation/contracts.test.mjs
node --test tests/functional-validation/contracts.test.mjs tests/qa-skill-pack.test.mjs
```

### Real OpenCode evidence

真实运行会调用模型并可能产生费用，必须显式 opt-in。当前 harness 使用三个场景：

| 场景 | 预期 | 关注点 |
|---|---|---|
| membership discount | `PASS` | 有权威验收标准、实际验证命令和 PASS traceability。 |
| tax rounding regression | `FAIL` | 真实行为不满足验收标准，分类为 product defect。 |
| missing acceptance data | `BLOCKED` | 关键验收数据缺失，记录精确重跑条件。 |

运行示例：

```powershell
$env:QA_SKILL_REAL_RUNS = '1'
$env:QA_SKILL_MODEL = 'cpa/gpt-5.4-mini'
$env:QA_SKILL_AGENT = 'build'
$env:QA_SKILL_TIMEOUT_MS = '600000'
node --test tests/functional-validation/integration.test.mjs
```

该 harness 在 OpenCode `1.18.6` 上取得过证据，兼容目标是观察到的 `1.18.x` JSON 和 export 形状。这是兼容性证据，不是对所有 OpenCode 版本的承诺。

### Security and review gates

每次重大变更应经过以下检查：

- Skill source 和 product target 是否完全分离。
- Parent 是否只发起一个 QA task，且 QA 子会话数量为一。
- QA 是否保持只读，产品、Skill 和 runtime config 是否完整性不变。
- delivered task-result report 是否与 child report byte/string exact 相同，raw parent mismatch 是否如实记录，是否存在状态行冲突或隐藏 blocker。
- 命令启动是否拒绝 shell 注入、危险路径和未批准 wrapper。
- 原始证据是否最小化、脱敏且限制传播。
- `PASS` 是否有当前实际证据，`BLOCKED` 是否有具体重跑条件。

### Historical Open WebUI benchmark findings

历史上曾使用 Open WebUI Issue **#27120** 和 **#26181** 作为 QA Skill 评估样本。历史报告的可用结论是：在当时的评估设置中，Skill 和 Baseline 在二元准确率上持平，不能据此宣称 QA Skill 带来了准确率提升或当前版本有效性提升。

还必须保留两个限制：

- 历史 benchmark 使用的是较旧版本的 Skill，不能直接代表当前 Phase 1 版本；适用性必须以版本记录、提交历史和对应运行证据为准。
- 二元准确率不足以衡量报告完整性、证据质量、只读边界、阻塞分类、Human Gate、报告 relay 或剩余风险暴露。

推荐的后续评估顺序是：

1. 预先声明 benchmark rubric，包括范围、正确性、证据、状态、边界和人工项，而不是运行后调整标准。
2. 先稳定自然语言入口和编排模式，明确 QA_ONLY、单子会话、计划门、结论门和 relay 行为。
3. 再增加 compact 或 structured output，并让其与完整 Markdown 报告逐项一致。
4. 最后在冻结的当前版本上，执行具有区分力的真实 Issue benchmark，比较 Skill 与 Baseline 的风险识别、证据追踪、状态准确性、阻塞处理和人工决策支持，而不只比较二元准确率。

## 部署、发现与使用

### 跨宿主部署原则

无论宿主使用何种 Skill 发现机制，都应部署完整 `qa-skill` Pack，不能只复制某一个 `SKILL.md`。六个组件依赖 references、templates、schemas、tools 和相互链接；交接给 QA subagent 的 resolved skill source path 必须指向同时包含这些目录的 pack root。宿主还必须保留单一 QA 会话、只读、Gate、证据和完整报告交付等行为契约。

### OpenCode 部署示例

在当前已验证的 OpenCode 环境中，可将整个 Pack 放到项目的 `.opencode/skills` 下：

推荐结构：

```text
your-project/
└── .opencode/
    └── skills/
        ├── using-qa/
        │   └── SKILL.md
        ├── qa-triage/
        │   └── SKILL.md
        ├── qa-lite/
        │   └── SKILL.md
        ├── qa-plan/
        │   └── SKILL.md
        ├── qa-execute/
        │   └── SKILL.md
        ├── qa-conclude/
        │   └── SKILL.md
        ├── references/
        ├── templates/
        ├── schemas/
        │   └── qa-plan.schema.json
        └── tools/
            └── validate-qa-plan.mjs
```

建议使用完整目录复制并检查六个组件都能被宿主发现，同时确认 `<resolved skill source path>/schemas/qa-plan.schema.json` 和 `<resolved skill source path>/tools/validate-qa-plan.mjs` 均存在。QA 报告必须写入宿主明确批准、位于 product target 和 Skill source 之外的安全 Markdown 位置；不得写入 `.opencode`、产品目标、路径穿越目标或通过符号链接、junction/reparse point 逃逸的位置。功能验证 harness 的运行产物写入已忽略的 `test-results/functional-validation/`，且不得把该 harness 位置解释为通用宿主的固定目录。

### 简洁使用示例

用户只需提出类似请求：

```text
刚刚推进完的开发，帮我做一下 QA。
目标仓库：C:\\works\\shop-app
范围：本次订单折扣修复和相关回归
非目标：不修改任何产品文件，不做发布决定
```

主 Agent 会在内部补齐路径、范围、验收和约束，并把结构化交接传给一个 QA subagent。用户不需要直接调用 `qa-plan`、`qa-execute` 或 `qa-conclude`。

## 兼容性与版本管理

### Skill Pack 版本

每次改变工作流语义、报告字段、状态规则或安全边界时，应更新 Pack 版本说明，并保留与报告和测试证据对应的版本标识。报告需要能说明：

- Skill Pack 版本或来源哈希。
- 宿主或 OpenCode 版本。
- QA run ID、时间和目标版本。
- 使用的验证命令和工具版本。
- 报告模板版本。

### 兼容性原则

- 变化应优先保持 Markdown 报告的人类可读结构和四状态语义。
- 结构化输出若上线，不能删除 Markdown 报告中的必要字段。
- 宿主升级不能改变单一 QA subagent、计划门、结论门和只读边界，除非经过明确版本迁移。
- OpenCode JSON、export 或 task-result 形状变化时，应先增加兼容性 fixture 和安全失败行为。
- 无法识别权威报告、状态行或子会话拓扑时，应该阻塞或失败关闭，不能猜测成功。
- 历史报告可以被读取为上下文或聚合输入，但不能在没有版本和适用性校验时覆盖当前证据。

## 推进计划与里程碑

| 里程碑 | 范围 | 交付物 | 完成信号 |
|---|---|---|---|
| M1 | Phase 1 稳定 | 六个组件、references、模板、pack contracts 和功能 harness。 | 单次 PASS、FAIL、BLOCKED 可重复，报告 relay、11-category / five-assessment matrix 和只读检查稳定。 |
| M2 | Phase 1 评估 | 预声明 benchmark rubric、当前版本样本和评估报告。 | 能区分证据质量、边界遵守和二元 verdict，不误读历史结果。 |
| M3 | Phase 2 设计 | 聚合 schema、风险覆盖矩阵和原始报告引用模型。 | 多 Diff 聚合可回链，不生成发布批准。 |
| M4 | Phase 2 实现 | 项目、子系统或发布级报告和 fixture。 | 跨模块风险、覆盖缺口和剩余风险可复查。 |
| M5 | Phase 3 连接器 | 授权来源读取、相关性、冲突和 context/evidence 分离。 | 外部上下文只影响计划，不直接产生 PASS。 |
| M6 | Phase 4 治理 | 知识候选、审批、版本、适用性、纠正和撤销。 | 无批准不生效，无受控自学习，审计可回放。 |

## 风险与缓解总表

| 风险 | 影响 | 缓解 |
|---|---|---|
| Agent 将主 Agent 摘要当作实际事实 | 可能漏掉真实变更和回归。 | Preflight 后独立 Diff inspection，Change Intake 分离事实与推断。 |
| 当前命令成功被解释为产品 PASS | 结论过度承诺。 | Evidence ID、追踪链、四状态和独立总体状态行。 |
| 目标路径混淆 | QA 可能验证 Skill 或错误仓库。 | supplied/resolved 路径分离，目标必须显式，歧义即阻塞。 |
| QA 修改产品或测试 | 原始验证不可复现，职责混乱。 | QA_ONLY、只读写入面、postflight 完整性和父边界合同。 |
| 自动修复覆盖原始证据 | 无法判断修复是否有效。 | 修复放在 QA 之外，原证据保留，fresh rerun evidence 必需。 |
| 上下文、未来知识或聚合结果替代当前证据 | 隐藏实际风险。 | context/evidence 分离、当前证据优先、人工治理和版本隔离。 |
| 外部记录含恶意指令或敏感内容 | 可能发生提示注入或数据泄露。 | 不可信输入规则、最小权限、脱敏和 Human Gate。 |
| 历史 benchmark 被当成当前效果证明 | 错误的产品结论。 | 明确 #27120、#26181 的版本和指标限制，冻结当前版本再评估。 |
| 报告 relay 被摘要或重写 | 用户无法复核完整证据。 | task-result 权威、哈希和字节数比对、严格状态标记。 |

## Definition of Done 矩阵

| 能力域 | Phase 1 当前完成 | Phase 2 计划完成 | Phase 3 计划完成 | Phase 4 计划完成 |
|---|---|---|---|---|
| 手动自然语言入口 | 已有，语义激活，无硬编码触发器。 | 复用到聚合请求。 | 支持授权上下文请求。 | 支持知识候选和复用请求。 |
| 目标和来源隔离 | 已有 supplied/resolved path 和显式 target。 | 聚合多 target 和版本。 | 连接器访问范围单独授权。 | 知识 scope 和 project boundary。 |
| QA 工作流 | 已有 triage-first `using-qa -> qa-triage -> qa-lite OR qa-plan -> qa-execute -> qa-conclude`。 | 复用同一闭环，范围扩大。 | 上下文只调整计划。 | 知识只辅助计划。 |
| Preflight 和 Diff | 已有紧凑行为级 Preflight 和实际 Diff inspection。 | 检查跨 Diff 基线和依赖。 | 关联外部记录和实际目标。 | 关联知识 provenance。 |
| 风险和验证 | 五层按风险选择，四种优先级，11-category / five-assessment matrix 先行。 | 风险与覆盖矩阵。 | 上下文相关性和冲突影响计划。 | 知识适用性不覆盖当前风险。 |
| 证据和状态 | 四状态、六类发现、完整追踪链。 | 跨运行聚合但可回链。 | context 与 evidence 分离。 | 知识使用与当前证据分离。 |
| 报告 | 完整 Markdown 报告和权威完成结果的 exact delivery；raw parent output 可审计。 | 项目或发布级审计报告。 | 上下文来源和冲突附录。 | 知识审计和生命周期记录。 |
| 结构化输出 | `qa-plan/v1` Planner sidecar 已实现；compact outcome summary 尚未实现。 | 计划中的 compact summary。 | 需包含 context provenance。 | 需包含 knowledge provenance。 |
| 修复模式 | `QA_ONLY`，无自动修复。 | 计划由宿主编排 `FIX_AND_RERUN`，仍不由 QA 编辑。 | 修复前后上下文可追踪。 | 知识纠正也必须人工批准。 |
| 人工和发布边界 | 已有 Human Gate，不做 release decision。 | 聚合报告仍不批准发布。 | 外部访问和冲突需要人工。 | 知识批准、修正、撤销需要人工。 |
| 安全 | 参数、路径、shell、symlink、脱敏和只读检查。 | 聚合来源和版本隔离。 | 连接器最小权限和注入防护。 | 知识权限、审计和撤销。 |
| 验收 | pack contracts、functional fixtures、真实 OpenCode 三场景。 | 多报告和跨模块 fixture。 | 离线连接器和冲突 fixture。 | 生命周期和错误知识 fixture。 |

## 总结

QA Skill 的产品方向是先建立可靠的标准 QA 方法，再逐步增加项目适配和人工治理的知识复用。Phase 1 已完成单次需求、修复和 Diff QA 的核心闭环：显式目标、Repository Preflight、实际 Diff、Change Intake、风险计划、11-category / five-assessment matrix、五层验证、计划门、真实证据、发现分类、结论门和四状态。

后续 Phase 2、Phase 3 和 Phase 4 都是计划，不应被描述为当前能力。它们可以扩大 QA 的范围、上下文和复用效率，但不能改变以下统一护栏：没有证据就没有 PASS，11-category / five-assessment matrix 先行，未知和剩余风险必须可见，外部记录只是上下文，QA 默认只读，产品修复在 QA 之外完成，修复后必须 fresh rerun，验收和发布决定始终由人负责。
