---
type: bug
record_id: bug-09c23cce8bb443d7aadb0f5dea5ce3b7
date: 2026-08-19
title: OpenCode SDK 1.18.18 session path template prevents prompt/get/abort
severity: high
status: resolved
key_conclusion: Fixed SDK session operations by unwrapping createSession's data.id and using the SDK low-level client with explicit /session/<id>/ URLs, because the generated 1.18.18 path methods request /session/%7Bid%7D/... and fail every prompt.
topics: [opencode-sdk, session-continuity, qa-guardian]
related: [change-2d00718e55fc479195377618f8fe8527, change-9c651671735d41ca84cb71a1c1bd2213]
---

## Bug Description

The real #211 E2E generated an empty dossier and an error-shaped plan. Direct SDK probes showed
`session.create` succeeded, but every `session.prompt` returned `UnknownError: Unexpected server
error`. The server log reported: `Expected a string starting with "ses", got "%7Bid%7D"`.

## Root Cause

Two SDK integration mistakes combined:

1. `session.create` returns `{ data: { id }, request, response }`; the wrapper read `result.id`,
   returning the full response object instead of the `ses_...` id.
2. `@opencode-ai/sdk@1.18.18` generated high-level `session.prompt/get/abort` methods build URLs
   containing the unresolved `{id}` template (`/session/%7Bid%7D/...`) even when
   `path.sessionID` is supplied.

## Solution

- `createSession` unwraps `result.data.id` and passes the target `directory` query.
- `prompt/getSession/abort` use the official SDK's low-level `_client` transport with explicit
  URLs (`/session/${encodeURIComponent(id)}/...`), retaining SDK transport/interceptors while
  bypassing the broken generated template.
- `prompt` unwraps `result.data` and joins text parts into `result.text` for role runners.

## Prevention Measures

- Added tests that assert the exact explicit URL used for prompt/get/abort.
- Added a real probe proving createSession returns a valid `ses_...` id and prompt returns
  `KIND ok / TEXT Hello!`.
- Keep this compatibility layer isolated in `opencode-client.mjs`; remove it only after verifying
  a future SDK version fixes the generated path template.

## Related Changes

- `tools/guardian/opencode-client.mjs`
- `tests/guardian/opencode-client.test.mjs`
- Full suite: 295/295 green.
