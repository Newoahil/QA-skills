# QA Skill 开发文档

> 当前分支聚焦 `qa` 这个 QA 编排者 agent，以及三个直接证据 subagent：`qa-cr`、`qa-api` 和 `qa-e2e`。`qa-cr` 是 P0 CR-first 质量闸门；`qa-api` 是隐藏的有界 HTTP/API runtime 证据 worker；`qa-e2e` 通常在 CR 之后采集真实浏览器/端到端证据，但在建立 oracle/trigger/scope 必需时也可先做有界 runtime diagnostic。它们都不输出总判定。

---

## 1. 产品定位

`qa-skill` 是面向单个 bounded requirement、fix、Diff/PR-change 的证据优先 QA prior。它定义 QA verdict 的边界和不变式，而不是固定 SOP：`qa` 先做 focused start，代码变更默认进入 CR gate；只有在建立 oracle/trigger/scope 的最小证据确实缺失时，才允许先做 bounded diagnostic；CR 过或无阻断代码风险后，再规划后续证据；最后由 `qa` 输出唯一 `Overall Status:`。

当前 agent 分工：

- `qa`：QA 编排者 agent。负责 focused start、CR-first 调度、后续 evidence planning、复核 raw evidence、汇总残余风险并输出唯一总判定。
- `qa-cr`：P0 quality-oriented code review evidence subagent。以 `qa` 分配的 diff/touched files 为起点，沿有证据支持的相关关系扩展；不修代码、不写测试、不下最终 verdict。
- `qa-api`：hidden leaf API evidence worker。由 `qa` 在 CR 之后按需直接派发，用于有界非浏览器 HTTP/API/integration runtime 证据；行为上默认只打本地/loopback，验证 target identity，记录 redacted request/response/timing/cleanup 证据，不做广泛扫描、不做安装；可通过 bash 产生临时/runner 制品，但不编辑产品文件。
- `qa-e2e`：hands-on e2e evidence worker。通常在 CR 之后、需要真实浏览器/运行中应用/端到端流程时由 `qa` 直接派发；若 `qa` 无法在没有运行时观察时可靠建立 oracle/trigger/scope，也可先派发做 bounded diagnostic。它运行现有 UI/e2e 工具链，并优先用受控单命令或 `scripts/e2e-runner.mjs` 做一次有界执行后返回结构化证据。

fixer、test-author、环境 provisioner 等只可能在 QA verdict 之后作为外部角色处理 FAIL、补测试或搭环境；它们不是 QA 流程本身。

---

## 2. 核心不变式

- **给边界不给固定步骤**：SKILL 是 QA prior，不规定表格、gate、命名阶段或固定执行顺序。
- **focused start**：收到 QA 任务后只确认 bounded target、调用方已提供的 change identity、oracle/commitments 的最低必要信息。
- **CR-first**：代码变更必须先过 P0 code-review evidence gate；如果 CR 都过不了，后续 e2e/API/重型 QA 没意义。
- **证据优先**：PASS/FAIL 必须指向 raw evidence，例如命令、输出、日志、文件行、截图、trace、复现行为或 subagent 返回的证据。
- **产品文件不编辑**：`qa` 与 `qa-cr` 通过 `edit: deny` 机械禁止产品文件编辑；`qa-api` 与 `qa-e2e` 的行为规则同样是不编辑产品文件，但它们可通过 bash 产生 temp/runner artifacts，因此这里不宣称对它们存在机械隔离式“仓库只读”沙箱。
- **唯一总判定**：只有 `qa` 输出 `Overall Status:`；subagent 只输出 `QA_EVIDENCE_RESULT`。

---

## 3. 范围

### 3.1 覆盖范围

