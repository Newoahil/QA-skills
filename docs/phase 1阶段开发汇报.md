# QA Skill Phase 1 阶段开发汇报
**日期：** 2026-08-06
**项目：** QA Skill Pack
**阶段结论：** Phase 1 完成度 100%

## 一、文档目的
本报告面向管理层，汇总 QA Skill Phase 1 的交付结果、验证证据、当前边界和后续推进方向。本文只描述当前已实现内容，不把 Phase 2 及以后路线写成已落地能力。

## 二、阶段摘要
Phase 1 已完成围绕单个需求、缺陷修复或代码 Diff 的单次 QA 闭环：由用户手动触发，由一个专用 QA subagent 连续完成 triage-first `using-qa -> qa-triage -> qa-lite OR qa-plan -> qa-execute -> qa-conclude`，并交付可复核的 Markdown QA 报告。当前阶段的价值在于把范围、风险、证据、结论和人工决策边界固定下来，避免把“看起来正常”误当成可验证结论。

当前实现已经交付 18 项 pack artifacts，包括六个核心组件、八个 shared references、两个报告模板、一个 JSON Schema 和一个 validator CLI；确定性测试基线为 **18 pack contracts + 65 functional contracts = 83 项**，全部通过。真机/真流验证覆盖 PASS、FAIL、BLOCKED 三类场景，但该 harness 默认是 opt-in，且只验证当前可观察到的 OpenCode 1.18.x 兼容形态，不代表通用兼容承诺。仓库-owned explicit suite 的独立快照是 182 total, 180 pass, 2 expected opt-in skips, 0 fail。

## 三、用户给出的四阶段方向
用户要求的总体方向可概括为四步：
1. Phase 1：以单个 Diff 或单次需求为中心，形成稳定、可追溯的 QA 闭环。
2. Phase 2：把同一 QA 方法扩展到项目级、子系统级或发布级 QA。
3. Phase 3：主动获取相关项目上下文，减少信息分散和历史缺口。
4. Phase 4：在人工治理前提下沉淀可复用的项目知识，但不允许自动改写当前证据边界。

其中，项目管理集成、知识沉淀和更高阶的项目级能力，属于后续方向，不应写成当前已实现能力。

## 四、Phase 1 的目的、架构和工作流
### 4.1 目的
Phase 1 的目标不是自动化发布，也不是替代人工 QA，而是为单次需求/修复/Diff 建立一条边界清晰、证据可追溯、结论可审计的验证路径。它解决的是“这次改动到底验证了什么、没验证什么、为什么能/不能下结论”的问题。

### 4.2 架构
当前 Phase 1 的结构是一个主 Agent 加一个专用 QA subagent，且同一子会话贯穿计划、执行、结论三个阶段。六个组件的职责已经固定：
- `using-qa`：人工入口、角色边界、总流程和停止条件。
- `qa-triage`：先判定 `Profile Decision: LITE` 还是 `Profile Decision: FULL`。
- `qa-lite`：单边界低风险 QA-Lite 路径、只读和 exact relay 交付。
- `qa-plan`：Repository Preflight、实际 Diff 检查、Change Intake、风险分析、验证计划和 Plan Gate。
- `qa-execute`：按已批准计划只读执行，记录真实证据。
- `qa-conclude`：分类发现、核对追踪链、形成结论和 Conclusion Gate。

报告模板和 references 把证据、状态、风险、发现、人审和残余风险固定到同一个 Markdown 载体里，避免子会话和主会话各写各的、最后无法对账。

### 4.3 工作流
当前工作流是：用户手动触发 -> 主 Agent 交接明确的 skill source path、product target path、范围、非目标、上下文和约束 -> using-qa -> qa-triage -> qa-lite OR qa-plan -> Repository Preflight -> 独立检查可用 Diff -> Change Intake -> Objective and Scope -> Inputs and Assumptions -> Risk Analysis -> 11-category / five-assessment matrix -> Verification Plan -> QA Plan Gate -> qa-execute -> qa-conclude -> Conclusion Gate -> 交付完整权威报告。

这个流程的关键点是先确认目标和边界，再谈验证；先看实际变化，再谈推断；先要证据，再给 PASS。

## 五、验证内容、类别和当前计数
### 5.1 确定性验证基线
当前可核对的 pack contracts 总数为 **18 项**，functional contracts 总数为 **65 项**，合计 **83 项**。这 83 项均已通过。相关命令为：

```powershell
node --test --test-name-pattern "^P1-" tests/qa-skill-pack.test.mjs
node --test tests/functional-validation/contracts.test.mjs
node --test tests/functional-validation/qa-plan-validator.test.mjs
```

