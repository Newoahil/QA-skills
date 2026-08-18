# QA Guardian — actor / GitHub-effect matrix (Phase 3 prerequisite, read-only audit)

> **Status:** factual audit + proposed target mapping. The audit half (every GitHub
> side-effect that exists today + which file/function performs it + which transport) is a
> read-only inventory and is authoritative NOW. The "target actor" column is a PROPOSAL that
> becomes binding only after the Phase 3 decision gate is confirmed (see
> [`qa-guardian-role-architecture.md`](./qa-guardian-role-architecture.md) §5 and the 5 decisions).
> No code changes are implied by this document alone.

## 1. Why this exists

Metis flagged the top Phase 3 risk as "ambient `gh` identity leakage": today every write goes
through one locally-authenticated `gh` (or one PAT via REST), so permissions look splittable
conceptually but are not enforced by transport. Before splitting identities we must map **every**
existing GitHub side-effect to exactly one intended actor and to the concrete code seam that
performs it. This is that map.

## 2. Actor taxonomy (proposed — pending decision 5)

Three security domains, kept structurally distinct so a machine actor can never self-authorize:

- **human_authorizer** — a human GitHub login on the `command_authors` whitelist. The ONLY actor
  whose issue comments can drive a `/guardian` authorization transition.
- **bot_fact_writer** — a machine identity that appends FACTS (verdict comments, notifications,
  progress). Its comments are never authorization commands.
- **bot_executor** — a machine identity that performs code/PR side-effects (branch, push, PR).

The future QA App maps to `bot_fact_writer` (+ issue-create + qa-label). The future Fixer App maps
to `bot_executor`. The Supervisor is the orchestrator that today performs most `bot_fact_writer`
effects locally.

## 3. The complete side-effect inventory (audited)

Every GitHub-mutating call in `tools/guardian/**` today, with its transport and the concrete seam:

| # | GitHub effect | File : function | Transport | Effect class | Proposed actor |
|---|---|---|---|---|---|
| 1 | `gh issue list` (discovery) | [scheduler.mjs:46](../tools/guardian/scheduler.mjs) `ghIssueList` | gh CLI | read | Supervisor |
| 2 | `gh issue view` (read issue) | [poll.mjs:81](../tools/guardian/poll.mjs) `defaultGhReader` | gh CLI | read | Supervisor |
| 3 | `gh label create qa-guardian-claimed` | [scheduler.mjs:292](../tools/guardian/scheduler.mjs) claim block | gh CLI | label | Supervisor |
| 4 | `gh issue edit --add-label qa-guardian / -claimed` (claim) | [scheduler.mjs:295](../tools/guardian/scheduler.mjs) claim block | gh CLI | label | Supervisor |
| 5 | `gh issue edit --add/--remove-label qa-guardian:*` (state projection) | [label-io.mjs:28](../tools/guardian/label-io.mjs) `projectLabels` | gh CLI | label | Supervisor |
| 6 | `gh issue comment` (notification) | [notify-io.mjs:16](../tools/guardian/notify-io.mjs) `defaultGhComment` | gh CLI | fact comment | bot_fact_writer (QA App) |
| 7 | `curl POST` (webhook notify) | [notify-io.mjs:29](../tools/guardian/notify-io.mjs) `defaultCurlPost` | curl | fact webhook | Supervisor |
| 8 | `gh issue comment` (verdict `[QA_VERIFIED]`/`[QA_FAILED]`) | [scheduler.mjs](../tools/guardian/scheduler.mjs) `writeVerdictComment` → `defaultGhComment` | gh CLI | fact comment | bot_fact_writer (QA App) |
| 9 | `gh pr create` | [pr-io.mjs:6](../tools/guardian/pr-io.mjs) `createPullRequest` | gh CLI | PR create | bot_executor (Fixer App) |
| 10 | branch commit + `git push` (fix branch) | the `qa-guardian` agent itself (runtime), not a module | gh/git ambient | code write | bot_executor (Fixer App) |
| 11 | issue comment via REST PAT (`/guardian <verb>` from callback) | [github-comment.mjs:34](../tools/guardian/github-comment.mjs) `postIssueComment` | REST PAT | command-relay comment | see §5 note |
| 12 | fix-trace / diagnosis / audit comments | the `qa-guardian` agent (runtime) | gh ambient | fact comment | bot_executor (Fixer) writes its own trace |

Denied everywhere (mechanism + discipline), no actor performs them automatically:
`gh pr merge`, `gh issue close`, `git reset`, `git clean`, force-push. These stay HUMAN-only.

## 4. Authorization channel (audited — the fail-closed core)

Only ONE code path turns a comment into an authorization transition:

- [commands.mjs:68](../tools/guardian/commands.mjs) `selectCommand` — a comment authorizes iff:
  its author login ∈ `trustedAuthors` (case-insensitive), it parses as `^\s*/guardian <verb>`, the
  verb is valid in the current state, and it is strictly newer than `last_consumed_comment_id`.
  **Empty/absent `trustedAuthors` ⇒ nothing is authorized (fail-closed).**

This is the ONLY place actor-class matters for authorization. Everything in §3 is a side-effect,
NOT an authorization input.

## 5. The load-bearing seam for Phase 3

Row 11 (`postIssueComment`) is the one subtle case: the callback path posts a `/guardian <verb>`
comment via a PAT, which the next poll then reads through `selectCommand`. That comment is only
honored because it is authored by a **human-trusted login**. When the QA/Fixer Apps arrive:

- Their bot logins MUST NOT be added to `trustedAuthors` (decision 1). A bot posting `/guardian
  approve` must be IGNORED, exactly like any untrusted commenter.
- Fact comments (rows 6, 8) authored by `bot_fact_writer` must remain non-authorization by
  structure (decision 5) — the `[QA_*]` marker grammar already guarantees a fact line can never
  match the `/guardian` command regex (§3A.3, locked by test).

## 6. What this audit settles vs leaves open

**Settled (facts):** there are exactly 12 GitHub-effect seams; only `selectCommand` authorizes;
all writes go through one ambient `gh`/PAT today; merge/close are already denied.

**Open (needs the decision gate):** whether Phase 3 enforces per-App tokens (decision 2), where
identity is asserted (decision 3), whether PR comments can ever authorize (decision 4 — note rows
6/8/12 are issue/PR comments; today only issue comments feed `selectCommand`), and the concrete
actor-routing abstraction that maps each row above to its actor's transport.
