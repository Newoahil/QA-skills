---
type: bug
record_id: bug-ed371946bdd44873af961a30f33378f8
date: 2026-08-21
title: Per-prompt model sent as string yielded empty response (must be object)
status: resolved
source: manual
key_conclusion: Passing a per-prompt model as a raw "provider/model" string to POST /session/:id/message made OpenCode silently return an empty response (parts_count=0) which then failed JSON parse as "Unexpected end of JSON input"; fixed by converting the string to OpenCode's required { providerID, modelID } object in the client.
topics: [guardian-runtime, opencode, model-config]
author: Sisyphus
related_files: [tools/guardian/opencode-client.mjs, tests/guardian/opencode-client.test.mjs]
---

## Description

After making model selection config-driven, every specialist failed within 18-32ms with `specialist-final-json parse failed for <role>: Unexpected end of JSON input`. The prompt returned `kind: ok` but with `parts_count=0` and empty text in ~5ms, so the empty string was JSON-parsed and threw.

## Root Cause

The config-driven model was passed to `POST /session/:id/message` as a raw string (e.g. `"cpa/gpt-5.5"`). Per the OpenCode SDK type `SessionPromptData`, the message body `model` field must be an object `{ providerID: string, modelID: string }`. A raw string is silently ignored/rejected by the server, which returns an empty assistant message instead of an error — producing the empty-JSON parse failure downstream. Verified live: string `cpa/gpt-5.5` → 5ms empty response; object `{ providerID: 'cpa', modelID: 'gpt-5.5' }` → 9.6s `OK`.

## Solution

Added `toModelObject(model)` in `opencode-client.mjs` and applied it in `promptOnce`: a `provider/model` string is split on the FIRST slash into `{ providerID, modelID }` (so ids like `openrouter/anthropic/x` keep the tail as modelID); an already-shaped object is passed through; nullish/malformed yields no model (session/agent default). Both the primary model and fallback models now go through this normalization.

## Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 549/549 (updated the two fallback tests that asserted the old string shape).
- Live smoke: the fixed client with string model `cpa/gpt-5.5` now returns `OK` in ~4s (was 5ms empty).

## Notes

This was a defect in the config-driven-model change (record change-2b02bc5e): the string was threaded correctly but not shaped into the object the endpoint requires. The undici timeout fix and portability design were unaffected.
