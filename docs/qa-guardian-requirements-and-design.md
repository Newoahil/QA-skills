# QA Guardian 需求与架构设计

> 状态：Draft v0.2
> 日期：2026-08-18
> 适用范围：在现有 qa-skill（证据优先只读 QA）之上，新增「issue 驱动的自动化值守 QA 工作流」
> 定位：本文档定义一个**新增编排层**，把现有只读 QA 作为独立裁判嵌入其中。它不修改、不削弱现有 qa-skill 的任何只读机制。
>
> **v0.2 变更**：触发从「人工派单」升级为「定时轮询自动值守」；闸门 1（诊断后停）改为「按 issue 风险分级」——低风险自动跳过、高风险保留；闸门 2（PR review）对所有 issue 保留不变。新增风险误判的不对称安全加固（分级失败默认高风险 / 全程留痕 / QA 独立自验对低风险不可省）。v0.1 的双闸门链路作为**高风险路径**保留。

---

## 0. 一页速览（TL;DR）

现有 qa-skill 只做「已有一个 Diff → 只读验证 → 出判定」这一环，且从机制层焊死不修代码、不提 PR、不碰 issue。

本设计新增一个 **QA Guardian（自动值守编排层）**：定时轮询发现带值守标签的 GitHub issue，自动调查代码、定位根因、评估风险、驱动修复、独立 QA 自验、提 dev PR，并把全过程追踪记录回写到 GitHub issue 评论和项目 `.qa/`。

**两个核心信任设计：**

1. **分权。** 一个有写权限的 `qa-guardian` agent 负责调查/修复/PR/追踪；它在验证阶段**派现有只读 `qa` agent** 做独立自验——自己修的代码绝不自己判 PASS。现有 `qa` / `qa-facet` / `.qa/` 机制 100% 复用，不改一行。
2. **风险分级 + 不对称安全。** 低风险 issue 自动跑到 PR（跳过人工确认方案），高风险 issue 停在闸门 1 等人。但**任何 issue 都停在 PR（闸门 2 不可省）**，merge 主干永远是人的决策。风险分级由 AI 自判 + 人抽查，且**误判只会更安全**：拿不准一律当高风险停。

```
定时轮询发现带 qa-guardian 标签的 issue
  → 调查代码 + 定位根因 + 评估风险等级
  → ┬─ 高风险 → ★闸门1: 停, 人确认修复方案
    └─ 低风险 → 跳过闸门1 (但诊断+风险理由仍写进 issue 留痕)
  → 修代码 → 派只读 qa 独立自验 (复用现有; QA 必过, 低风险也不省)
  → 提 dev PR + 回写 issue 评论 + .qa/ 沉淀
  → ★闸门2: 停, 人 review PR merge (所有 issue 都停; 人 merge 时关 issue)
```

> 不对称保护（贯穿全文）：分级拿不准 → 默认高风险；低风险跳闸门1也全程留痕；QA 独立自验对低风险一个都不能省。这三条让「跳过人工方案确认」的风险被「机器质检必过 + 可追溯 + merge 仍是人」补偿。

---

# 第一部分：需求文档

## 1. 背景

### 1.1 现状

现有 qa-skill 已把整条链路里**最难做对的一环**——证据优先、只读、独立的 QA 判定——做扎实了（P8/P12 实测 5/5 判定正确、全亲历证据、只读机制守住）。但它的设计起点是「已经有了一个 Diff」，并从 opencode permission 机制层焊死：`edit: deny`、`git commit/push: deny`、不联网、不修复、不 ship。

### 1.2 需求来源

需求方希望达到「**自动化值守**」程度：系统能在团队协作中辅助 QA 岗位工作——收到 issue 后调查代码、驱动问题修复、反馈给人确认、提交 dev PR、做好 issue 追踪记录与修复及关闭总结、有 commit 依据。

### 1.3 现状与目标的根本差距

现有能力只覆盖目标链路的约 40%（修复后的 QA 自验环节）。差距集中在三处，均为现有代码从设计上明确「不做」的：

1. **入口差距**：现状入口是 Diff，目标入口是 issue。缺 issue 解析 + 代码调查定位工作流。
2. **角色差距**：目标需要一个有写权限、能修代码/提 PR/回写 issue 的驱动 agent。现有 `qa` 从机制层是它的反面。
3. **闭环差距**：目标需要自动值守轮询 + 风险分级闸门状态机 + GitHub 回写 + 追踪记录。现有只有 `.qa/` 单写，无 GitHub 回写、无跨闸门状态管理、无自动触发。

### 1.4 设计立场

**加一层，不改现有。** 现有只读 QA 是已验证资产，其只读性正是「值守场景无人盯着时」的安全底座。新增编排层把它当独立裁判包进去，而非改造它加写权限。改造现有 `qa` 加写权限会同时摧毁两件已投入大量工程焊死的核心价值：QA 独立性（自己修的自己判）与只读安全边界。

---

## 2. 北极星定位

**让一个带值守标签的 GitHub issue 从「被自动发现」到「有一个可供人 review 的 dev PR + 完整可追溯记录」之间的全部执行劳动被 AI 自动完成，同时把不可逆决策点（PR 合并 = 进主干）牢牢留给人；只对高风险 issue 额外保留一个人工方案确认点。**

QA Guardian 不替代人的决策，只压缩人在决策之间的执行与追踪成本。它不做 issue 关闭决定（人 merge PR 时完成），不做发布决定，不做 merge 决定。风险分级把「值不值得停下让人看方案」这件事自动化，但**任何 issue 进主干这一步永远是人**。

---

## 3. 范围

### 3.1 覆盖范围

- 以**一个 GitHub issue** 为基本工作单位，**定时轮询自动发现**带值守标签（如 `qa-guardian`）的 issue 触发。
- 从 issue 出发调查代码、定位根因、**评估风险等级**、产出诊断报告。
- **风险分级闸门**：高风险停闸门 1 等人确认方案；低风险跳过闸门 1 直接进修复（诊断+风险理由仍留痕）。
- 驱动修复（有写权限的编排 agent 修代码）。
- 修复后派现有只读 `qa` 做独立 QA 自验（**低风险也不省**）。
- 提交 dev PR，回写 issue 评论，沉淀 `.qa/` 追踪记录。
- 闸门 2 停在 PR，人 review（**所有 issue 都停**）。

### 3.2 明确不做

- **不自动 merge PR**（人的决策；permission + 闸门 2 双重保证）。
- **不自动关闭 issue**（人 merge PR 时通过 PR 关联自动关闭，或人工关闭）。
- **不对任何 issue 跳过闸门 2**（低风险也停 PR；不存在「自动进主干」）。
- **不对接 Jira / Linear 等非 GitHub 平台**（单平台 GitHub）。
- **不改现有 qa-skill 的只读机制。**
- **不做发布 / 上线决定。**
- **不在风险拿不准时冒进**（分级失败一律默认高风险，见 §5A）。

### 3.3 与现有 qa-skill 的关系

| 现有资产 | 本设计如何使用 |
|---|---|
| `qa-skill/SKILL.md`（六阶段先验） | 修复后自验环节直接遵循，不改 |
| `agents/qa.md`（只读 orchestrator） | 作为独立裁判被 `qa-guardian` 派发，不改 |
| `agents/qa-facet.md`（只读 facet） | 高风险 issue 的并行取证，不改 |
| `references/using-qa.md`（闭环指引） | 其「派 QA→报告→问用户→修→再验」骨架被 Guardian 链路继承并具体化 |
| `references/qa-memory.md` + `.qa/` 写机制 | 追踪记录沉淀直接复用其写机制 |

---

## 4. 角色与责任

| 角色 | 类型 | 权限 | 职责 |
|---|---|---|---|
| **人（决策者 / 抽查者）** | 人 | — | 给 issue 打值守标签（一次性授权）；在**高风险** issue 的闸门 1 确认方案；在闸门 2 review PR 并决定 merge/关闭 issue；**事后抽查低风险 issue 的风险判定是否合理** |
| **`qa-guardian`（自动值守编排 agent）** | 新建，有写权限 | 可 edit 产品文件 / `git commit` / 建分支 / `gh` 回写 issue+PR | 轮询发现 issue、调查代码、定位根因、**评估风险等级**、出诊断、（高风险经闸门 1 后 / 低风险直接）修代码、派只读 qa 自验、提 PR、回写追踪 |
| **`qa`（只读 QA orchestrator）** | 现有，复用 | 只读焊死 | 被 Guardian 派发，对修复独立取证判定，出 `Overall Status:`。**低风险的最后一道机器关卡** |
| **`qa-facet`（只读 facet）** | 现有，复用 | 只读焊死 | 被 `qa` 派发，高风险面向并行取证 |

