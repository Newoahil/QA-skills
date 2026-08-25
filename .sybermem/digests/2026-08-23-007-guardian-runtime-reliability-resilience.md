---
type: digest
kind: phase
date: 2026-08-23
number: 007
title: Guardian runtime reliability, provider resilience & concurrency hardening
status: completed
source_records:
  - changes/2026-08-20-change-856058c87cf3450e8460263aeef5cb2a-guardian-capability-memory.md
  - changes/2026-08-21-change-0187155e93c44e53b0dd8b136d4386c6-guardian-business-event-logging.md
  - changes/2026-08-21-change-27078cb8ae6e43b19f65ab149bdb87ca-guardian-per-role-models-cooldown-fallback.md
  - changes/2026-08-21-change-2b02bc5e4e534535a15f2ef47dc9986d-config-driven-portable-models.md
  - changes/2026-08-21-change-7dc3767885cd4c9cb2ff5a1b5d8ca73d-guardian-opencode-provider-errors.md
  - changes/2026-08-21-change-5330fd1c1188484fa1647010616d8195-guardian-investigation-json-logging.md
  - changes/2026-08-21-change-30d32899761b40d8ac9f442695dfec62-configurable-session-deadlines.md
  - changes/2026-08-21-change-0042ab69c2b94eb49a3576bfaadea0e4-investigation-no-timeout-duration-telemetry.md
  - changes/2026-08-21-change-60858dbd238d4a13a5190dc40a7a1965-guardian-scheduler-startup-runtime.md
  - changes/2026-08-21-change-76c5d0ed9fac48cb970da4f0329c2454-shared-opencode-serve-plan-b.md
  - changes/2026-08-23-change-96411a1dd44048a394cca9c0e583e5f5-abort-signal-propagation.md
  - changes/2026-08-23-change-9a4b5837878a4ecb8b3f19802d8933cf-scheduler-dryrun-no-fetch.md
  - changes/2026-08-23-change-c239a32f90e64b70900d8c3e4b4b08fd-opencode-dispatcher-lifecycle.md
  - changes/2026-08-23-change-c92529725557423dacc30e3244241a94-deadline-abort-cleanup.md
  - changes/2026-08-23-change-ccc37d2238b34c2c847a647079a7d498-lock-corruption-races.md
  - changes/2026-08-23-change-8a7e53756a744118b2fe955d659e78d3-mechanical-risk-gate.md
  - bugs/2026-08-21-bug-0555bcc31a2e4b2a81d7d41fe989ac86-specialist-prompt-fetch-failed-undici-timeout.md
  - bugs/2026-08-21-bug-18e1e4841f894cb49f1815d3cc2277c1-dead-owner-scheduler-lock.md
  - bugs/2026-08-21-bug-209175d9b7974cc18bae1aea0eae8a6f-specialist-session-pollution-and-fallback.md
  - bugs/2026-08-21-bug-ed371946bdd44873af961a30f33378f8-prompt-model-must-be-object.md
coverage:
  from: 2026-08-21
  to: 2026-08-23
coverage_hash: 28fe41a6dcdcf49de0943fd2c1904b8f35440f03969074711d3a6dfbda43752e
---

## Phase Scope
Making the SDK-based runtime survive real provider failures, long prompts, and concurrency edges: config-driven portable models with cooldown fallback, the shared `opencode serve` (Plan B), abort-signal propagation, scheduler-lock corruption/race hardening, and the undici timeout / model-object / session-pollution bug cluster.

## Core Conclusions
- Model selection is **config-driven and portable**: no hardcoded provider/model in agent definitions; per-role models read from `.qa/guardian/config.json` (with default + OpenCode global-default fallback), and prompts **auto-retry on the next fallback model on provider cooldown (429)** so one model cooldown can't brick an investigation.
- Guardian treats OpenCode `info.error` responses as **provider failures** (not JSON-parse failures) and waits for all investigation specialists, so cooldown no longer appears as parse errors or stale "running" state; structured JSON/prompt diagnostics name the bad boundary and missing optional specialists no longer cause empty-output parse errors.
- **A per-prompt model must be an object `{ providerID, modelID }`** — passing a raw `"provider/model"` string to `POST /session/:id/message` makes OpenCode silently return an empty response that then fails JSON parse.
- **Specialist sessions must be fresh per investigation**: reusing a long-lived session (keyed by an unchanging round) contaminates structured output; only genuinely transient provider errors trigger fallback, and specialist/plan prompts are bounded by an app-level deadline.
- The **undici default 300s header/body timeout** (unaffected by the SDK's `req.timeout=false`) aborted long prompts with "fetch failed" ~307s; fixed by a custom fetch backed by an undici `Agent` with header/body timeouts disabled.
- Session **deadlines are configurable** (`fixer_deadline_ms`/`qa_deadline_ms`, default 60 min) via `resolveSessionDeadlineMs`, which stays positive even when investigation is "unlimited" (`child_timeout_ms=0`); investigation forced timeouts were removed in favor of duration telemetry + persisted specialist sessions for retry/TUI, and Ctrl+C/abort propagates through fixer/QA SDK prompts.
- **Concurrency/lifecycle hardening**: N=1 lock acquisition requires both a live lease and an alive owner PID (dead-owner locks reclaimed immediately); lock parsing/corrupt-lock reclaim/heartbeat-ownership hardened; deadline results settle before best-effort abort cleanup so a hung abort can't hold the lock; the shared OpenCode client has an explicit close lifecycle closed each tick to avoid leaking undici dispatchers.
- **Shared `opencode serve` (Plan B)**: `guardian-start.bat` auto-starts one shared serve and points both scheduler (SDK sessions) and read-only TUI (`--base-url`) at it, so specialist/fixer/QA sessions are natively viewable / `opencode attach`-able; degrades to subprocess mode if serve is unavailable.
- Business-event logging emits the whole run chain (discovery, per-issue routing, specialist begin/ok/failed, plan begin/ok, fixer/qa begin, provider fallback); optional non-blocking SyberMem recall/record and config-gated specialists are available without making OMO/SyberMem mandatory. Deterministic risk grading is wired into plan validation so a model-written LOW can't bypass Gate 1 unless the mechanical LOW whitelist is satisfied.

## Key Decisions and Changes
- Config-driven portable models + per-role pinning + cooldown fallback; provider-error classification; investigation JSON logging; configurable deadlines; no-timeout duration telemetry; scheduler-startup ReferenceError + ASCII label fix; shared opencode serve (Plan B); abort-signal propagation; dry-run no-fetch; dispatcher lifecycle close; deadline/abort decoupling; lock corruption/race hardening; mechanical risk gate.
- Bugs: undici timeout, dead-owner lock, specialist session pollution + over-eager fallback, per-prompt model-must-be-object.

## Current State
The runtime survives provider cooldowns, long prompts, aborts, and lock corruption; models are portable across users' providers; the shared serve makes sessions observable. This is the reliability substrate under all later Guardian behavior.

## Recommended Next Reads
- digest-003 — the SDK sessions this phase makes resilient.
- digest-006 — the TUI/dashboard that attach to the shared serve.
- digest-009 — later fixer/QA outcome routing and evidence built on this substrate.

## Source Coverage
20 records (16 changes + 4 bugs), 2026-08-21 to 2026-08-23, covering runtime reliability, provider resilience, and concurrency hardening.