- 对一个 bounded 变更做证据优先 QA。
- 当前值守闭环能力顺序：`qa -> focused start -> CR gate first -> qa-api if needed -> qa-e2e if needed -> qa verdict`。
- `qa` 可读代码、文档、diff、测试、日志和调用方提供的上下文。
- `qa-cr` 为代码变更提供 P0 CR-first evidence gate；小 diff 可由 `qa` 内联做 CR-like review，复杂/有风险/上下文多的 diff 派 `qa-cr`。
- `qa-api` 可在 CR 后运行项目已有本地服务或受控 bash 命令，对有界 HTTP/API claim 采集 status/header/body/timing/auth/read-after-write 等运行时证据；行为上默认只访问 localhost/127.0.0.1，外部 target 需人工明确批准和测试身份；默认 GET/HEAD/OPTIONS，mutation 需显式 method+endpoint/data/cleanup 许可；不编辑产品文件，但可产生 temp/ignored artifacts。
- `qa-e2e` 可在 CR 后运行项目已有 e2e/UI 工具链、启动本地 dev/preview server，并优先通过受控单命令或 `scripts/e2e-runner.mjs` 完成 start -> ready -> test -> cleanup 的一次有界执行。建立 oracle/trigger/scope 必需时，也可先做 bounded diagnostic。默认不自动安装浏览器/driver assets；仅在 assignment 明确授权且确有需要时才可安装 runner browser/driver assets；不可安装/升级应用依赖。
- 已存在 `.qa/` 时可做可选跨 run QA memory；不存在时保持 report-only，不静默创建。

### 3.2 不在范围

- 不写产品代码，不修改/新增仓库测试、fixture、snapshot、配置或文档。
- 不做发布/上线决定。
- 不自动修复，不把 fixer/test-author 纳入 QA 编排。
- 不主动安装应用依赖；本地/loopback project service access 仅在 assignment 需要时允许，生产/外部服务仍需明确人工批准。
- 不把 e2e 作为默认路径；只有真实 UI/e2e 风险无法被轻量证据覆盖时才使用。
- 不提供泛化 shard worker；QA 范围/上下文过大时，先由 `qa` 用最小探查/通用代码定位能力缩小范围，或标 evidence-needed/`BLOCKED`。
- 不把 `qa-api` 扩大成通用 runtime/安全/压测 worker；它只做有界 HTTP/API 证据。

---

## 4. 角色表

| 角色 | 所属流程 | 目标 |
|---|---|---|
| 人/调用方 | QA 入口 | 提供 bounded 目标、需求上下文、已有验证结果或环境限制 |
| `qa` | QA 主编排 | focused start，CR-first 调度，后续 evidence planning，复核 raw evidence，输出唯一 `Overall Status:` |
| `qa-cr` | QA CR evidence | 对 `qa` 给定的 diff/touched files 做质量导向 CR 取证，返回 `QA_EVIDENCE_RESULT` |
| `qa-api` | QA API evidence | 在 CR 后对 `qa` 给定的有界 HTTP/API claim 采集 redacted runtime evidence，返回 `QA_EVIDENCE_RESULT` |
| `qa-e2e` | QA e2e evidence | 在 CR 后对 `qa` 给定的 UI/e2e flow 运行现有工具链，返回 `QA_EVIDENCE_RESULT` |
| fixer/test-author/provisioner | QA verdict 后的外部闭环 | 在用户授权下修复、补测试或搭环境；完成后可再次请求 QA 复验 |

---

## 5. 编排机制

### 5.1 `qa` 的 CR-first 顺序

- 收到 QA 任务后只做 focused start：bounded target、调用方已提供的 HEAD/ref/diff/touched files、oracle/commitments、明显风险和预算限制。
- 对代码变更立即进入 CR gate。
- 简单小 diff 可由 `qa` inline CR-like read-only review。
- 复杂、高风险或上下文多的 diff 派 `qa-cr`。
- 若没有运行时观察就无法可靠建立 oracle、trigger 或 bounded CR scope，可先取得最小必要 diagnostic evidence；它不替代 mandatory CR，也不免除后续 required verification。
- 如果 `qa-cr` 返回 `status: FAIL` + `gate: stop_and_fail` 且 raw evidence 可复核，或 `qa` inline CR 发现明确 load-bearing FAIL，`qa` 直接输出 `Overall Status: FAIL` 并停止。
- CR 通过或没有阻断代码质量风险后，才进行后续 QA evidence planning。
- 需要有界 runtime HTTP/API evidence 时派 `qa-api`。
- 需要真实 UI/e2e evidence 时派 `qa-e2e`。

### 5.2 `qa-api` 的安全定位

`qa-api` 是隐藏的 leaf HTTP/API runtime 取证 worker。它必须：

