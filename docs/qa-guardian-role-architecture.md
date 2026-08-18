# QA Guardian — role architecture & cross-role protocol (normative)

> **This document is the normative source of truth** for the three-role split, the role→artifact
> mapping, and the verdict→Supervisor→GitHub protocol. Agent files and operator docs summarize it
> and defer to it on any conflict.
>
> **Phase 1 scope:** role vocabulary and boundary contracts only. No runtime string changes, no new
> runnable agent, no GitHub-label changes, no state-machine changes, no GitHub-App split, no
> webhook. Those are explicitly Phase 2/3/4 (see "Phase boundaries").

---

## 1. Why three roles

A single all-in-one agent that investigates, fixes, grades, and merges has no real gate — one lapse
(prompt injection via issue text, a model misstep) can carry a bad change all the way to trunk. The
system is therefore split into three roles that **mechanically constrain each other**, so no single
compromised or distracted step can cross the next boundary.

| Role | Executed by (Phase 1) | Write power | Core job |
|---|---|---|---|
| **QA Agent** | [`qa.md`](../qa-skill/agents/qa.md) (unchanged) | Read-only (welded) | Discover defects, verify fixes, emit a verdict. Never edits product code, never writes GitHub. |
| **Fixer Agent** | [`qa-guardian.md`](../qa-skill/agents/qa-guardian.md) (unchanged) | Write (code + fix-trace comments + PR) | Locate root cause, make the minimal fix, self-test via QA, hand off a PR. Never grades its own fix, never merges/closes, never writes the QA verdict comment. |
| **Guardian Supervisor** | [`scheduler-core.mjs`](../tools/guardian/scheduler-core.mjs) + [`state-router.mjs`](../tools/guardian/state-router.mjs) + [`commands.mjs`](../tools/guardian/commands.mjs) + [`scheduler.mjs`](../tools/guardian/scheduler.mjs) (unchanged) | Orchestration + sole GitHub-verdict writer | Own events, state, N=1 concurrency, idempotency, the human command gate, the machine QA gate, and PR creation in enforced mode. Never writes product code. |

**Role names are vocabulary.** In Phase 1 the QA Agent *is* the `qa` agent, the Fixer Agent *is*
the `qa-guardian` agent, and the Supervisor *is* the existing scheduler/router/commands decision
layer. No file is renamed; no new runnable agent is introduced.
[`fixer-agent.md`](../qa-skill/agents/fixer-agent.md) is a role-contract doc (no frontmatter, not
runnable). There is no `qa-agent.md` and no `guardian-supervisor.md` runnable agent in Phase 1.

---

## 2. The load-bearing invariant: the fixer never grades its own fix

The safety root of the whole system is one rule: **the role that changes code can never issue the
PASS verdict on that change.** This is enforced by mechanism, not discipline:

- The **QA Agent** has `edit: "*": deny` and `git commit/push: deny` — it *cannot* edit code, so a
  PASS from QA can never have been self-authored by whoever wrote the fix.
- The **Fixer Agent** has a `task` whitelist of `qa` + `explore` only — it *cannot* dispatch a
  write-capable agent to "grade" for it, and it *cannot* merge/close (`gh pr merge` / `gh issue
  close` denied).

If either boundary is weakened, the invariant is gone. **No Phase 1 change may add any `gh` write
permission to the QA Agent, or add any grading path to the Fixer.**

---

## 3. The verdict → Supervisor → GitHub protocol

This is the protocol Phase 2 will implement in code; Phase 1 fixes it as a contract.

```
QA Agent (read-only)
   │  produces a LOCAL artifact only
   ▼
.qa/guardian/<n>/qa-verdict.json   { status: PASS|FAIL|BLOCKED, issue, branch,
   │                                 verified_at, report_hash, evidence_summary }
   ▼
Guardian Supervisor (sole GitHub-verdict writer)
   ├─ validates the artifact via the machine QA gate (status must be exactly PASS)
   ├─ translates it into the GitHub verification comment: [QA_VERIFIED] / [QA_FAILED]
   └─ in enforced mode, owns `gh pr create` after a PASS
```

**Hard rules:**

1. **QA never writes GitHub.** QA's only output is the local `qa-verdict.json` artifact (plus its
   report). It has zero GitHub side effects — this keeps QA a clean, independent judge and keeps the
   injection surface small.
2. **The Supervisor is the sole writer of the `[QA_VERIFIED]` / `[QA_FAILED]` comment.** It derives
   that comment from the validated artifact. Neither QA nor the Fixer writes it.
