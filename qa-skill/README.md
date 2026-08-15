# QA Skill 使用文档

一个用于 opencode 的、面向单个 bounded 变更的证据优先 QA skill。它把标准 QA 流程沉淀为对 agent 的方向与边界约束（而非逐步 SOP），并用 opencode 的 agent permission 从机制层焊死只读与防越权。

> 完整的设计与开发文档见仓库 docs/QA-skill开发文档-0813.md。本文只讲怎么用。

## 它是什么 / 不是什么

- 是：对一个需求 / 一处修复 / 一个 Diff 做只读的、证据优先的质量验证，产出一份带判定的报告 + 测试用例设计。
- 不是：测试框架、测试生成器、自动发布系统。它不写产品代码、不改仓库测试文件、不做上线决定、不自动修复。

## 文件结构

```
qa-skill/
├── SKILL.md                    六阶段 QA 先验（主文档，agent 加载的核心）
├── README.md                   本使用文档
├── references/
│   ├── using-qa.md             开发 agent 调用指引 + 修复闭环（条件加载）
│   └── qa-memory.md            跨 run 沉淀细则（仅项目有 .qa/ 时加载）
└── agents/
    ├── qa.md                   QA orchestrator（mode: all，只读焊死）
    └── qa-facet.md             只读 facet 子 agent（hidden，仅被 qa 调用）
```

## 安装

把 skill 与 agents 放到 opencode 全局配置目录：

```
skill   -> ~/.config/opencode/skills/qa-skill/       （含 SKILL.md 与 references/）
agents  -> ~/.config/opencode/agents/qa.md
           ~/.config/opencode/agents/qa-facet.md
```

安装后重启 opencode 以加载新 agent。

## 三种调用方式

QA agent 是 mode: all，三个入口都可用：

| 方式 | 谁发起 | 何时用 |
|---|---|---|
| Tab 切换 / 直接对话 | 你 | 手动想验一个改动 |
| @qa | 你 | 对话中点名调它 |
| task(subagent_type:"qa") | 开发 agent | 开发完派 QA（推荐，见下） |

CLI 直接跑：

```
opencode run --agent qa --dir <repo> "请为这个改动做 QA。<目标变更 + 预期行为/需求上下文>"
```

## 推荐用法：开发 agent 派 QA + 修复闭环

推荐让开发 agent 把 QA 作为一环调用（保只读与独立性），流程：

1. 开发 agent 派 qa（task, subagent_type:"qa"）→ 拿到报告 + 测试用例设计。
2. 开发 agent 向你招询一次：是否执行修复闭环。
3. 你确认后：开发 agent 按 QA 用例实现测试、跑、修复 FAIL 项（它有写权限，QA 没有）。
4. 修完再派一次 qa 验证 FAIL 转 PASS、无回归；修-验循环最多 1-2 轮，仍不过则交回你，不无限修。

两种调用姿势的取舍：

- 姿势1（推荐）：派 qa subagent。机制级只读、独立性强（写代码的 agent 不是评判的 agent）。
- 姿势2（降级）：开发 agent 自己加载 qa-skill 自查。会丢失只读机制与独立性（自己出卷自己判），仅适合快速自查，不能替代独立 QA。

细节见 references/using-qa.md。

## QA 会怎么跑（六阶段）

1. 理解改动该做什么：判断 bug 修复还是新需求，重建"预期行为"这一判 PASS/FAIL 的黄金标准，建"应兑现清单"。
2. 按风险规划验证：想"这改动怎么坏"，深度随风险，优先最轻的等价验证。
3. 取真证据：实际跑；工具缺失时用项目已有 runtime 直接验或写一次性探针（不落仓），而非直接 BLOCKED。
4. 校准判定：四状态 PASS / FAIL / BLOCKED / NEEDS_HUMAN_REVIEW 之一，一份 QA 恰好一行 Overall Status。
5. 出报告：唯一硬格式是 Overall Status 一行，其余自由组织。
6. 收尾：残余风险 + 给人的建议（测试用例草稿、需人工复核项）。

高风险 / 多面向的变更，qa 会并行派 qa-facet 子 agent 分头取证再收口；简单变更一个 session 直接做完。

## facet 并行与 subagent_depth

开发Agent → qa → qa-facet 是三层链。opencode 默认 subagent_depth=1，subagent 不能再派 subagent，所以 qa 作 subagent 时默认派不了 facet。

- 想让 qa 自动并行派 facet：在全局 opencode.json 设 subagent_depth: 2。代价是全局所有 subagent 都能多嵌套一层。
- 不设（depth 1）：qa 作 subagent 时会自适应降级——在自己 session 内串行覆盖同样的面向（覆盖不丢，只是不并行）。或者你手动 Tab 切 qa 做 primary，那时它是第一层，depth 1 就能并行派 facet。

```json
// ~/.config/opencode/opencode.json
{
  "subagent_depth": 2
}
```

## 跨 run 沉淀（可选，opt-in）

项目里存在 .qa/ 目录时，QA 会跨多次运行积累可复用的检查用例与团队约定：

- QA 前读 .qa/ 复用相关用例/约定；QA 后沉淀本次所学。
- 启用方式：在项目根建一次 .qa/ 目录即开启（进不进 git 由你决定）；不建则 QA 纯 report-only、完全不碰你的项目。
- QA 不会自己创建 .qa/——目录存在与否就是这个功能的总开关。
- 客观用例（有代码证据）自动沉淀；团队约定（如"这类按钮左对齐"这种代码看不出对错的偏好）需你主动提出才录入。

QA 对产品文件只读，仅对 .qa/ 目录可写（机制层焊死）。细则见 references/qa-memory.md。

## 边界速览

- 只读：不改产品源码/测试/fixture/快照/配置；例外仅 .qa/。
- 不装依赖、不联网、不碰生产（除非你明确批准）。
- 只给判定，不做上线决定、不自动修。
- 设计并建议测试用例是 QA 本职；把测试写进仓库是建设者（开发 agent）的活。