- 如实遵守机制边界：bash permission 不能机械保证 loopback-only 或 repository read-only，这两者是必须遵守的 policy boundary，而不是可宣称的隔离能力。
- 只处理 `qa` 给定的 bounded claim，不因为 endpoint 名称、OpenAPI 术语或 auth 名词就自动激活。
- 默认只打 `localhost` / `127.0.0.1` 等 loopback target；external target 需要明确人工批准和 supplied test identity。
- 先验证 target identity；遇到 local -> external redirect 时拒绝 follow，记录观察即可。
- 默认只做 `GET` / `HEAD` / `OPTIONS`；mutation 需显式 method + endpoint、disposable/authorized test data、request budget、cleanup/reset 或 idempotency 约束，条件不清就 BLOCKED 且不发请求。
- redact `Authorization`、`Cookie`、`Set-Cookie`、token/API key 和敏感 body 字段；报告 presence/version identity，不泄露值。
- 可产生 temp/ignored artifacts，但不编辑 repository product files。
- 把 transport unavailable/timeout 记为 BLOCKED，把 objective response mismatch 记为 FAIL；`4xx/5xx` 是观测，不自动失败。
- 只返回 evidence，不输出 `Overall Status:`。

### 5.3 `qa-cr` 的安全定位

`qa-cr` 是值守闭环 QA 内部的 P0 code-review evidence gate。它必须：

- 从 `qa` 的 bounded diff/touched-file assignment 工作，不重写 oracle。
- 先查 assigned diff/touched files，并沿有证据支持的相关关系逐步扩展；不设固定 hop 上限，也不做无依据全项目扫描。
- 重点看 oracle/commitments 是否真实实现，以及回归、边界/错误、状态/并发/cache、API/contract、安全/权限/数据一致性、测试证明力和影响质量的维护性风险。
- 找到 load-bearing FAIL 可立即返回 `gate: stop_and_fail`。
- 证据不足时返回 BLOCKED/limits/recommended_next，不运行 shell，不无限探索。
- 不改代码、不写测试、不做最终 verdict。

### 5.4 `qa-e2e` 的安全定位

`qa-e2e` 是通常在 CR 后使用的 hands-on 浏览器/e2e 取证 worker。它必须：

- 从 `qa` 的 bounded assignment 工作，不扩大成全项目 QA。
- 当 `qa` 无法在没有运行时观察时建立 oracle/trigger/scope 时，也可接受 bounded diagnostic assignment；但 diagnostic 不替代 CR。
- 使用项目已有 UI/e2e 工具链和本地 dev/preview server。
- 优先用项目已有单命令或 `scripts/e2e-runner.mjs` 做受控单次执行，避免失控后台编排。
- 默认不自动安装 runner browser/driver assets；缺失时返回 BLOCKED，由 `qa`/调用方决定是否另行准备，或在 assignment 明确授权且确有需要时再安装后重试。不可安装/升级应用依赖。
- 遵守 exit-code truth：非零 e2e exit code 是 failing evidence，除非该命令/spec 在运行前已被 QA scope 排除。
- 只返回 evidence，不输出 `Overall Status:`。

### 5.5 范围过大时怎么处理

如果 QA 范围或上下文太大，当前分支不使用泛化 shard worker。`qa` 应先用最小 read-only 探查、搜索、传播关系定位、调用方提供的证据，或运行时已有的通用 explore/recon 能力来缩小范围；可以持续沿相关关系深挖，但不要新增 task permission，也不要做无依据全项目扫描。若仍无法把 required evidence 收敛到可验证范围，报告 evidence-needed、residual risk 或 `BLOCKED`。

---

## 6. 降低“不返回上层”风险的四件事

1. **direct child only**：`qa` 可以派直接子 QA subagent，即使 `qa` 自己是 dev/builder 的 subagent。关键是 `qa-cr`、`qa-api` 或 `qa-e2e` 必须直接把 evidence 返回给 `qa`，且它们不能再派 agent。
2. **bounded assignment**：每个 subagent assignment 必须有 diff/flow、oracle、out-of-scope 和证据目标；不得扩大成开放式全项目 QA。
3. **budget/stop condition**：每个 assignment 都有预算和停止条件。CR load-bearing FAIL 可短路后续重型证据；证据不足就返回 BLOCKED/evidence-needed。
4. **structured QA_EVIDENCE_RESULT + timeout/failure fallback**：所有 QA subagent 必须返回 `QA_EVIDENCE_RESULT`。dispatch 不可用、被拒、超时、失败或返回不完整时，`qa` 把对应证据标为 BLOCKED/evidence-needed/environment-needed 或 residual risk，不无限等待，不假 PASS。

