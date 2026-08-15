# QA Skill 开发文档

> 一个用于 opencode 的、面向"单个 bounded 变更"的证据优先 QA skill。它把标准 QA 流程（STLC 六阶段）沉淀为对 agent 的**方向与边界约束**，而不是逐步 SOP，让 agent 自主决定"具体怎么做"，同时用 opencode 的 agent permission 从机制层焊死只读与防越权。

---

## 1. 背景

### 1.1 问题来源

早期版本的 QA skill 是一套 **SOP（标准作业流程）**：41 个文件、约 3917 行，拆成 `using-qa / qa-triage / qa-plan / qa-execute / qa-conclude / qa-lite` 一条流水线，外加大量 reference、template、JSON planner 校验器（`validate-qa-plan.mjs` 755 行）、memory 匹配工具（`match-memory.mjs` 669 行）。

实测暴露出这套 SOP 的三个根本问题：

- **合规率低、声明与产出脱钩**：模型经常跳过被强制要求的表格/gate，或在 self-check 里声称"已评估矩阵"但报告里根本没有对应内容。一轮 5 案实测中，完整版报告的模板合规率只有约 20%（5 份里仅 1 份完全按模板产出）。
- **结构越完善，探索反而越差**：大量"填表/命名 gate"给了模型一个更容易达成的替代目标（"把表填完"），挤占了真正开放式的"把问题找全"。在最难的 nextauth 案例上，精简版一次就做到了完整版五轮工程改造都没做到的发现。
- **成本高**：SOP 的格式税（复述已知信息、填固定结构）消耗真实 token 与推理轮次，却不产生新调查。

### 1.2 设计转向

核心结论：**agent 的能力已经足够，问题不在"教它怎么做"，而在"给它方向和边界"。** 于是把 skill 从 SOP 重构为 **QA Prior（QA 先验）**——只定义"一个可信 QA 判定必须建立什么、绝不能越过什么边界、必须在哪里继续探索"，把"具体路径、深度、工具、报告结构"完全交给 agent。

一轮受控 5 案对比（baseline / 旧完整版 / 旧精简版 / 新版）验证了这个方向：新版质量为项目历史最高，全部判定正确且均由亲历证据支撑，而体量只有旧版的约 3.6%。

---

## 2. 目标

在**不牺牲 QA 独立性与证据亲历性**的前提下，用尽量少的规则，让任意开发场景下的 agent 都能跑出一份可信、可交接的 QA 判定。

核心结果：

- **给方向不给步骤**：skill 只约束"什么是好的 QA、必须产出什么、守什么边界"，不规定编号步骤、固定模板、命名 gate。
- **证据必须亲历**：每一条 PASS/FAIL 都由 agent 自己实际观察到的证据支撑（跑了命令、看到输出、复现了行为），不接受"看起来对"、未跑的测试、计划、或转述别人的结论。
- **机制级只读**：只读与防越权由 opencode agent permission 焊死，而非靠散文求模型自觉。
- **可编排、可闭环**：支持被任意开发 agent 调用，产出报告 + 测试用例设计，交回开发 agent 驱动"修复 -> 再验证"闭环。
- **可选跨 run 沉淀**：在项目显式启用（存在 `.qa/`）时，跨多次 QA 积累可复用的检查用例与团队约定。

---

## 3. 范围

### 3.1 覆盖范围

- 对**一个 bounded 变更**（一个需求、一处修复、一个 Diff/PR-change）做证据优先 QA。
- 六阶段思考框架：需求分析 -> 风险计划 -> 取证 -> 判定 -> 报告 -> 收尾。
- 只读取证：跑已有测试；工具缺失时用项目已有 runtime 直接验或写一次性探针（不落仓）。
- 按风险的可选编排：高风险/多面向变更时并行派发只读 facet 子 agent。
- 可选跨 run 沉淀（`.qa/`）：客观用例自动沉淀、团队约定人工录入。
- 三种调用入口：作 subagent 被 task 调用（推荐）、`@qa`、直接 Tab 切换。

### 3.2 不在范围

