# 2026-08-13 QA Skill 真实 Issue Benchmark 阶段结果

## 1. 本轮目标

本轮目标是尽快判断当前 QA Skill 是否能在真实 Issue / PR 场景中展现出相对 Baseline 的区分度。

评估口径不是修复 patch 命中率，也不是 hidden test 通过率，而是 QA 工作方式与 QA 报告质量：

| 维度 | 含义 |
|---|---|
| Scope discipline | 是否清楚限定目标、范围、非目标与未验证项 |
| Risk-chain awareness | 是否能识别真实影响链路，而不是泛泛风险 |
| Must Verify coverage | 是否把关键风险转成必须验证项 |
| Executable steps | 验证步骤是否包含 setup / action / expected / evidence |
| Evidence-status calibration | PASS / FAIL / BLOCKED / NEEDS_HUMAN_REVIEW 是否由当前证据支持 |
| Actionability | 报告是否能让开发者、reviewer、owner 直接行动 |

## 2. 前置修复与 dry-run 结果

在真实 Issue benchmark 前，本轮先完成了 P0 rubric 与委派绕过 guard 的验证。

### 2.1 P0 rubric 改造

已完成内容：

| 项 | 结果 |
|---|---|
| 新增 `qa-report-quality-rubric.md` | 完成 |
| `qa-report.md` 引用 rubric、压缩矩阵、增加 Self-Check | 完成 |
| `qa-conclude` 在 Conclusion Gate 前强制核对 rubric | 完成 |
| pack test | 43/43 通过 |

核心链：

```text
Risk -> Must Verify -> Verification -> Evidence -> Status
```

### 2.2 委派绕过问题

发现的问题：host 通过 `task` 委派时，子 agent 可能只收到压缩转述，不加载完整 skill 链，导致 gate / status / self-check 标记丢失。

修复：

| 路线 | 修复 |
|---|---|
| Diff / bounded Issue route | `using-qa` 增加 skill-loading contract |
| Project QA route | `using-project-qa` 增加对称 skill-loading contract |

### 2.3 合成 dry-run 验证

| 场景 | 目标 | 结果 |
|---|---|---|
| order-cache Diff QA | 验证 `using-qa` guard 与 P0 rubric | 通过：`Overall Status` 与 `Report Quality Self-Check` 复现；模型自主发现 cache invalidation 风险 |
| dry-run-project whole-project QA | 验证 `using-project-qa` guard | 通过：完整加载 `using-project-qa -> project-qa-plan -> project-qa-execute -> project-qa-conclude`，复现 `Project QA Plan Gate`、`Project QA Conclusion Gate`、`Overall Status` |

Project dry-run 额外发现了预埋之外的真实逻辑缺陷：`inventory.release()` 会导致库存膨胀。

## 3. 真实 Issue benchmark 执行方式

现有 `benchmarks/real-projects/manifest.json` 的 request 使用 project QA 语义，触发最重 `using-project-qa` 路线。Pilot 显示：Baseline 成功，但 QA Skill arm 在 600s 和 1500s timeout 下仍未完成。因此，本轮转为更符合 QA Skill 分层设计的 bounded Issue QA：

| Benchmark 类型 | 路线 |
|---|---|
| 单 PR / 单 Issue / bounded change QA | `using-qa -> qa-triage -> qa-lite` 或 Full |
| whole-project QA | `using-project-qa`，不用于本轮区分度 smoke |

### 3.1 Case 口径

本轮 10-case benchmark 定义为：

```text
10 个 snapshot case × 2 arms = 20 个有效模型 run
```

| Arm | 说明 |
|---|---|
| Baseline | 禁用全局 `qa-skill` 后运行，不加载 QA Skill |
| QA Skill | 加载 `using-qa`，由 `qa-triage` 选择 Lite / Full |

重要校正：第一次 baseline 批次被全局 QA Skill 污染；这些结果已归档到 `baseline-contaminated`。有效 baseline 是物理移走全局 `qa-skill` 后重跑的干净结果。

## 4. 10 个 case 的复杂度

