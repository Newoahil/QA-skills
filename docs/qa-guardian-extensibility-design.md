# QA Guardian — dual hot-plug extensibility design (task-source + agent)

> **This document is a design proposal for review.** It defines the abstraction seams that make
> two things hot-pluggable: the **task source** (GitHub issues today; an HTTP/API dispatch source
> and others in future) and the **agents** (both read-only investigation specialists and
> pipeline-stage agents). It does **not** change any behavior on its own — it is the plan the
> phased refactor will implement.
>
> **"Hot-plug" scope (decided):** config/manifest registration + process restart to take effect.
> This is **not** runtime dynamic loading (no unloading/reloading a live scheduler). For a resident
> scheduler this is the intended level.
>
> **Compatibility invariant (decided):** the existing GitHub + QA-Guardian line keeps
> **byte-identical behavior** — all current `tests/guardian/*.test.mjs` stay green. GitHub/QA logic
> becomes "the first built-in implementation" running on top of the new abstractions.
>
> **Status:** proposal. Sequencing and abstraction shapes below incorporate an Oracle architecture
> review (see §7 "Review notes"). Nothing here is implemented yet.

---

## 1. Goals & non-goals

### Goals

1. **Task-source hot-plug.** Add a new source of work (e.g. an HTTP/API dispatcher) by writing one
   file that implements the `TaskSource` contract and registering it — without editing the scheduler
   core or the state machine.
2. **Agent hot-plug (two kinds).**
   - **Investigation specialist** (read-only, produces evidence, conditionally selected): register
     via an agent manifest, selected by `requires_capability` — no edit to `selectSpecialists`.
   - **Pipeline-stage agent** (mutates state/artifacts, participates in gates/retry/idempotency):
     register a `Stage` at a declared extension point — no edit to the scheduler's main loop.

### Non-goals

- Runtime dynamic loading / unloading (restart is required to pick up a new source or agent).
- A fully user-programmable pipeline. Configuration must **not** be able to describe arbitrary state
  transitions, arbitrary effect permissions, or custom recovery — that would be a second programming
  language (see §5.3 YAGNI line).
- Changing the safety model. The read-only-QA invariant, the actor→effect authorization matrix, the
  fail-closed command authorization, and "no auto-merge/close" all remain exactly as today.

---

## 2. Where the system is coupled today (verified)

The current system is a high-quality but single-vertical implementation. GitHub + QA semantics are
baked through the whole chain:

| Layer | File | Coupling |
|---|---|---|
| Discovery | [`scheduler.mjs`](../tools/guardian/scheduler.mjs) `ghIssueList`/`listCandidates` | `spawnSync('gh', ['issue','list',...])`; work item's primary key is `Number(issueNumber)` |
| State input | [`state-router.mjs`](../tools/guardian/state-router.mjs) `routeIssue(record, gh, opts)` | 2nd arg `gh` is `{ closed, comments:[{id,body,createdAt,author}] }` — the GitHub issue shape **is** the state-machine input contract |
| Recovery protocol | [`commands.mjs`](../tools/guardian/commands.mjs) | resume driven by parsing `/guardian approve|revise|reject|rework|retry|followup` from issue **comments**; `gh.closed` === "human merged → DONE" |
| State schema | [`state.mjs`](../tools/guardian/state.mjs) | `newState(issueNumber)`, file is `${Number(issueNumber)}.json`, `branch: fix/issue-<n>`; primary key is a number throughout |
| Effects | [`actor-routing.mjs`](../tools/guardian/actor-routing.mjs) `EFFECTS` | GitHub verbs: `LABEL`, `PR_CREATE`, `MERGE`, `CLOSE`, `FACT_COMMENT`, `FACT_WEBHOOK` |
| Specialists | [`investigation-coordinator.mjs`](../tools/guardian/investigation-coordinator.mjs) `SPECIALIST_ROLES` | frozen array of 6 `guardian-*` roles; `selectSpecialists` uses imperative `if (cap.context7) roles.push('guardian-docs')` chains |
| Specialists (dup) | [`capabilities.mjs`](../tools/guardian/capabilities.mjs) `GUARDIAN_AGENT_ROLES` | the same 6-role list duplicated; `agentEnabled` recognizes only **known** keys (can disable, cannot register unknown) |
| Pipeline | [`scheduler.mjs`](../tools/guardian/scheduler.mjs) L500–592 | fixed, named, ordered calls: `runFixerSession(...)` then `runQaSession(...)` — the "fixer → qa" order is imperative code, not data |

