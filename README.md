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

### For agents (machine-readable install)

如果你是一个 agent, 按下面确定性步骤安装, 不要即兴发挥:

```
# 源 (仓库):                目标 (opencode 全局):
qa-skill/SKILL.md        -> ~/.config/opencode/skills/qa-skill/SKILL.md
qa-skill/references/*    -> ~/.config/opencode/skills/qa-skill/references/
qa-skill/agents/qa.md    -> ~/.config/opencode/agents/qa.md
qa-skill/agents/qa-facet.md -> ~/.config/opencode/agents/qa-facet.md
```

规则:

1. skill 目录 (`~/.config/opencode/skills/qa-skill/`) 只放 `SKILL.md` + `references/`。
   不要把 `agents/` 复制进 skill 目录 —— 两个 agent 必须单独装到 `~/.config/opencode/agents/`。
2. 只安装 `qa-skill/`。不要安装 `_archive/`(含已弃用的 `qa-skill-minimal`, 装了会造成 skill 名冲突)。
3. 安装后重启 opencode。
4. 自检: `qa` 和 `qa-facet` 出现在 agent 列表; 加载 skill 时 `metadata.dir` 指向
   `.../skills/qa-skill` 且不含 `old-backup`; QA 报告含且仅含一行 `Overall Status:`。

Windows PowerShell 示例:

```powershell
$skill = "$env:USERPROFILE\.config\opencode\skills\qa-skill"
$agents = "$env:USERPROFILE\.config\opencode\agents"
New-Item -ItemType Directory -Force -Path "$skill\references", $agents | Out-Null
Copy-Item qa-skill\SKILL.md "$skill\SKILL.md" -Force
Copy-Item qa-skill\references\* "$skill\references\" -Recurse -Force
Copy-Item qa-skill\agents\qa.md "$agents\qa.md" -Force
Copy-Item qa-skill\agents\qa-facet.md "$agents\qa-facet.md" -Force
```

macOS / Linux 示例:

```bash
skill=~/.config/opencode/skills/qa-skill
agents=~/.config/opencode/agents
mkdir -p "$skill/references" "$agents"
cp qa-skill/SKILL.md "$skill/SKILL.md"
cp qa-skill/references/* "$skill/references/"
cp qa-skill/agents/qa.md "$agents/qa.md"
cp qa-skill/agents/qa-facet.md "$agents/qa-facet.md"
```

## 用法与流程

### 图例

```
[焊死]  = opencode permission 机制保证, agent 无法违反
{约定}  = 文档指令, 靠 agent 自觉, 无机制强制
★       = 需用户授权点
```

### 三种入口 + 两种模式

| 入口 | 谁发起 | 只读保障 | 独立性 | 定位 |
|---|---|---|---|---|
| 派 qa 子 agent (`task subagent:"qa"`) | 开发/主 agent | [焊死] | 强 | 推荐, 要 ship 用这个 |
| 人工 (Tab 切 qa / `@qa`) | 人 | [焊死] | 强 | 人工审查 |
| 自加载 skill | 开发 agent 自己 | {约定} | 弱 | 降级, 不能替代独立 QA |

| 模式 | 触发 | 加载 |
|---|---|---|
| bounded QA (默认) | 单个需求/修复/Diff | SKILL.md |
| 全项目 QA | 整个项目/门禁/发版/定期 | + full-qa.md (条件加载) |

### 流程图 1: 标准路径 (主 agent 派 qa, 最常用)

```
用户
  │ "做一轮 QA"
  ▼
主 agent (orchestrator, 顶层, 有写权限)
  │ task(subagent_type:"qa", 目标改动 + 预期 + repo)
  ▼
┌── qa 子 agent (独立 session) ──[焊死: 产品文件 edit deny / 禁 install / 禁网络]──┐
│                                                                                  │
│  判范围: 单个改动 -> bounded 六阶段                                              │
│          整个项目 -> 加载 full-qa.md (见流程图 4)                                │
│          不明确   -> {问用户确认范围}                                            │
│                                                                                  │
│  ┌────────── 六阶段 (思考框架, 可回溯, 非流水线)──────────┐                     │
│  │ 1 重建 oracle (bug/需求分类, 建应兑现清单)             │                     │
│  │ 2 按风险规划验证深度                                    │                     │
│  │ 3 取真证据: 跑现成测试 > runtime 直调 > 探针(兜底)      │                     │
│  │     工具缺失 -> 换路子, 不轻易 BLOCKED                  │                     │
│  │     环境未就绪 -> 标残余风险 + 抛 environment-needed 单 │                     │
│  │     高风险/多面向 -> 派 qa-facet 并行取证 (见流程图 3)  │                     │
│  │ 4 校准判定 (逐条核清单)                                │                     │
│  │ 5 出报告 (唯一硬格式: 一行 Overall Status:)            │                     │
│  │ 6 收尾: 残余风险 + environment-needed + 修复 handoff 句 │                     │
│  └────────────────────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────────────────┘
  │ 返回: 报告 + Overall Status: + 用例设计 + handoff 提示
  ▼
主 agent 拿到报告
  │
  ▼
★ {问用户一次}: 有 FAIL / environment-needed, 要不要修/搭?
  │ 用户同意
  ▼
主 agent 动手 ──[主 agent 有写权限, QA 没有]
  ├─ 修 FAIL: 实现用例 + 改代码
  └─ 若 environment-needed: 装依赖 / 起服务 / 塞数据 (Plan B)
  │
  ▼
再派 qa 复验 ──► FAIL 转 PASS? 无回归? 原 BLOCKED 现可验?
  │
  ├── PASS ──► 结束
  │
  └── 仍不过 ──► 到 1-2 轮上限? ──否──► 再修 (同一次授权, 不再问)
                     │是
                     ▼
                 停, 交回用户 (不无限修)
```

