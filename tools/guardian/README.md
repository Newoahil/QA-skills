# QA Guardian — install & run (MVP)

QA Guardian is an **orchestration layer** on top of the existing read-only `qa-skill`. It takes any
open GitHub issue from *auto-discovered* to *a dev PR a human can review + a full
traceable record*, while keeping every irreversible decision (merging to trunk) with the human, and
stopping high-risk issues one extra time for plan confirmation.

It does **not** modify `qa` / `qa-facet` / `SKILL.md` / `references/*` — it dispatches the read-only
`qa` agent as an independent judge (the guardian never grades its own fix). Full design:
[`docs/qa-guardian-requirements-and-design.md`](../../docs/qa-guardian-requirements-and-design.md).

> **Role vocabulary (see [`docs/qa-guardian-role-architecture.md`](../../docs/qa-guardian-role-architecture.md), normative).**
> The system is described as three roles: the **QA Agent** (the read-only `qa` agent — discovers
> defects and verifies fixes, never writes GitHub), the **Fixer Agent** (the write-capable
> `qa-guardian` agent — fixes and reports the fix, never grades its own fix, never opens the PR or
> merges/closes), and
> the **Guardian Supervisor** (the `scheduler`/`state-router`/`commands` decision layer — owns
> events, state, N=1, the human command gate, the machine QA gate, and PR creation; it is the sole
> writer of the QA verification comment). These are **role names only**: the runtime agent is still
> `qa-guardian`. Discovery is now all-open; `qa-guardian:*` labels are visible projections only, and
> the state machine is unchanged.
> After editing any `qa-skill/agents/*.md`, re-sync to `~/.config/opencode/agents/`.

> **Two ways to run.** Either drive one issue by hand (§15.2, below) or run the always-on resident
> scheduler (§15.1) that polls, enforces N=1, runs the agent, and delivers notifications. The
> Feishu interactive-card notification + **local WebSocket card-button callback** (button →
> `/guardian` comment) ship too. The one-click launcher starts exactly one combined process
> (scheduler + one Feishu WS client); the HTTP callback remains an optional legacy transport.
> Deployment and local setup are in
> [`DEPLOY.md`](./DEPLOY.md).

## What's here

| File | Role | Design ref |
|---|---|---|
| `state.mjs` | `.qa/guardian/<n>.json` schema + read/write + lease | §11A.3, §11B.4 |
| `state-router.mjs` | poll-time dispatch table (dedup + gate recovery + STALLED + author auth) | §11A.2 |
| `commands.mjs` | `/guardian approve\|revise\|reject\|rework\|retry` protocol + trusted-author gate | §11.2 |
| `risk.mjs` | LOW-whitelist + fail-safe-HIGH grading (pure) | §5A |
| `notify.mjs` | dual-channel notify decision (issue comment + webhook), idempotent | §11B.5 |
| `notify-feishu.mjs` | Feishu interactive-card builder (per-state buttons + input) | §11B.5 |
| `notify-io.mjs` | notification delivery (gh comment + curl webhook) + orchestration | §11B.5 / FR-21 |
| `poll.mjs` | single-issue entry: read state → route → print action/invocation | §15.2 |
| `scheduler.mjs` | resident watch loop: list → poll → planTick → notify + run (N=1) | §15.1 |
| `scheduler-core.mjs` | pure N=1 tick planning (which issue to run, which to notify) | §15.1 |
| `dashboard.mjs` | 只读中文仪表盘：查看当前队列、状态、下一步会话查看命令 | — |
| `session-view.mjs` | 只读中文 OpenCode 会话查看器：按 session 或 issue/agent 查看真实对话 | — |
| `lock.mjs` | atomic N=1 lock (exclusive-create + heartbeat + owner release) | §11B.4 |
| `feishu-callback.mjs` | Feishu signature verify + card-action parse + verb whitelist | §11B.5 |
| `callback-handler.mjs` | callback request handling (verify → parse → comment, dedup) | §11B.5 |
| `callback-server.mjs` | HTTP boundary for the cloud callback service | §11B.5 |
| `github-comment.mjs` | REST PAT issue-comment client (cloud, no `gh`) | §12 |
| `secrets.mjs` | env-first secret loader (gitignored file fallback) | — |

The write-capable agent itself is [`qa-skill/agents/qa-guardian.md`](../../qa-skill/agents/qa-guardian.md).

## Prerequisites

