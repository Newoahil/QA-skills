---
type: bug
record_id: bug-209175d9b7974cc18bae1aea0eae8a6f
date: 2026-08-21
title: Specialist investigations failed via reused-session pollution and over-eager model fallback
status: resolved
source: manual
key_conclusion: Specialist investigations produced non-JSON results because they reused a long-lived session (keyed by an unchanging round) whose accumulated history contaminated the structured output, compounded by classifying any info.error as a retryable cooldown and downgrading models; fixed by always creating a fresh specialist session, only falling back on genuinely transient provider errors, and bounding specialist/plan prompts with an app-level deadline.
topics: [guardian-runtime, opencode, investigation]
author: Sisyphus
related_files: [tools/guardian/session-resolver.mjs, tools/guardian/opencode-client.mjs, tools/guardian/investigation-process.mjs, tools/guardian/budgets.mjs, tools/guardian/scheduler.mjs]
---

## Description

After the model-object fix, specialists still failed: logs showed `provider.fallback cpa/gpt-5.5 -> cpa/gpt-5.6-sol` with `code=null status=null`, then `specialist.failed ... Unexpected token 'O', "OK" is not valid JSON` after ~15 minutes. Verified via OpenCode docs and live probes (oracle-assisted).

## Root Cause (chain)

1. Specialist sessions were reused: the create-vs-reuse key was `round`, which stays 1 across re-discovery/retries, so every attempt reused the original 07:47 session with large accumulated history (including an earlier manual "reply OK" exchange).
2. `gpt-5.5` returned an assistant `info.error` with no status/code; `opencode-client.prompt` classified ANY `info.error` as `provider-error` and the fallback loop retried on the next model — an unnecessary downgrade for a non-transient error.
3. The fallback ran on the same polluted session; the model answered the stale context and returned free text `OK`.
4. Specialists request structured JSON via `format:{type:'json_schema'}`; with no `structured` output, `extractJson('OK')` threw `Unexpected token 'O'`.
5. No app-level deadline on specialist/plan SDK prompts (undici header/body timeouts are disabled for long runs), so a hung/queued prompt wasted ~15 min. (Live verification of the final fix was blocked because the shared serve had crashed — ECONNREFUSED — a separate operational issue.)

Confirmed by probe: a FRESH session + gpt-5.5 + `format` returns `info.structured` = the full JSON object in ~7s; the format field and structured path are correct.

## Solution

1. `session-resolver.mjs`: specialists ALWAYS create a fresh session (removed round-based reuse); they are one-shot read-only investigations, so no session history should ever carry over.
2. `opencode-client.mjs`: `normalizeProviderError` now computes `retryable` (only 429/408/5xx or an explicit cooldown/rate-limit code); the fallback loop downgrades models ONLY when `error.retryable === true`. Unknown errors (null code+status) surface as a hard failure instead of a wasteful downgrade.
3. `investigation-process.mjs` + `budgets.mjs`: specialist/plan SDK prompts are bounded by a config `specialist_deadline_ms` (default 30 min, always positive); on timeout the session is aborted and the specialist fails, releasing the N=1 lock.

## Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 551/551.
- `node --check` passed for changed modules.
- Red tests first proved each gap (fresh-session, no-fallback-on-unknown-error, deadline-abort).
- End-to-end live specialist verification is pending a serve restart (serve had crashed during testing).

## Notes

The undici custom-fetch (long-lived dispatcher) from an earlier fix could not be re-verified here because the shared serve was down; its interaction with SDK Request objects should be re-checked once serve is back. `format:{type:'json_schema'}` is correct and unchanged.
