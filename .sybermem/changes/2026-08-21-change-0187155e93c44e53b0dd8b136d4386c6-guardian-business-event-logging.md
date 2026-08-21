---
type: change
record_id: change-0187155e93c44e53b0dd8b136d4386c6
date: 2026-08-21
title: Guardian emits full business event logs for a run
status: completed
source: manual
key_conclusion: Guardian now logs the whole run chain (issue discovery, per-issue routing, each investigation specialist begin/ok/failed, plan begin/ok, fixer/qa begin, and provider model fallback) as structured events, so an operator can see whether issues were fetched and which agents ran instead of only seeing a final failure.
topics: [guardian-runtime, observability, logging]
author: Sisyphus
related_files: [tools/guardian/scheduler.mjs, tools/guardian/investigation-runtime.mjs, tools/guardian/opencode-client.mjs]
---

## Change Content

Added structured business event logs across the Guardian run chain using the existing `{ts,level,component,event,...}` logger:

- `discovery.candidates` — after listing GitHub issues, logs count/open/followups/issue list (emitted from `listCandidates` via an injected logger).
- `route.decision` — one per issue with action/to_state/reason.
- `investigation.begin` + `specialist.begin` / `specialist.ok` / `specialist.failed` (role, round, duration_ms, error message) — emitted from `prepareInvestigation` via an injected logger.
- `plan.begin` / `plan.ok` (duration_ms, valid).
- `fixer.begin` / `qa.begin` (issue, round) alongside the existing stopped/retry/passed events.
- `provider.fallback` — emitted from the OpenCode client when a prompt downgrades to the next fallback model on a provider cooldown (from_model/to_model/code/status).

No business logic changed; only observability was added. Logs never include issue title/body, tokens, secrets, or raw provider response bodies.

## Reason for Change

The operator could not tell from logs whether Guardian had fetched issues from GitHub, which routing decision each issue got, which specialist agents were launched, or whether a provider fallback occurred; only a terminal `investigation.failed` was visible. Complete,规范 business events make each run auditable before real testing.

## Impact Scope

Affects Guardian scheduler discovery/routing/agent-launch logging, the investigation runtime specialist/plan logging, and the OpenCode client fallback logging. `prepareInvestigation` and `createOpencodeClient` gained an optional `logger` (default no-op / null), and `listCandidates` reads `deps.logger`. No permission, read-only boundary, state machine, or model-selection behavior changed.

## Implementation

- `investigation-runtime.mjs`: added optional `logger` param and specialist/plan lifecycle events.
- `scheduler.mjs`: passed `logger` into `listCandidates`, `createOpencodeClient`, and `prepareInvestigation`; added `route.decision`, `fixer.begin`, `qa.begin`.
- `opencode-client.mjs`: added optional `logger` and a `provider.fallback` warn event on model downgrade.

## Test Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 543/543.
- `node --check` passed for changed Guardian modules.
- `git diff --check` reported only expected CRLF conversion warnings.
- Live smoke: ran `prepareInvestigation` with an injected logger and observed the full ordered chain (investigation.begin → specialist.begin/ok ×N → plan.begin/ok); confirmed no issue title/body leaked into logs via the failure-path regression test.

## Notes

Dify recall remained unavailable (`D:\QA-skills\.opencode\tools\dify_recall.py` missing). Regression tests pin the key events: discovery.candidates, specialist.begin/ok/failed, plan.begin/ok, and provider.fallback.
