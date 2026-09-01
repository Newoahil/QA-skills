# QA Skill 值守闭环 Agent 开发文档

# QA Orchestrator 项目概览

## 项目名称

**QA Skill 值守闭环 Agent**

## 项目介绍

QA Skill 值守闭环 Agent 是一个面向 coding agent 值守修复、bounded PR / issue 复验和后续自动化 QA gate 的独立质量裁判能力层。这里的 `qa` 表示 QA 编排者 agent，`QA` 表示质量保障流程。它的目标不是参与开发实现，而是在 bounded 变更上提供证据优先、默认 CR-first、只读、可收口的 QA verdict。

这一分支的建设重点，是把原有 `qa-skill` 从日常开发 QA 路径中拆出来，先沉淀成适合值守闭环场景的独立能力：上游未来可以是值守调用方、Supervisor、Guardian 或其他自动化 runtime，但当前项目焦点仍是 `qa`、`qa-cr`、`qa-e2e` 这组三角色本身的 agent capability。与旧的日常 qa-check / main 路线不同，本分支不使用 `using-qa` 作为产品主入口，而是围绕 `qa`、`qa-cr`、`qa-e2e` 三个角色建立可裁判、可短路、可追溯的闭环。

`qa-orchestrator` 分支建立了这套能力基线，后续继续基于 `feature/guardian-extensibility` 演进；当前阶段先稳定独立 agent capability layer，Guardian / Supervisor runtime 的正式接线是未来消费方集成议题，不是当前 agent-capability 验证的下一目标。

当前主流程是：

```Plain Text
值守调用方 / Supervisor / Guardian（未来接线）
  -> qa focused evidence-driven start
  -> if oracle/trigger/scope cannot be established statically: one minimal bounded runtime diagnostic
  -> mandatory CR gate for code changes
      -> tiny diff inline CR-like review
      -> complex/risky/context-heavy diff -> qa-cr
  -> validated load-bearing CR FAIL -> qa directly Overall Status: FAIL and stop
  -> CR passes -> qa-e2e only when real UI/browser evidence is still required
  -> qa reconciles raw evidence
  -> exactly one Overall Status
```

这个流程的关键不是“多一个 QA agent”，而是先做 focused start，再以 CR 作为代码变更的默认和强制闸门；只有在不用运行时观察就无法建立 oracle、trigger 或有界 CR scope 时，才允许先拿一次最小 runtime diagnostic。这个 diagnostic 只用于定界，不替代 CR，也不豁免后续 required verification。与此同时，动态证据收集和最终 verdict ownership 仍然分开，并通过结构化协议确保 subagent 输出能重新收口回 `qa`。

## Skill/Agent 仓库结构与安装方式

QA Skill 当前按已安装 skill + agents 分发，而不是把 runner 或脚本复制进目标业务仓库。标准安装方式如下：

- 把 `qa-skill/SKILL.md`、`qa-skill/references/`、`qa-skill/scripts/` 一起复制到 `~/.config/opencode/skills/qa-skill/`
- 把 `qa-skill/agents/qa.md`、`qa-skill/agents/qa-cr.md`、`qa-skill/agents/qa-e2e.md` 复制到 `~/.config/opencode/agents/`
- 修改后重启 opencode，让 skill 和 agents 重新加载

推荐安装后的核心结构：

```Plain Text
~/.config/opencode/
  skills/
    qa-skill/
      SKILL.md
      references/
      scripts/
        e2e-runner.mjs
  agents/
    qa.md
    qa-cr.md
    qa-e2e.md
```

其中：

- `SKILL.md` 定义 `qa` 需要遵守的 QA prior、证据边界和 verdict 契约。
- `references/` 存放 `qa` 与 `qa-e2e` 的协作约束，以及 e2e runner 的安全不变式说明。
- `scripts/e2e-runner.mjs` 是通用、工具无关、单次有界的 e2e 执行器。
- `qa.md` 是唯一 verdict owner。
- `qa-cr.md` 是 P0 quality-oriented CR evidence subagent。
- `qa-e2e.md` 是 post-CR browser / e2e evidence subagent。