### 5.2 验证类别
当前 Phase 1 的验证覆盖以下类别：
- 结构与清单：六个组件、共享 references、模板和目录边界。
- 语义约束：手动触发、单一 QA subagent、只读边界、阶段顺序、报告权限。
- 路径与预检：明确区分 skill source path 和 product target path，先做 Repository Preflight，再看实际 Diff。
- 证据与状态：Change Intake、风险优先级、证据追踪链、四种状态和人审边界。
- 适用性矩阵：11-category / five-assessment matrix 必须先行，不能静默省略任一类别或 assessment。
- 功能 harness：严格 JSONL 解析、权威报告交付、child/parent relay、拓扑校验、脱敏、运行时配置、postflight integrity、opt-in 真机运行门槛。

### 5.3 当前测试事实
`tests/qa-skill-pack.test.mjs` 当前覆盖 18 项 P1 pack 级校验；`tests/functional-validation/contracts.test.mjs` 当前覆盖 44 项功能合同校验，`tests/functional-validation/qa-plan-validator.test.mjs` 另覆盖 21 项 runtime validator contract。功能验证 README 明确写明：真实 OpenCode 运行是 opt-in，通过 `QA_SKILL_REAL_RUNS`、`QA_SKILL_MODEL`、`QA_SKILL_AGENT` 和 `QA_SKILL_TIMEOUT_MS` 控制，默认不触发模型调用。

### 5.4 Runtime validator contracts

`qa-plan/v1` 的 21 项 runtime validator contract 只检查 planner sidecar 的一致性，不检查产品质量本身。它们覆盖两阶段 JSON sidecar、CLI 错误处理、4 MiB regular-file 输入边界、plan-stage 与 conclusion-stage 的字段约束、11 类 applicability matrix、引用完整性、Lite / Full 路由边界、`rigor: Standard` 与 `rigor: Audit`、Schema-Validator 漂移门禁、非命令 evidence、稳定诊断和输入只读性。Node 不可用时的手工 fallback 由 `P1-PLANNER-017` 文本合同覆盖。全部 21 项都已通过。

## 六、结果、证据与限制
### 6.1 结果
Phase 1 当前结论是：交付完成，且验证基线通过。现有证据说明，流程骨架、语义边界、报告模板、状态分类、权威交付和功能 harness 已可用。

### 6.2 证据
主要证据如下：
- `node --test --test-name-pattern "^P1-" tests/qa-skill-pack.test.mjs`、`node --test tests/functional-validation/contracts.test.mjs` 和 `node --test tests/functional-validation/qa-plan-validator.test.mjs` 均通过。
- pack contracts 18 项通过，functional contracts 65 项通过，合计 83 项通过。
- functional harness 文档明确了 opt-in 真机运行和四个环境变量门槛。
- Phase 1 Skill、references 和模板文件已经按目录结构落位，并可被发现。

### 6.3 限制
当前实现仍有明确边界：
- 这不是项目级聚合 QA，也不是发布级 QA。
- 这不是自动化修复系统，不会自动修改产品文件。
- 这不是持续知识库，也没有把项目管理集成做成当前实现。
- 真机 OpenCode 验证是 opt-in，不是默认全量执行。
- 已有历史 benchmark 只能作为参考，不能替代当前证据。

## 七、Phase 2 M1-M6 状态说明
Phase 2 的 M1-M6 目前只适合作为后续路线背景，不应理解为 Phase 1 已经具备这些能力。
- M1：项目级入口与运行契约，属于扩展方向。
- M2：项目级计划与风险分类，属于扩展方向。
- M3：项目级执行与结论，属于扩展方向。
- M4：生成测试和修复闭环，属于扩展方向。
- M5：运行恢复与历史状态，属于扩展方向。
- M6：能力发现与资源调度，属于扩展方向。

当前报告只确认这些是后续阶段目标，不把它们写成已经落地的能力。

## 八、下一步建议
1. 先让需求方确认 Phase 1 交付边界和当前 83 项确定性验证基线，以及 182 total, 180 pass, 2 expected opt-in skips, 0 fail 的仓库-owned explicit suite 快照。
2. 再定义 Phase 2 的项目级目标、边界和人工职责，不要先上集成再补规则。
3. 若要推进真机验证，先保持 opt-in 门槛和证据脱敏规则不变，再扩充场景覆盖。
4. 若要推进项目上下文自动获取，先设计只读、可追溯、可回收的治理边界，再考虑复用。

## 九、交付说明
坤哥，下午好！

QA Skill Phase 1 已完成交付。当前阶段已经把单次需求/修复/Diff 的 QA 闭环、证据链、状态分类、只读边界和权威报告模板固定下来，并通过了 83 项确定性合同验证。仓库-owned explicit suite 另有 182 total, 180 pass, 2 expected opt-in skips, 0 fail 的独立快照。后续如果要进入项目级能力、上下文获取和知识治理，建议按 Phase 2 起步，但那部分应作为新阶段设计，不应回写为 Phase 1 的既成事实。
