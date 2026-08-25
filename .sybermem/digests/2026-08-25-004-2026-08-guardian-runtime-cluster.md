---
type: digest
kind: phase
date: 2026-08-25
number: 004
title: 2026-08 guardian-runtime cluster
status: completed
source_records:
  - bugs/2026-08-21-bug-0555bcc31a2e4b2a81d7d41fe989ac86-specialist-prompt-fetch-failed-undici-timeout.md
  - bugs/2026-08-21-bug-209175d9b7974cc18bae1aea0eae8a6f-specialist-session-pollution-and-fallback.md
  - bugs/2026-08-21-bug-ed371946bdd44873af961a30f33378f8-prompt-model-must-be-object.md
  - changes/2026-08-21-change-0187155e93c44e53b0dd8b136d4386c6-guardian-business-event-logging.md
  - changes/2026-08-21-change-27078cb8ae6e43b19f65ab149bdb87ca-guardian-per-role-models-cooldown-fallback.md
  - changes/2026-08-21-change-2b02bc5e4e534535a15f2ef47dc9986d-config-driven-portable-models.md
  - changes/2026-08-21-change-7dc3767885cd4c9cb2ff5a1b5d8ca73d-guardian-opencode-provider-errors.md
coverage:
  from: 2026-08-21
  to: 2026-08-21
coverage_hash: c7b3bd49255c196a57496652ff2d0acaec8f93092fa7bfc43b2e0c139fe487c3
---

## Phase Scope

This phase covers the Guardian runtime's OpenCode SDK execution reliability work on 2026-08-21: provider/model configuration, structured prompt behavior, long-running prompt transport, specialist session isolation, provider-error handling, and operator-visible business logging.

## Core Conclusions

- Guardian runtime prompts must treat OpenCode SDK calls as long-lived operations: undici's default 300s header/body timeout aborts slow model responses unless the client supplies a custom fetch with disabled header/body timeouts and a bounded connect timeout.
- Per-prompt model selection must use OpenCode's `{ providerID, modelID }` shape. Passing a raw `provider/model` string can yield empty assistant messages and downstream JSON parse failures.
- Model selection belongs in `.qa/guardian/config.json`, not repository agent frontmatter. Repo-baked provider IDs make the tool non-portable; role-specific models and fallback models are optional user configuration.
- Provider failures surfaced through `data.info.error` are real failures even when HTTP status is 200. Guardian must report safe provider metadata, retry only genuinely transient errors, and avoid parsing empty `parts` as JSON.
- Specialist investigations are one-shot read-only work and should start fresh sessions; reusing long-lived sessions pollutes structured-output prompts with prior context.
- Runtime diagnosis needs structured business events for discovery, routing, specialist lifecycle, plan lifecycle, fixer/QA entry, and provider fallback so operators can distinguish no work, provider cooldown, stale state, and genuine failures.

## Key Decisions and Changes

- Added an undici-backed custom fetch for the OpenCode client with header/body timeouts disabled while keeping connection establishment bounded.
- Normalized configured model strings into OpenCode model objects, and routed primary/fallback models through the same conversion.
- Replaced hardcoded agent model frontmatter with `resolveModelForRole(config, role)`, using per-role config, default config, then OpenCode's global/agent default.
- Detected `data.info.error` provider failures, whitelisted safe error fields, and limited fallback retries to retryable cooldown/rate-limit/timeout/server conditions.
- Changed specialist session resolution to always create fresh specialist sessions and added app-level specialist/plan prompt deadlines with abort cleanup.
- Added structured Guardian business events without logging secrets, issue bodies, or raw provider responses.

## Current State

The runtime can run portable provider configurations, survive slow model responses, classify provider cooldowns as provider failures instead of JSON parse errors, and expose enough structured events for operator debugging. The remaining operational caveat from the source records was that one live end-to-end specialist verification was blocked by a crashed shared OpenCode serve, not by the code path under test.

## Recommended Next Reads

- `bugs/2026-08-21-bug-0555bcc31a2e4b2a81d7d41fe989ac86-specialist-prompt-fetch-failed-undici-timeout.md`
- `bugs/2026-08-21-bug-209175d9b7974cc18bae1aea0eae8a6f-specialist-session-pollution-and-fallback.md`
- `changes/2026-08-21-change-2b02bc5e4e534535a15f2ef47dc9986d-config-driven-portable-models.md`
- `changes/2026-08-21-change-7dc3767885cd4c9cb2ff5a1b5d8ca73d-guardian-opencode-provider-errors.md`

## Source Coverage

7 records listed in frontmatter `source_records`.