1. **Install the agents.** Copy the QA agents to your opencode agents dir so `qa-guardian`, `qa`, and
   `qa-facet` are all available:
   - `qa-skill/agents/qa-guardian.md`, `qa.md`, `qa-facet.md` → `~/.config/opencode/agents/`
   - `qa-skill/` → `~/.config/opencode/skills/qa-skill/`
2. **Enable the 3-level chain.** The repo ships [`opencode.json`](../../opencode.json) with
   `subagent_depth: 2`, which lets `qa-guardian → qa → qa-facet` nest. Without it, `qa` still covers
   its facets serially (coverage preserved, only parallelism lost — see `references/using-qa.md`).
3. **Authenticate `gh`.** All GitHub reads/writes go through the `gh` CLI (the guardian never reaches
   the network directly). Verify before running: `gh auth status`. Without it, the guardian is
   `BLOCKED` and hands back.
3a. **Install the official Feishu SDK for the combined runtime.** From the QA-skills root run
    `npm install`. Set `FEISHU_APP_ID` + `FEISHU_APP_SECRET` to enable the local WebSocket; set
    `FEISHU_WS_ENABLED=false` for scheduler-only mode.
4. **Bootstrap `.qa/`.** Watch mode requires `.qa/` to exist (state persistence depends on it — an
   explicit opt-in, matching the "never silently create `.qa/`" rule). Create it once:
   ```bash
   mkdir -p .qa/guardian
   ```
    Configure `.qa/guardian/config.json`:
    ```json
    {
      "github_repo": "owner/repo",
      "watch_mode": "new-open",
      "command_authors": ["your-github-login"],
     "poll_interval_ms": 60000,
     "lease_ms": 1800000,
     "base_branch": "dev",
     "notify_webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/XXXX",
      "notify_channel": "feishu",
       "investigation_mode": "enforced",
       "models": {
         "default": "your-provider/your-model",
         "fixer": "your-provider/your-strong-model",
         "qa": "your-provider/your-strong-model",
         "guardian-code": "your-provider/your-strong-model",
         "guardian-docs": "your-provider/your-fast-model",
         "plan": "your-provider/your-strong-model"
       },
       "fallback_models": ["your-provider/your-backup-model"],
       "capabilities": {
        "codegraph": false,
        "context7": false,
        "git_history": true,
        "local_runtime": true,
        "plan_critic": true,
        "sybermem": false,
        "runtime_probe": "restricted"
      },
      "agents": {
        "guardian_code": true,
        "guardian_business": true,
        "guardian_runtime": true,
        "guardian_docs": true,
        "guardian_history": true,
        "guardian_plan_critic": true
      },
      "memory": {
        "provider": "none",
        "recall_before_investigation": true,
        "recall_before_plan": true,
        "record_after_gate2": false,
        "record_failures": false,
        "max_recall_items": 5
      },
      "skills": {
        "disabled": []
      }
   }
   ```

    | key | meaning | default |
    |---|---|---|
    | `github_repo` | GitHub repository in `owner/name` form; the launcher infers it from `origin` or asks interactively | inferred/required |
     | `watch_mode` | deprecated compatibility field; all OPEN issues are now candidates | ignored |
     | `command_authors` | **trusted `/guardian` command authors (security, required).** Must be a non-empty JSON array of exact GitHub login names, e.g. `["goudaren0528"]`; the launcher asks for it on first setup, normalizes a scalar entry, and checks it against the current `gh api user` login. A wrong login means every command is ignored (fail-closed) and startup stops with a direct fix message. | none |
     | `poll_interval_ms` | resident scheduler poll interval; config may override the code default. 10s is responsive for one local project; use 30000+ when watching multiple projects or reducing GitHub API traffic. | 10000 |
   | `lease_ms` | N=1 lock lease (heartbeat-renewed while a run is live) | 1800000 |
    | `specialist_timeout_ms` / `investigation_budget_ms` / `child_timeout_ms` | investigation-phase timeouts; **0 = unlimited** (durations are recorded as telemetry instead of force-killing) | 0 (unlimited) |
    | `fixer_deadline_ms` | Fixer SDK session deadline (polling bound; must be > 0) | 3600000 (60 min) |
    | `qa_deadline_ms` | QA SDK session deadline (polling bound; must be > 0) | 3600000 (60 min) |
   | `base_branch` | PR target branch | dev |
    | `notify_webhook` | notification webhook URL (Feishu bot / generic) | none → comment-only |
    | `notify_channel` | `generic` (raw JSON) or `feishu` (interactive card) | generic |
    | `investigation_mode` | `legacy`, `shadow`, or `enforced` dossier/plan migration mode | enforced |
    | `models` | **optional per-role model map, keyed by role** (`fixer`, `qa`, `qa-facet`, `plan`, `guardian-code`/`business`/`runtime`/`docs`/`history`/`plan-critic`, plus a `default` catch-all). Values are your own OpenCode `provider/model` strings — the repo hardcodes none. Any unset role falls back to `models.default`, then to the OpenCode agent/global default, so Guardian runs out of the box on any provider even with no `models` block. | none (use global default) |
    | `fallback_models` | optional ordered list of `provider/model` strings tried in turn when a prompt hits a provider cooldown / 429 | none |
    | `capabilities` | optional read-only integrations and specialist capability flags | safe defaults |
    | `agents` | per-specialist switches; set an agent key to `false` to skip it | enabled |
    | `memory` | optional engineering-memory provider settings; SyberMem is opt-in | disabled |
    | `skills.disabled` | names of optional Guardian agents/skills to exclude from selection | none |

    > Set `command_authors` in the per-project launcher binding or **nothing will be approvable** —
     > this is the deliberate fail-closed guard against an arbitrary or forged comment approving a
     > HIGH-risk plan. The value must match the exact login returned by `gh api user --jq .login`,
     > not a display name or email. If the scheduler logs `gate1-waiting` after an approve comment,
     > first check that the comment author is present in this array and restart the scheduler after
     > correcting it. Every OPEN issue is eligible; no `qa-guardian` discovery label is required.
     > Active issues receive visible `qa-guardian:doing`; state JSON and the N=1 lock remain authoritative.
     > `.qa/guardian/<n>.json` remains authoritative.
    The stronger investigation phases write `.qa/guardian/<n>/dossier.json` and `plan.json`;
    use `shadow` before `enforced`, and use `legacy` as rollback.