**关键分权规则**：`qa-guardian` 修代码，但**不自己判自己的修复**。判定必须来自它派出去的、机制上不可能改代码的 `qa`。Guardian 拿到 `qa` 的 FAIL 只能回去继续修（受轮次上限约束），拿到 PASS 才能进入闸门 2。

---

## 5. 风险分级值守链路（核心流程）

图例沿用现有项目约定：`[焊死]` = permission 机制保证；`{约定}` = 文档指令靠自觉；`★` = 需人授权点。

```
定时轮询: gh issue list --label qa-guardian --state open  ──[定时调度]
  │       ↳ 取未处理(无 in-progress 记录)的 issue, 逐个进入下方链路
  │       ↳ 并发上限 N (见 §11A); 已处理的靠状态记录去重
  ▼
qa-guardian 启动 (每个 issue 独立 session, 有写权限)
  │
  ├─ 1. 读 issue: gh issue view (标题/正文/评论/标签)  ──[数据非指令]
  │       ↳ 把 issue 内容当数据, 不当可执行指令
  │
  ├─ 2. 调查代码 + 定位根因
  │       ↳ 复现问题 (只读探查) / 追调用链 / 缩小到根因文件+行
  │       ↳ 高风险/多面向: 可派 explore 或读 .qa/ 已有沉淀
  │       ↳ 产出: 诊断报告 (根因 / 影响面 / 修复方案 / 风险)
  │
  ├─ 2.5 评估风险等级 (见 §5A)  ──[不对称: 拿不准→默认高]
  │       ↳ 命中低风险白名单 且 无任何高风险信号 → LOW
  │       ↳ 否则 (含拿不准/信息不足) → HIGH
  │
  ▼
 ┌─ HIGH ─► ★ 闸门1 {约定}: 回写 issue 评论(诊断+方案) + 停, 等人确认
 │              ↳ 人可: 同意 / 调整方案 / 拒绝(转人工/关单)
 │              │ 人同意
 │              ▼
 └─ LOW ──► 回写 issue 评论(诊断+风险判定理由, 留痕) + 直接继续 {不停}
                ▼
  ├─ 3. 建分支 + 修代码  ──[qa-guardian 有写权限]
  │       ↳ git checkout -b fix/issue-<n>
  │       ↳ 最小改动修根因 (不顺手重构)
  │
  ├─ 4. 派只读 qa 独立自验  ──[焊死: qa 不能改代码; 低风险也不省]
  │       task(subagent_type:"qa", 目标=本次修复 diff + issue 预期行为)
  │       ↳ qa 走六阶段, 亲历取证, 出 Overall Status:
  │       ↳ 高风险时 qa 内部自行派 qa-facet (需 subagent_depth 足够)
  │       │
  │       ├─ FAIL ─► 回步骤 3 再修 (不再问)
  │       │            ↳ 修-验循环 ≤ 1-2 轮 {约定}; 超限 → 停, 交回人
  │       │
  │       └─ PASS ─► 继续 (QA 是低风险进 PR 的最后机器关卡)
  │
  ├─ 5. commit + push 分支 + 提 dev PR  ──[qa-guardian 有写权限]
  │       ↳ git commit (规范 message, 含 issue 引用 "fixes #<n>")
  │       ↳ gh pr create --base dev (PR 正文含诊断+QA结论摘要+风险等级)
  │
  ├─ 6. 双写追踪记录
  │       ↳ 回写 issue 评论: 修复总结 + QA Overall Status: + PR 链接 + commit sha
  │       ↳ 沉淀 .qa/: 客观用例自动沉淀 (若项目有 .qa/)
  │
  ▼
★ 闸门2 {约定}: 停在 PR, 等人 review  ──[所有 issue 都停, 低风险不例外]
          ↳ 人 merge PR → PR "fixes #<n>" 自动关 issue (或人工关)
          ↳ qa-guardian 不自动 merge, 不自动关 issue
```

### 5.1 两个闸门的语义

| 闸门 | 位置 | 对谁生效 | 停下时人看到什么 | 人的动作 | 恢复方式 |
|---|---|---|---|---|---|
| **闸门 1** | 诊断后、修代码前 | **仅高风险 issue** | issue 评论里的诊断报告（根因/方案/风险） | 同意 / 调整 / 拒绝 | 人回复后 Guardian 继续 |
| **闸门 2** | 提 PR 后 | **所有 issue** | dev PR（含诊断+QA结论+风险等级）+ issue 追踪评论 | review → merge / 打回 | 人 merge（自动关 issue）或打回让 Guardian 再改 |

低风险 issue 只经过闸门 2；高风险 issue 经过闸门 1 + 闸门 2（即 v0.1 的完整双闸门路径）。

### 5.2 issue 关闭归属

需求方明确：**issue 关闭交给人在 merge PR 时完成**。做法是 PR 正文/commit 含 `fixes #<n>`，GitHub 在 merge 到 `dev`（或最终目标分支）时自动关闭。Guardian 本身不调 `gh issue close`。这样「关闭」这一状态变更始终由人的 merge 动作触发，符合需求方选的「PR 提交后停，人 review」边界。

---

## 5A. 风险分级设计（低风险跳闸门 1 的安全前提）

风险分级决定一个 issue 是否跳过闸门 1（人工方案确认）。因为跳过意味着**没有任何人看过就直接改代码**，分级的保守性直接等于系统安全性。分级由 AI 自判 + 人事后抽查，并用三条不对称保护兜底。

### 5A.1 判定方向：AI 自判 + 人抽查

- **AI 自判**：Guardian 在链路步骤 2.5 基于诊断结果评估风险等级，只输出 `LOW` / `HIGH`。
- **人抽查**：低风险 issue 的诊断 + 风险判定理由全部留痕在 issue 评论（见 §6），人事后可回看 Guardian 凭什么判低风险。抽查发现误判 → 收紧白名单 / 给该类 issue 预打 `risk:high` 标签强制高风险。

### 5A.2 低风险白名单（命中才可能 LOW，保守）

一个 issue 判 `LOW` 必须**同时**满足以下全部，否则 `HIGH`：

- 修复只落在低危面：文案 / 注释 / 文档 / 日志文案 / 测试文件 / 明确隔离的非核心工具函数；
- **不触碰**：金额/计费、认证/授权/权限、个人数据/隐私、数据迁移/schema、核心业务链路、跨服务边界（Feign/HTTP/RPC/MQ）、并发/状态、构建/发布配置；
- 影响面局部：改动集中、blast radius 可界定，无跨模块扩散；
- diff 规模小（建议阈值如 ≤ 一个可配置行数，具体值实现时定）；
- 有可复现的明确 oracle（bug 能复现、预期行为清楚），不依赖业务/主观判断。

> 白名单是「宁可漏判为高」的过滤器，不是「尽量判低以提效」。任何一条不满足 → HIGH。

### 5A.3 不对称安全保护（三条，贯穿全文，误判只会更安全）

这三条是低风险自动化的安全底座，实现时必须全部落地：

1. **分级失败默认高风险（fail-safe）**：AI 对风险等级拿不准、信息不足、诊断本身不确定、或白名单判定有歧义 → **一律 `HIGH`**，走闸门 1。系统在不确定时永远偏向「多让人看一次」，而非「赌它没事」。

2. **低风险全程留痕（可抽查）**：即使跳过闸门 1，Guardian 也必须把**诊断报告 + 判低风险的具体理由**（命中白名单哪几条、排除了哪些高风险信号）写进 issue 评论。没有留痕的低风险自动化 = 黑箱,禁止。留痕让「人抽查」有据。

3. **QA 独立自验对低风险不可省（最后机器关卡）**：低风险虽跳过「人看方案」，但修复后的独立 `qa` 自验**一个都不能少**，且 QA `FAIL` → 绝不提 PR（退回再修或交人）。这样「没人看方案」的风险被「机器独立质检必过」补偿——低风险 issue 靠的是「机器修 + 机器独立验 + 人守 merge」，而非「无人把关」。

### 5A.4 分级与闸门的关系（一张表说清）

| issue 风险 | 闸门 1（人看方案） | 修复 | QA 独立自验 | 闸门 2（人 review PR） | merge |
|---|---|---|---|---|---|
| **LOW** | ✗ 跳过（但留痕） | 自动 | ✅ 必过 | ✅ 停 | 人 |
| **HIGH** | ✅ 停等人 | 经确认后 | ✅ 必过 | ✅ 停 | 人 |
| **拿不准** | → 归入 HIGH | — | — | ✅ 停 | 人 |