| Case | 复杂度 | 类型 | 说明 |
|---|---|---|---|
| `dig-pr4-pre` | 低 | CLI / test command compatibility | `node --test test/` vs `node --test`，链路短 |
| `dig-pr4-post` | 低 | CLI / test command compatibility | 同上，post snapshot |
| `claude-skill-check-pre` | 低 | validator boundary | 单字符 name validator 边界 |
| `claude-skill-check-post` | 低 | validator boundary | 同上，post snapshot |
| `lodash-4319-pre` | 中低 | parser boundary | consecutive brackets path parsing |
| `fake-timers-541-pre` | 中 | runtime edge case | no-timers `clock.jump(0)`，需要校准证据强度 |
| `js-yaml-155-pre` | 中 | parser / null handling | named null + empty scalar |
| `click-2730-pre` | 中 | CLI help/default behavior | flag option + `default_map` |
| `dig-pr2-pre` | 中偏高 | schema / API contract | collection vs item metadata shape、legacy compatibility、vendored drift |
| `dig-pr2-post` | 中偏高 | schema / API contract | 同上，post snapshot |

总体评价：本组 case 偏低到中等复杂度，适合 smoke，但不适合证明高复杂真实 issue 上的强区分度。

## 5. 10-case 质量评分结果

评分：6 维 × 0–2 分，总分 12。

| Case | Baseline | QA Skill | Delta | 结果 |
|---|---:|---:|---:|---|
| `dig-pr4-pre` | 12 | 12 | 0 | 平 |
| `dig-pr4-post` | 11 | 12 | +1 | QA Skill 胜 |
| `dig-pr2-pre` | 12 | 11 | -1 | QA Skill 负 |
| `dig-pr2-post` | 11 | 12 | +1 | QA Skill 胜 |
| `claude-skill-check-pre` | 11 | 10 | -1 | QA Skill 负 |
| `claude-skill-check-post` | 10 | 12 | +2 | QA Skill 胜 |
| `lodash-4319-pre` | 11 | 12 | +1 | QA Skill 胜 |
| `fake-timers-541-pre` | 8 | 11 | +3 | QA Skill 胜 |
| `js-yaml-155-pre` | 12 | 11 | -1 | QA Skill 负 |
| `click-2730-pre` | 11 | 11 | 0 | 平 |

### 5.1 汇总

| 指标 | 结果 |
|---|---:|
| QA Skill 胜 | 5 |
| 平 | 2 |
| QA Skill 负 | 3 |
| Baseline 总分 | 109 / 120 |
| QA Skill 总分 | 114 / 120 |
| 总差值 | +5 |
| 平均差值 | +0.5 / case |
| 中位差值 | +0.5 |

结论：弱正向信号，不是高置信强阳性。

允许表述：

> QA Skill 在这 10 个 bounded Issue 样本上展现出 modest structural/reporting improvement。

不允许表述：

> QA Skill 已经被证明广泛优于 baseline。

## 6. Token 与耗时对比

来自 20 个有效 run 的 `step_finish.part.tokens` 汇总。

| Arm | Runs | Total tokens | Avg / run | Input | Output | Reasoning | Cache read | Total time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 10 | 1,924,878 | 192,488 | 306,242 | 24,327 | 6,085 | 1,588,224 | 1,779s |
| QA Skill | 10 | 2,967,680 | 296,768 | 336,064 | 38,288 | 10,288 | 2,583,040 | 3,256s |

### 6.1 增幅

| 指标 | QA Skill - Baseline | 增幅 |
|---|---:|---:|
| Total tokens | +1,042,802 | +54.2% |
| Avg tokens / run | +104,280 | +54.2% |
| Input tokens | +29,822 | +9.7% |
| Output tokens | +13,961 | +57.4% |
| Reasoning tokens | +4,203 | +69.1% |
| Cache read | +994,816 | +62.6% |
| Time | +1,477s | +83.0% |

性价比结论：当前 QA Skill 有弱正向质量信号，但成本增幅明显；在这 10 个 bounded Issue case 上，性价比还不够好。

## 7. 复杂度与正向作用趋势

| 复杂度组 | Cases | 平均 Delta |
|---|---:|---:|
| 低 | 4 | +0.5 |
| 中低 | 1 | +1.0 |
| 中 | 3 | +0.67 |
| 中偏高 | 2 | 0 |

当前数据不支持“复杂度越高，QA Skill 正向作用越强”的线性结论。

更准确的趋势：