**Already data-driven (the good seams to imitate):**

- [`resolveModelForRole(config, role)`](../tools/guardian/investigation-coordinator.mjs) reads
  `config.models[role]` — role→model is already config-driven; a new role needs no code change for
  its model.
- [`webhook-ingest.mjs`](../tools/guardian/webhook-ingest.mjs) `WakeStore` is injected — "an event
  only triggers reconcile; truth is re-sourced." This is the cleanest existing pluggable seam and
  the model for the whole task-source abstraction.
- Strong dependency-injection + pure-function discipline throughout → most changes are **extract
  interface**, not rewrite.

---

## 3. The four abstraction seams

### 3.1 Seam A — `TaskSource` (normalized observation)

Replaces `ghIssueList` / `defaultGhReader`. The router's input becomes a **structured observation**,
not the GitHub `{closed, comments}` shape. All new files in this section live under
`tools/guardian/`.

```js
// tools/guardian/task-ref.mjs — canonical identity value object (Seam D groundwork)
// A TaskRef is the source-neutral identity of one unit of work. It is a plain frozen object,
// constructed only via makeTaskRef(); code never fabricates {source,taskId} inline.
TaskRef = { source: string, taskId: string, displayId: string };
//   source    : 'github' | 'http' | ... (which TaskSource owns this task)
//   taskId    : source-neutral STRING id. For GitHub this is String(issueNumber) — see §4/§6
//               for the compatibility rule that keeps on-disk state numeric during P1–P7.
//   displayId : human label, e.g. "#123" for GitHub. Never used as a key.
export function makeTaskRef({ source, taskId, displayId }): TaskRef   // validates + Object.freeze
export function taskRefKey(ref): string                              // `${source}:${taskId}`, the map/lock key
export function githubIssueToTaskRef(issueNumber): TaskRef           // { 'github', String(n), `#${n}` }

// tools/guardian/task-source.mjs — the pluggable contract (GitHub is the first impl; HTTP is the second)
TaskSource = {
  // Enumerate candidate work. Replaces ghIssueList / listCandidates. Ordering is the source's
  // responsibility (GitHub: oldest updatedAt first, as today).
  listTasks(): Promise<TaskRef[]>,
  // Re-source the CURRENT truth for one task (never trusts a cached event). Replaces defaultGhReader.
  readTask(ref: TaskRef): Promise<TaskObservation>,
  // Map this source's raw list element back to a TaskRef.
  getId(rawTask): TaskRef,
};