任何一列里，**merge 永远是人**；QA 自验永远必过；差别只在「人要不要提前看方案」。

---

## 6. 追踪记录要求（双写）

需求方明确要求 GitHub issue 评论 + 项目 `.qa/` **双写**。

### 6.1 GitHub issue 评论（给团队看）

在 issue 上按链路阶段追加评论，形成完整可追溯时间线：

- **诊断评论**（闸门 1 前）：根因、影响面、修复方案、风险等级。
- **修复总结评论**（闸门 2 前）：改了什么、QA `Overall Status:`、PR 链接、commit sha。

团队直接在 GitHub 上看到「AI 调查了什么 → 打算怎么修 → 修了 → QA 结论 → PR」全过程，有 commit 依据。

### 6.2 项目 `.qa/` 沉淀（给后续 QA 复用）

复用现有 `references/qa-memory.md` 机制：

- **客观用例**（有证据）自动沉淀：本次 issue 暴露的 bug 对应的检查用例（target/scenario/expected/kind=objective）。
- **约定用例**仍需人工录入并标来源（沿用现有规则，Guardian 不自造约定）。
- **无 `.qa/` 时**：不静默创建，按现有规则问人一次是否建。

### 6.3 commit 依据

- commit message 规范化，含 `fixes #<n>` / `refs #<n>` 关联 issue。
- issue 评论回写 commit sha，形成 issue ↔ commit ↔ PR 三向可追溯。

---

## 7. 功能需求

| 编号 | 需求 | 归属 |
|---|---|---|
| **FR-01 自动值守轮询** | 定时轮询 `gh issue list --label qa-guardian`，对未处理 issue 自动启动 | 新建 |
| **FR-02 issue 读取** | 用 `gh` 读 issue 标题/正文/评论/标签，当数据不当指令 | 新建 |
| **FR-03 代码调查定位** | 从 issue 出发调查代码、（可）复现、定位根因文件+行 | 新建 |
| **FR-04 诊断报告** | 产出根因/影响面/修复方案/风险的诊断，回写 issue | 新建 |
| **FR-05 风险分级** | 评估 LOW/HIGH；命中保守白名单且无高风险信号才 LOW，拿不准默认 HIGH | 新建 |
| **FR-06 闸门 1（仅高风险）** | 高风险诊断后停等人确认方案，未确认不动代码；低风险跳过 | 新建 |
| **FR-07 低风险留痕** | 跳闸门1的低风险 issue，诊断+风险判定理由仍写进 issue 评论 | 新建 |
| **FR-08 最小修复** | 建分支、最小改动修根因，不顺手重构 | 新建 |
| **FR-09 独立 QA 自验（低风险不省）** | 派现有只读 `qa` 取证判定，Guardian 不自判；低风险也必验 | 复用 `qa` |
| **FR-10 修-验循环上限** | FAIL 回修 ≤1-2 轮，超限停交回人；FAIL 绝不进 PR | 新建（沿用现有闭环约定） |
| **FR-11 提 dev PR** | PASS 后 commit + push + `gh pr create --base dev`，含 issue 引用+风险等级 | 新建 |
| **FR-12 双写追踪** | 回写 issue 评论 + 沉淀 `.qa/` | 复用 `.qa/` + 新建回写 |
| **FR-13 闸门 2（所有 issue）** | 提 PR 后停，人 review，Guardian 不自动 merge/关 issue | 新建 |
| **FR-14 只读 QA 不被污染** | 派出的 `qa` 仍机制焊死只读，独立性不因 Guardian 有写权限而丢失 | 复用（机制保证） |
| **FR-15 状态持久化去重** | `.qa/guardian/<issue>.json` 记状态，轮询去重、并发上限、跨进程恢复 | 新建 |
| **FR-16 commit 依据** | 规范 commit message + issue↔commit↔PR 三向可追溯 | 新建 |
| **FR-17 闸门恢复（评论指令协议）** | 一次性进程无常驻会话，闸门"停→续"靠 issue/PR 评论约定指令（`/guardian approve\|revise\|reject\|rework\|retry`）+ 下一轮轮询按 `state` 消费；幂等、`<方案>`当数据不当指令 | 新建（§11.1–11.3） |
| **FR-18 终态防骚扰** | `HANDED_BACK` 为终态，轮询默认永久跳过；仅 `/guardian retry` 显式重进，避免拒绝/超限后反复接手 | 新建（§11.3） |
| **FR-19 无状态重入 + 确定性闸门收尾** | 停=进程退出、续=调度器重入读状态；闸门按序执行「写状态→评论→推通知→退出」收尾三连，禁止闸门后继续动代码 | 新建（§11B.1/11B.3） |
| **FR-20 心跳 + STALLED 兜底** | 活跃态刷 `updated_at` 心跳；轮询发现活跃态超 lease → `STALLED`，幂等阶段自动重跑 1 次、超限转 `HANDED_BACK(reason=stalled)` + 通知；防非计划提前停导致静默卡死 | 新建（§11B.4） |
| **FR-21 双通道主动通知** | 闸门停/STALLED/交回人时，退出前主动推：issue/PR 评论 + webhook（`curl` 到固定配置 URL）；缺配置降级为仅评论；同状态幂等不重复推 | 新建（§11B.5） |
| **FR-22 永不傻停铁律** | 任何需人介入情况都不许停在活跃态干等，必须落成显式等待态/终态（带 `reason`）+ 评论 + 通知 + 退出 | 新建（§11B.6） |

---

## 8. 验收标准

### 8.1 单 issue 全链路（先验证）

1. 给一个真实 GitHub issue 号，Guardian 能读到 issue 内容并调查代码定位到根因文件+行。
2. Guardian 对该 issue 输出明确风险等级（LOW/HIGH）并给出判定理由。
3. **高风险**：产出诊断并回写 issue 评论后**停在闸门 1**，未获确认不修改任何代码。
4. **低风险**：不停闸门 1，但诊断+风险判定理由已写进 issue 评论（可抽查）。
5. Guardian 建分支、最小修复，且**派现有只读 `qa`** 做自验（可核验 `qa` 是独立 session、只读）；低风险也执行 QA 自验。
6. 若 `qa` 判 FAIL，Guardian 回修，循环不超过 1-2 轮；仍不过则停并交回人；FAIL 状态下不提 PR。
7. `qa` 判 PASS 后，Guardian commit（message 含 `fixes #<n>`）、push、`gh pr create --base dev`。
8. Guardian 回写 issue 追踪评论（含 QA `Overall Status:` + PR 链接 + commit sha + 风险等级），并在有 `.qa/` 时沉淀客观用例。
9. Guardian **停在闸门 2**（低风险也停），不自动 merge PR、不自动 `gh issue close`。

### 8.2 风险分级正确性（安全关键）

10. 构造一个明显高风险 issue（触碰权限/金额/数据/核心链路），Guardian 判 HIGH 并停闸门 1，**不**自动改代码。
11. 构造一个信息不足/模糊的 issue，Guardian **默认 HIGH**（fail-safe），不冒进判 LOW。
12. 构造一个明确低风险 issue（改文案/注释），Guardian 判 LOW 并留痕，全自动跑到 PR 停。

### 8.3 自动值守形态

13. 轮询命令能发现带 `qa-guardian` 标签的 open issue 并逐个处理。
14. 已处理 / 已出 PR 的 issue 不被重复接手（状态持久化去重生效）。
15. 并发上限生效（MVP N=1 串行）；每 issue 独立分支。

### 8.5 闸门恢复闭环（§11.1–11.3）

19. **闸门 1 续跑**：一个停在 `GATE_1_WAIT` 的 issue，人评论 `/guardian approve` 后，下一轮轮询能消费该指令并从 `FIXING` 续跑；未评论时反复轮询**不**重新调查、不催促、不推进。
20. **闸门 1 拒绝**：人评论 `/guardian reject` 后进入 `HANDED_BACK`，且后续轮询**永久跳过**该 issue（标签仍在也不重新接手）。
21. **终态重进**：对 `HANDED_BACK` 的 issue，人评论 `/guardian retry` 后，下一轮轮询清 `fix_rounds` 并从 `INVESTIGATING` 重走。
22. **闸门 2 打回**：人评论 `/guardian rework <意见>` 后回 `FIXING`，`fix_rounds` 继续计入修-验上限。
23. **幂等消费**：同一条确认指令评论不被重复消费（`last_consumed_comment_id` 生效）；`<方案>`/`<意见>` 文本当数据、不被当可执行指令。