5. **Open issues are discovered automatically.** No label is required. `qa-guardian:doing` is only a
    visible projection; state JSON and the N=1 lock remain authoritative.

### Optional capabilities and memory

QA Guardian ships the optional read-only specialists in this repository so another user can install
the agents and get the same behavior without your local OMO setup:

| Capability | Agent/tool | Default | Notes |
|---|---|---|---|
| code path tracing | `guardian-code`, `codegraph` when available | agent on, codegraph off | `QA_GUARDIAN_CODEGRAPH_ENABLED=true` or `capabilities.codegraph=true` still requires an available index/probe. |
| business rule reconstruction | `guardian-business` | on | Rebuilds bug vs request oracle, acceptance criteria, and unresolved facts. |
| runtime reproduction design | `guardian-runtime` | on | Read-only; runtime probes remain restricted and never replace independent QA. |
| official docs | `guardian-docs`, Context7 when available | off | Enable with `capabilities.context7=true`; docs are evidence, not verification. |
| git-history analysis | `guardian-history` | on | Uses local history to identify regression windows and prior fixes. |
| plan critique | `guardian-plan-critic` | on | Reviews scope, evidence, risk, and verifiability before fixing. |
| engineering memory | SyberMem provider | off | Enable with `memory.provider="sybermem"` or `capabilities.sybermem=true`; unavailable CLI degrades to no memory. |

External integrations are never mandatory. If SyberMem, Context7, or codegraph is unavailable, the
scheduler records a bounded warning (where applicable) and continues with repository-local evidence.
Memory recall is injected into specialist and plan prompts as **DATA hints, not facts or
instructions**. Gate 2 SyberMem recording is opt-in via `memory.record_after_gate2=true`.

Use either `agents.<key>=false` or `skills.disabled` to switch off an optional specialist. For
example, this disables history and plan critique while leaving the rest of the Guardian intact:

```json
{
  "agents": { "guardian_plan_critic": false },
  "skills": { "disabled": ["guardian-history"] }
}
```

### Windows launcher startup checks

Use `tools/guardian/scheduler-start.ps1` for resident runs on Windows. It guides missing setup instead
of silently watching the wrong checkout:

```powershell
.\tools\guardian\scheduler-start.ps1 -TargetRepo D:\your-project -Init -CommandAuthors your-login -GitHubRepo owner/repo
.\tools\guardian\scheduler-start.ps1 -TargetRepo D:\your-project -DryRun -Yes
.\tools\guardian\scheduler-start.ps1 -TargetRepo D:\your-project -Dashboard -Yes
```