标准返回块：

```text
QA_EVIDENCE_RESULT
agent: qa-cr | qa-api | qa-e2e
scope: <bounded diff or flow actually checked>
status: OK | FAIL | BLOCKED | NEEDS_HUMAN_REVIEW
gate: continue | stop_and_fail | need_e2e | need_human | blocked
evidence:
  - <raw command/output/artifact/file-line/log/observed behavior>
limits:
  - <what was not checked and why>
findings:          # optional
  - <finding tied to evidence>
recommended_next: # optional
  - <next evidence/fix/human/environment step>
confidence: <high|medium|low plus reason> # optional
END_QA_EVIDENCE_RESULT
```

---

## 7. 目录结构

```text
qa-skill/
├── SKILL.md                         # QA prior：边界、不变式、verdict 契约
├── README.md                        # 当前开发说明
├── agents/
│   ├── qa.md                        # QA 编排者 agent
│   ├── qa-api.md                    # bounded non-browser HTTP/API evidence worker
│   ├── qa-cr.md                     # P0 quality-oriented CR evidence worker
│   └── qa-e2e.md                    # bounded browser/e2e evidence worker
├── scripts/
│   └── e2e-runner.mjs               # 通用 start -> ready -> test 受控执行器
└── references/
    └── e2e-adapter.md               # qa 与 qa-e2e 的协作约束
```

如果把 `qa-skill` 安装/复制到别处使用，`scripts/e2e-runner.mjs` 也必须一起带上；`qa-e2e` 运行时应从已安装的 `qa-skill` 目录解析 runner 绝对路径，不要假设目标仓库内存在该脚本，也不要复制进目标仓库。

仓库中如存在其他历史 agent/reference 文件，本分支不把它们作为 QA 主路径或推荐产品路径。

---

## 8. Agent 定义要点

### 8.1 `qa`

- `mode: all`：可作为当前会话 agent、`@qa`，或被外层调用方指定运行。
- `permission.edit`：`"*": deny`，仅 `".qa/**": allow`。
- `permission.webfetch / websearch`：`deny`。
- 不配置 shell 执行能力；需要动态证据时依赖已有 evidence、单会话可读证据，或在 CR 后直接派 `qa-api` / `qa-e2e`。
- `permission.task`：`"*": deny` + `"qa-api": allow` + `"qa-cr": allow` + `"qa-e2e": allow`。
- 对 dispatch unavailable/refused/timeout/incomplete result 必须 fallback 为 BLOCKED/evidence-needed/environment-needed/residual risk。

### 8.2 `qa-api`

- `mode: subagent` + `hidden: true`。
- `permission.edit: deny`，`task: deny`，web deny。
- read/grep/glob/codegraph allow；`bash` required。
- deny git mutation and common install commands；不安装依赖、不跟随 local -> external redirect。bash permission 不是 loopback-only / repository-read-only 的机械隔离，二者仍是必须遵守的 policy boundary。
- 默认 localhost/127.0.0.1 only；external target 需人工批准与测试身份。
- 只做 bounded HTTP/API runtime evidence；不编辑产品文件，但可产生 temp/ignored artifacts；必须返回 `QA_EVIDENCE_RESULT`，不输出 `Overall Status:`。

### 8.3 `qa-cr`

- `mode: subagent` + `hidden: true`。
- `permission.edit: deny`，`task: deny`，web deny。
- read/grep/glob/codegraph only；不配置 bash。
- 只做 assigned diff/touched files 及直接邻接的 quality-oriented CR evidence。
- 必须足够早返回：FAIL 短路，OK 带 limits 返回，不无限探索。
- 必须返回 `QA_EVIDENCE_RESULT`，不输出 `Overall Status:`。

### 8.4 `qa-e2e`

- `mode: subagent` + `hidden: true`。
- `permission.edit: deny`，`task: deny`，web deny。
- 可运行本地 e2e/browser 命令和项目已有 dev/preview server。
- 默认不自动安装 runner browser/driver assets；仅在 assignment 明确授权且确有需要时才可安装。不可安装/升级应用依赖。
- 禁止 destructive git 操作，如 commit、push、reset、checkout、clean、rebase、merge。
- 必须返回 `QA_EVIDENCE_RESULT`，不输出 `Overall Status:`。