- **不写产品代码、不写/改仓库测试文件**：QA 只读、只设计与建议用例，实现/落仓/维护由授权的建设者（开发 agent）在 QA 之后完成。
- **不做发布/上线决定**：QA 只给判定，人决定是否 ship。
- **不自动修复**：修复由开发 agent 在用户授意下驱动。
- **不做团队级度量**：不产出覆盖率/缺陷密度仪表盘（那是团队级跨版本 QA 的范畴）。
- **不主动联网**：默认关闭 webfetch/websearch；仅在环境已有 `gh` CLI / GitHub MCP 时可选读取 issue/PR 上下文。
- **不主动创建 `.qa/`**：跨 run 沉淀是 opt-in，目录不存在则保持纯 report-only。

---

## 4. 角色与调用场景

| 角色 | 场景 | 目标 |
|---|---|---|
| 开发 agent | 本地开发完一个变更，提 PR 前想验证 | 派 QA 拿到判定 + 用例设计，驱动修复闭环 |
| 人（手动） | 想对某个改动做独立审查 | Tab 切 `qa` 或 `@qa`，拿一份带证据的判定 |
| QA orchestrator（`qa`） | 被调用后执行 QA | 规划、（按需）派 facet、收口判定、出报告 |
| QA facet worker（`qa-facet`） | 被 `qa` 派去查某一面向 | 亲历取证，回传带证据的发现，不下总判定 |
| 建设者（开发 agent） | 拿到 QA 产物后 | 实现测试、修复 FAIL、再验证闭环 |

---

## 5. 核心流程

### 5.1 六阶段 QA 主流程（思考框架，非流水线）

1. **理解改动该做什么（重建 oracle）**：先判断是 bug 修复还是新需求，从主 agent 交接/PRD/PR/issue/commit/已有测试重建"预期行为"这个判 PASS/FAIL 的黄金标准；建"应兑现清单"对抗长上下文遗漏；缺权威需求则推断+标注，不阻断。
2. **按风险规划验证**：想"这改动怎么坏"，深度随风险；风险启发清单为提示非必填；优先最轻的等价验证。
3. **取真证据**：实际跑；工具缺失先换路子（已有 runtime/一次性探针）再谈 BLOCKED；应兑现清单逐条核；关键结论贴命令/输出。
4. **校准判定**：四状态 `PASS / FAIL / BLOCKED / NEEDS_HUMAN_REVIEW` 之一；缺 oracle 按推断置信度决定能否 PASS；一份 QA 恰好一行 `Overall Status:` = 最坏子项。
5. **出报告**：唯一硬格式是 `Overall Status:` 一行，其余按"建议骨架"自由组织，声明必须有对应证据。
6. **收尾**：残余风险 + 给人的建议（测试用例草稿、需人工复核项）；有 `.qa/` 才走沉淀。

### 5.2 调用与闭环流程（开发 agent 视角）

1. 开发 agent 派 `qa`（推荐姿势）-> 拿到报告 + 测试用例设计。
2. 开发 agent **向用户招询一次**：是否执行修复闭环。
3. 用户确认后：按 QA 用例实现测试、跑、修复 FAIL 项（开发 agent 有写权限）。
4. **再验证**：修复后再派一次 `qa` 确认 FAIL 转 PASS、无回归；修-验循环最多 1–2 轮，仍不过则交回用户，不无限修。

### 5.3 编排流程（qa 视角，按风险）

- 默认不拆，一个 session 从头到尾。
- 高风险/多面向时并行派 `qa-facet`；若因 depth 限制派不了，则在本 session 内串行覆盖同样面向（覆盖不丢，仅失去并行）。
- 收口 = 校验各 facet 的带证据发现 + 逐条核对应兑现清单 + 出唯一一行 `Overall Status:`。

### 5.4 跨 run 沉淀流程（可选，`.qa/` 存在时）

1. QA 前读 `.qa/` 复用相关用例/约定。
2. QA 后沉淀本次所学：客观用例（有证据）自动沉淀；团队约定必须人工录入并标来源。
3. 考虑代码链路影响到的关联模块，回归其已沉淀用例。

---

## 6. 产品需求

### 6.1 QA 判定契约