// The normalized observation returned by readTask() — deliberately NOT {closed, comments}.
TaskObservation = {
  identity: TaskRef,                              // the same TaskRef shape above
  // Terminal fact. ONE canonical shape (resolves the §3.1/§7 mismatch): status-based, not a boolean.
  terminal: {
    status: string,          // source-neutral terminal status, e.g. 'completed' | 'rejected'
    reason: string,          // e.g. 'merged-closed' (GitHub maps closed→this, preserving today's DONE)
    sourceEvidence: object,  // raw proof from the source (e.g. { closed: true }); opaque to the router
  } | null,                  // null = not terminal
  // Already-VALIDATED control events (authorization + parsing done inside the adapter, see below).
  // The neutral layer consumes these; it never re-parses text.
  controlEvents: Array<{
    id: string,              // event id, source-unique
    kind: 'command',
    verb: string,            // one of commands.mjs COMMANDS keys (approve|revise|reject|rework|retry|followup)
    data: string,            // opaque DATA tail, never interpreted
    author: string,          // already trust-checked by the adapter
    occurredAt: string,      // ISO
    sequence: number,        // monotonic within this source; the router's ordering key
  }>,
  facts: { title: string, body: string },        // task CONTENT, separated from canonical identity
  // Source-neutral consumption cursor (replaces the GitHub-specific last_consumed_comment_id semantics).
  // The router compares controlEvents by `sequence` strictly greater than cursor.lastConsumedSequence.
  cursor: { lastConsumedId: string | null, lastConsumedSequence: number | null },
};
```

**Critical boundary — who parses `/guardian`.** The GitHub adapter **calls the existing
`commands.mjs`** (`selectCommand` / `parseCommand`) internally to turn issue comments +
trusted-author checks + `gh.closed` into validated `controlEvents` and the `terminal` fact. It does
**not** reimplement parsing. So `commands.mjs` is **unchanged** and stays the GitHub protocol parser
(§5) — it is simply now *invoked from inside* `github-task-source.mjs` instead of from the router.
The neutral layer never sees a comment; it consumes the validated `controlEvents` the adapter emits.
This is the one explicit adapter↔parser boundary, and `commands.mjs`'s existing tests are the
regression guard for it.

**GitHub → `TaskObservation` field mapping (P2, exact):**

| GitHub fact (via `gh`/`commands.mjs`) | `TaskObservation` field |
|---|---|
| `issue.number` | `identity` = `githubIssueToTaskRef(number)` |
| `state === 'CLOSED'` at `GATE_2_WAIT` | `terminal = { status:'completed', reason:'merged-closed', sourceEvidence:{closed:true} }` (preserves today's DONE) |
| any other open issue | `terminal = null` |
| `selectCommand(...)` result | one entry in `controlEvents` (verb/data/author/id), `sequence` = comment order |
| `title` / `body` | `facts.title` / `facts.body` |
| `last_consumed_comment_id` | `cursor.lastConsumedId` (+ derived `lastConsumedSequence`) |

### 3.2 Seam B — `EffectSink`

Replaces scattered `defaultGhComment` / `openGate2PullRequest` / label writes.

```js
// tools/guardian/effect-sink.mjs — outbound side-effect abstraction
EffectSink = { emit(descriptor: EffectDescriptor): Promise<EffectResult> };

EffectDescriptor = {
  // kind ∈ the EXISTING EFFECTS values (actor-routing.mjs), unchanged in P4:
  //   'fact_comment' | 'fact_webhook' | 'label' | 'pr_create' | 'read'
  // (MERGE/CLOSE are never emitted — human-only, as today.)
  kind: string,
  ref: TaskRef,                 // the task this effect targets (carries source+taskId)
  payload: object,              // kind-specific; schemas below
  actor: string,                // one of actor-routing.mjs ACTORS; authorizes the emit
  idempotencyKey: string,       // caller-supplied; the sink dedups on it (e.g. verdict-comment hash)
};

// EffectResult — uniform across sinks so callers don't branch on source.
EffectResult = { delivered: boolean, id?: string, url?: string, skipped?: boolean, error?: string };