---

## 9. Verdict 契约

- **`PASS`**：每个必需 commitment 都有可复核证据，且无未决 FAIL/BLOCKED/NHR。
- **`FAIL`**：证据与 oracle 冲突，或承诺项未兑现。
- **`BLOCKED`**：必需检查无法得到客观证据，且已穷尽可行替代路径。
- **`NEEDS_HUMAN_REVIEW`**：已有证据，但正确性取决于业务、安全、设计或主观判断，QA 不能代判。

每份 QA 报告只能有一行：

```text
Overall Status: <PASS | FAIL | BLOCKED | NEEDS_HUMAN_REVIEW>
```

---

## 10. 风险与限制

| 风险/限制 | 影响 | 处理 |
|---|---|---|
| CR 都过不了 | 后续 api/e2e/重型 QA 没意义 | `qa` 复核 CR raw evidence 后直接 `Overall Status: FAIL` |
| `qa` 自身不能执行 shell | 动态验证能力受限 | 使用已有证据、静态/轻量替代路径；必要时在 CR 后直接派 `qa-api` / `qa-e2e` 或标注 residual risk/BLOCKED |
| `qa-api` target/data/cleanup 不清 | mutation 风险不可控 | 不发请求，返回 BLOCKED，由调用方补 target identity/approval/test data/cleanup |
| `qa-api` 默认 local-only | 外部/生产 API 无法默认验证 | 需要明确人工批准与测试身份；否则保持 BLOCKED/残余风险 |
| subagent 不是 `qa` 的 direct child | evidence 可能无法可靠回到 `qa` | 只派 direct child；`qa-cr`/`qa-api`/`qa-e2e` 不再派 agent |
| QA 范围/上下文太大 | 可能无法充分覆盖 | `qa` 先用最小探查/定位缩小范围；仍不可验证则 evidence-needed/residual risk/BLOCKED |
| e2e 环境缺 service/secret/seed/browser asset | 无法证明 UI/e2e 行为 | `qa-e2e` 返回 not runnable 证据；`qa` 给 environment-needed handoff |
| e2e 成本高且易受环境波动影响 | 简单变更可能过度验证 | 只有 CR 后仍有 load-bearing UI/e2e 风险需要时才派发 |
| 默认不联网 | 无法自动读取远端 issue/PR 或外部服务状态 | 把调用方提供的上下文作为数据；缺关键 oracle 时标注 inferred 或 NHR |
| 外部修复/补测试不在 QA 流程内 | QA 不直接闭环代码变更 | verdict 后由用户授权的外部角色处理，处理完再请求 QA 复验 |

---

## 11. 验收标准

### 11.1 当前验证/基准证据

- `npm run test:orchestrator` 已通过：共 61 项；确定性模式下 49 项通过，12 个 opt-in real scenarios 跳过。
- `npm run test:e2e-runner` 已通过（10/10）。
- 12 个 opt-in real paired scenarios 已有通过结果：包括 `qa-api` guided contract `FAIL`、autonomous API `PASS`（含本地实际响应证据）、static-only API-name `PASS`（无不必要 runtime）、external mutation `BLOCKED`（`qa-api` 子证据明确报告未执行请求）、runtime-unavailable `BLOCKED`。
- real model evals 为 opt-in 且依赖环境，不是默认 CI。

- `qa` 能对 bounded 变更输出证据支持的 `Overall Status:`。
- 代码变更必须 CR-first；复杂/有风险/上下文多的 diff 可派 `qa-cr`。
- CR load-bearing FAIL 可让 `qa` 直接 FAIL 并停止后续重型 QA。
- CR 后需要有界 HTTP/API 证据时，`qa` 可直接派 `qa-api`。
- CR 后需要 UI/e2e 证据时，`qa` 可直接派 `qa-e2e`。
- `qa-api`、`qa-cr`、`qa-e2e` 都不输出 `Overall Status:`，都必须返回 `QA_EVIDENCE_RESULT`。
- README/SKILL/agent 定义不把开发修复闭环、泛化 shard worker 或通用 runtime 扫描 worker 作为 QA 产品路径。
