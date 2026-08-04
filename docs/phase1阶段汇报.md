# QA Skill Phase 1 阶段汇报

**更新日期：** 2026-08-03
**项目：** QA Skill Pack
**阶段结论：** Phase 1 完成度 100%，49/49 全部通过

## Phase 1 范围

Phase 1 聚焦单次需求、缺陷修复或代码 Diff 的 QA 闭环，不涉及项目级或发布级聚合。

| 维度 | Phase 1 定义 |
|---|---|
| 触发方式 | 用户手动触发 |
| QA 单位 | 一次需求 / 一次修复 / 一次 Diff |
| 执行模式 | 一个专用 QA subagent，同一会话内复用 `qa-plan -> qa-execute -> qa-conclude` |
| 证据原则 | 证据优先；无证据不得标记 PASS |
| 读写边界 | 只读产品代码和测试；仅写入 QA 报告和批准的临时产物 |
| 交付形式 | 一份可复核的 Markdown 权威报告 |
| 最终决策 | 人类做出最终接受或发布决定 |

## Phase 1 交付物

Phase 1 核心 pack 文件共 10 项。

| 类别 | 文件 | 职责 |
|---|---|---|
| Skill | `using-qa/SKILL.md` | 人工入口、角色边界、总流程和停止条件 |
| Skill | `qa-plan/SKILL.md` | Repository Preflight、Diff 检查、Change Intake、风险分析、Plan Gate |
| Skill | `qa-execute/SKILL.md` | 按已批准计划只读执行，记录真实证据 |
| Skill | `qa-conclude/SKILL.md` | 分类发现、核对追踪链、形成结论、Conclusion Gate |
| Reference | `references/qa-principles.md` | QA 核心原则和状态定义 |
| Reference | `references/risk-checklist.md` | 风险分类和五层验证选择 |
| Reference | `references/evidence-guide.md` | 证据收集、脱敏和安全规则 |
| Reference | `references/finding-classification.md` | 六类发现分类和状态优先级 |
| Reference | `references/human-gates.md` | 人工门禁触发条件和处理规则 |
| Template | `templates/qa-report.md` | 统一 QA 报告结构 |

## 验证结果汇总

| 验证类别 | 测试数 | 通过 | 命令 |
|---|---|---|---|
| P1 pack contracts | 8 | 8 | `node --test --test-name-pattern "^P1-" tests/qa-skill-pack.test.mjs` |
| Functional contracts | 41 | 41 | `node --test tests/functional-validation/contracts.test.mjs` |
| **Phase 1 合计** | **49** | **49** | |

## P1 Pack 合同测试明细

| Test ID | 测试目标 | 验证内容 | 建立的保证 | 结果 |
|---|---|---|---|---|
| P1-STRUCT-001 | pack 文件结构 | 10 项 Phase 1 核心文件全部存在，且当前 pack 中没有未声明文件 | Phase 1 核心清单完整，pack 文件边界受控 | PASS |
| P1-FRONTMATTER-002 | Skill 元数据 | Phase 1 核心 Skill 及当前声明 Skill 的 YAML frontmatter 中 `name` 匹配目录名，`description` 非空 | Phase 1 核心 Skill 具备可发现的最小元数据 | PASS |
| P1-SEMANTICS-003 | 语义锚点 | 手动触发、单一 QA subagent、只读边界、Change Intake 四字段、Plan Gate、风险优先级、五层验证、六类发现、四种状态、无证据无 PASS、人审门禁 | 核心流程语义完整且无回归 | PASS |
| P1-LINKS-004 | 内部链接 | Phase 1 核心文档及当前声明 pack 文件中的 Markdown 相对链接可解析，且不逃逸 `qa-skill` 目录 | Phase 1 文档引用完整，当前 pack 无越界链接 | PASS |
| P1-DISCOVERY-005 | Skill 发现 | 通过隔离 OpenCode 实例验证 Phase 1 核心 Skill 及当前声明 Skill 可被发现，路径解析在 pack 内 | OpenCode 可正确发现并加载 Phase 1 核心 Skill | PASS |
| P1-POLICY-006 | 策略一致性 | 六类规范发现分类、四种风险优先级、五层验证、状态优先级、证据安全规则、人审门禁规则在全部策略文件中一致 | 跨文件策略无冲突 | PASS |
| P1-PREFLIGHT-007 | 仓库预检 | skill source path 与 product target path 分离、Repository Preflight 先于 Diff 检查、不依赖 `.git` 目录检测、路径歧义时 BLOCKED | 目标和边界在验证前已确认 | PASS |
| P1-OUTPUT-008 | 报告输出 | 报告模板包含独立 `Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW` 占位行，结论阶段必须替换为单一规范状态 | 报告结论格式统一且可机器提取 | PASS |