3. **The Fixer's GitHub writes are fix-trace only** (diagnosis / audit-trail / PR-trace). The Fixer
   never writes the verification verdict comment.
4. **Agent status markers are facts, not authorizations.** `[QA_VERIFIED]`, `[FIXER_PR_OPENED]`,
   etc. (a Phase 2 comment vocabulary) report state; they never drive a `/guardian` authorization
   transition. Human `/guardian approve|revise|reject|rework|retry` commands remain the only
   authorization channel, gated by the `command_authors` trusted-author whitelist (fail-closed:
   empty whitelist authorizes nothing). Bot-authored status markers must never enter that
   authorization whitelist — see [`commands.mjs`](../tools/guardian/commands.mjs).

---

## 3A. Phase 2 comment-protocol grammar (normative)

Phase 2 implements the protocol of §3 as standardized GitHub issue/PR comments. This section fixes
the exact wire format so the builder (`tools/guardian/verdict-comment.mjs`) and the parser side stay
in agreement, and so the injection-safety boundary is unambiguous.

### 3A.1 Marker vocabulary

Every protocol comment begins with a **marker line**: a single bracketed uppercase token on its own
line, at the start of the comment.

| Marker | Written by | Meaning |
|---|---|---|
| `[QA_VERIFIED]` | Supervisor | Independent QA returned PASS; the machine QA gate approved; PR opened. |
| `[QA_FAILED]` | Supervisor | Independent QA did not approve (FAIL / BLOCKED / invalid / missing verdict). |
| `[FIXER_PR_OPENED]` | (Phase 3) Fixer | Fixer opened a PR (fact only; reserved, not emitted in Phase 2). |

Phase 2 emits **only** `[QA_VERIFIED]` and `[QA_FAILED]`, and **only** the Supervisor emits them.
`[FIXER_*]` markers are reserved vocabulary for Phase 3 and MUST NOT be emitted by any Phase 2 code.

### 3A.2 Comment shape

```
[QA_VERIFIED]
QA Guardian: issue #<n> 独立 QA 通过，已开 PR 待人工评审。

```json
{ "protocol": "qa-guardian/v1", "marker": "QA_VERIFIED", "agent": "guardian-supervisor",
  "issue": 191, "status": "PASS", "branch": "fix/issue-191", "pr_url": "https://…",
  "run_id": "…", "attempt": 1, "report_hash": "sha256:…", "verified_at": "2026-08-19T…Z" }
```
```

