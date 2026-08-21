---
type: bug
record_id: bug-0555bcc31a2e4b2a81d7d41fe989ac86
date: 2026-08-21
title: Specialist prompts failed with fetch failed at ~300s (undici timeout)
status: resolved
source: manual
key_conclusion: Long specialist/fixer/QA prompts aborted with "fetch failed" at ~307s because Node's built-in undici default headersTimeout/bodyTimeout is 300s and the SDK's req.timeout=false does not affect it; fixed by giving the OpenCode SDK client a custom fetch backed by an undici Agent with header/body timeouts disabled.
topics: [guardian-runtime, opencode, undici-timeout]
author: Sisyphus
related_files: [tools/guardian/opencode-client.mjs, tests/guardian/opencode-client.test.mjs, package.json]
---

## Description

Every Guardian investigation of issue #205 failed with all specialists reporting `specialist <role> prompt failed: fetch failed`. Business event logs showed `specialist.begin` for all four roles followed, ~307 seconds later, by four simultaneous `specialist.failed` with `duration_ms` ≈ 306993. Short probe prompts (a few seconds) always succeeded; only long-running model prompts failed.

## Root Cause

The specialist/fixer/QA prompts are long-lived HTTP requests: the model may run for several minutes before the response headers arrive. Node's built-in undici uses a default `headersTimeout`/`bodyTimeout` of 300s. The `@opencode-ai/sdk` client sets `req.timeout = false` on the request object, but that flag does not affect Node's undici transport, so the request was aborted at ~300s with `fetch failed`. The ~307s failure time across all four concurrent specialists confirmed a fixed client-side timeout rather than a provider or concurrency issue.

## Solution

Added `undici` as an explicit dependency and built the SDK client with a custom `fetch` bound to an undici `Agent` configured `{ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30000 }`. Connection establishment still fails fast, but a slow model response is no longer aborted. Verified live: a real guardian-code investigation prompt now runs ~157s and returns `kind: ok` where it previously failed at ~307s.

## Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 547/547.
- `node --check` passed for changed modules.
- Live smoke: long guardian-code prompt succeeded end-to-end via the fixed client; the same session still returns provider-error only for genuine cooldown, not a timeout.

## Notes

undici 8.10.0 added to package.json/package-lock.json. This is portable (npm install brings it) and unrelated to any provider/model configuration.