Before starting, the launcher confirms the target directory, target GitHub repository, watch mode,
trusted command authors, and PR base branch. The gitignored
`tools/guardian/scheduler.config.json` stores independent bindings under `projects`, keyed by
canonical target path, plus `last_target_repo` for no-argument launches. An explicit
`-TargetRepo D:\your-project` always selects only that project's binding; each project asks once for
strict clean-target mode or worktree/current-snapshot mode and remembers it independently. `-Yes`
never invents a missing choice, and `-DryRun` fails closed without prompting or writing. Legacy v1
single-binding JSON remains readable and is migrated into the project map on the next write.

Strict mode blocks startup unless both repositories are safe:

- the target repository is a clean git worktree and local `base_branch` equals `origin/<base_branch>`;
- this QA Guardian tools repository is a clean git worktree; if its active branch is behind or differs
  from its upstream, the launcher prints a warning and continues with the local tool version;
- `gh auth status` succeeds and `gh repo view <github_repo>` is accessible.

Worktree mode uses a persistent clean control worktree for authoritative `.qa/guardian` state and a
separate clean QA snapshot. The snapshot receives `git diff HEAD --binary` plus only explicitly selected
repository-relative runtime input files. It never copies `.git`, `.qa/guardian`, `node_modules`, or
arbitrary untracked/ignored files; differing destination files fail closed. Fixer, Supervisor, state,
PR, GitHub comments, and dashboard/session resolution use control; read-only investigation specialists
use the QA snapshot. The canonical target checkout is never modified.

`-DryRun` prints the resolved launch plan and current dirty status without creating worktrees/snapshots
or running `git fetch`; it reads existing local refs only.
If no persisted binding exists, `-DryRun` exits immediately with Chinese guidance to run the scheduler
once interactively; it never prompts or writes the binding.
`guardian-runtime.mjs` and `scheduler.mjs` remain non-interactive lower-level entrypoints.
`-Dashboard` is read-only: it resolves the authoritative control worktree, does not create
worktrees/snapshots, and skips GitHub preflight.

## 查看值守进度（中文只读仪表盘）

当常驻 scheduler 在跑时，另开一个终端查看队列和会话入口：

```bash
node tools/guardian/dashboard.mjs --repo <repo>
node tools/guardian/dashboard.mjs --repo <repo> --watch 5
node tools/guardian/dashboard.mjs --repo <repo> --issue 42
```

仪表盘只读取 `<repo>/.qa/guardian/*.json`，不会写状态、不会发 GitHub 评论、不会批准或打回
任何闸门。它会显示每个 issue 的状态、风险、轮次、分支、更新时间，并在底部提示下一步查看会
话的命令。

要看具体 agent 的真实 OpenCode 对话，使用会话查看器：

```bash
node tools/guardian/session-view.mjs --repo <repo> --issue 42 --agent fixer
node tools/guardian/session-view.mjs --repo <repo> --issue 42 --agent qa
node tools/guardian/session-view.mjs --repo <repo> --issue 42 --agent code
node tools/guardian/session-view.mjs --session ses_abc123 --full
```

`--agent` 支持 `fixer`、`qa`，也支持 `.qa/guardian/<issue>.json` 里记录的专家角色名，例如
`code`、`business`、`runtime`、`docs`、`history`、`plan-critic`。会话内容通过 OpenCode SDK
`getMessages(sessionId)` 读取；如果服务没启动，请先运行 `opencode serve`，或用 `--base-url`
指定地址。所有错误都会用中文给出「问题 / 原因 / 下一步」。

Windows 上也可以直接双击两个 bat 分开启动，日常入口严格只有两个：`tools/guardian/scheduler-start.bat` 负责值守，
`tools/guardian/dashboard-start.bat` 负责只读 Dashboard（内部调用 `dashboard-start.ps1` 解析 node）。两个 bat 都可传目标项目路径；显式路径只切换到该项目的 binding，不会复用另一项目的 control worktree 或配置。无参启动时会交互要求输入本次目标目录，避免误监控上次项目。

如果希望一次双击同时启动 scheduler 和新的单终端 TUI，使用组合入口：

```text
tools\guardian\guardian-start.bat D:\tuantuanrent
```

它会打开两个窗口：scheduler 在独立 PowerShell 窗口持续值守，当前窗口进入只读 TUI。TUI 中按 `q` 只退出视图，不会停止 scheduler；需要停止值守时，在 scheduler 窗口按 `Ctrl+C`。组合入口只读取已有项目 binding，不会重复询问模式或 `command_authors`；新项目首次使用前，先运行一次 `scheduler-start.bat D:\tuantuanrent` 完成初始化。

