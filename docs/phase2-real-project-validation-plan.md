# Phase 2 真实项目 Skill first 基准验证协议

**状态：** 当前 draft corpus 已冻结，真实运行已尝试三轮，但尚未形成有效的 Skill-vs-Baseline effectiveness 结果。`run-20260804-01` 因 provider reasoning 配置无效，`run-20260804-02` 因证书错误被旧 harness 错误计分而作废，`run-20260804-03` 在修复后正确 fail-closed。
**评估对象：** 现有 Phase 2 Skill pack，不是新的生产 runtime。
**结论边界：** 当前 draft corpus 不能支持任何已批准的 effectiveness claim。

## 1. 范围与边界

本协议只定义真实项目 benchmark 的执行合同，不定义生产 runtime、策略引擎、qa runtime、语言适配器或通用测试平台。

Harness 只做四件事。它读取冻结的 draft manifest，按同一请求调用现有 OpenCode，比较 Baseline arm 和 Skill arm，最后把结果写成可审计 artifacts。

Harness 不做这些事。它不决定项目该跑什么测试，不安装依赖，不 clone 或 fetch，不访问网络或凭证，不修改原始 corpus，不修改 Skill 源，也不把一次运行包装成统计显著性结论。

## 2. 冻结 Corpus

当前冻结的 corpus 位于 `benchmarks/real-projects/manifest.json`，corpus root 是 `C:\Users\lhw\AppData\Local\Temp\opencode\qa-skill-real-project-corpus`。

这份 draft manifest 里有 3 个 pair，分别是 2 个真实 Node PR pair 和 1 个 Python public fix pair。具体 pairId 是 `dig-create-app-node22-test-path-pr4`、`dig-create-app-chip0007-collection-type-pr2`、`claude-skill-check-single-character-name-fix`。

manifest 现在的状态是 `draft`，所以它没有 approval record。approval person 和 approval time 只在把 manifest 升到 `approved` 时才需要补齐。

这也意味着两件事。第一，当前 corpus 只是允许执行 benchmark，不表示项目质量已经被背书。第二，draft corpus 不能支持已批准的 effectiveness claim。

## 3. 执行合同

真实 benchmark 只通过显式 opt in 打开。

1. `QA_SKILL_PHASE2_BENCHMARK_RUNS=1`
2. `--allow-real-project-benchmark`
3. `QA_SKILL_OPENCODE_BIN` 指向已校验的直连 OpenCode 可执行文件
4. `--provider-config C:\Users\lhw\.config\opencode\opencode.json` 或 `QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH`
5. `--manifest`
6. `--corpus-root`
7. `--artifact-root`
8. `--comparison-threshold`
9. 可选 `--pair`
10. 可选 `--snapshot`

模型、agent 和 timeout 由 manifest 的 `runConfig` 固定，Baseline 和 Skill 两个 arm 必须共享同一组值。它们不会再通过环境变量覆盖。也不要再引入 `QA_SKILL_BENCHMARK_MODEL`、`QA_SKILL_BENCHMARK_AGENT` 或 `QA_SKILL_BENCHMARK_TIMEOUT_MS` 这类旧 knob。

Benchmark 只接受直接 argv。它会把 `directArgvArrays` 当成普通 Node 或 Python 命令行参数列表原样执行，不经过 qa runtime 包装，也不经过语言适配器层。

Provider 配置只做本地、provider-only 隔离读取。Harness 只从 `C:\Users\lhw\.config\opencode\opencode.json` 或 `QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH` 指向的文件里提取与 manifest model `cpa` 匹配的 provider 定义，然后通过 `OPENCODE_CONFIG_CONTENT` 传给 OpenCode。它不会带入 host plugins、MCPs、skills、其他 provider 定义或任何 credential 值；provider 相关值只以 redacted 形式出现在 artifacts 中。

每个 arm 只允许 1 次 primary run，`retryPolicy` 固定为 `none`，`attempt` 和 `maxAttempts` 都是 1。没有自动重试，也不允许因为结果不好再静默重跑。

## 4. Artifacts 与 authority

每个 run 都会写出 redacted evidence 和 assessor only oracle。`oracle.json` 是 assessor only，它记录的是运行后独立检查的结果，不进入模型输入。

每个 run 目录至少会有这些文件。

1. `manifest.json`
2. `prompt-metadata.json`
3. `terminal.json`
4. `raw-stdout.jsonl`
5. `stderr.txt`
6. `events.json`
7. `final-message.md`
8. `final-report.md`
9. `command-evidence.json`
10. `model-command-evidence.json`
11. `relevant-model-command-evidence.json`
12. `model-command-events.json`
13. `agent-topology.json`
14. `parent-boundary-evidence.json`
15. `child-report-relay-evidence.json`
16. `report-authority-evidence.json`
17. `oracle.json`
18. `postflight.json`
19. `scorecard.json`
20. `cleanup.json`
21. `failure.json`，只在失败时出现

每个 evidence cycle 还会写出这些顶层 outputs。

1. `corpus-manifest.json`
2. `run-order.json`
3. `scorecards/`
4. 每个 snapshot 的 `comparison.json` 和 `comparison.md`
5. 每个 pair 的 `comparison.json` 和 `comparison.md`
6. `benchmark-summary.md`
7. `limitations.md`

`corpus-manifest.json` 也是 assessor only。它只记录 corpus truth，不是给模型看的 prompt 材料。`scorecards/`、`benchmark-summary.md` 和 `limitations.md` 都是 cycle 级交付，不能当成已批准 effectiveness claim 的证据。

## 5. 确定性验证命令

下面这两个命令是确定性的测试入口。它们只验证合同和 fail-closed 行为，不代表已经取得有效的真实 benchmark 效果结论。

```powershell
node --test tests/functional-validation/real-project-benchmark-contracts.test.mjs
node --test tests/functional-validation/real-project-benchmark.test.mjs
```

## 6. 真实运行命令

下面这个命令是外部证书问题恢复后启动新 evidence cycle 的 PowerShell 模板。已有三轮 campaign 证据必须保留；再次执行会消耗模型成本，并且必须使用全新的空 artifact root。

```powershell
$env:QA_SKILL_PHASE2_BENCHMARK_RUNS = '1'
$env:QA_SKILL_OPENCODE_BIN = 'C:\path\to\opencode.exe'
$env:QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH = 'C:\Users\lhw\.config\opencode\opencode.json'
node tests/functional-validation/real-project-benchmark.mjs --allow-real-project-benchmark --provider-config C:\Users\lhw\.config\opencode\opencode.json --manifest benchmarks/real-projects/manifest.json --corpus-root C:\Users\lhw\AppData\Local\Temp\opencode\qa-skill-real-project-corpus --artifact-root C:\works\QA-skills\test-results\real-project-benchmark-NEW-CAMPAIGN --comparison-threshold 5
```

如果只想跑某个子集，可以再加 `--pair <pairId>` 或 `--snapshot <snapshotId>`。这两个过滤器只缩小 scoped primary execution，不改变 manifest 的冻结内容，也不改变 draft corpus truth。`runId`/run identity 目录不会被覆盖；要开始另一轮 evidence cycle，必须换一个新的 artifact root。

## 7. 评分和比较边界

比较阈值是显式参数，不藏在环境变量里。当前文档对应的阈值是 `5`。

`oracle.json` 和 `corpus-manifest.json` 一起构成 assessor side truth。它们都不会把原始模型输出当成权威答案，也不会把 draft corpus 伪装成已批准结果。

独立评分和比较可以产生 `tie`、`no_improvement` 或 `inconclusive`。它们都不等于 approved effectiveness claim。