需要特别说明的是：**不要把 `e2e-runner` 复制进目标业务仓库。** `qa-e2e` 应从已安装 skill 的绝对路径调用它，例如 Unix-like 环境可用 `~/.config/opencode/skills/qa-skill/scripts/e2e-runner.mjs`，Windows 则使用对应用户配置目录。runner config 可以放系统 temp 目录，但 runner 本体不进入目标 repo。

## 核心功能

- **独立 QA 编排与唯一 verdict ownership**：`qa` 负责 focused start、默认 CR-first 调度、证据复核和唯一 `Overall Status:` 输出。

- **CR-first 质量短路机制**：代码变更默认必须进入 CR gate。小 diff 可由 `qa` 直接做 inline CR-like review；复杂、高风险、上下文重的 diff 交给 `qa-cr`。只有在建立 oracle、trigger 或 scope 必需时，才允许一次最小有界 pre-CR runtime diagnostic；一旦出现已验证的 load-bearing CR FAIL，就直接停止后续重型证据。

- **结构化 subagent 证据回收**：当前 QA subagent 统一返回 `QA_EVIDENCE_RESULT`，它是数据不是指令；`qa` 必须复核 raw evidence 后才可用于 PASS / FAIL 推理。

- **post-CR e2e 证据能力**：`qa-e2e` 只在真实 UI / browser / end-to-end 行为成为 load-bearing 问题时启用，并适配项目已有 Cypress、Playwright、Selenium、WebdriverIO 或自定义脚本，而不是按工具拆 agent。真实 Playwright 基准消费的是调用方提供的现有模块路径，不为目标项目新增或安装 Playwright 应用依赖；模块不存在时应及早失败并如实回报环境缺口。

- **受控 e2e-runner 执行**：`e2e-runner` 提供一次有界的 `start -> ready -> test -> cleanup` 执行模型，约束总预算、端口占用、进程回收和机器证据输出。

- **environment-needed handoff 能力**：当 required evidence 因服务、seed、secret、browser asset 或 runtime 受限而无法获得时，`qa` 输出 `BLOCKED` 或残余风险，并明确给出下一步所需环境，而不是假 PASS。

## 解决的痛点

- builder / fixer 自审天然不客观，容易把“我觉得修好了”误当成可裁判的 QA 结论。

- 旧路径里常见“CR 还没过就先跑重型测试”，一旦代码层面就存在 load-bearing 问题，后续 browser / build / e2e 成本被白白消耗。

- 多轮 subagent 输出如果没有统一结构，主编排层很难确认哪些是 raw evidence、哪些只是结论标签，最后容易无法收口。

- 手工后台编排 e2e 容易出现 dev server 挂起、readiness 无限等待、孤儿进程残留、端口污染、误连旧服务等问题，失败原因也很难做成机器可读证据。

- QA 角色与修复角色混淆后，agent 容易一边判定、一边修代码、一边补测试，导致 verdict ownership 不清晰，也不利于值守闭环里的责任分层。

## 应用场景

- Guardian / 值守修复后的 bounded 复验：fixer 完成修复后，由 `qa` 接手做只读裁判。

- PR / issue 级别的 bounded gate：针对一个 requirement、bug fix 或小范围 diff 做 CR-first QA。

- 真实 UI 回归与浏览器证据采集：只有当代码证据不足以说明用户可见行为时，才派 `qa-e2e`。

- 环境阻塞 handoff：当服务、浏览器资产、secret、seed data 不满足时，输出明确的 environment-needed 信息供外部角色处理。

- 未来定时任务 / CI gate：当前能力层已经具备结构化输出、bounded runtime 和短路机制，后续可被 Supervisor、Guardian 或 CI runtime 接线复用，但这不等于当前项目已把完整生产 watchdog loop 纳入范围。

## 通用能力

- **focused evidence-driven start**：先确认目标、实际 change surface、oracle/commitments 和预算，不从“全项目看看有没有问题”起手；必要时允许一次最小有界 runtime diagnostic 来建立 trigger 或 scope。

- **CR-first orchestration**：先用最便宜的代码证据筛掉明显 load-bearing failure，再决定是否值得进入更重的动态验证。