### 单终端只读 ANSI TUI（独立入口）

如果想在一个终端里同时看队列、详情和上下文，可以使用新的只读 TUI：

```bash
node tools/guardian/dashboard-tui.mjs --repo <repo>
node tools/guardian/dashboard-tui.mjs --repo <repo> --refresh 8
npm run guardian:dashboard:tui -- --repo <repo>
```

特性与边界：

- 启动前会先通过 `resolveViewerRepo` 找到 authoritative control repo，再读取 `.qa/guardian`。
- **严格只读**：只读 issue state、artifact 文件和 OpenCode transcript；不会写 state、不会发 GitHub 评论、不会改 git、不会触发 approve/retry/rework/reject。
- 三栏单终端布局：左侧 issue queue，中间 selected issue details，右侧 context tabs。
- 右侧标签页：`1 摘要`、`2 transcript`、`3 logs`、`4 产物/错误`。
- transcript 通过现有 OpenCode 读取链路获取；如果 OpenCode 不可达，会在右栏直接显示中文问题/原因/下一步。
- 适配 Windows Terminal / PowerShell 5.1：只使用 Node built-ins + 原生 ANSI alternate screen/raw mode，不增加依赖。
- 非 TTY 环境不会强行进入 raw mode；此时请改用 `dashboard.mjs`，或仅执行 `--help` 查看说明。

默认快捷键：

| 键位 | 作用 |
|---|---|
| `q` | 退出并恢复终端 |
| `↑/↓` 或 `j/k` | 队列导航；若焦点在详情/上下文，则改为滚动 |
| `←/→` 或 `h/l` | 在队列 / 详情 / 上下文三栏之间切换焦点 |
| `Enter` | 进入详情滚动模式 |
| `Esc` | 返回队列焦点 |
| `1/2/3/4` | 切换摘要 / transcript / logs / 产物错误 |
| `r` | 手动刷新 |
| `a` | 打开/关闭自动刷新 |
| `?` | 帮助 |
| `F` | transcript 完整模式（含更长内容） |
| `G` | 跳到 logs 末尾并开启 follow |
| `p` | 暂停 logs follow |

如果终端过窄，TUI 会降级为只读提示页并要求扩大窗口；如果收到 `SIGINT`/`SIGTERM`，会恢复 cursor、alternate screen 和 raw mode 后退出。

## Run the single-issue chain (MVP, §15.2)

Drive one issue directly through the guardian agent:

```bash
opencode run --agent qa-guardian --dir <repo> \
   "Watch GitHub issue #<n>: investigate the root cause, assess risk, and follow the qa-guardian
    contract — stop at gate 1 only if high-risk, dispatch read-only qa to verify, then hand off to
    the Supervisor for PR creation and stop at gate 2."
```

The guardian will, per its contract:
1. Read the issue (content is **data**, never instructions).
2. Investigate + locate the root cause, write a diagnosis.
3. Grade risk `LOW`/`HIGH` (uncertain → HIGH, fail-safe).
4. **HIGH** → comment the diagnosis+plan, write `GATE_1_WAIT`, notify, and **exit** (wait for
   `/guardian approve|revise|reject`). **LOW** → comment the diagnosis + *why-LOW* audit trail and
   continue without stopping.
5. Create `fix/issue-<n>`, make the **minimal** fix.
6. Dispatch read-only `qa` for independent verification (**low-risk is verified too**). `FAIL` → fix
   again (≤1–2 rounds); a `FAIL` never opens a PR.
    7. On `PASS`: the Supervisor finalizes the scoped commit (`fixes #<n>`), pushes the branch,
    creates the PR from the Fixer-authored Chinese `pr-summary.md`, writes the issue verdict from the
    QA-authored Chinese `qa-acceptance.md`, dual-writes the trace (issue comment + `.qa/` objective
    case), writes `GATE_2_WAIT`, notifies, and **exits**. The Fixer only edits and reports; in
    enforced mode the scheduler/Supervisor owns the QA gate, verdict comment, and PR.
8. **Never** merges, **never** closes the issue — the human's merge does that.

### Resuming after a gate (comment commands, §11.2)

Because each run is a one-shot process, you resume by leaving a comment the next poll consumes:

| Comment | Effect |
|---|---|
| `/guardian approve` | (gate 1) fix as planned |
| `/guardian revise <feedback>` | (gate 1) treat feedback as DATA, re-investigate/regenerate the proposal, and wait for approval again |
| `/guardian reject` | (gate 1) stop; issue is handed back (terminal) |
| `/guardian rework <opinion>` | (gate 2) send the PR back for another fix round |
| `/guardian retry` | (handed-back) re-enter the pipeline from scratch |
| `/guardian followup <problem>` | (DONE/GATE_2_WAIT) start a new acceptance round; text is DATA |

