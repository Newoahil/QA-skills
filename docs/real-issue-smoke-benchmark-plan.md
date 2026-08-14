# 真实 Issue Smoke Benchmark 测试计划

**状态：** Proposed  
**目标阶段：** P0 rubric 与委派 guard 验证完成后的小规模真实 Issue 对照测试  
**评估对象：** QA Skill 是否改善通用 Agent 的 QA 工作方式与 QA 决策，而不是是否生成官方修复 patch。

## 1. 测试目标

本 smoke benchmark 用 3–5 个真实 Issue / PR / commit 场景，对比同一模型在 **Baseline** 与 **QA Skill** 两个 arm 下的 QA 产物质量。

核心问题不是“模型是否更会 debug”，而是：加载 QA Skill 后，Agent 是否更像专业 QA 一样工作。

| 能力 | 需要观察的变化 |
|---|---|
| 风险链路发现 | 是否从 Issue / Diff 推导出真实影响链路，例如状态、缓存、权限、数据一致性、并发、下游消费者 |
| Must Verify 覆盖 | 是否把关键风险转成明确的 `Must Verify`，而不是泛泛列检查项 |
| 验证步骤可执行性 | 是否包含前置条件、操作、预期结果、证据来源 |
| 证据与结论校准 | 是否只用当前实际证据支持 `PASS` / `FAIL` / `BLOCKED` / `NEEDS_HUMAN_REVIEW` |
| 报告可行动性 | 开发者、reviewer、owner 是否能直接用报告定位缺口与剩余风险 |
| 委派 / skill 链完整性 | QA Skill arm 是否加载完整 skill 链并复现强制 gate/status 标记 |

## 2. 非目标

| 非目标 | 原因 |
|---|---|
| 不评估官方 patch 命中率 | QA Skill 的目标是 QA 方法与决策，不是生成修复 |
| 不以 hidden test pass/fail 作为主指标 | hidden test 是辅助信号，不能代表 QA 报告质量 |
| 不把一次 smoke 运行包装成统计显著性结论 | 3–5 个 Issue 只用于风险发现和流程验证 |
| 不自动安装依赖、访问外部服务或使用生产资源 | 需要人类批准与隔离边界 |
| 不自动修复产品代码 | QA 默认 read-only |

## 3. Corpus 选择标准

优先选择 3–5 个真实 Issue / PR / commit 场景，每个场景必须满足：

| 条件 | 要求 |
|---|---|
| 明确上下文 | 有 Issue / PR / commit / Diff 中至少一种显式引用 |
| 风险链路真实 | 涉及跨模块、状态、缓存、权限、数据一致性、API 契约、回归或安全隐私中的至少一类 |
| 本地可观察 | 无需外部账号、生产服务或长时间环境准备即可读代码并执行至少部分验证 |
| 范围可控 | 单个 Issue 或单个 PR-change，避免超大项目级审计 |
| 证据可保存 | 能记录命令、输出摘要、文件路径、hash 或报告片段 |

暂时避免：

- 超大 monorepo 或构建时间不可控项目
- 必须联网、登录、密钥、生产数据或外部服务的 Issue
- 纯 UI 主观体验且没有客观验收标准的 Issue
- 只能靠 hidden test 判断的 Issue
- 依赖安装或环境修复本身占主要工作量的 Issue

## 4. 对照设计

每个 Issue 跑两个 arm：

| Arm | 说明 |
|---|---|
| Baseline | 同一模型，不加载 QA Skill，只给同样的 Issue / Diff / target 信息，要求 QA |
| QA Skill | 同一模型，加载当前 QA Skill，通过 `qa-skill` / `using-qa` 进入 QA 流程 |

控制变量：

- 模型相同
- target repo / commit / Diff 相同
- 用户输入上下文相同
- 网络、安装、生产资源权限策略相同
- 每个 arm 默认一次 primary run，不因结果不好自动重跑

## 5. 输入 Prompt 约束

Prompt 应避免提示具体风险答案，只给真实上下文和边界。

模板：

```text
请对这个真实 Issue / PR 改动做一次 QA。

目标仓库：<target path>
Issue / PR / commit 引用：<explicit ref>
范围：只审这个 Issue / PR / Diff 相关改动。
非目标：不要修改任何产品文件，不要做最终发布决定，不要自动安装依赖或访问外部服务。

请输出完整 QA 报告，包含范围、风险、Must Verify、验证证据、发现项、剩余风险和最终状态。
```

QA Skill arm 额外要求：必须加载当前 QA Skill，并遵守 read-only、四状态、Human Gate、Report Quality Rubric、委派 guard。