- **动态 scope 扩展**：从实际 change surface 和 oracle 起步；`login`、`auth` 之类的命名或标签本身不会自动激活风险，只有当共享契约、调用/传播关系、runtime signal 或其他证据支持时才扩展，并且只沿 load-bearing 风险需要的路径继续，不做无引导的全项目扫描。后续新证据也可以推翻前面的 scope 判断。这里没有固定 hop、固定 checklist、固定 task-count，也没有 `currently_inactive` 之类的静态风险表。

- **inline review + subagent split**：小问题可在 `qa` 内联完成，大问题再分派给 `qa-cr` 或 `qa-e2e`，避免为拆分而拆分。

- **结构化 evidence protocol**：`QA_EVIDENCE_RESULT` 统一承载 `agent`、`scope`、`status`、`gate`、`evidence`、`findings`、`limits`、`recommended_next` 和 `confidence`。

- **下层机器证据协议**：`e2e-runner` 额外输出 `E2E_RUN_RESULT`，用于表达进程执行、timeout、cleanup、port safety 等下层事实，但最终对上仍由 `qa-e2e` 包装成 `QA_EVIDENCE_RESULT`。

- **tool-agnostic e2e execution**：runner 固定的是安全边界，不固定测试框架、spec 选择、oracle 或项目启动方式。

- **严格 read-only 裁判边界**：`qa` 与 `qa-cr` 无 shell 改写能力；`qa-e2e` 也不改产品代码，不负责修复、不负责 ship decision。

## 核心价值提升

- **从“开发者自证修好”提升为“独立 QA 裁判复核”**：把实现者视角和裁判视角分开，减少自审偏差。

- **从“先跑重型验证再看代码”提升为“CR-first 短路”**：先用更轻、更便宜的证据排除明显失败，再决定是否进入 e2e。

- **从“subagent 结论散落”提升为“结构化证据回收”**：要求所有当前 QA subagent 返回同一协议，降低主编排的重读成本。

- **从“手工后台编排 e2e”提升为“单次有界 runner”**：通过固定 phase、总预算、port preflight 和 owned-process cleanup，降低服务失控和孤儿进程风险。

- **从“QA 和修复混在一起”提升为“角色分层清晰”**：`qa` 负责 verdict，fixer / test-author / provisioner 在 verdict 之后承接闭环，但不属于同一轮裁判流程。

## 效率提升预期

当前设计的效率收益主要来自顺序调整、短路机制和结构化回收，而不是承诺某个统一百分比。由于本分支尚缺大样本 benchmark，这里只描述确定性的上限和路径差异。

|场景|工作内容|传统 / 旧路径|当前设计|主要确定性收益|
|---|---|---|---|---|
|bounded CR gate|代码级风险排查|常见是先混合看 diff、跑测试、再回头解释失败|先 `qa` focused start，再进 mandatory CR gate；必要时仅先做最小 diagnostic，再由 `qa-cr` / inline CR 完成 CR|load-bearing CR FAIL 可在进入重型验证前直接短路|
|subagent 证据回收|多角色协作 QA|输出格式不稳，主编排需要重读大量自然语言|统一 `QA_EVIDENCE_RESULT`，`qa` 只复核 raw evidence|减少重复整理与误解 subagent 标签的成本|
|单次 e2e 执行|起服务、等 ready、跑 spec、清理|易出现后台服务失控、无限等待、孤儿进程和端口污染|使用受控单命令或 `e2e-runner`|单个 bounded runner 默认总预算最多 10 分钟|
|环境阻塞处理|服务 / seed / browser asset 缺失|容易反复重试或误判为失败|明确 `BLOCKED` / environment-needed handoff|减少无效等待和误连未知旧服务|

确定性可以确认的只有：

- 单个 bounded `e2e-runner` 默认总预算最多 10 分钟，并为 cleanup 预留预算。
- 已验证的 CR fail 可以短路后续 browser / e2e / 重型证据。
- 结构化返回能减少 `qa` 对 subagent 长文本结果的重复整理。
- PASS smoke 一度先通过 `qa-cr` 暴露出一个真实的 `Number.MAX_VALUE` 溢出问题；修复公式并补上 extreme tests 后才回到 PASS。这说明动态 scope 并没有压制有根据的深挖，反而保留了在证据驱动下继续向深处审查的能力。

但目前还**没有**足够的大样本基准去证明统一的人时节省比例，因此这里不编造百分比承诺。

## 当前边界