### 8.6 进程生命周期与容错（§11B）

24. **确定性闸门收尾**：Guardian 停闸门 1 时，可核验其在退出前已按序完成「写状态 `GATE_1_WAIT`→回写 issue 评论→推通知」，且退出后未继续改任何代码。
25. **STALLED 检测**：构造一个中途异常退出的 issue（进程死在 `INVESTIGATING`/`FIXING`，状态未推进），验证下一轮轮询在 `updated_at` 超 lease 后判 `STALLED`，自动重跑 1 次或转 `HANDED_BACK(reason=stalled)`，**不**永久卡死、**不**被当"处理中"无限跳过。
26. **双通道通知**：闸门停/STALLED/交回人时，issue/PR 评论 + webhook 均收到含 issue 号+阶段+链接的通知；缺 webhook 配置时降级为仅评论且链路不阻断；同一状态不重复推（`last_notified_state` 生效）。
27. **永不傻停**：构造一个信息不足需澄清的 issue，验证 Guardian **不**停在活跃态干等，而是落成 `HANDED_BACK(reason=needs-clarification)` 或 `GATE_1_WAIT` + 评论 + 通知 + 退出。
28. **联网豁免边界**：验证 Guardian 仅向配置的 `notify_webhook` 发 `curl`，`webfetch/websearch` 全程无调用，通知 body 不含代码/密钥。

### 8.4 机制不被削弱

16. 全程可验证：现有 `qa` 的只读机制未被削弱（无 `qa` 直接 edit 产品文件 / commit 的记录）。
17. issue ↔ commit ↔ PR 三向可追溯链完整。
18. 任何风险等级下，Guardian 都未 `gh pr merge` / `gh issue close`（主干与关闭始终是人）。

---

# 第二部分：架构设计

## 9. 总体架构：双 agent 分权

```
┌─────────────────────────────────────────────────────────────────────┐
│  人 (决策者 / 抽查者)                                                  │
│    · 给 issue 打 qa-guardian 标签 (一次性授权)                         │
│    ↑ 闸门1(仅高风险): 确认方案   ↑ 闸门2(所有): review PR              │
│    · 事后抽查低风险 issue 的风险判定理由                               │
└────┬──────────────────┬───────────────────────────────────────────────┘
     │ 打标签            │ 回写/PR
     │ (被轮询发现)      │
     ▼                   │
┌─────────────────────────────────────────────────────────────────────┐
│  调度器: 定时轮询 gh issue list --label qa-guardian (间隔可配)         │
└────┬──────────────────────────────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  qa-guardian  (新建, mode: all, 有写权限)                             │
│  ─────────────────────────────────────────────────────────────────  │
│  职责: 读issue / 调查 / 诊断 / 评估风险 / 修复 / 提PR / 双写追踪       │
│  权限: edit allow / git commit·push·checkout allow / gh allow         │
│        (gh merge·close·edit deny; reset·clean·install deny)          │
│                                                                       │
│  评估风险 ─┬─ HIGH(含拿不准) → ★停闸门1 等人 → 修复                    │
│            └─ LOW → 留痕评论 → 直接修复 (不停)                         │
│         │ 修复完成后, 派独立裁判 (task subagent)                       │
│         ▼                                                             │
│    ┌──────────────────────────────────────────────────┐              │
│    │  qa  (现有, 复用, 只读焊死)  ──[edit deny]──        │              │
│    │  独立 session 对 Guardian 的修复取证判定 (低风险也验)│             │
│    │       │ 高风险时派                                 │              │
│    │       ▼                                            │              │
│    │  qa-facet (现有, 复用, 只读焊死, hidden)            │              │
│    └──────────────────────────────────────────────────┘              │
│         │ 返回 Overall Status: + 证据                                  │
│         ▼                                                             │
│  Guardian 依判定决定: FAIL→回修 / PASS→提PR → ★停闸门2(所有 issue)     │
└─────────────────────────────────────────────────────────────────────┘
     │ 双写 + 状态持久化
     ▼
┌──────────────────────┐   ┌────────────────────────────────────┐
│ GitHub issue 评论      │   │ 项目 .qa/                           │
│ (诊断/风险理由/总结/   │   │ · 客观用例沉淀 (复用写机制)         │
│  PR/sha)              │   │ · guardian/<issue>.json 状态持久化  │
└──────────────────────┘   └────────────────────────────────────┘
```

**为什么必须双 agent 而非单 agent 全能**：

- **独立性**：QA 的核心价值是「写代码的人不是判代码的人」。若 Guardian 自带 QA 逻辑自判，等于自己批自己，现有项目花大力气焊死的独立性归零。
- **安全**：值守场景无人实时盯着。一个能自由 `commit/push` 又自带「判自己 PASS」逻辑的 agent，一旦误判就直接把坏代码推上去。分权后，判定必来自机制上不可能改代码的 `qa`，Guardian 无法绕过它给自己放行。
- **零改动复用**：`qa` / `qa-facet` / `.qa/` 一行不改，已验证资产原样嵌入。

## 10. 权限矩阵（落在 opencode agent permission 真实机制上）

### 10.1 `qa-guardian`（新建 agent frontmatter 设计）

```yaml
---
description: QA Guardian orchestrator. Automated watch mode over GitHub issues.
  Polls for labeled issues, investigates code, locates root cause, assesses risk,
  drives a minimal fix, dispatches the read-only qa agent for independent
  verification, opens a dev PR, and writes traceable records back to the issue
  and .qa/. Low-risk issues skip the fix-plan gate (with an audit trail); high-risk
  and uncertain issues stop for human plan confirmation. Every issue stops at PR
  review. Never auto-merges, never auto-closes the issue.
mode: all
temperature: 0.1
permission:
  edit:
    "*": allow            # Guardian 有写权限 (这是与 qa 的根本区别)
  webfetch: deny          # 默认不联网; issue/PR 上下文走 gh CLI (通知不走 webfetch, 走 bash curl 到固定 URL)
  websearch: deny
  bash:
    "*": allow
    "git commit*": allow  # Guardian 需要 commit (与 qa 相反)
    "git push*": allow    # 仅推 fix 分支; 不推 main/dev (靠 message+分支约定)
    "git checkout*": allow
    "git reset*": deny    # 破坏性, 仍禁
    "git clean*": deny
    "*install*": deny     # 值守场景不自动装依赖 (与 qa 一致的安全底线)
    "gh issue close*": deny   # ★关键: 不自动关 issue (需求方边界)
    "gh pr merge*": deny      # ★关键: 不自动 merge (闸门2, 所有 issue)
    "gh issue edit*": deny    # 不自动改 issue 标签/状态 (留痕用 comment 即可)
  task:
    "*": deny
    "qa": allow           # 只准派独立只读 qa 做裁判
    "explore": allow      # 调查阶段可派 explore 辅助定位 (可选)
---
```

设计要点：

- `edit / git commit / git push / git checkout: allow` —— 这是 Guardian 与现有 `qa` 的**根本分野**，让它能真正修代码提 PR。
- `gh issue close: deny` + `gh pr merge: deny` —— 用 permission 机制把「不自动关 issue」「不自动 merge」这两条需求方边界拦住。**注意**：bash permission 是字符串前缀匹配，强度弱于 `edit: deny`（见 §16 风险表）。因此这两条采用**机制 + 约定双重**保证：permission deny 是第一道拦截，但「不 merge」的**根本保证是闸门 2 本身**——Guardian 出 PR 后即结束响应、把控制权交回人，链路上根本不走到 merge 那一步。
- `git reset / clean: deny`、`*install*: deny` —— 保留现有安全底线，值守无人盯守时尤其重要。
- `task: qa allow` —— Guardian 只能派只读 qa 当裁判，不能派其他有写权限 agent 帮它「代判」，堵住绕过独立性的后门。
- **受限 webhook 联网豁免（§11B.5）**：`webfetch/websearch` 仍 `deny`（不放开任意联网）；主动推送通知**仅通过 bash `curl` POST 到 `.qa/guardian/config.json` 里配置的固定 `notify_webhook` URL** 实现。agent 定义里约定：`curl` 仅用于该通知用途、只 POST 到配置 URL，不得用于其他联网。这是"受限单点联网豁免"，缺配置则通知降级为仅 issue 评论、不阻断链路。

### 10.2 `qa` / `qa-facet`（现有，不改）

保持现状：`edit "*": deny`、`git commit/push/reset/checkout/clean: deny`、`*install*: deny`、`webfetch/websearch: deny`。Guardian 派它时，它在自己的独立 session 里机制性地无法改代码——**这正是独立性的机制保证**。

