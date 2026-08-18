# QA Guardian — install & run (MVP)

QA Guardian is an **orchestration layer** on top of the existing read-only `qa-skill`. It takes a
GitHub issue labeled `qa-guardian` from *auto-discovered* to *a dev PR a human can review + a full
traceable record*, while keeping every irreversible decision (merging to trunk) with the human, and
stopping high-risk issues one extra time for plan confirmation.

It does **not** modify `qa` / `qa-facet` / `SKILL.md` / `references/*` — it dispatches the read-only
`qa` agent as an independent judge (the guardian never grades its own fix). Full design:
[`docs/qa-guardian-requirements-and-design.md`](../../docs/qa-guardian-requirements-and-design.md).

> **Two ways to run.** Either drive one issue by hand (§15.2, below) or run the always-on resident
> scheduler (§15.1) that polls, enforces N=1, runs the agent, and delivers notifications. The
> Feishu interactive-card notification + card-button callback service (button → `/guardian` comment)
> ship too. Deployment for the scheduler and the cloud callback service is in
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
4. **Bootstrap `.qa/`.** Watch mode requires `.qa/` to exist (state persistence depends on it — an
   explicit opt-in, matching the "never silently create `.qa/`" rule). Create it once:
   ```bash
   mkdir -p .qa/guardian
   ```
   Configure `.qa/guardian/config.json`:
   ```json
   {
     "command_authors": ["your-github-login"],
     "poll_interval_ms": 60000,
     "lease_ms": 1800000,
     "base_branch": "dev",
     "notify_webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/XXXX",
     "notify_channel": "feishu"
   }
   ```

   | key | meaning | default |
   |---|---|---|
   | `command_authors` | **trusted `/guardian` command authors (security, required).** Only these GitHub logins can drive commands; **unset = every command is ignored (fail-closed)** | none |
   | `poll_interval_ms` | resident scheduler poll interval | 60000 |
   | `lease_ms` | N=1 lock lease (heartbeat-renewed while a run is live) | 1800000 |
   | `base_branch` | PR target branch | dev |
   | `notify_webhook` | notification webhook URL (Feishu bot / generic) | none → comment-only |
   | `notify_channel` | `generic` (raw JSON) or `feishu` (interactive card) | generic |

   > Set `command_authors` or **nothing will be approvable** — this is the deliberate fail-closed
   > guard against an arbitrary or forged comment approving a HIGH-risk plan.
5. **Label an issue.** Put the `qa-guardian` label on the GitHub issue you want handled (one-time
   human authorization).

## Run the single-issue chain (MVP, §15.2)

Drive one issue directly through the guardian agent:

```bash
opencode run --agent qa-guardian --dir <repo> \
  "Watch GitHub issue #<n>: investigate the root cause, assess risk, and follow the qa-guardian
   contract — stop at gate 1 only if high-risk, dispatch read-only qa to verify, open a dev PR, and
   stop at gate 2."
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
7. On `PASS`: commit (`fixes #<n>`), push, `gh pr create --base dev`, dual-write the trace (issue
   comment + `.qa/` objective case), write `GATE_2_WAIT`, notify, and **exit**.
8. **Never** merges, **never** closes the issue — the human's merge does that.

### Resuming after a gate (comment commands, §11.2)

Because each run is a one-shot process, you resume by leaving a comment the next poll consumes:

| Comment | Effect |
|---|---|
| `/guardian approve` | (gate 1) fix as planned |
| `/guardian revise <plan>` | (gate 1) fix with your adjustment (`<plan>` is data) |
| `/guardian reject` | (gate 1) stop; issue is handed back (terminal) |
| `/guardian rework <opinion>` | (gate 2) send the PR back for another fix round |
| `/guardian retry` | (handed-back) re-enter the pipeline from scratch |

## Run the resident scheduler (§15.1, unattended)

Instead of driving one issue by hand, run the always-on scheduler on a machine that has
`opencode`, an authenticated `gh`, `git`, and the target repo checked out:

```bash
node tools/guardian/scheduler.mjs --repo <repo>
```

Each tick it lists open `qa-guardian` issues, polls each, picks a single runnable issue under an
**atomic N=1 lock** (heartbeat-renewed for the whole run so a long run is never mistaken for dead),
runs the guardian agent, and **delivers notifications** for gate/STALLED/HANDED_BACK events
(idempotent per state). Full deployment — including the cloud Feishu callback service — is in
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

A true end-to-end run needs a `gh`-authenticated clone with a live labeled issue — run the §15.2
command above against a real repo to validate the full chain.

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