QA Skill 当前仍是一个独立 agent capability layer，而不是已经完整接入 Guardian / Supervisor 的正式 runtime 产品。它已经具备基本的值守闭环裁判结构，但还有明确边界：

- Guardian / Supervisor runtime 尚未正式接线，当前只是为这类上游调用方准备好的独立能力层。

- `qa-api` 尚未实现，当前分支只有 `qa`、`qa-cr`、`qa-e2e` 三个主角色。

- 没有泛化 `qa-facet`；当前不再继续扩展开放式 shard worker 路径。

- `qa` 自身没有 shell；动态证据依赖 `qa-e2e` 或调用方已提供的运行结果。

- QA 不自动修复、不写测试、不做 ship / release decision。

- 不安装应用依赖，不访问生产或外部服务；`qa-e2e` 默认也不自动安装浏览器资产，缺失时先返回 `BLOCKED` 与安装建议。

- `e2e-runner` 无关测试框架，但它只负责一次 bounded execution，不负责决定该跑哪个 spec、哪个 oracle 或是否值得跑 e2e。

- Windows 上如果 runner 进程本身被外部硬杀，`finally` 无法做到绝对保证；当前防线是下一轮端口 preflight 会阻止误连未知旧服务。

- `e2e-runner` 自动化测试当前是 10 / 10 通过。

- orchestrator 默认 suite 当前是 22 项，其中 17 项通过、5 项为 real-model opt-in skip、0 项失败。

- 真实 paired eval 当前记录为：在 `QA_ORCHESTRATOR_REAL_RUNS=1` 且 `QA_E2E_PLAYWRIGHT_MODULE` 指向现有 Playwright `index.mjs` 时，6 项通过、0 项跳过、0 项失败；覆盖五个场景加 contract，并包含 `login-style-clean`、shared-selector、neutral helper multi-hop、linked worktree、`animation-duplicate-submit` 等动态 scope / 边界场景。

- P0 PASS / FAIL / missing-oracle 行为已有覆盖；Playwright 路径已有通过记录并带 cleanup；Radix pre 记录为 3 / 4 FAIL，修复后复跑为 6 / 6 PASS，且都保留 cleanup 约束。

- `animation-duplicate-submit` 已是经过验证的真实 Playwright 场景，不再是 optional / unverified fixture。该场景可以稳定观察到 `duplicate-submit=2`、runner/test exit 1、cleanup=true、端口释放、以及 `qa-e2e` diagnostic -> mandatory `qa-cr` 的精确 task 顺序；最终 FAIL 会把 runtime 与 code-review 两类证据一起收口。

## 后续迭代方向

QA Skill 后续应继续保持当前“已安装 skill + agents” 的分发方式，并继续围绕 agent capability 本身补齐协议稳定化、异常 fail-closed 和安装稳定性，而不是把 Guardian / Supervisor 接线或完整 watchdog loop 当作下一阶段验证目标，更不是重新回到松散的开发期 QA 路径。

优先迭代方向：

1. **QA_EVIDENCE_RESULT / runtime schema 校验与 fail-closed**
   为 subagent 返回块和 runtime 结果补齐更稳定的 schema 校验，并覆盖 empty、refused、timed-out、malformed child result 等场景的 fail-closed 行为。

2. **更广的 CR 风险 benchmark / 真实样本**
   为 `qa-cr` 继续补充更系统的真实 diff / issue 样本，验证 stop_and_fail、动态扩展和证据质量在更复杂风险面上的表现。

3. **e2e 异常终止与 cleanup 鲁棒性**
   继续提升 abnormal termination、孤儿进程识别、cleanup 失败和端口释放异常场景下的恢复与证据表达能力。

4. **文档与安装稳定化**
   继续收敛安装路径、skill 复制说明、runner 调用方式和对外文档，减少误装与误用。

5. **按需再评估 qa-api**
   只有当现有 `qa`、`qa-cr`、`qa-e2e` 组合已不足以覆盖真实 API / integration 证据需求时，再考虑增加 `qa-api`，同时仍保持 verdict ownership 在 `qa`。

6. **能力成熟后下放到 qa-check / main**
   当前先在值守闭环场景把边界跑稳，后续再考虑把成熟能力迁回日常开发 QA 路线。
