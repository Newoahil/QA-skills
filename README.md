# QA Skill

一个用于 opencode 的、证据优先 QA skill。默认面向单个 bounded 变更（一个需求 / 一处修复 / 一个 Diff），并支持全项目 QA 模式（持续质量门禁 / 发版门禁 / 定期项目级体检，条件加载）。它把标准 QA 流程沉淀为对 agent 的方向与边界约束（而非逐步 SOP），并用 opencode 的 agent permission 从机制层焊死只读与防越权。

> 本仓库已于 2026-08 从"六组件流水线 SOP"重构为 QA Prior（QA 先验）。早期基于 using-qa / qa-triage / qa-lite / qa-plan / qa-execute / qa-conclude 多文件流水线的实现已整体退役。

## 它是什么 / 不是什么

- 是：对一个 bounded 变更（默认）或整个项目（全量模式）做只读的、证据优先的质量验证，产出一份带判定的报告 + 测试用例设计。
- 不是：测试框架、测试生成器、自动发布系统、Code Review。它不写产品代码、不改仓库测试文件、不做上线决定、不自动修复。全量模式是"覆盖 + 风险分级"，不是"穷尽验对整个项目"。

核心理念：给方向不给步骤。Agent 的能力已经足够，skill 只约束"什么是好的 QA、必须产出什么、守什么边界"，把"具体路径、深度、工具、报告结构"交给 Agent。

## 目录结构

```
qa-skill/
├── SKILL.md                    六阶段 QA 先验（主文档）
├── README.md                   使用文档（安装 / 调用 / 流程 / depth 说明）
├── references/
│   ├── using-qa.md             开发 agent 调用指引 + 修复闭环（条件加载）
│   ├── full-qa.md              全项目 QA 入口层（仅全量 / 门禁 / 发版 QA 时加载）
│   └── qa-memory.md            跨 run 沉淀细则（仅项目有 .qa/ 时加载）
└── agents/
    ├── qa.md                   QA orchestrator（mode: all，只读焊死）
    └── qa-facet.md             只读 facet 子 agent（hidden，仅被 qa 调用）

tests/regression/               bounded QA 回归 harness（run-qa-regression.mjs + 用法说明）
docs/
├── QA-skill开发文档-0813.md    完整设计与开发文档
├── p7 / p8 / p9 / p12 ...      各阶段实验与验证数据
_archive/                       已弃用产物（如 qa-skill-minimal），仅存历史，请勿安装
```

## 快速开始

1. 安装到 opencode 全局：skill 放到 `~/.config/opencode/skills/qa-skill/`；agents 放到 `~/.config/opencode/agents/`。
2. 重启 opencode。
3. 调用：
   - CLI：`opencode run --agent qa --dir <repo> "为这个改动做 QA。<变更 + 预期行为>"`
   - TUI：Tab 切到 qa，或 `@qa`
   - 开发 agent 内部：`task(subagent_type:"qa")` 派发（推荐）
   - 全项目 QA：请求里说明"对整个项目做 QA / 质量门禁 / 发版检查"，agent 会加载 `full-qa.md` 走全量模式；范围不明确时会先向你确认是单个改动还是整个项目。

详细用法见 [`qa-skill/README.md`](qa-skill/README.md)（使用文档）。完整设计见 [`docs/QA-skill开发文档-0813.md`](docs/QA-skill开发文档-0813.md)。

## 核心特性

- **六阶段思考框架**：需求分析 -> 风险计划 -> 取证 -> 判定 -> 报告 -> 收尾（是概念框架，不是流水线）。
- **证据必须亲历**：每条 PASS/FAIL 由 agent 实际观察到的证据支撑；工具缺失时用项目已有 runtime 直接验或写一次性探针，而非直接 BLOCKED。
- **四状态判定**：PASS / FAIL / BLOCKED / NEEDS_HUMAN_REVIEW，一份 QA 恰好一行 `Overall Status:`。
- **机制级只读**：产品文件 `edit: deny`，防越权委托由 permission 焊死，而非靠散文自觉。
- **按风险编排**：高风险 / 多面向变更时并行派 `qa-facet` 子 agent 取证再收口；简单变更一个 session 直接做完。
- **可编排闭环**：开发 agent 派 QA -> 拿报告 + 用例设计 -> 招询 -> 修复 -> 再验证（1-2 轮上限）。报告收尾自带一句修复 handoff 提示，使调用方即使没加载 `using-qa.md` 也能得知下一步。
- **环境未就绪的交接（Plan B）**：某项因环境未就绪（缺依赖/服务/数据）而 BLOCKED 时，QA 不止步于标注残余风险，还产出一张结构化 `environment-needed` 交接单（缺什么/跑什么/预期/谁能接）；由主/开发 agent 在用户授权下搭好环境，再回 QA 复验。QA 自身仍只读、不装依赖、不搭环境。
- **可选跨 run 沉淀**：项目建 `.qa/` 后跨多次 QA 积累可复用的检查用例与团队约定（opt-in，不主动创建）；可沉淀"环境配方"供后续复用/CI 对接。
- **全项目 QA 模式**（条件加载 `references/full-qa.md`）：切分项目为自然单元 -> 每个单元当 bounded 跑六阶段 -> 收口出覆盖 + 风险。主打持续质量门禁 / 发版 / 定期体检；额外验单元间集成点（尤其 Feign/HTTP/RPC/MQ 跨服务边界）；退出判据是"切分完整 + 每单元有明确交代（验了 / 无验证依据 / BLOCKED / 未覆盖），无静默漏切"；有 `.qa/` 时可增量（只深验变化单元 + 抽查稳定单元）。普通 bounded QA 不加载它，零额外成本。

## 验证状态

- **主流程**：已实测（P8：5 案对比 baseline / 旧完整版 / 旧精简版 / 新版，质量为项目历史最高，全部判定正确且均由亲历证据支撑，体量约为旧版 3.6%）。
- **回归复测（P12）**：当前版本再跑同 5 案 pre-fix 快照，5/5 判定正确、全部亲历证据、只读机制守住、确认加载新版；相较 baseline 未退化，fake-timers 一案更强。
- **假阳性控制**：构造 nextauth post-fix（已修复）快照复验，正确判 PASS —— 说明 skill 能区分"有 bug"与"已修复"，非反射式判 FAIL。（n=1 单个控制。）
- **调用闭环 / 报告 handoff / 环境交接（Plan B）/ 跨 run 沉淀 / 全项目 QA 模式**：均已实现并落地，尚未做专门的端到端 / 全量 / 跨 run 场景实测。

- 回归 harness 见 [`tests/regression/`](tests/regression/)。详见 `docs/p8-prior-redesign-verify-20260814-results.md`、`docs/p12-v3-regression-results.md` 等。