| 影响因素 | QA Skill 表现 |
|---|---|
| 单点、清晰、可一条命令复现 | 区分度弱，baseline 也很强 |
| 需要证据校准、避免 overclaim | QA Skill 更有优势 |
| 需要 residual risk / human gate / blocked 说明 | QA Skill 更有优势 |
| 需要多变体探索，但 Lite/triage/report 不稳定 | QA Skill 可能输 baseline |

代表性 case：

| Case | Delta | 说明 |
|---|---:|---|
| `fake-timers-541-pre` | +3 | QA Skill 明显更谨慎，避免 weak static evidence 过度结论 |
| `dig-pr2-pre` | -1 | 本应利好 Skill，但 baseline 探索了更多 surface，Skill 报告偏薄 |
| `js-yaml-155-pre` | -1 | baseline 覆盖更多变体 |
| `claude-skill-check-post` | +2 | 低复杂度也能靠结构化与完整性获胜 |

## 8. 主要有效性风险

| 风险 | 影响 |
|---|---|
| 单次 run / arm | 模型随机性可能影响小差值 |
| 非盲评 | 评分有主观偏差 |
| case 偏简单 | baseline 容易拿高分，出现 ceiling effect |
| 部分 repo 缺依赖或 exact runtime | 判断常基于 source/probe，不是完整测试 |
| marker compliance 不稳定 | QA Skill 链加载了，但 Lite Gate / Conclusion Gate / Self-Check 不稳定 |

## 9. 对 P1 的直接启示

P1 不是继续“加仪式”，而是解决本轮暴露出的两个核心问题：

| 问题 | 当前现象 | P1 目标 |
|---|---|---|
| 区分度弱 | 平均只 +0.5 / case | 稳定提升 Must Verify、risk-chain、evidence calibration、actionability |
| 成本偏高 | token +54%，耗时 +83% | 压缩 Lite/triage/report 冗余，避免 bounded Issue 付 project-level 成本 |
| marker 不稳定 | 部分 QA Skill 报告缺 Lite Gate / Conclusion Gate / Self-Check | 让 `qa-triage -> qa-lite -> qa-conclude` 输出契约稳定复现 |
| Lite 未完全吃到 P0 rubric | P0 rubric 主要落在 Full `qa-report.md` | 同步到 `qa-lite-report.md` |
| 复杂 case 反输 baseline | `dig-pr2-pre`、`js-yaml-pre` 等 baseline 更完整 | 强化 triage/risk-checklist，避免漏关键变体、兼容性/契约面 |

### 9.1 P1 优先项

| 优先级 | 改造 | 目的 |
|---|---|---|
| P1-1 | `qa-lite-report.md` 同步 rubric + gate/self-check | 真实 Issue 多数走 Lite，Lite 必须稳定输出质量约束 |
| P1-2 | `qa-triage` 明确 Lite/Full 选择 + marker contract | 避免该 Lite 的变重、该 Full 的变薄，降低成本 |
| P1-3 | `risk-checklist` 增加链路式风险提示 | 提升 risk-chain / Must Verify 覆盖，减少 baseline 反超 |
| P1-4 | `evidence-guide.md` 压缩证据摘要规则 | 降低 token 和报告冗余，保留可复核性 |

### 9.2 P1 后重跑目标

| 指标 | 当前 | P1 后目标 |
|---|---:|---:|
| 平均质量 delta | +0.5 / case | >= +1.5 / case |
| QA Skill 胜/平/负 | 5 / 2 / 3 | >= 7 / 2 / 1 |
| token 增幅 | +54% | <= +30% |
| marker compliance | 不稳定 | >= 9 / 10 稳定 |
| QA Skill 反输 case | 3 | <= 1 |

## 10. Artifacts

本轮 artifacts 位于：

```text
C:\Users\lhw\AppData\Local\Temp\opencode\bounded-issue-ab\run-20260813-10case
```

关键文件：

| 文件 | 说明 |
|---|---|
| `summary.md` | benchmark 总结 |
| `scorecard.json` | 质量评分汇总 |
| `marker-check-clean-baseline.json` | 干净 baseline 后的 marker / skill-load 检查 |
| `token-usage-summary.json` | token 汇总 |
| `token-usage-by-run.json` | 每 run token 明细 |
| `run-bounded-ab.mjs` | bounded Issue A/B runner |