## 6. 产物与目录建议

建议输出目录：

```text
test-results/real-issue-smoke/<run-id>/
  manifest.json
  issues/<issue-id>/
    baseline/
      opencode-events.jsonl
      stderr.log
      final-report.md
      marker-check.json
      rubric-score.json
    qa-skill/
      opencode-events.jsonl
      stderr.log
      final-report.md
      marker-check.json
      rubric-score.json
    comparison.md
  summary.md
```

每个 arm 至少保留：

| 文件 | 用途 |
|---|---|
| `opencode-events.jsonl` | skill/tool/task 加载与执行证据 |
| `stderr.log` | CLI / 环境错误 |
| `final-report.md` | 评估对象 |
| `marker-check.json` | 强制标记检查结果 |
| `rubric-score.json` | 六维 rubric 评分 |
| `comparison.md` | Baseline vs QA Skill 对照结论 |

## 7. 强制标记检查

QA Skill arm 必须检查：

| 路线 | 必查标记 |
|---|---|
| Diff Full | `QA Plan Gate: OPEN/BLOCKED`、`QA Conclusion Gate: COMPLETE/BLOCKED`、独立 `Overall Status:`、`Report Quality Self-Check` |
| Diff Lite | `Profile Decision: LITE`、`QA Lite Gate` 或等价 Lite gate 记录、独立 `Overall Status:`、风险-验证-证据链 |
| Project QA | `Project QA Plan Gate`、`Project QA Conclusion Gate`、独立 `Overall Status:`、`Module Results`、`Execution Evidence`、`Residual Risk` |

任何 QA Skill arm 若没有加载对应 skill 链，应记录为 infrastructure / workflow failure，不得计为有效 QA Skill 结果。

## 8. Rubric 评分

每个 final report 用 0–2 分评分：

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| Scope discipline | 范围混乱或扩大 | 有范围但遗漏 non-goals / 未测项 | 范围、non-goals、未测项清楚 |
| Risk-chain awareness | 只列泛泛风险 | 发现部分影响链 | 明确真实受影响链路 |
| Executable steps | “跑测试”占位 | 部分步骤可执行 | Must Verify 有具体 setup/action/expected/evidence |
| Evidence-status calibration | PASS/FAIL 无证据或证据错配 | 部分校准 | 状态完全由当前证据支持，BLOCKED/Human Review 准确 |
| Actionability | reviewer 需重推理 | 有发现但不够落地 | 开发者/QA/owner 可直接行动 |
| Memory/context integrity | 外部上下文/记忆被当证据 | 有标注但混用 | planning input 与 evidence 清楚分离 |

总分 12 分。Smoke 阶段只做相对比较，不声明统计显著性。

## 9. 判定标准

| 结果 | 条件 |
|---|---|
| Smoke PASS | QA Skill arm 在 3–5 个 Issue 中多数报告总分高于 Baseline，且无 skill 链/强制标记系统性失败 |
| Smoke FAIL | QA Skill arm 未改善报告质量，或频繁绕过 skill 链 / 缺强制标记 |
| BLOCKED | corpus、环境、权限、依赖或输出 authority 不足以比较 |
| NEEDS_HUMAN_REVIEW | 评分需要产品/QA owner 判断，例如主观验收、业务风险权重、是否可接受剩余风险 |

## 10. 执行顺序

1. 选 3 个候选真实 Issue，记录 target repo / ref / scope / non-goals。
2. 为每个 Issue 准备干净 workspace 或 worktree。
3. 跑 Baseline arm，保存 artifacts。
4. 跑 QA Skill arm，保存 artifacts。
5. 运行 marker check。
6. 按六维 rubric 人工或半自动评分。
7. 写每个 Issue 的 `comparison.md`。
8. 写总览 `summary.md`，只给 smoke 级结论。

## 11. 扩展门槛

只有当 smoke benchmark 满足以下条件时，才扩大到 10–20 个 Issue：

- QA Skill arm 没有系统性 skill 链绕过
- 强制标记稳定出现
- 至少 2/3 的 Issue 中 QA Skill 报告明显优于 Baseline
- 成本、耗时、artifact 提取稳定可控
- 评分维度没有重大歧义

## 12. 当前前置状态

| 前置项 | 状态 |
|---|---|
| P0 QA Report Quality Rubric | 已完成 |
| Diff 路线委派 guard | 已完成并真实模型 dry-run 验证 |
| Project 路线委派 guard | 已完成并真实模型 dry-run 验证 |
| 合成场景风险链路验证 | 已完成 |
| 真实 Issue smoke benchmark | 待开始 |