- 四状态，恰好一行 `Overall Status:`，等于最坏子项。
- `PASS` 门槛：每条必需检查有亲历可复核证据、应兑现清单每条兑现、无未决 BLOCKED/NHR。
- 缺权威 oracle：推断可靠+证据齐可 PASS（须标注"推断"）；连正确标准都推不出/涉业务主观 -> NEEDS_HUMAN_REVIEW。

### 6.2 证据要求

- 证据必须亲历，禁止"看起来对/未跑测试/计划/转述结论"。
- 工具缺失时先换路子（已有 runtime 直接验、一次性探针）再谈 BLOCKED。
- 探针只读、落临时目录、不进 git。

### 6.3 报告要求

- 唯一硬格式：`Overall Status:` 一行。
- 其余用"建议骨架"（Scope / Commitments / Findings / Residual risk / Suggestions）自由组织，复杂度按需，禁止为凑格式硬填空标题。
- 声明与产出对齐：凡"声称做过"的必须指得到证据。

### 6.4 只读与职责边界

- 产品源码/测试/fixture/快照/配置一律只读；唯一例外是 `.qa/` 目录（存在时可写）。
- 不装依赖、不联网、不碰生产（除非人明确批准）。
- QA 设计并建议测试用例（本职），但不写测试进仓库（SDET 职责，交建设者）。
- QA 不做上线决定、不自动修。

### 6.5 跨 run 沉淀要求

- opt-in：`.qa/` 存在即启用，不存在则纯 report-only 且不主动创建；首次可用中性措辞陈述一句"未持久化，建 `.qa/` 可复用"。
- 两类入口：客观用例自动沉淀；约定用例人工录入 + 标来源。
- 最低字段：target / scenario / expected / kind(objective|convention) /（约定）source。不定死 schema、不写匹配工具。

---

## 7. 验收标准

### 7.1 主流程验收

- 派 `qa` 或切 `qa` 后，能对一个 bounded 变更产出带 `Overall Status:` 的报告。
- 报告的每条 PASS/FAIL 都有亲历证据（命令/输出/复现）。
- 工具缺失（如 vitest/pytest 未装）时，能改用已有 runtime 或探针取证，而非直接 BLOCKED。
- 高复杂度变更能自发派 facet；简单变更不拆。
- 报告不出现"声称做过但无产出"的脱钩。

### 7.2 调用与闭环验收

- 开发 agent 能用 task 以 `subagent_type: "qa"` 派发 QA。
- 拿到报告 + 用例设计后，开发 agent 会向用户招询是否执行闭环。
- 确认后能实现测试、修复、再派 QA 验证，且循环不超过 1–2 轮。

### 7.3 只读机制验收

- QA 运行全程无 edit 产品文件、无 install 依赖记录。
- 尝试改产品文件被 permission 拒绝；`.qa/` 写入（若存在）被允许。

### 7.4 跨 run 沉淀验收（待专门场景验证）

- 项目建 `.qa/` 后，QA 后能沉淀客观用例；无 `.qa/` 时纯 report-only。
- 第二次 QA 关联模块时能读到并复用已沉淀用例。
- 约定用例只在人明确提出后进库。

> 注：跨 run 沉淀能力已实现但尚未做专门的跨 run 场景实测，7.4 为设计验收项。

---

## 8. 技术实现

### 8.1 目录结构

```
qa-skill/
├── SKILL.md                    # 六阶段 QA 先验（唯一主文档）
├── references/
│   ├── using-qa.md             # 开发 agent 调用指引 + 修复闭环（条件加载）
│   └── qa-memory.md            # 跨 run 沉淀细则（仅 .qa/ 存在时加载）
└── agents/
    ├── qa.md                   # QA orchestrator（primary/subagent 皆可，只读焊死）
    └── qa-facet.md             # 只读 facet 子 agent（隐藏，仅被 qa 程序化调用）
```

全局安装位置：
- skill -> `~/.config/opencode/skills/qa-skill/`
- agents -> `~/.config/opencode/agents/`

### 8.2 agent 定义要点

**`qa`（orchestrator）**
- `mode: all`：三入口都开（task 调用 / `@qa` / Tab 切换）；推荐作 subagent 调用以保只读与独立性。
- `permission.edit`：`"*": deny` + `".qa/**": allow`（产品文件只读，记忆目录可写）。
- `permission.bash`：`"*": allow`，但黑名单禁 `*install*`、`git push/reset/checkout/clean/commit`。
- `permission.webfetch / websearch`：`deny`。
- `permission.task`：`"*": deny` + `"qa-facet": allow`（只准派 facet，防越权委托给其他 agent）。

