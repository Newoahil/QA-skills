# QA Skill

一个用于 opencode 的、面向单个 bounded 变更（一个需求 / 一处修复 / 一个 Diff）的证据优先 QA skill。它把标准 QA 流程沉淀为对 agent 的方向与边界约束（而非逐步 SOP），并用 opencode 的 agent permission 从机制层焊死只读与防越权。

> 本仓库已于 2026-08 从"六组件流水线 SOP"重构为 QA Prior（QA 先验）。早期基于 using-qa / qa-triage / qa-lite / qa-plan / qa-execute / qa-conclude 多文件流水线的实现已整体退役。

## 它是什么 / 不是什么

- 是：对一个 bounded 变更做只读的、证据优先的质量验证，产出一份带判定的报告 + 测试用例设计。
- 不是：测试框架、测试生成器、自动发布系统。它不写产品代码、不改仓库测试文件、不做上线决定、不自动修复。

核心理念：给方向不给步骤。Agent 的能力已经足够，skill 只约束"什么是好的 QA、必须产出什么、守什么边界"，把"具体路径、深度、工具、报告结构"交给 Agent。

## 目录结构

```
qa-skill/
├── SKILL.md                    六阶段 QA 先验（主文档）
├── README.md                   使用文档（安装 / 调用 / 流程 / depth 说明）
├── references/
│   ├── using-qa.md             开发 agent 调用指引 + 修复闭环（条件加载）
│   └── qa-memory.md            跨 run 沉淀细则（仅项目有 .qa/ 时加载）
└── agents/
    ├── qa.md                   QA orchestrator（mode: all，只读焊死）
    └── qa-facet.md             只读 facet 子 agent（hidden，仅被 qa 调用）

docs/
├── QA-skill开发文档-0813.md    完整设计与开发文档
├── p7 / p8 / p9 ...            各阶段实验与验证数据
```

## 快速开始

1. 安装到 opencode 全局：skill 放到 `~/.config/opencode/skills/qa-skill/`；agents 放到 `~/.config/opencode/agents/`。
2. 重启 opencode。
3. 调用：
   - CLI：`opencode run --agent qa --dir <repo> "为这个改动做 QA。<变更 + 预期行为>"`
   - TUI：Tab 切到 qa，或 `@qa`
   - 开发 agent 内部：`task(subagent_type:"qa")` 派发（推荐）

详细用法见 [`qa-skill/README.md`](qa-skill/README.md)（使用文档）。完整设计见 [`docs/QA-skill开发文档-0813.md`](docs/QA-skill开发文档-0813.md)。

## 核心特性

- **六阶段思考框架**：需求分析 → 风险计划 → 取证 → 判定 → 报告 → 收尾（是概念框架，不是流水线）。
- **证据必须亲历**：每条 PASS/FAIL 由 agent 实际观察到的证据支撑；工具缺失时用项目已有 runtime 直接验或写一次性探针，而非直接 BLOCKED。
- **四状态判定**：PASS / FAIL / BLOCKED / NEEDS_HUMAN_REVIEW，一份 QA 恰好一行 `Overall Status:`。
- **机制级只读**：产品文件 `edit: deny`，防越权委托由 permission 焊死，而非靠散文自觉。
- **按风险编排**：高风险 / 多面向变更时并行派 `qa-facet` 子 agent 取证再收口；简单变更一个 session 直接做完。
- **可编排闭环**：开发 agent 派 QA → 拿报告 + 用例设计 → 招询 → 修复 → 再验证（1-2 轮上限）。
- **可选跨 run 沉淀**：项目建 `.qa/` 后跨多次 QA 积累可复用的检查用例与团队约定（opt-in，不主动创建）。

## 验证状态

- **主流程**：已实测（5 案对比 baseline / 旧完整版 / 旧精简版 / 新版，质量为项目历史最高，全部判定正确且均由亲历证据支撑，体量约为旧版 3.6%）。
- **调用闭环 / 跨 run 沉淀**：已实现并落地，尚未做专门的端到端 / 跨 run 场景实测。

详见 `docs/p8-prior-redesign-verify-20260814-results.md` 等。