Rules:
- The marker line is line 1, verbatim, no leading whitespace.
- A short human sentence (Chinese, per repo convention) follows.
- A single fenced ```json block carries the machine-readable metadata envelope.
- The envelope carries **only** the allow-listed keys above. It NEVER contains source code, diffs,
  secrets, tokens, or full report text — only the `report_hash` fingerprint.

### 3A.3 Injection-safety boundary (load-bearing)

Protocol markers are **facts, never authorizations** (§3 rule 4). The grammar guarantees this
mechanically: a `/guardian` command is only ever a line matching `^\s*/guardian\s+<verb>` (see
[`commands.mjs`](../tools/guardian/commands.mjs) `LINE_RE`). A `[QA_VERIFIED]` / `[QA_FAILED]` /
`[FIXER_*]` marker line can NEVER match that pattern, so a Supervisor/agent status comment can never
be re-parsed as an authorization command. `verdict-comment.mjs` additionally exposes an
`assertMarkerIsNotCommand()` guard and the test suite locks this as a regression.

Conversely, the Supervisor is the **sole writer** of `[QA_VERIFIED]`/`[QA_FAILED]`. Neither the QA
role (zero GitHub side effects) nor the Fixer writes them. This keeps the `command_authors`
trusted-author whitelist purely for **human** authorization; bot-authored facts never enter it.

### 3A.4 Idempotency

The Supervisor writes at most one verdict comment per verdict transition. Idempotency uses a
`last_verdict_comment_hash` field on the per-issue state record: before writing, the Supervisor
hashes the intended comment; if it equals the stored hash, the write is skipped. This mirrors
`last_notified_state` (§11B.5) and makes a re-tick safe (a duplicate at worst costs one message,
never correctness — but the hash guard prevents even that).

---

## 4. Frozen in Phase 1 (do not change)

These are load-bearing runtime facts. Phase 1 changes **none** of them.

- **State machine.** The canonical `STATES` in [`state.mjs`](../tools/guardian/state.mjs) stay
  exactly as-is (scheme A). No new state names, no renamed states, no new transitions. The guardian
  test suite is the guard.
- **GitHub discovery label.** Discovery stays `gh issue list --label qa-guardian`; the claim label
  stays `qa-guardian-claimed`. Role rename does **not** rename the discovery label.
- **Projected labels.** `qa-guardian:bug` / `:request` / `:risk-high` / `:risk-low` / `:gate-1` /
  `:gate-2` / `:handed-back` in [`label-io.mjs`](../tools/guardian/label-io.mjs) stay verbatim.
- **Runtime dispatch.** The scheduler still launches `opencode run --agent qa-guardian`
  ([`poll.mjs`](../tools/guardian/poll.mjs)). No `--agent` string changes; `poll.test.mjs`'s argv
  assertion is the guard.
- **Package / service / metadata names.** `qa-guardian-tools` (package), `qa-guardian-callback`
  (docker service / HTTP User-Agent) are cosmetic and stay.

---

## 5. Phase boundaries

| Phase | In scope | Explicitly out |
|---|---|---|
| **1 (now)** | Role vocabulary + boundary contracts as docs; `fixer-agent.md` role doc; this normative doc; ops-doc terminology notes. Zero runtime/label/state change. | Everything below. |
| **2** | Implement the comment protocol (`[QA_VERIFIED]` etc.) and standardized verdict/report artifacts in code; Supervisor as sole verdict-comment writer. | App identities, webhook. |
| **3** | Two GitHub App identities (QA App / Fixer App) with a bot-fact channel separate from the human authorization whitelist. | Webhook. |
| **4** | Webhook as primary trigger; scheduler demoted to compensation; unify delivery-id idempotency with comment-id idempotency in one layer. | — |

---

## 5A. Phase 3 locked decisions (normative)

Five decisions were locked before any Phase 3 code. They bound the actor/identity design and the
authorization model. See the audited seams in
[`qa-guardian-actor-effect-matrix.md`](./qa-guardian-actor-effect-matrix.md).

1. **`trustedAuthors` is human-only, always.** No machine identity — not the QA App, not the Fixer
   App, not the Supervisor, not any bot login — may ever be a member of the `command_authors` /
   `trustedAuthors` whitelist. A bot comment that reads `/guardian approve` is IGNORED exactly like
   any untrusted commenter. This is enforced structurally (see decision 5), not just by convention.

2. **Phase 3 is policy/actor-routing scaffolding, not a per-App-token transport cutover.** GitHub
   side-effects keep flowing through the existing single-PAT `gh`/REST transport for now. Phase 3
   adds a reversible actor-routing layer that assigns each side-effect to an intended actor and
   forbids out-of-role effects at the routing boundary (e.g. the QA-App actor route has no
   PR-create capability). Real per-identity App tokens are a later, separately-shipped step.

3. **Identity is asserted twice, independently.** For any actor-bound effect we distinguish (a) the
   credential/route actually used and (b) the GitHub actor visible on the resulting artifact. Code
   must not trust an internal policy label alone. Phase 3's routing asserts (a); (b) is verified
   where a resulting artifact's author is observable.

4. **PR comments never authorize.** The `/guardian` authorization channel is fed ONLY by **issue**
   comments authored by a human on `trustedAuthors`. PR comments (from any actor) are facts/traces,
   never authorization inputs. `selectCommand` is only ever given the issue-comment stream.

5. **The fact channel and the authorization channel are structurally distinct.** An explicit actor
   taxonomy — `human_authorizer` / `bot_fact_writer` / `bot_executor` — decides which channel an
   actor may enter. Authorization eligibility requires the `human_authorizer` class; a
   `bot_fact_writer` / `bot_executor` can write facts and perform its allowed effects but can never
   reach the authorization path, even if its login were mistakenly added to a whitelist. This is a
   code-structural guarantee, not a string-matching one.

**Frozen by these decisions:** the fail-closed empty-whitelist rule (§2 / `selectCommand`), the
Supervisor-sole-writer verdict rule (§3), and the marker-is-never-a-command grammar (§3A.3) all
remain exactly as-is; Phase 3 strengthens them with an explicit actor class, never weakens them.

---

## 6. Operational note

Agent markdown lives in the repo under [`qa-skill/agents/`](../qa-skill/agents/) and must be
re-synced to `~/.config/opencode/agents/` for the runtime to pick up changes. Because Phase 1 adds
only a non-runnable role doc (`fixer-agent.md`) and does not modify `qa-guardian.md` / `qa.md`, the
running behavior is unchanged; the sync keeps the repo and global copies consistent.