// Per-kind payload schema (GitHub sink; other sinks translate the SAME payloads):
//   fact_comment : { body: string }                       -> gh issue comment
//   fact_webhook : { json: object }                       -> curl webhook
//   label        : { add?: string[], remove?: string[] }  -> gh issue edit (best-effort projection)
//   pr_create    : { base, head, title, body }            -> gh pr create
```

**Authorization call order (unchanged semantics, P4):** `emit()` first calls
`assertActorMayPerform(descriptor.actor, descriptor.kind)` from `actor-routing.mjs` — the **same
check, same matrix, same throw** as today — *before* any I/O. The sink is a thin dispatcher on top
of the existing `defaultGhComment` / `defaultCurlPost` / `openGate2PullRequest` / label functions;
it only relocates the call site, so the actor→effect authorization is provably identical (§6.3).

**Do not rename `EFFECTS` in P4.** The `actor-routing.mjs` matrix is a **security boundary**, not
vocabulary; semantic names like `PUBLISH_FACT` drop the target/reversibility/authority dimensions and
would blur `MARK_TERMINAL` across GitHub-close vs API-status vs internal-transition (different
authorization + failure behavior). Semantic renaming is an **optional later step**, gated on tests
proving authorization equivalence.

### 3.3 Seam C — agent registry + data-driven pipeline (two distinct contracts)

Specialists and stages have **different contracts** and must **not** share one manifest type.

**Loading & bootstrap (both registries).** Manifests are loaded once at scheduler startup by
`tools/guardian/agent-registry.mjs` from two locations, project overriding built-in:
`tools/guardian/agents.manifest.json` (built-in defaults) merged with an optional
`<repo>/.qa/guardian/agents.manifest.json` (per-project). Loader rules: **unknown keys reject**,
**duplicate `role`/`id` reject** (fail-closed, logged), a specialist whose `requires_capability` is
unavailable is **skipped** (not an error), and validation failure aborts startup rather than running
a half-registered pipeline. The registry is passed into `tick()` the same way `config` is today.

**(a) Investigation specialists** — read-only, evidence-producing, conditionally selected:

```jsonc
// agents.manifest.json → "specialists"
{
  "specialists": [
    { "role": "guardian-code", "requires_capability": null,           "enabled_default": true  },
    { "role": "guardian-docs", "requires_capability": "context7",     "enabled_default": false },
    { "role": "guardian-perf", "requires_capability": "local_runtime","enabled_default": false }
    // adding a specialist = one line here + an agent definition file at qa-skill/agents/<role>.md
  ]
}
```

```js
// Specialist agent-definition contract (already how guardian-* agents work today):
//   - a qa-skill/agents/<role>.md OpenCode agent file, read-only permissions;
//   - selected iff enabled (config.agents[role] !== false, §capabilities) AND
//     requires_capability is null or that capability is available;
//   - runtime model resolved by the EXISTING resolveModelForRole(config, role) — no code change.
// selectSpecialists() becomes: registry.specialists.filter(byCapability).filter(byEnabled)
// — replacing today's imperative if-chain. Duplicate/unknown roles are rejected by the loader.
```

**(b) Pipeline-stage agents** — mutate state/artifacts, participate in gate/retry/idempotency/security:

```js
// pipeline.manifest (a validated MANIFEST, not free-form config) — Stage descriptor
Stage = {
  id: string,                          // unique; duplicate rejected by loader
  agent: string,                       // OpenCode agent that runs the stage
  runner: string,                      // exported fn name with the signature below (validated to exist)
  inputArtifacts:  string[],           // artifact kinds it may READ  (e.g. ['dossier','plan'])
  outputArtifacts: string[],           // artifact kinds it may WRITE (e.g. ['pr-summary'])
  stateTransition: { from: string, to: string },   // must reference existing STATES (validated)
  retryPolicy: { maxRounds: number },
  producesEffects: boolean,            // if true, may emit via EffectSink; else edit-only
  extensionPoint: 'before-fixer' | 'after-qa',      // ONLY these declared points in P6/P7
};