### 10.3 权限对照表（一眼看清分权）

| 能力 | qa-guardian（新建） | qa（现有复用） |
|---|---|---|
| edit 产品文件 | ✅ allow | ❌ deny [焊死] |
| git commit / push | ✅ allow | ❌ deny [焊死] |
| git checkout（建分支） | ✅ allow | ❌ deny [焊死] |
| gh issue close | ❌ **deny（机制+约定）** | ❌ deny |
| gh pr merge | ❌ **deny（机制+约定）** | ❌ deny |
| 装依赖 | ❌ deny | ❌ deny |
| 联网 | ❌ deny（走 gh） | ❌ deny |
| 派 qa（裁判） | ✅ allow | —（派 qa-facet） |
| 写 `.qa/` | ✅ allow | ✅ allow（现有） |

## 11. 状态机（风险分级 + 修-验循环）

```
        ┌─────────────┐
        │  DISCOVERED │  轮询命中带 qa-guardian 标签的 open issue
        └──────┬──────┘   (状态记录去重, 已处理不重入)
               ▼
        ┌─────────────┐
        │ INVESTIGATING│ 读issue+调查代码+定位根因
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  DIAGNOSED  │ 出诊断
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ RISK_ASSESSED│ 评估风险等级 (拿不准→HIGH, 见 §5A)
        └──────┬──────┘
        ┌──────┴───────┐
     HIGH│              │LOW
        ▼              ▼
 ★┌───────────┐   ┌──────────────┐
  │GATE_1_WAIT│   │ 回写留痕评论   │ (诊断+风险理由)
  │(回写诊断+  │   │ 不停, 直接继续 │
  │ 方案,停)  │   └──────┬───────┘
  └────┬──────┘          │
   人拒绝│  人确认方案     │
       ▼   └──────┬──────┘
 ┌──────────┐     ▼
 │HANDED_BACK│  ┌─────────────┐◄──────────────┐
 │(转人工/  │  │   FIXING    │ 建分支+最小修复 │
 │ 关单)    │  └──────┬──────┘                │
 └──────────┘         ▼                        │ FAIL 且未超轮次上限
              ┌─────────────┐                  │
              │  VERIFYING  │ 派只读qa自验 ─────┤
              └──────┬──────┘                  │
                     │ PASS                     │
                     │            FAIL 且超轮次 │
                     │            上限 ─────────┴──► HANDED_BACK
                     ▼
              ┌─────────────┐
              │  PR_OPENED  │ commit+push+gh pr create --base dev
              │             │ +双写追踪(issue评论+.qa/)
              └──────┬──────┘
                     ▼
             ★┌─────────────┐  ──[所有 issue 都到这; 低风险不例外]
              │ GATE_2_WAIT │ 停, 人 review PR
              └──────┬──────┘
                     │ 人 merge PR (fixes #n 自动关 issue)
                     ▼
              ┌─────────────┐
              │    DONE     │ (关闭由人的merge触发, 非Guardian)
              └─────────────┘
```

- **RISK_ASSESSED** 是新增分叉点：`HIGH`（含拿不准）走 `GATE_1_WAIT`；`LOW` 回写留痕后直接进 `FIXING`。
- **GATE_1_WAIT 的"人拒绝 / 人确认方案"两条边不是即时回调，而是评论指令 + 下一轮轮询消费**：Guardian 停在此态即结束进程；人在 issue 评论给 `/guardian approve|revise|reject`（§11.2），下一轮轮询解析后才走对应边。未给指令则一直停在此态（轮询每轮跳过、不催促）。
- **GATE_2_WAIT** 对**所有** issue 生效（低风险也停 PR）——这是「不存在自动进主干」的机制体现。除正常「人 merge → DONE」外，人评论 `/guardian rework <意见>` 可打回，下一轮轮询消费后回 `FIXING`。
- **FIXING ↔ VERIFYING** 循环受 1-2 轮上限约束（沿用现有 `using-qa.md` 闭环规则），超限进 `HANDED_BACK`；QA `FAIL` 绝不进 `PR_OPENED`（对低风险同样成立）。
- **HANDED_BACK 是终态**（人 `reject` / 修-验超限），轮询默认永久跳过；仅当人评论 `/guardian retry` 时新增一条回边 `HANDED_BACK → INVESTIGATING`（清 `fix_rounds` 重来，§11.3）。图中 `HANDED_BACK` 因此不是死胡同，而是"停下等人主动召回"。
- **DONE** 由人的 merge 动作触发，Guardian 不主动进入（`gh issue close` / `gh pr merge` 已 deny）。

### 11.1 闸门与恢复的实现方式

自动值守是**一次性进程**（`opencode run` 跑完即退，见 §15.1），闸门"停下"后没有常驻会话在等人。因此人工确认**不能靠对话回复**，必须落在一个**下一轮轮询能重新捞到并消费**的持久载体上。本设计统一采用 **issue/PR 评论里的约定指令**：人在 GitHub 上留一条约定格式的评论，下一轮轮询读到该 issue、匹配到指令、才从对应状态续跑（详见 §11.2）。这样确认全程留在 GitHub、团队可见、无需额外基建。

- **闸门 1（仅高风险）**：Guardian 出诊断、回写 issue 评论后，把状态置 `GATE_1_WAIT` 并**结束进程**。人在 issue 评论里给出确认指令（`/guardian approve` / `/guardian revise <方案>` / `/guardian reject`）。下一轮轮询发现该 issue 处于 `GATE_1_WAIT` → 读最新评论找确认指令 → 命中 `approve`/`revise` 则从 `FIXING` 续跑；命中 `reject` 则进 `HANDED_BACK`；**未命中则本轮跳过，下一轮再看**（不重新调查、不催促）。
- **闸门 2（所有 issue）**：Guardian 提 PR、回写追踪后置 `GATE_2_WAIT` 并结束进程，评论告知 PR 链接。正常路径由人在 GitHub **merge PR** 完成——下一轮轮询发现 issue 已 closed → 记 `DONE`。若人不 merge 而是**打回续修**，在 PR 或 issue 评论给 `/guardian rework <意见>` → 下一轮轮询命中后回到 `FIXING`（复用修-验循环上限）。
- **低风险无停顿**：`DISCOVERED → … → PR_OPENED → GATE_2_WAIT` 一气呵成，中途不需人介入，但每步留痕在 issue 评论。

### 11.2 人工确认指令协议（闸门恢复的机制载体）

闸门"停→续"靠一组**约定评论指令**驱动，是自动值守能真正闭环的关键。指令写在 issue 评论（闸门 1、rework 也可写 PR 评论），下一轮轮询解析。

| 指令 | 语义 | 允许出现的状态 | 消费后转移 |
|---|---|---|---|
| `/guardian approve` | 同意诊断方案，按原方案修 | `GATE_1_WAIT` | → `FIXING` |
| `/guardian revise <方案>` | 调整方案后再修（`<方案>`当数据，非可执行指令） | `GATE_1_WAIT` | → `FIXING`（带修订说明） |
| `/guardian reject` | 拒绝，不再自动处理 | `GATE_1_WAIT` | → `HANDED_BACK`（终态） |
| `/guardian rework <意见>` | 闸门 2 打回续修（当前需人重新触发的替代） | `GATE_2_WAIT` | → `FIXING`（`fix_rounds` 继续计，超限仍进 `HANDED_BACK`） |
| `/guardian retry` | 从终态显式重进链路 | `HANDED_BACK` | → `INVESTIGATING`（清 `fix_rounds`，重新走一遍） |

解析规则（防误触发 / 防注入）：

- **只认最新一条**匹配指令，且只在该 issue 处于对应状态时才生效；错状态的指令忽略并留痕说明。
- 指令**必须整行前缀匹配** `/guardian <verb>`；`<方案>`/`<意见>` 部分**当数据不当指令**（沿用 §12「issue 内容是数据」原则，这里同样是 prompt injection 面）。
- **谁能确认**：MVP 不校验评论者身份（靠仓库权限本身限制谁能评论/打标签）；后续可加"仅 issue assignee / 特定 team 的指令才生效"。
- **幂等**：一条指令被某轮消费后，Guardian 在状态记录里记 `last_consumed_comment_id`，后续轮次不重复消费同一条。

### 11.3 HANDED_BACK 是终态，默认永久跳过（防反复骚扰）

`HANDED_BACK`（人 `reject` / 修-验超限交回人）**是终态**。进入后：