## 证据分层

Phase 1 的验证证据来自三个独立、非叠加的层次。每一层回答不同的问题，不能互相替代。

| 证据层 | 范围 | 是否调用模型 | 当前结果 | 回答的问题 |
|---|---|---|---|---|
| 确定性合同验收 | 8 项 P1 pack + 41 项 functional = 49 项 | 否，纯 Node.js 断言 | 49/49 全部通过 | 合同定义是否正确、harness 逻辑是否自洽 |
| 当前真实 OpenCode 受控场景 | 3 个合成 fixture 场景，真实模型执行 | 是，`cpa/gpt-5.4-mini` | 3/3 scenario assertion 通过 | 在受控条件下，Skill 能否正确驱动模型完成 PASS/FAIL/BLOCKED 闭环 |
| 历史公开 GitHub Issue 基准 | 2 个 Open WebUI issue，旧版 Skill | 是，历史运行 | Skill 与 Baseline 二元准确率持平 | 旧版 Skill 是否接触过真实开源缺陷叙述 |

三层证据之间不存在加法关系。确定性合同验收不证明模型行为；受控场景不证明任意 issue 泛化；历史基准不证明当前版本提升。

## 真实 OpenCode 端到端效果验证

以下三个场景是当前保留的、可复核的真实模型运行证据。每个场景的 `scenario-assertion.json` 均记录 `passed: true`，runtime config 均锁定 `general` subagent 为 `cpa/gpt-5.4-mini`。开发文档记录证据取得于 OpenCode 1.18.6，harness 兼容目标为已观察到的 1.18.x schema 形态，不声称通用兼容。

| 场景 | 预期 | 观察 | 验证命令 | 退出码 | 关键输出 | 产物目录 | 证明的能力 |
|---|---|---|---|---|---|---|---|
| `pass-membership-discount` | PASS | PASS | `node verify-membership-discount.mjs` | 0 | `OK membership discount behavior: member=90 guest=100` | `test-results/functional-validation/pass-membership-discount/` | 正向证据可支撑 PASS 判决，R01→V01→E01→PASS 追踪链完整 |
| `fail-rounding-regression` | FAIL | FAIL | `node verify-tax-rounding.mjs` | 1 | `expected 10.24 received 10.23` | `test-results/functional-validation/fail-rounding-regression/` | 真实产品缺陷被正确分类为 product defect，F02/R02/V02/E02 追踪链可追溯 |
| `blocked-missing-acceptance-data` | BLOCKED | BLOCKED | 前置条件 `acceptance-data/currency-cases.json` 缺失，子会话有意未运行验证器 | 2（post-run oracle） | `missing prerequisite: acceptance-data/currency-cases.json` | `test-results/functional-validation/blocked-missing-acceptance-data/` | 缺失验收数据被正确判定为 BLOCKED 而非假 FAIL/PASS，记录精确重跑条件 |

三个场景覆盖 PASS、FAIL、BLOCKED 三条客观判决路径，且每条路径都产生了与预期一致的模型行为、命令证据和报告产物；`NEEDS_HUMAN_REVIEW` 不在本组真实模型场景覆盖内。

## 历史 GitHub 开源 Issue 效果验证

历史上曾使用两个 Open WebUI 公开 issue 作为 QA Skill 评估样本。这两个 issue 是合适的现实回归输入，但当前仓库不保留原始 benchmark 产物，issue 级判决细节无法重新审计，且这些 issue 不是当前 fixture harness 的输入。