// Stage runner signature (deterministic, injected deps — mirrors runFixerSession/runQaSession today):
//   async run({ client, state, ref, guardianDir, artifacts, emit, model, signal }) -> { state, status }
```

A stage entry must **not** be just `{ agent: 'fixer' }`; that only moves hardcoded coupling into
undocumented runtime convention. The built-in `fixer → qa` pipeline is expressed as a **constant
ordered array in code** (`pipeline.manifest` is the built-in default the array is derived from);
manifest stages may be inserted **only at the two declared extension points** (additive), and the
loader **rejects** a stage whose `stateTransition` references unknown states or whose `runner` is
missing. Stage ordering is deterministic: built-in stages keep their fixed order; a manifest stage
is spliced at its `extensionPoint`, and two stages at the same point are ordered by manifest
appearance (validated to be unambiguous).

### 3.4 Seam D — canonical task identity (`TaskRef`), string-ID last

`issueNumber:Number` → `taskId:string` is necessary **eventually**, but it is the **riskiest** change
because identity is embedded in state filenames, [`ledger.mjs`](../tools/guardian/ledger.mjs)
transition tokens, artifact paths, branch names, OpenCode session bindings, and prompt text. So:

- Introduce a `TaskRef` value object + helpers **first**.
- Keep the GitHub-compatible `issue` field, `${n}.json` filenames, and `fix/issue-<n>` branches
  during the compatibility phase.
- Do the full string-ID migration **last** (P7), with a migration strategy for session bindings and
  source-specific cursor/terminal tests.

> **Compatibility rule for `task_id` (resolves the §6.1 zero-byte-diff requirement).** During
> P1–P7, `TaskRef` is an **in-memory** value object only. It is **NOT persisted** to
> `.qa/guardian/<n>.json`: `newState()`/`normalizeState()`/the on-disk schema are **unchanged**, so
> existing state files round-trip byte-for-byte and the golden diff (§6.1) holds. Code obtains a
> `TaskRef` at runtime via `githubIssueToTaskRef(record.issue)` — the numeric `issue` field stays the
> single persisted key. `task_id` becomes a **persisted** field only in **P7**, together with the
> full string-ID migration and its state-file migration step. (Earlier drafts said "add `task_id`
> alongside `issue` in P1"; that is corrected here — P1 adds the *value object*, not a *stored
> field*.)

---

## 4. Phased plan (dependency order — revised per Oracle review)

> The original "replace the primary key first (D)" was rejected: identity渗透 is too broad for a
> first mechanical change. The revised order lays the **identity groundwork** first and defers the
> full string-ID migration to the very end, so GitHub behavior is never at risk mid-refactor.

| Phase | Goal | Deliverables | Depends on |
|---|---|---|---|
| **P1 Identity value object** | Introduce the in-memory `TaskRef`; do **not** change `issue` serialization / filenames / branches / ledger tokens / on-disk schema | `task-ref.mjs` + helpers; **no persisted field change** (see the compatibility rule in §3.4) | — |
| **P2 GitHub task source** | Collapse `gh issue list` / issue facts / comments / closed into the normalized `TaskObservation`; keep `/guardian` parsing + cursor **inside** the adapter | `task-source.mjs` (contract) + `github-task-source.mjs` (first impl) | P1 |
| **P3 Router neutralization** | `routeIssue` consumes `TaskObservation`; **golden tests** prove every GitHub decision (action payload + persisted state) is byte-equivalent | `state-router.mjs` change + golden fixtures | P2 |
| **P4 EffectSink** | Introduce `EffectSink` behind existing gh effect functions; keep effect names; lock the actor→effect authorization with tests | `effect-sink.mjs` + `github-effect-sink.mjs` | P3 |
| **P5 Specialist registry** | Replace `SPECIALIST_ROLES` constant + `selectSpecialists` if-chain with an agent manifest filtered by `requires_capability` (**independent, low-risk — can run in parallel with P2–P4**) | `agent-registry.mjs` + `agents.manifest.json` | (parallel) |
| **P6 Stage runner** | Extract the `fixer → qa` fixed sequence into an internal `Stage` contract + constant array; main loop iterates stages; behavior unchanged | `stage-runner.mjs` + `pipeline.manifest` (built-in constant) | P4 |
| **P7 Second implementations** | Land the HTTP/API task source + one new pipeline-stage agent; run end-to-end. Still uses `githubIssueToTaskRef`-style refs; **no string-ID migration yet** | `http-task-source.mjs`, new stage def | Task-source half: P1–P4. Agent half: P5–P6 |
| **P8 String-ID migration** | Persist `task_id`; migrate state filenames, `ledger.mjs` tokens, branch/artifact paths, and OpenCode session bindings off `Number(issue)`; source-specific cursor / terminal tests | state-file migration script, `ledger.mjs`, session-binding migration | P1–P7 |

**Every phase is a stop point:** after any of P1–P7, the GitHub line runs unchanged and all tests
stay green. P8 is the only phase that changes on-disk representation and therefore ships with its own
migration + fresh golden baselines.

### Minimal closed loops per goal

- **Agent hot-plug only** → P5 + P6 (task source stays GitHub; no P7/P8 needed).
- **Task-source hot-plug only** → P1–P4 + the P7 HTTP source. A **GitHub-only** deploy can stop
  before P8; P8 (string-ID) is required only once a source whose ids are **not** representable as the
  existing numeric key must persist state (e.g. a non-numeric API task id).
- **Both (the chosen scope)** → P1–P7, then P8 when a non-numeric-id source needs durable state.

---

## 5. File-level change list

All new files live under `tools/guardian/` unless a path says otherwise.

| File | Phase | Nature |
|---|---|---|
| `tools/guardian/task-ref.mjs` *(new)* | P1 | in-memory identity value object + helpers (no persisted change) |
| [`state.mjs`](../tools/guardian/state.mjs) | P1 | **unchanged on disk**; P1 adds no stored field (see §3.4 compatibility rule). Stored-schema change is **P8** |
| `tools/guardian/task-source.mjs` *(new)* | P2 | interface contract |
| `tools/guardian/github-task-source.mjs` *(new)* | P2 | extract `ghIssueList` / `defaultGhReader`; **calls** `commands.mjs` to build `controlEvents` |
| [`state-router.mjs`](../tools/guardian/state-router.mjs) | P3 | `routeIssue` consumes `TaskObservation`; + golden tests |
| [`commands.mjs`](../tools/guardian/commands.mjs) | P2–P3 | **untouched**; now invoked from inside `github-task-source.mjs` (§3.1 boundary) |
| `tools/guardian/effect-sink.mjs` *(new)* + `tools/guardian/github-effect-sink.mjs` *(new)* | P4 | wrap `defaultGhComment` / `defaultCurlPost` / `openGate2PullRequest` / label |
| [`actor-routing.mjs`](../tools/guardian/actor-routing.mjs) | P4 | **no rename**; wired inside the sink; authorization matrix locked by tests |
| `tools/guardian/agent-registry.mjs` *(new)* + `tools/guardian/agents.manifest.json` *(new)* | P5 | manifest loader + built-in specialist manifest; replaces `SPECIALIST_ROLES` constant |
| [`investigation-coordinator.mjs`](../tools/guardian/investigation-coordinator.mjs) / [`capabilities.mjs`](../tools/guardian/capabilities.mjs) | P5 | `selectSpecialists` reads the registry; delete the duplicated 6-role constant |
| `tools/guardian/stage-runner.mjs` *(new)* + `tools/guardian/pipeline.manifest.mjs` *(new, built-in constant)* | P6 | extract `scheduler.mjs` L500–592 fixer→qa sequence |
| [`scheduler.mjs`](../tools/guardian/scheduler.mjs) | P2/P4/P6 | slim down: list via `TaskSource`, effects via `EffectSink`, pipeline via `StageRunner`. These are **migration edits**; "no scheduler edit" is the post-refactor goal for *adding a new source/agent*, not for the extraction itself |
| `tools/guardian/http-task-source.mjs` *(new)* + new stage def *(new)* | P7 | second implementations (validate both abstractions) |
| [`ledger.mjs`](../tools/guardian/ledger.mjs) | P8 | transition/artifact tokens are `Number(issue)`-bound; changed **last**, with the string-ID migration |
| state-file migration script + session-binding migration *(new)* | P8 | persist `task_id`, migrate filenames/paths/session records off the numeric key |

### 5.3 The YAGNI line for the stage abstraction

For a system with ~2–3 stages, a fully user-configurable arbitrary pipeline is over-engineering. The
sanctioned scope:

- define an internal `Stage` contract;
- represent the built-in pipeline as a constant ordered array;
- allow manifest registration of additional validated stages **only at declared extension points**
  (additive: before/after existing stages).

**Line crossed (do not do yet):** configuration that must describe retry behavior, gates, artifact
contracts, or security policy without code-level validation. If the P7 validation stage needs custom
state transitions, custom effects, and custom recovery, that is evidence the stage contract is not
yet stable — fall back to a fixed contract.

---

## 6. Test strategy (guarding "byte-identical")

1. **Golden decision tests (§6.1, P3 core):** for existing GitHub fixtures, `routeIssue` before/after
   normalization produces a **zero-byte diff** of action payload + persisted state. This holds in
   P1–P7 precisely because `TaskRef` is in-memory only and the on-disk schema is untouched (§3.4
   compatibility rule); P8 re-baselines these goldens as part of its migration.
2. **State round-trip tests (§6.2):** an old `123.json` stays byte-equivalent after `normalizeState`
   in P1–P7; no new stored field is introduced until P8.
3. **Authorization-matrix equivalence (§6.3, P4):** every `actor → effect` allow/deny pair is
   identical before and after the sink is introduced (same `assertActorMayPerform` call, §3.2).
4. **Protocol invariance:** `/guardian` line matching, data-tail validation, trusted-author checks,
   idempotent consumption — `commands.mjs` behavior held constant, now exercised through
   `github-task-source.mjs`.
5. **Manifest loader tests (P5/P6):** unknown key rejected, duplicate role/id rejected, unavailable
   capability skipped (not error), stage with unknown `stateTransition`/missing `runner` rejected.
6. **Full existing suite green** as the entry gate for every phase:
   `node --test "tests/guardian/*.test.mjs"`.
7. **P8 additions:** source-specific cursor tests (out-of-order / replay) + terminal-semantics tests
   + state-file/session-binding migration tests — an API source may lack monotonic ids and needs an
   explicit order/comparison model.

---

## 7. Review notes (Oracle) — sharp edges

- **Biggest hidden coupling = the recovery/idempotency model.** Identity is used at three separate
  boundaries: (1) `state.mjs` filename + `issue` field, (2) `ledger.mjs` transition/artifact tokens
  (normalized through `Number(issue)`), (3) runtime artifacts + OpenCode session bindings. Therefore
  string-ID migration is deferred to P7, and an API source must supply a **source-neutral cursor**,
  not just an opaque string.
- **Task content is coupled too.** Investigation/fixer prompts literally say "GitHub issue #…";
  `synthesizeDossier` stores `issue: Number(issue)`. P7 must separate **task content / display
  identity** from **canonical identity**.
- **Terminal semantics are not intrinsic.** `gh.closed` is currently treated as "human merged →
  DONE"; GitHub closure is not literally merge. Preserve the exact GitHub behavior; model neutral
  terminals as `{ status, reason, sourceEvidence }`, never a bare boolean — and do not "correct"
  closure semantics during the refactor.
- **Labels are a GitHub projection**, not a neutral effect — keep projection behavior outside the
  neutral state machine and best-effort, as today.
- **OpenCode session binding** records `issue: Number(issue)` and titles use the issue number.
  Migrating identity without a strategy can silently break session reuse or bind a session to the
  wrong task → P7 needs an explicit migration.
- **Sequencing verdict:** do identity groundwork first, **not** a full primary-key sweep. Seam C's
  specialist portion can proceed early; seam C's stage-list portion follows the compatibility seam
  and gets its own contract tests.

---

## 8. Decided vs. open

### Decided (settled design — not re-litigated during implementation)

- **Dependency order:** identity groundwork first, string-ID migration last (now **P8**). `TaskRef`
  is in-memory in P1–P7; the on-disk schema changes only in P8.
- **Stage config scope:** the §5.3 YAGNI line holds — additive insertion at the two declared
  extension points only; no arbitrary transitions/effects/recovery via config.
- **`EFFECTS` naming:** not renamed (P4 keeps the existing security vocabulary).
- **`commands.mjs`:** unchanged; invoked from inside the GitHub adapter (§3.1 boundary).
- **Compatibility invariant:** GitHub line byte-identical through P7; P8 ships its own migration +
  fresh golden baselines.
- **Second-implementation stage (P7):** a **`notify` stage** inserted at `after-qa` — read-only
  output plus a single `fact_webhook` effect, no custom state transition. This is the narrowest
  `Stage` that still exercises the manifest → loader → ordered-insertion → EffectSink path, so it
  stress-tests the abstraction without crossing the §5.3 YAGNI line.
- **Branch:** all phases land on `feature/guardian-extensibility`, cut from `auto-qa`, merged back
  via PR when the chosen phases are complete.

### Open

- **Start signal:** this document is the review artifact; implementation begins only on an explicit
  go for a **named phase** (e.g. "start P1"). No phase has started yet.