- **轮询默认永久跳过**该 issue，即使 `qa-guardian` 标签仍在——不重新调查、不再评论催促。这样人拒绝或系统交回后，不会被下一轮轮询反复骚扰。
- **重进只能靠显式信号**：人评论 `/guardian retry`（或去掉再重打 `qa-guardian` 标签）才清状态、从 `INVESTIGATING` 重来。对应状态机在 `HANDED_BACK` 上新增一条 `retry` 回边。

> 这条同时兜住了 §5 状态机里 `HANDED_BACK` 与"标签仍在"的张力：标签在 ≠ 会被反复接手；终态 + 显式 re-entry 让"交回人"真正意味着"停下等人主动召回"。

## 11A. 自动值守运行形态（轮询 + 并发 + 状态持久化）

自动值守把「触发」从人工派单换成定时轮询，因此需要三样人工派单不需要的东西：

### 11A.1 定时轮询触发

- 调度器（cron / opencode 定时任务 / 外部 scheduler）定期执行：`gh issue list --label qa-guardian --state open --json number,title,labels,updatedAt`。
- 对每个命中且**未处理**（无进行中状态记录）的 issue，启动一个 Guardian session 走状态机。
- 轮询间隔可配（如 5 分钟）；MVP 可先手动跑轮询命令验证链路，再接调度器。

### 11A.2 去重、等待态消费与并发

轮询对每个命中 issue，先读状态记录（§11A.3）按 `state` 分流——**这是去重和闸门恢复合一的核心逻辑**：

| issue 当前 `state` | 本轮轮询动作 |
|---|---|
| 无状态记录 / `DISCOVERED` | 新 issue，启动链路（`INVESTIGATING → …`） |
| `INVESTIGATING`/`FIXING`/`VERIFYING`/`PR_OPENED` **且 `updated_at` 在 lease 内** | 真在处理（心跳新鲜）→ **跳过**，避免重复接手 |
| `INVESTIGATING`/`FIXING`/`VERIFYING` **且 `updated_at` 超 lease** | 上轮进程异常死了 → 判 **`STALLED`**：幂等阶段自动重跑 1 次；仍卡则转 `HANDED_BACK(reason=stalled)` + 推通知（§11B.4） |
| `GATE_1_WAIT` | 读最新评论找 §11.2 指令：命中 `approve`/`revise` → 续 `FIXING`；`reject` → `HANDED_BACK`；**未命中 → 跳过** |
| `GATE_2_WAIT` | 若 issue 已 closed（人 merge）→ `DONE`；否则读评论找 `rework` → 续 `FIXING`；**未命中 → 跳过** |
| `HANDED_BACK` | **终态，默认跳过**；仅当评论有 `/guardian retry` 才清状态重进（§11.3） |
| `DONE` | 跳过（已终结） |

- **去重本质**：状态记录既防"处理中被重复接手"，也让"等待态"不被当成新 issue 重新调查——两者用同一张 `state` 表统一解决。
- **并发上限 N**：同时处于**活跃处理态**（非等待/终态）的 issue 数设上限。避免多个有写权限的 Guardian 并发改同一仓库造成分支/commit 冲突。MVP 建议 **N=1**（串行处理，最简单最安全）。注意等待态 issue **不占并发额度**（它们只是被轮询扫描、不实际动代码）。
- **分支隔离**：每个 issue 用独立分支 `fix/issue-<n>`，天然隔离；但并发时仍建议串行以防交叉。

### 11A.3 状态持久化

自动值守跨轮询、跨进程，必须持久化每个 issue 的状态，否则重启后重复处理或丢失进度：

- 落在 `.qa/guardian/<issue>.json`（复用现有 `.qa/` 可写机制，无需新权限）：记录 `state`（DISCOVERED/…/GATE_2_WAIT/DONE/HANDED_BACK）、`risk`（LOW/HIGH）、`branch`、`pr_url`、`fix_rounds`、`updated_at`（活跃态心跳时间戳，§11B.4 判 STALLED 用）、`stall_retries`（STALLED 自动重跑次数，超限转 HANDED_BACK），以及闸门恢复所需的 `last_consumed_comment_id`（幂等消费确认指令，见 §11.2）、`last_notified_state`（幂等通知，§11B.5 防同状态重复推）、`handed_back_reason`（`reject` / `fix-rounds-exceeded` / `stalled` / `needs-clarification` / `blocked`，供人抽查与决定是否 `retry`）。
- webhook 配置落 `.qa/guardian/config.json`（`notify_webhook` 等），缺配置时通知降级为仅 issue 评论（§11B.5）。
- 轮询时先读状态记录，按 §11A.2 的 `state` 分流表决定本轮动作（新起 / 跳过 / 消费确认续跑 / 终态跳过）。
- 人 merge PR 后，下一轮轮询发现 issue 已 closed → 状态记为 `DONE`，不再处理。
- **状态记录是本地事实，issue/PR 评论是权威信号**：轮询以 GitHub 侧（issue 是否 closed、有无确认指令评论）为准更新本地 `state`，避免本地记录与 GitHub 真实状态漂移。

> 若项目无 `.qa/`：自动值守场景**建议要求先建 `.qa/`**（因为状态持久化依赖它）。这与现有「不静默创建 `.qa/`」规则一致——自动值守是显式启用的高级模式，启用前让人建一次 `.qa/` 是合理前提。

## 11B. 进程生命周期与无状态重入（闸门"停→通知→续"的机制真相）

前面所有"停在闸门等人"的说法，落到 opencode 的真实运行模型上必须被正确理解——否则整套值守无法真正闭环。

### 11B.1 机制前提：opencode 没有"暂停/等待/恢复"运行时原语

`opencode run --agent qa-guardian "..."` 的运行模型是：**拉起一个进程 → agent 一路执行到它认为"本轮该结束" → 进程退出、内存状态全部丢失**。opencode **不提供**"挂起当前 run、等一个外部信号、再从挂起点继续"的能力。

因此本设计里**所有"停"，物理上只有一种实现：当前 run 主动结束、进程退出**；**所有"续"，物理上只有一种实现：调度器下一轮重新拉起一个全新进程，读 `.qa/guardian/<n>.json` 把自己恢复到该在的位置**。这套模式称为**无状态重入（stateless re-entry）**：

> Guardian 不是"一个长期活着、在闸门挂起等人"的进程；它是"每轮被调度器短暂拉起 → 读状态 → 干一小段 → 写状态 → 退出"的**一次性进程序列**。**状态活在 `.qa/guardian/<n>.json` 文件里，不活在进程里。** §11.1–11.3 的评论指令 + 轮询消费 + 状态文件，正是"停/续"在无暂停原语下的唯一实现路径。

**调度器是常驻单点**：整套"下一轮重新拉起"依赖调度器（cron / opencode 定时任务 / 外部 scheduler）持续运行。**调度器挂 = 整个值守停摆**，这是自动值守的命脉单点（见 §16 风险表）。

### 11B.2 两种"停"：设计闸门停 vs 非计划提前停

| 停的类型 | 触发 | 状态文件应处于 | 危险 |
|---|---|---|---|
| **设计闸门停** | 判 HIGH 停闸门1 / 出 PR 停闸门2 / 主动交回人 | `GATE_1_WAIT` / `GATE_2_WAIT` / `HANDED_BACK`（**等待/终态**） | 无——轮询能正确消费 |
| **非计划提前停** | agent 觉得"答完了" / 想问澄清 / 撞 permission deny / 报错 / 上下文超限 | 仍停在**活跃态**（`INVESTIGATING`/`FIXING`/`VERIFYING`）但进程已死 | **致命**——轮询把活跃态判"处理中→跳过"，issue 永远卡死、静默丢失 |

### 11B.3 设计闸门停：确定性收尾三连（顺序不可乱）

Guardian 走到任一闸门时，**不允许靠 agent"自觉停对地方"**，必须执行确定性收尾，**按序**做完再退出：

1. **写状态文件**：`state=GATE_1_WAIT`（或 `GATE_2_WAIT`/`HANDED_BACK`）、`updated_at=now`、清活跃态心跳。——本地事实先落地。
2. **回写 issue/PR 评论**：诊断+方案（闸门1）/ PR 追踪（闸门2）/ 交回原因（HANDED_BACK）。——GitHub 权威信号 + 团队可见留痕。
3. **主动推送通知**（§11B.5）：issue 评论已发 + webhook 推一条到 Slack/webhook。——不依赖人盯 GitHub。
4. **结束响应、进程退出**。禁止在闸门后继续修代码/提 PR。

> 顺序理由：状态（本地事实）→ 评论（权威信号）→ 通知（幂等，重复推顶多多一条消息，不影响正确性）。下一轮进程启动时若发现"评论已发但状态没落成等待态"这类半截情况，以 GitHub 侧评论为准纠正本地状态（§11A.3 的漂移防护）。

