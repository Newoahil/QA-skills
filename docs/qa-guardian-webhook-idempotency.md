# QA Guardian — Phase 4 webhook trigger & unified idempotency (normative)

> **This document is the normative Phase 4 architecture**, locked after an Oracle consultation on
> the concurrency/idempotency fork. It defers to
> [`qa-guardian-role-architecture.md`](./qa-guardian-role-architecture.md) on frozen invariants and
> the authorization model, and refines §5 Phase 4 into an implementable design.

## 0. One-line verdict

The webhook is a **durable wake-up producer only** — never a state writer, never an authorization
evaluator. The existing scheduler remains the **sole consumer and sole writer**: it drains wake
records, acquires the existing N=1 lease, rereads GitHub, and runs the existing pure `state-router`
and `commands` seams. Truth always comes from GitHub, never from the webhook payload.

## 1. Locked decisions (do not reopen)

1. **Webhook never applies a transition and never authorizes.** It cannot: it has neither exclusive
   ownership of `.qa/guardian/<n>.json` nor the canonical comment view, and its payload may be
   duplicated, delayed, or observed before a later comment. Treating the payload as a command would
   break both human-comment authorization and latest-wins chronology.
2. **The scheduler is the only serialization point.** No distributed locking between the cloud
   container and the local workspace. The cloud relay is transport infrastructure, not a second
   participant in state ownership.
3. **GitHub comment chronology stays canonical.** A webhook delivery is only a *reason to
   reconcile issue N*; it never identifies which command wins. Reconciliation always rereads all
   relevant comments and calls `selectCommand`, so `isNewerComment` chronology still decides.
4. **State stays single-writer.** All `.qa/guardian/<n>.json` writes happen inside the scheduler's
   critical section under the existing lease (read → route → write → launch decision).

## 2. Control flow

```text
GitHub webhook
  -> cloud callback-server.mjs
       verify signature/envelope
       accept: issues | issue_comment | pull_request | push
       derive target issue number only
       durable INSERT delivery_id if absent   (idempotent ingress dedupe)
       return 2xx AFTER durable insert
  (callback server does NOT run gh, selectCommand, state-router, or write .qa/)

local scheduler (sole consumer + sole writer)
  -> interval tick OR relay wake
  -> acquire existing global N=1 lease
  -> drain pending wake targets from relay; ACK; record locally
  -> union with interval-compensation targets (open qa-guardian issues)
  -> for each issue N (coalesced to a set, reconciled once):
       read fresh GitHub facts via gh
       read .qa/guardian/N.json
       selectCommand(latest eligible HUMAN comment)   (chronology = truth)
       state-router(state, ghFacts, lease) -> one action
       application-token guard: skip if this transition already committed
       persist state + transition ledger atomically
       launch/resume AT MOST ONE fixer if the router says so
       post notifications/verdicts via existing Supervisor paths
  -> heartbeat / release lease
```

## 3. Unified 3-layer idempotency ledger

Three DISTINCT identities protecting three different boundaries. Do NOT collapse them into one
"event id".

### 3.1 Ingestion identity — webhook `delivery_id`
"Have we accepted this webhook delivery already?"
- Cloud inbox: `webhook_inbox/<delivery_id>` → `{ delivery_id, event_type, issue_number,
  received_at, status: pending|claimed|forwarded }`. Authoritative ingress dedupe.
- Local mirror after drain: `.qa/guardian/ledger/ingested/<delivery_id>.json`. Audit/retry
  boundary, written idempotently.
- **Subsumes** the callback path's in-memory `seen` set (which does not survive restart / multi
  instance). `seen` may remain as an optimization, never as the correctness mechanism.
- Does NOT subsume `last_consumed_comment_id` — a delivery is not a command.

### 3.2 Artifact identity — GitHub object id
"Which GitHub object caused/represents the work?"
- command / verdict: `issue_number + comment_id`; PR: `repo + pull_request_number`; push: commit
  SHA only if tracked.
- Local: `.qa/guardian/ledger/artifacts/<issue>/commands/<comment-id>.json`,
  `.../verdicts/<comment-id>.json`, `.qa/guardian/ledger/artifacts/prs/<pr-number>.json`.
- **Never** use the webhook `delivery_id` as command identity (many deliveries can describe one
  comment; one delivery may precede later comments).
- Existing fields: `last_consumed_comment_id` stays the fast-path chronology cursor; the durable
  command artifact ledger becomes the stronger audit/idempotency record. `last_verdict_comment_hash`
  stays for content dedupe (not a sufficient artifact id — two comments can share content).
  `last_notified_state` stays a notification cursor, not repurposed.