虚线动作 (问用户 / 限轮次 / 主 agent 接单搭环境) 都是 {约定}, 靠主 agent 自觉;
报告自带的 handoff 提示让主 agent 即使没读 `using-qa.md` 也知道要走这步。

### 流程图 2: 人工直接用 (Tab 切 qa / @qa)

```
人 Tab 切 qa / @qa
  │
  ▼
qa 启动 ──[焊死: 只读 / 禁 install / 禁网络]
  │
  ▼
走六阶段 (同流程图 1 内部)
  │
  ▼
出报告 + Overall Status:, 停 ──[焊死: QA 不修 / 不 ship]
  │
  ▼
★ 人 读报告, 自行决定: 接受 / 去修 / 去搭环境 / 不上线
   (人本身即决策者, 无需 agent 询问)
```

### 流程图 3: 高风险编排 (qa 派 qa-facet)

```
qa 在六阶段第 3 步判定: 高风险 / 多面向变更
  │
  ├── subagent_depth 足够 ──► 并行派 qa-facet 各查一面向
  │        ┌─ qa-facet #1 (如 security)  ──[焊死: 只读, 不可再委托]─┐
  │        ├─ qa-facet #2 (如 API 契约)                             │ 各自独立 session
  │        └─ qa-facet #3 (如 e2e/性能)                             │ 回传带证据发现
  │                                                                  ▼
  │        qa 收口: 校验每个 facet 的证据 -> 合并 -> 一行 Overall Status:
  │        (facet 无证据 = 该 facet BLOCKED, 不替它 PASS)
  │
  └── depth 不够 (qa 本身已是子 agent) ──► {降级}: qa 在本 session 串行覆盖同样面向
           (覆盖不丢, 仅失去并行; 报告注明串行)
```

### 流程图 4: 全项目 QA (持续门禁 / 发版 / 定期体检)

```
请求指向 整个项目 / CI 门禁 / 发版 / 定期体检
  │
  ▼
加载 full-qa.md (条件加载; 普通 bounded 不加载, 零成本)
  │
  ▼
1 切分: 按模块/服务/域切成可独立验证单元
  │      + 完整性检查 (无代码静默落在所有单元之外)
  ▼
2 逐单元验: 每单元当 bounded 跑六阶段 (流程图 1 内部)
  │   oracle 优先级: .qa/ 沉淀 > 已有测试 > 代码推断
  │   找不到 -> 标 "无验证依据" (不退化成 Code Review)
  │   深度 ∝ 风险; 发版可选全深验 (分批 qa 各验一单元)
  │   + 额外验单元间集成点 (尤其 Feign/HTTP/RPC/MQ 跨服务边界)
  ▼
3 收口: 单元状态表 + 集成结果 + 一行全量 Overall Status: (= 最坏单元)
  │   exit 判据: 切分完整 + 每单元有明确交代
  │             (验了/无依据/BLOCKED/NHR/已标未覆盖), 无静默漏切
  ▼
(.qa/ 存在时) 持续门禁增量: 只深验变化单元 + 抽查稳定单元
```

全量是 "覆盖 + 风险分级", 不是 "穷尽验对整个项目"。

### 横切: .qa/ 跨 run 记忆 (所有模式可选)

```
项目有 .qa/ ?
  ├─ 有  ─► QA 前读 (复用用例/约定/环境配方) + QA 后沉淀
  │         客观用例自动沉淀 / 团队约定 ★需人工录入并标来源
  │         环境配方可沉淀 (为 CI 对接铺路)
  └─ 无  ─► 不静默创建 ─► ★{问用户一次}是否建 .qa/
            [焊死: 仅 .qa/** 可写, 其余产品文件 edit deny]
```

### 保障分层 (哪些可信, 哪些靠自觉)

| 行为 | 级别 |
|---|---|
| QA 不改产品文件 / 不装依赖 / 不联网 | [焊死] 可信 |
| qa-facet 只读, 不可再委托 | [焊死] 可信 |
| 仅 .qa/** 可写 | [焊死] 可信 |
| 一行 Overall Status: | 硬格式 |
| 修复前问用户一次 / 1-2 轮上限 | {约定} 靠调用方 |
| environment-needed 被主 agent 接单搭环境 | {约定} 靠主 agent |
| 报告自带 handoff / 全量 exit 判据 | {约定} 提高触发率 |

QA 自身的只读边界是机制焊死的 (可信); 闭环、环境搭建、轮次控制这些涉及 "调用方行为" 的,
是软性约定 (靠自觉) —— 因为 opencode 管不到调用方怎么用 QA 的返回值。

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