### 11B.4 非计划提前停：心跳 + lease 超时 + STALLED 兜底（补静默卡死黑洞）

这是 §11B.2 那一致命列的解药。没有它，任何一次中途崩溃/误停都让 issue 无声死掉。

- **心跳**：活跃态（`INVESTIGATING`/`FIXING`/`VERIFYING`）下 Guardian 定期刷新状态文件 `updated_at`（心跳）。
- **lease（最长活跃时长）**：每个活跃态设租约（如 30 分钟，可配；重编译语言如 Java 可放宽）。
- **轮询判超时**：轮询扫到活跃态 issue 时多判一步——
  - `updated_at` 在 lease 内 → 真在处理 → 跳过（原逻辑）；
  - `updated_at` 超 lease → 上轮进程异常死了 → 判 **`STALLED`**：
    - **重跑前置检查（幂等保护）**：核对状态文件记的 `branch` 与实际 git 状态是否一致；只对**幂等阶段**自动重跑（`INVESTIGATING` 只读，可安全重跑；`FIXING`/`VERIFYING` 需先确认分支未处于半改状态，否则不自动重跑）。
    - **重试上限**：自动重跑 1 次仍 `STALLED` → 转 `HANDED_BACK`（`reason=stalled`）+ 推通知，**不无限重试烧钱**。

### 11B.5 通知机制（双通道：issue 评论 + webhook 主动推送）

闸门停 / STALLED / 交回人时，通知必须在**进程退出前主动推**（进程要死，不能被动等人来看），双通道：

- **issue/PR 评论**（团队可见、可追溯、GitHub 内可订阅）：`gh issue comment` / `gh pr comment`。
- **webhook 主动推送**（不依赖人盯 GitHub）：向配置的 Slack / 企微 / 通用 webhook POST 一条含 issue 号 + 阶段 + 链接的消息。
  - **配置**：webhook URL 存 `.qa/guardian/config.json`（如 `{ "notify_webhook": "https://..." }`）；缺配置时**降级为仅 issue 评论**（不因缺 webhook 阻断链路）。
  - **联网豁免边界**（与 §10 "默认不联网"冲突的显式解法）：Guardian 仍 `webfetch/websearch: deny`；webhook 仅通过 **bash `curl` 到 config 里那个固定 URL** 实现，且在 agent 定义里约定**只允许 POST 到该配置 URL、不得用于其他联网**。这是"受限单点联网豁免"，不是放开任意网络。
  - **幂等**：同一 issue 同一阶段的通知在状态文件记 `last_notified_state`，同状态不重复推（避免每轮轮询重复骚扰）。

#### 11B.5-a 已交付实现（超出原「通用 webhook」设计的落地范围）

原 §11B.5 只描述通用 webhook（Slack/企微/通用）。实际交付在此基础上扩展如下（记录以对齐文档与代码）：

- **飞书通道（`notify_channel: "feishu"`）**：webhook body 由 `notify-feishu.mjs` 渲染为飞书交互卡片；`generic`（默认）仍发原始 JSON，向后兼容。通道格式化集中在 `buildChannelBody`，notify 决策保持通道无关。
- **飞书卡片按钮回调服务**（云端，`callback-server.mjs` + Dockerfile/compose，见 `tools/guardian/DEPLOY.md`）：飞书卡片按钮点击经**强制签名校验**（sha256 + 常量时间比较 + 5 分钟防重放 + 严格 timestamp）、verb 白名单、事件去重后，用 GitHub REST + fine-grained PAT 写一条 `/guardian <verb> <意见>` issue 评论。回调**只写评论**，绝不 merge/close/改代码——与「人在 GitHub 手打命令」同一条安全路径。请求体设大小上限（超限 413）。
- **命令作者授权（`command_authors`，fail-closed）**：poller 只采纳白名单内 GitHub 登录名发出的 `/guardian` 命令;**未配置则任何命令都不生效**。这消除「任意/伪造评论批准 HIGH 方案」的授权漏洞——即使飞书回调写了评论，其 GitHub 身份也必须在白名单内才被采纳（双重授权）。
- **投递接线（FR-21）**：常驻 scheduler 每 tick 通过 `notify-io.mjs`（`gh` 评论 + `curl` webhook）真实投递 gate/STALLED/HANDED_BACK 通知，幂等持久化 `last_notified_state`、best-effort per issue。

### 11B.6 铁律：Guardian 永不"傻停等对话"

把"不可见卡死"强制转成"可见等待"的核心纪律，写进 agent 定义并作为验收项：

> **Guardian 任何需要人介入的情况——想问澄清、信息不足、撞权限、无法继续——都不许停在活跃态干等，必须落成显式的等待态/终态（`GATE_1_WAIT` / `HANDED_BACK` 且带 `reason`）+ 回写评论 + 推通知 + 退出。** "停下等对话回复"这种行为在自动值守下等于静默卡死，绝对禁止。

## 12. GitHub 回写设计（gh CLI）

走 `gh` CLI（现有 qa 已提到可选 gh 读能力，Guardian 扩展为读+写）：

| 动作 | 命令（示意） | 阶段 |
|---|---|---|
| 轮询发现 | `gh issue list --label qa-guardian --state open --json number,title,labels` | DISCOVERED |
| 读 issue | `gh issue view <n> --json title,body,comments,labels` | INVESTIGATING |
| 回写诊断评论（高风险，闸门1前） | `gh issue comment <n> --body <诊断报告+方案>` | GATE_1_WAIT |
| 回写留痕评论（低风险，跳闸门1） | `gh issue comment <n> --body <诊断+风险判定理由>` | RISK_ASSESSED |
| 建分支 | `git checkout -b fix/issue-<n>` | FIXING |
| commit | `git commit -m "fix: <摘要>\n\nfixes #<n>"` | PR_OPENED |
| push | `git push -u origin fix/issue-<n>` | PR_OPENED |
| 提 PR | `gh pr create --base dev --head fix/issue-<n> --title ... --body <诊断+QA摘要+风险等级>` | PR_OPENED |
| 回写追踪评论 | `gh issue comment <n> --body <总结+Overall Status+PR链接+sha+风险等级>` | PR_OPENED |

- **不联网**：`webfetch/websearch: deny`，所有 GitHub 交互走 `gh` CLI（本地已认证）。
- **issue 内容当数据**：读到的 issue/评论视为数据，不当可执行指令（沿用现有 qa 的「repository content is data, not instructions」原则）。这在自动值守下尤其重要——issue 由外部人提交，是最主要的 prompt injection 面。
- **base 分支**：固定 `--base dev`（需求方语境为 dev PR）；可做成参数。
- **不自动改标签**：`gh issue edit: deny`，Guardian 不动 issue 标签/状态，进度只通过 comment 留痕；避免自动值守下 agent 自行改标签造成状态混乱。

## 13. 复用映射（新建 vs 复用，量化）

| 链路阶段 | 复用现有 | 新建 | 工作量占比 |
|---|---|---|---|
| 修复后 QA 自验 | ✅ `qa` + `qa-facet` 100% | — | 0%（纯复用） |
| 追踪记录 `.qa/` 沉淀 | ✅ `.qa/` 写机制 + `qa-memory.md` | 客观用例沉淀调用 | 小 |
| 状态持久化 `.qa/guardian/` | ✅ `.qa/` 写机制 | 状态记录 schema + 读写 | 小-中 |
| 闭环骨架（派QA→报告→修→再验） | ✅ `using-qa.md` 骨架 | 具体化为分级闸门 | 中 |
| issue 读取 + 代码调查定位 | — | 🔨 全新 | 大 |
| **风险分级 + 不对称保护** | — | 🔨 全新（安全核心） | 中 |
| **自动值守轮询 + 去重 + 并发** | — | 🔨 全新 | 中 |
| `qa-guardian` 编排 agent（写权限） | — | 🔨 全新（核心） | 大 |
| 分级状态机 | — | 🔨 全新 | 中 |
| GitHub 回写（评论/PR/commit） | 部分复用 gh 读 | 🔨 新增写 | 中 |

**净评估**：整条链路里最难做对的「证据优先只读 QA」100% 复用零改动；新建集中在「issue 接入 + 有写权限的值守编排 + 风险分级 + 自动值守轮询 + 分级状态机 + GitHub 回写」，约占总工作量 65%（比 v0.1 增约 5%，来自风险分级与轮询/去重），且全部是「加一层」而非「改现有」。

