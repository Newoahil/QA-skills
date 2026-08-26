# scheduler.mjs 拆分方案（P0 改进点）

> 目标：把 1,205 行的 `tools/guardian/scheduler.mjs` 拆成职责单一、各自可测的模块，
> 保持唯一外部入口（`runScheduler` / `createSchedulerRuntime`）行为字节级不变。
> 本文件是规划，不改代码。执行前需用户明确授权。

## 现状（实测）

- 全文件 **1,205 行**，20 个导出 + 22 个内部函数。
- **`createSchedulerRuntime` 单函数 558 行（占 46%）**，内部嵌 `tick`（593 行起）——这是真正的巨石核心，其余 19 个导出都是 4–74 行的小函数。
- 外部依赖者只有 **1 个**：`guardian-runtime.mjs`（import `runScheduler`）。爆破半径天然封闭。
- 32 个内部 import——逻辑早已被 phase-008 抽到 `state-router` / `stage-runner` / `task-source` / `effect-sink` / `supervisor-exec` / `scheduler-core` / `lock`，各自有测试。scheduler 现在主要是「装配者」。
- 测试网：9 个 scheduler 相关测试（`scheduler-discovery` 378 行、`scheduler-state` 401 行、`scheduler-core` 158 行等），测行为不测文件结构 → 拆分后基本不用改。

## 职责分域（20 个导出按域归类）

| 域 | 导出函数 | 特征 | 拟落到的新文件 |
|---|---|---|---|
| **A. 配置/校验** | `DEFAULT_INTERVAL_MS`, `MAX_FIX_ROUNDS_DEFAULT`, `validateSchedulerConfig`, `resolveRepoDir`, `assertTargetRepoConfigured` | 纯函数，无状态 | `scheduler-config.mjs` |
| **B. 任务发现/身份** | `listCandidates`, `listCandidatesFromTaskSource`, `pollTaskObservation`, `createSchedulerTaskSource` | 读多写少，已依赖 task-source 适配器 | `scheduler-discovery.mjs` |
| **C. 状态转移片段** | `sessionStatusAction`, `buildInvestigationFailureState`, `applyGateCommandState`, `summarizeSupervisorEvidence`, `persistCommandlessTransitions` | 有状态写，编排逻辑 | `scheduler-transitions.mjs` |
| **D. 锁/租约临界区** ⚠️ | `createLeaseFence` | N=1 锁心跳，**高危** | 保留在核心或独立 `scheduler-lease.mjs` |
| **E. 通知/gate 发布** | `publishWaitingGate1Proposals`, `writeWatchState`, `writeVerdictComment` | 副作用，依赖 notify-io | `scheduler-notify.mjs` |
| **F. 运行时装配核心** ⚠️ | `createSchedulerRuntime`(558行) + 内部 `tick`, `runScheduler`, `main` | 巨石核心，锁+状态+gate 缠绕 | 留在 `scheduler.mjs`，瘦身为装配 |

## 分批拆分顺序（低风险 → 高风险）

### 批次 1 — 纯函数域（零风险，先做）
搬 **A. 配置/校验**（`validateSchedulerConfig`, `resolveRepoDir`, `assertTargetRepoConfigured`, 两个常量）→ `scheduler-config.mjs`。
- 兜底测试：`scheduler-config.test.mjs`（62 行，已存在）—— import 路径改一行即可。
- 无状态、无锁、无副作用，纯搬迁。

### 批次 2 — 任务发现域（低风险）
搬 **B. 发现/身份**（`listCandidates*`, `pollTaskObservation`, `createSchedulerTaskSource` + 内部 `schedulerStateKey`/`followupTaskRef`/`candidateKey`/http 配置助手）→ `scheduler-discovery.mjs`。
- 兜底测试：`scheduler-discovery.test.mjs`（378 行，已存在）。
- 已依赖 task-source 适配器，只是把「装配任务源」的代码搬出去。

### 批次 3 — 通知/gate 发布域（低-中风险）
搬 **E. 通知发布**（`publishWaitingGate1Proposals`, `writeWatchState`, `writeVerdictComment`）→ `scheduler-notify.mjs`。
- 兜底测试：`verdict-comment-integration.test.mjs`, `scheduler-watch-state.test.mjs`（已存在）。
- 有副作用但边界清晰（都走 notify-io / verdict-comment）。

### 批次 4 — 状态转移片段（中风险）
搬 **C. 转移片段**（`sessionStatusAction`, `buildInvestigationFailureState`, `applyGateCommandState`, `summarizeSupervisorEvidence`, `persistCommandlessTransitions`）→ `scheduler-transitions.mjs`。
- 兜底测试：`scheduler-state.test.mjs`（401 行）, `scheduler-session-status.test.mjs`, `followup-gate-injected.test.mjs`。
- **注意**：这些函数写 state，拆时确保 state 读写仍走 `state.mjs` 的原子写，不引入并发窗口。

### 批次 5 — 巨石核心瘦身（高风险，最后做，Oracle 复核）⚠️
处理 **D + F**：`createLeaseFence`（锁心跳）+ `createSchedulerRuntime`(558行) + `tick`。
- **这是唯一需要 Oracle 级谨慎的部分**。历史坑（digest-004/007）：
  - N=1 lease 心跳必须覆盖整个临界区（investigation + fixer + QA + PR），拆错会误判 STALLED。
  - deadline 结算必须在 abort cleanup 之前，否则 hung abort 会一直持有锁。
- 策略：**不搬锁逻辑，只把 `tick` 内部的阶段编排（fixer→qa→gate）委托给已有的 `stage-runner`**，让 `createSchedulerRuntime` 回归「装配 + 锁临界区」两件事。
- 兜底测试：`stage-runner.test.mjs`, `scheduler-core.test.mjs`（planTick 纯函数）。
- **执行前必须**：Oracle 复核锁临界区边界不变；每批 `node --test tests/guardian/*.test.mjs` 全绿再进下一批。

## 验收标准（每批都要满足）

1. `node --test "tests/guardian/*.test.mjs"` 全绿（拆分不改行为）。
2. `guardian-runtime.mjs` 的 import 只从 `scheduler.mjs` 拿 `runScheduler`（对外契约不变）。
3. 每个新文件 < 250 行（符合项目规范）。
4. `lsp_diagnostics` 干净。
5. 每批独立 commit（符合 commit-clean 规范），批次 5 单独 commit 并附 Oracle 复核结论。

## 不在本次范围（避免 scope 蔓延）

- 不动 6 个 specialist / agent 定义（已干净）。
- 不解绑 GitHub 语义（那是 P1 的事，本次只做结构拆分）。
- 不碰飞书通知（P2）。

## 风险总评

- 批次 1–4：**低风险**，纯搬迁 + 现成测试兜底。
- 批次 5：**中-高风险**，集中在锁/gate 临界区，需 Oracle 复核 + 分步验证。
- 整体可**分批独立交付**，任一批出问题可单独回滚，不影响已完成批次。