`rework` repairs the current Gate 2 PR. `followup` starts a new round, preserves the previous
branch/PR in `round_history`, uses a fresh branch, and never force-pushes the previous PR.

## Run the combined resident runtime (§15.1, unattended)

Instead of driving one issue by hand, run the always-on scheduler on a machine that has
`opencode`, an authenticated `gh`, `git`, and the target repo checked out:

```bash
npm install
node tools/guardian/guardian-runtime.mjs --repo <repo>
```

Each tick it lists open `qa-guardian` issues, polls each, picks a single runnable issue under an
**atomic N=1 lock** (heartbeat-renewed for the whole run so a long run is never mistaken for dead),
runs the guardian agent, and **delivers notifications** for gate/STALLED/HANDED_BACK events
(idempotent per state). The same process also maintains one Feishu WebSocket connection when
`FEISHU_APP_ID` + `FEISHU_APP_SECRET` are present. Full setup — including the optional legacy
HTTP callback service — is in
[`DEPLOY.md`](./DEPLOY.md).

## Poll routing (what the scheduler calls)

`poll.mjs` is the deterministic decision the scheduler runs per issue. It reads the issue's state +
GitHub facts and prints the action + the next guardian invocation:

```bash
node tools/guardian/poll.mjs --repo <dir> --issue <n> [--lease-ms 1800000]
# → {"issue":42,"action":"RESUME","toState":"FIXING","invoke":"opencode run --agent qa-guardian ..."}
```

Actions: `START` (new), `SKIP` (dedup / waiting / terminal), `RESUME` (consume a gate command),
`STALLED` (lease expired → auto-rerun idempotent stage or hand back), `DONE` (human merged),
`HANDED_BACK`.

## Tests

Deterministic logic (routing, risk grading, command parsing, notify idempotency, state round-trip) is
unit-tested with `gh`/`curl` stubbed:

```bash
node --test "tests/guardian/*.test.mjs"
```

A true end-to-end release gate needs a `gh`-authenticated clone with at least one open issue and a
live shared OpenCode server. Before treating a release as validated, run the resident scheduler against
a real repository and record evidence for this checklist:

- all-open discovery: an open issue without `qa-guardian` is listed as a candidate and claimed under N=1;
- investigation and plan artifacts: `.qa/guardian/<issue>/dossier.json` and `plan.json` are written;
- fixer/QA gate: fixer completion is followed by independent QA, and PR finalization happens only after QA PASS;
- GitHub effects: branch push, PR creation, and the issue verdict comment are present and linked;
- human stop: the run ends in `GATE_2_WAIT`; it does not merge or close the issue automatically;
- observability: dashboard/session-view can show the issue state and relevant OpenCode session ids.

## Safety model (why this is trustworthy unattended)

- **Command authorization (fail-closed).** Only `/guardian` commands from a login in
  `command_authors` are honored; an unconfigured whitelist honors nothing. A forged/replayed Feishu
  callback comment or an arbitrary repo commenter cannot approve a plan — the poller checks the
  comment author, and the cloud callback identity must itself be in `command_authors` to take effect.
- **Separation of powers.** The guardian writes code; the **read-only `qa`** (mechanically unable to
  edit) judges it. The guardian's `task` whitelist is `qa` + `explore` only — it cannot dispatch a
  write-capable agent to grade for it.
- **Asymmetric risk grading.** LOW requires *every* whitelist clause; uncertainty is always HIGH; low
  risk still gets full independent QA and still stops at gate 2. Merge is always the human's.
- **No auto-merge / no auto-close.** Guaranteed first by **gate 2 itself** (the guardian exits after
  opening the PR), with `gh pr merge/close: deny` as a second line of defense.
- **Never idle-hangs.** Any need for human input becomes an explicit waiting/terminal state + comment
  + notification + exit — never a silent stall (§11B.6).
- **Agent-written prose, supervisor-checked.** The Fixer writes `.qa/guardian/<n>/pr-summary.md` and
  QA writes `.qa/guardian/<n>/qa-acceptance.md` in Chinese. Gate 2 refuses to publish missing,
  non-Chinese, incomplete, command-injecting, or secret-looking prose; the Supervisor only appends
  machine facts such as commit SHAs, PR URL, status, and report hash.