**`qa-facet`（facet worker）**
- `mode: subagent` + `hidden: true`（不出现在 @ 菜单，仅被 qa 调用）。
- `permission.edit: deny`、`task: deny`（只读、不可再委托）。
- bash 黑名单同 qa。

### 8.3 依赖的 opencode 机制

| 机制 | 用途 | 配置 |
|---|---|---|
| agent permission | 机制级只读、防越权委托、`.qa/` 写例外 | `qa.md` / `qa-facet.md` frontmatter |
| `subagent_depth` | 允许 `开发agent -> qa -> qa-facet` 三层链 | 全局 `opencode.json` 设 `subagent_depth: 2` |
| Task tool | 开发 agent 派 qa、qa 派 facet | `subagent_type` 参数 |
| skill 条件加载 | reference 仅在需要时读，普通 QA 零额外成本 | SKILL.md 内链接引用 |

> `subagent_depth: 2` 是全局配置，会让任意 subagent 多嵌套一层。未设置时 qa 作 subagent 无法派 facet，会自适应降级为串行自查（覆盖不丢）。

### 8.4 触发方式

```bash
# CLI：作 orchestrator agent 运行
opencode run --agent qa --dir <repo> "<QA 请求 + 需求上下文>"

# TUI：Tab 切到 qa，或对话中 @qa

# 开发 agent 内部：Task 工具
task(subagent_type: "qa", prompt: "<目标变更 + 预期行为 + repo 路径>")
```

---

## 9. 风险与限制

| 风险/限制 | 影响 | 处理 |
|---|---|---|
| 需重编译的语言（Java/Maven 等）在只读+禁装依赖下难取动态证据 | 可能退化为静态审查 + 标注残余风险 | skill 已要求先换轻等价验证、如实标注残余风险；这是语言生态固有成本，非缺陷 |
| `subagent_depth: 2` 是全局配置 | 所有 subagent 都能多嵌套一层 | 按需启用；不启用则 facet 自适应降级为串行 |
| 与上层 agent 框架（如 oh-my-opencode）潜在冲突 | primary agent 位/权限可能相互影响 | 实测暂不冲突；如冲突可将 qa 改纯 subagent |
| 默认不联网 | 无法自动读远程 GitHub issue/PR | 主场景（提 PR 前）需求多在本地上下文；如需可用 `gh` CLI / GitHub MCP |
| 跨 run 沉淀未实测 | 沉淀能力可能有未发现的问题 | 需专门跨 run 场景验证后方可宣称可用 |
| 开发 agent 自加载 skill 自查（姿势2） | 丢失只读机制与独立性 | 已在指引中标注为降级用法，不能替代独立 QA |

---

## 10. 后续方向

- **跨 run 沉淀实测**：构造"QA 模块 A -> 沉淀 -> QA 关联模块 B -> 复用"的最小场景，验证读取/复用/关联回归/约定录入闭环。
- **更大样本 / 重复跑验证**：当前主流程验证为 n=5 单跑，需更大样本 + 重复跑测方差以支撑更强结论。
- **简单 case 成本优化**：低复杂度变更成本仍偏高（缺 turn-batching 指令），可评估补一条合并命令的成本指令。
- **框架兼容**：如需与上层 agent 框架深度共存，评估将 qa 定为纯 subagent 的收益与代价。
- **远端验证工作流对接**：若团队 QA 依赖远端 dev/CI 跑测试，评估 QA 如何读取/参考远端验证结果。

---

## 附：验证记录

- 主流程 5 案验证：见 `../QA-skills/docs/p8-prior-redesign-verify-20260814-results.md`（质量约 59，为项目历史最高，全部判定正确、均有亲历证据，约 1.44x baseline 成本）。
- 三臂对比（baseline/完整版/精简版）：`../QA-skills/docs/p7-minimal-skill-3arm-20260814-results.md`。
- 跨 run 沉淀设计记录：`../QA-skills/docs/p9-cross-run-memory-design-20260814.md`。