| Issue | 真实缺陷 | 作为 QA 样本可验证什么 | 当前可核对状态 |
|---|---|---|---|
| [#27120](https://github.com/open-webui/open-webui/issues/27120) | Folders Sharing 的 default/group 权限被静默丢弃，根因是后端 sharing model 遗漏了 `folders` 字段 | 能否识别“界面保存成功但后端字段未持久化”的跨层回归风险 | Issue 已关闭，由 [PR #27296](https://github.com/open-webui/open-webui/pull/27296) 修复；本地未保留该样本的逐次运行产物 |
| [#26181](https://github.com/open-webui/open-webui/issues/26181) | display name 中的首尾空格导致 `httpcore.LocalProtocolError` 并中断 MCP 连接 | 能否识别输入边界、HTTP header 合法性和 MCP 集成链路风险 | Issue 已关闭，由 [PR #26182](https://github.com/open-webui/open-webui/pull/26182) 修复；本地未保留该样本的逐次运行产物 |

历史报告的可用结论仅限于以下内容：

| 维度 | 可核对结论 |
|---|---|
| 样本真实性 | 评估样本来自真实公开缺陷，而不是全部由合成场景构造 |
| 历史结果 | 在当时设置中，旧版 Skill 与 Baseline 的二元准确率持平 |
| 能证明什么 | 旧版评估曾纳入真实开源 Issue 场景 |
| 不能证明什么 | 不能证明准确率提升、当前版本有效性提升或任意 Issue 泛化能力 |
| 指标限制 | 二元准确率不衡量报告完整性、证据质量、只读边界、阻塞分类或 relay 保真度 |
| 证据限制 | 当前仓库没有原始 benchmark 运行产物，无法重新审计逐 Issue 判决和报告质量 |

## 41 项 Functional contracts 主要验证的能力

41 项 functional 合同测试按验证的能力域分为五组，每组覆盖一组具体的失败模式和风险。所有 41 项均通过。

| 能力域 | 数量 | 覆盖的合同 ID | 验证的风险与失败模式 | 证明的具体能力 |
|---|---|---|---|---|
| QA 编排与角色边界 | 10 | FV-SCENARIOS-001, FV-PROMPT-010, BUG-PARENT-QA-SELF-EXECUTION-026, BUG-BLOCKED-OUTPUT-DISCIPLINE-027, BUG-PARENT-REPORT-VERBATIM-034, BUG-CHILD-TASK-WRAPPER-035, BUG-PARENT-BOUNDARY-EVIDENCE-032, FV-TOPOLOGY-022, FV-TOPOLOGY-024, FV-TOPOLOGY-023 | 父端自行执行 QA、多子会话、模型泄露答案、子会话伪造 wrapper、拓扑异常 | 一个 child 完成全部 QA，父端仅做 skill 加载和一次 task 调用；子会话模型锁定且可审计 |
| 证据可信与报告权威 | 12 | BUG-CHILD-REPORT-RELAY-033, BUG-TASK-RESULT-EXTRACTION-039, FV-EXTRACT-004, FV-COMMAND-EVIDENCE-018, FV-COMMAND-EVIDENCE-019, FV-COMMAND-EVIDENCE-020, FV-REPORT-SOURCE-015, BUG-REPORT-AUTHORITY-037, BUG-REPORT-AUTHORITY-041, FV-REPORT-SOURCE-017, FV-REPORT-SOURCE-016, BUG-REPORT-AUTHORITY-038 | 报告截断/改写/摘要、不安全 wrapper、引用产物与权威源不一致、镜像分歧、父端消息遗漏 | task-result 为逐字节权威源；命令证据与报告一致；不安全引用和 wrapper 被拒绝；镜像分歧被记录但不替换权威 |
| 结论准确与可追溯 | 5 | FV-DIAGNOSTICS-021, BUG-BLOCKED-PREREQ-WORD-ORDER-028, BUG-BLOCKED-AVAILABILITY-RERUN-036, FV-ASSERT-008, BUG-FAIL-TRACEABILITY-PROXIMITY-042 | 阻塞行误判为警告、BLOCKED 措辞模糊、基础设施错误与产品判决混淆、追踪链格式松散 | PASS/FAIL/BLOCKED 三种判决与基础设施状态分离；BLOCKED 必须含可操作重跑条件；FAIL 追踪链跨报告分节仍可验证 |
| 运行安全与隔离 | 6 | BUG-RUN-INPUT-VALIDATION-029, BUG-OPENCODE-INVOKE-SHELL-030, BUG-REPORT-SYMLINK-ESCAPE-031, FV-RUNTIME-025, FV-RUNTIME-011, FV-REDACTION-005 | shell 注入、路径遍历、symlink 逃逸、密钥泄露、提示内容进入元数据 | 运行输入在启动前验证；OpenCode 调用不使用 shell 回退；报告引用不逃逸项目边界；密钥脱敏且 PATH 不进入产物 |
| 可复现与基础设施完整性 | 8 | FV-FIXTURE-002, FV-JSONL-003, FV-SKILL-006, FV-FIXTURE-012, FV-POSTMODEL-014, FV-ARTIFACTS-007, FV-TERMINAL-013, FV-GATE-009 | fixture 不真实、非法 UTF-8/JSONL 被误接受、Skill 物化不完整、产品/Skill/配置被模型修改、产物缺失、真实运行未 opt-in | 每个场景为真实 Git 仓库含 scoped diff；JSONL 严格解析；Skill 哈希可验证；模型退出后三类完整性检查；真实模型调用为显式 opt-in |
| **合计** | **41** | | | |

## 不能由这些证据推出的结论

以下结论在当前 Phase 1 证据基础上不成立，明确列出以避免过度解读。

| 不能推出的结论 | 原因 |
|---|---|
| QA Skill 的准确率优于 Baseline | 历史 benchmark 显示旧版 Skill 与 Baseline 二元准确率持平；当前受控场景未与 Baseline 对比 |
| QA Skill 可泛化到任意 GitHub issue | 当前仅 3 个合成 fixture 场景有真实运行证据；历史 2 个 issue 的判决细节不可复现 |
| 项目验证器本身正确 | harness 假设 fixture 中的 verifier 行为正确；verifier 的正确性不是 Phase 1 的验证目标 |
| 覆盖所有 OpenCode 版本、语言、运行时或大型项目 | 兼容性证据限于已观察到的 OpenCode 1.18.x schema；场景为微型 Node.js fixture |

## 关键验证结论

| 保证 | 证据 |
|---|---|
| 目标与源分离 + 预检 | P1-PREFLIGHT-007：skill source path 与 product target path 独立传递，Repository Preflight 先于 Diff 检查 |
| 单一子会话 / 父端不自执行 | P1-SEMANTICS-003、BUG-PARENT-QA-SELF-EXECUTION-026、BUG-PARENT-BOUNDARY-EVIDENCE-032：恰好一次 task 调用，父端禁止 QA 工具 |
| 目标/Skill/配置不变 | FV-POSTMODEL-014：产品、skill、runtime config 三类哈希前后对比 |
| PASS/FAIL/BLOCKED 分离与可追溯 | P1-POLICY-006、FV-ASSERT-008、BUG-FAIL-TRACEABILITY-PROXIMITY-042：四种状态分离，基础设施与产品判决不混淆，追踪链格式严格 |
| task-result 精确交付 | BUG-TASK-RESULT-EXTRACTION-039、BUG-REPORT-AUTHORITY-037/038/041：wrapper 内逐字节保留，权威源唯一，镜像检查独立 |
| 产物路径安全 | BUG-REPORT-SYMLINK-ESCAPE-031、FV-REPORT-SOURCE-016：拒绝 symlink 逃逸和不安全引用 |
| 脱敏 / 无完整环境或提示 | FV-REDACTION-005、FV-RUNTIME-011：密钥脱敏，PATH 移除，提示仅保留 SHA-256 |
| 真实 OpenCode 运行 opt-in | FV-GATE-009：`QA_SKILL_REAL_RUNS=1` 才触发，model/agent 必填，timeout 可选，默认 skip |

## Phase 1 边界

| 不在 Phase 1 范围内 |
|---|
| 自动修复产品代码或测试 |
| 自动 commit / push / release |
| 项目级或发布级聚合 QA |
| 替代人工最终接受决策 |
| 默认确定性验收不调用模型；真实 OpenCode 集成需另行 opt-in |

## 结论

Phase 1 以 49/49 确定性合同验收为底座，以 3/3 真实 OpenCode 受控场景为当前效果证据，以 2 个历史 Open WebUI issue 为领域暴露记录。三层证据各自独立：合同验收证明 harness 自洽，受控场景证明 Skill 在已知 fixture 上可正确驱动 PASS/FAIL/BLOCKED 闭环，历史基准证明旧版 Skill 曾接触真实缺陷叙述但未表现出准确率优势。41 项 functional 合同按能力域分为编排边界、证据权威、结论可追溯、运行安全和可复现性五组，每组验证一组具体的失败模式。当前证据不支持准确率提升、任意 issue 泛化或通用兼容性结论。
