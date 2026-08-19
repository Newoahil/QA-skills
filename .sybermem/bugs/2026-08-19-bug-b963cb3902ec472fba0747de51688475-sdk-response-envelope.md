---
type: bug
record_id: bug-b963cb3902ec472fba0747de51688475
date: 2026-08-19
title: Unwrap OpenCode SDK response envelopes and structured output
severity: high
status: resolved
key_conclusion: Fixed SDK wrapper response handling: createSession now unwraps data.id, prompt/get/abort bypass the broken 1.18.18 path template using explicit low-level URLs, and json_schema results are read from data.info.structured rather than text parts.
topics: [opencode-sdk, structured-output, qa-guardian]
related: [bug-09c23cce8bb443d7aadb0f5dea5ce3b7, change-9c651671735d41ca84cb71a1c1bd2213]
---

## Bug Description

The real #211 E2E generated an empty dossier and an error-shaped plan. SDK probes showed:

- `session.create` returned `{ data: { id }, request, response }`, not `{ id }`;
- generated `session.prompt/get/abort` requested `/session/%7Bid%7D/...` (SDK 1.18.18 path
  template bug) and the server rejected `{id}` as a session id;
- successful json_schema output appeared in `data.info.structured`, not text parts.

## Root Cause

The wrapper assumed raw response data and high-level generated path methods worked. In SDK
1.18.18, responses are envelopes and the generated session path template is broken for
prompt/get/abort. Additionally, json_schema uses the StructuredOutput tool, so there may be no
text part at all.

## Solution

- `createSession` unwraps `result.data.id` and passes the target `directory` query.
- `prompt/getSession/abort` use the SDK low-level `_client` with explicit
  `/session/${encodeURIComponent(id)}/...` URLs.
- prompt unwraps `result.data`, joins text parts, and exposes `result.structured` from
  `data.info.structured`.
- specialist and plan runners prefer `structured`, falling back to text JSON parsing.

## Prevention Measures

- Tests assert explicit prompt/get/abort URLs and structured-output extraction.
- Real probes proved `ID ses_...`, `KIND ok`, and `STRUCTURED {"ok":true}`.
- Keep the compatibility wrapper isolated in `opencode-client.mjs`; remove only after a future
  SDK version is verified to fix the generated path template.

## Related Changes

- `tools/guardian/opencode-client.mjs`
- `tools/guardian/investigation-process.mjs`
- `tests/guardian/opencode-client.test.mjs`
- Full suite: 295/295 green.