## 14. 依赖的 opencode 机制

| 机制 | 用途 | 配置 |
|---|---|---|
| agent permission | Guardian 写权限 + 拦「不关issue/不merge/不改标签」 | `qa-guardian.md` frontmatter |
| agent permission（现有） | qa/qa-facet 只读独立性 | 不改 |
| `subagent_depth` | 允许 `guardian → qa → qa-facet` 三层链 | 全局 `opencode.json` 设 `subagent_depth: 2`（若要 qa 内部再派 facet 则需 depth 足够；否则 qa 自适应串行降级，覆盖不丢） |
| Task tool | Guardian 派 qa；qa 派 facet | `subagent_type` |
| `gh` CLI | 轮询 issue / 读 issue / 回写评论 / 建 PR | 本地已认证，Guardian bash allow |
| 定时调度 | 自动值守轮询触发 | cron / opencode 定时任务 / 外部 scheduler（实现时定） |
| `.qa/guardian/` 状态记录 | 轮询去重 + 跨进程恢复 | 复用 `.qa/` 写权限，无需新机制 |
| skill 条件加载 | Guardian 复用 qa-skill 先验做自验 | qa agent 内部加载 |

> `subagent_depth`：Guardian(顶层) → qa(第1层) 本就成立；若要 qa 在自验时再派 qa-facet(第2层)，需 `subagent_depth: 2`。未设置时 qa 自适应串行覆盖同样面向（现有机制，覆盖不丢，仅失并行）。

## 15. 触发方式

### 15.1 自动值守（目标形态）

```bash
# 调度器定期执行 (cron / opencode 定时任务 / 外部 scheduler), 间隔可配 (如每5分钟)
# 轮询带 qa-guardian 标签的 open issue, 对未处理的逐个启动 Guardian
opencode run --agent qa-guardian --dir <repo> \
  "轮询处理带 qa-guardian 标签的 open issue: 逐个调查根因、评估风险、\
   低风险自动修到PR、高风险停闸门1等我确认、所有都停在PR。并发上限1。"
```

### 15.2 单 issue 手动触发（调试 / 分级验证用）

```bash
opencode run --agent qa-guardian --dir <repo> \
  "对 GitHub issue #<n> 值守: 调查根因、评估风险等级、按分级决定是否停闸门1。"

# TUI: Tab 切到 qa-guardian, 或 @qa-guardian, 给 issue 号
```

> MVP 建议先用 15.2 单 issue 手动跑通全链路 + 验证风险分级判定是否保守，再接 15.1 的调度器做真正的自动值守。

## 16. 风险与限制

| 风险/限制 | 影响 | 处理 |
|---|---|---|
| **风险误判（高判成低，跳了闸门1）** | 高风险改动无人看方案就自动改代码到 PR | §5A 不对称三条：拿不准默认 HIGH / 低风险全程留痕供抽查 / QA 独立自验必过；且**闸门 2 对低风险仍生效**，人 review PR 是最后一道人工关 |
| **自动值守无人实时盯，Guardian 自主醒来干活** | 之前「人不派就不动」的安全闸消失 | 白名单极保守 + fail-safe 默认高 + 所有 issue 停 PR + `gh merge/close/edit`·`git reset/clean`·install 全 deny + 并发上限 N（建议 1） |
| Guardian 有写权限 | 误修/误推风险 | push 仅 fix 分支（不推 main/dev）；PR `--base dev`；QA FAIL 绝不进 PR |
| 自己修的自己验（若误用单agent） | 独立性归零 | 架构强制派独立只读 qa；`task` 白名单只允许 qa，堵绕过 |
| issue 内容含恶意指令（prompt injection，自动值守下更严重） | Guardian 被诱导越权 | issue 内容当数据不当指令；关键破坏性动作 permission deny；低风险白名单不含「按 issue 指示扩大改动范围」 |
| 轮询重复处理 / 并发冲突 | 同 issue 被多次接手 / 分支 commit 冲突 | §11A 状态持久化去重 + 并发上限（MVP N=1 串行）+ 分支隔离 |
| 状态持久化依赖 `.qa/` | 无 `.qa/` 时无法跨轮询记状态 | 自动值守启用前要求先建 `.qa/`（显式高级模式的合理前提） |
| 需重编译语言（Java/Maven）动态验证难 | qa 自验可能退化为静态+标残余风险 | 沿用现有 qa 的降级规则；Guardian 可在闸门2如实标注残余风险 |
| `gh` 未认证 / 无 issue 权限 | 读写 issue 失败 | 前置检查 `gh auth status`；失败则 BLOCKED 并交回人 |
| push 到错误分支 | 污染 main/dev | commit/push 仅在 `fix/issue-<n>` 分支操作；PR `--base dev` 而非直推 |
| **permission 前缀匹配可被变体绕过** | `gh pr merge*` 的 deny 是字符串前缀匹配，理论上 `gh  pr merge`（多空格）、别名、或先 `cd` 再执行等变体可能不命中，`deny` 的「焊死」强度弱于 `edit: deny` | 不把 `gh merge/close deny` 当纯机制保证——在 Guardian 系统提示里同时用 `{约定}` 明确禁止 merge/close；关键在于**闸门本身**（Guardian 出 PR 后结束响应、交回人）才是不 merge 的真正保证，permission deny 是第二道防线而非唯一防线。文档 §10 的 `[焊死]` 标注应据此降级为「机制 + 约定 双重」 |
| **非计划提前停 → issue 静默卡死**（agent 觉得答完/想问澄清/撞权限/报错/上下文超限而中途退出，状态停在活跃态） | issue 永远停在 `INVESTIGATING`/`FIXING`/`VERIFYING`，被轮询判「处理中→跳过」，无声丢失，无人察觉 | §11B.4 心跳 + lease 超时 → 判 `STALLED` → 幂等阶段自动重跑 1 次、超限转 `HANDED_BACK(reason=stalled)` + 通知；§11B.6 铁律「永不傻停等对话，一切人介入必落成显式态 + 通知」把不可见卡死强制转成可见等待 |
| **调度器是常驻单点** | 调度器（cron / opencode 定时任务 / 外部 scheduler）挂掉 = 整个值守停摆，所有闸门恢复/STALLED 检测/新 issue 接手全停 | MVP 明确「调度器必须常驻」是值守前提；可加调度器自身存活监控（外部 healthcheck）；单 issue 手动触发（§15.2）不依赖调度器，可作为兜底手段 |
| **webhook 联网豁免扩大攻击面** | 为主动推送开的 bash `curl` 联网口，理论上可被 prompt injection 诱导 POST 到非配置 URL / 外泄信息 | §11B.5 约定 `curl` 仅 POST 到 `.qa/guardian/config.json` 的固定 `notify_webhook`；`webfetch/websearch` 仍全 deny；通知 body 只含 issue 号+阶段+链接（不含代码/密钥）；缺配置即降级为仅 issue 评论 |

## 17. 后续方向（本版之后）

> v0.2 已将「定时轮询值守」「状态持久化」「风险分级跳闸门1」纳入主线，以下为其之上的进一步方向。

- **触发升级**：定时轮询 → webhook 事件驱动（issue 打标签即时唤起，替代轮询延迟）。
- **并发提升**：从 MVP N=1 串行 → 多 issue 安全并发（需解决同仓库分支/commit 隔离与 QA 资源竞争）。
- **多平台**：抽象 issue provider，接 Jira / Linear。
- **风险分级自学习**：把人抽查纠正的误判沉淀进 `.qa/`，收紧/校准白名单（受人治理，不静默自学）。
- **闸门恢复升级**：v0.2 已用 §11.2 评论指令协议（`/guardian rework` 等）实现打回续修；进一步可让 Guardian **解析自由格式的 PR review comment**（无需固定指令前缀）并续修，甚至逐条回应 review 意见。
- **分级可观测**：统计 LOW/HIGH 分布、误判率、抽查命中率，作为「是否敢放宽白名单」的依据。

---

## 附：与现有项目文档的一致性声明

- 四状态判定（PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW）、`Overall Status:` 单行、只读焊死、`.qa/` opt-in、handoff、facet、`[焊死]/{约定}/★` 图例 —— 全部沿用现有 qa-skill 语义，未重定义。
- 本设计**不修改** `SKILL.md` / `qa.md` / `qa-facet.md` / `references/*` 任何一行；仅新增 `qa-guardian` agent 与本链路。
- 现有 `references/using-qa.md` 描述的「调用方驱动修复闭环」在本设计中被**具体实现**为 `qa-guardian`——即现有文档里那个「有写权限的主/开发 agent」角色的落地。