### 3.3 Application identity — applied-transition token (NEW)
"Has the scheduler applied this logical operation?"
```text
transition_token = sha256(repo ":" issue ":command:" selected_comment_id ":verb:" verb ":action:" router_action)
# commandless (DONE/STALLED/compensation):
#   issue:<n>:state:<current>:action:<router-action>:facts:<stable-facts-digest>
```
- Local: `.qa/guardian/ledger/applied/<issue>/<token>.json` →
  `{ token, issue_number, action, command_comment_id, from_state, to_state, applied_at,
  effect_status: committed|in_progress|completed|retryable }`.
- This ledger is NEW — no current field represents an applied transition
  (`last_consumed_comment_id` = consumption not completion; `last_notified_state` = notify emission;
  `last_verdict_comment_hash` = verdict content; `seen` = neither).
- `last_consumed_comment_id` stays in the schema as a compatibility cursor; on successful command
  application, update it AND write the application record in the same critical section.

## 4. Crash semantics (exactly-once logical transition)

Represent the critical operation as `intent -> transition committed -> external effect completed`,
not a boolean dedupe. For fixer-launching actions: write the application record as `in_progress`
BEFORE launch (under the lease), pass the deterministic token to the launch. On restart, examine
`in_progress` records + lease/state facts:
- fixer demonstrably active → resume/monitor;
- not active → retry the SAME token (never a new logical run);
- mark `completed` only after the existing completion/verdict path succeeds.

Guarantee = **exactly-once logical transition token + at-most-one active fixer under the lease**,
with retryable `in_progress` recovery. Absolute exactly-once external process execution across
arbitrary crash is not claimed (would need a transactional job runner).

## 5. Concurrency mechanism

A single global work queue consumed by the existing scheduler loop, guarded by the existing global
N=1 lease. One `reconcile(issueNumber)` function; two producers (interval compensation lists open
issues; relay drain adds targets). Producers only ADD issue numbers; only the scheduler loop
reconciles and writes. A relay poll may shorten the sleep / wake the loop but must NOT reconcile
concurrently. Rejected alternatives and their failure modes: webhook handler calling reconcile
(second writer race); per-issue locks only (no global N=1 fixer bound); independent webhook worker
(distributed lock + lost-update races); relying only on the fixer-run lease (may not cover the whole
scheduler critical section — extend the lock to cover read→route→write→launch).

## 6. Deployment shape (cross-machine)

Fold webhook reception into the existing [`callback-server.mjs`](../tools/guardian/callback-server.mjs)
(already owns REST/PAT + signature verification). It: verifies signature; accepts
issues/issue_comment/pull_request/push; extracts issue number; durably inserts by `delivery_id`;
exposes an authenticated pull/claim + ack endpoint; returns 2xx only after durable insert. It MUST
NOT write `.qa/`, run `gh`, select commands, launch agents, or post verdicts.

The scheduler (different machine: local workspace + gh + git) periodically pulls:
```text
GET  /guardian/wakes?consumer_id=<scheduler-id>     -> pending records
POST /guardian/wakes/<delivery-id>/ack              -> idempotent ack
```
The inbox retains unacknowledged records with a visibility/lease timeout so a scheduler crash causes
redelivery. Relay outage only DELAYS webhook-triggered reconciliation — the interval GitHub poll is
the compensation backstop (intended failure mode; no authorization/state-ownership compromise). If
the cloud container FS is ephemeral, back the inbox with its existing DB or a managed queue, never
container-local files.

## 7. Regression tests (lock the design)

`node --test` with injected GitHub/relay/clock/fs/process deps, no network:
1. **Delivery replay** — same `delivery_id` twice → one durable inbox record + one wake target.
2. **Webhook + compensation convergence** — one human `/guardian` comment + webhook wake + interval
   wake → one command artifact, one application token, one transition, one fixer launch.
3. **Out-of-order vs chronology** — old webhook after a newer eligible comment exists → `selectCommand`
   picks the newer comment, never webhook arrival time.
4. **Concurrent duplicate issue wakes** — two near-simultaneous deliveries + two ticks → lease permits
   one reconciliation/fixer run; one valid read-modify-write result.
5. **Crash recovery** — persist an `in_progress` transition, simulate launch crash, restart → same
   token retried/resumed (not a second run); verdict/state writes stay single-writer.

## 8. Escalation triggers

Revisit only if: the local scheduler cannot reliably reach the relay; webhook volume makes relay
polling materially expensive; or multiple independent scheduler machines must be active. Then move to
a real durable queue with visibility leases + explicit single-consumer ownership. Abandoning
single-writer state (CAS/versioned state, distributed locking, transactional event processing) is
NOT justified for Phase 4.
