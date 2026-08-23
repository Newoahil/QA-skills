---
type: change
record_id: change-c239a32f90e64b70900d8c3e4b4b08fd
date: 2026-08-23
title: Close shared OpenCode client dispatchers
status: done
source: implementation
key_conclusion: Added an explicit close lifecycle to the shared OpenCode client and closed it at the end of each scheduler tick so per-tick undici dispatchers are not leaked.
topics: [qa-guardian, opencode-client, scheduler, resource-lifecycle]
author: Sisyphus
related_files: [tools/guardian/opencode-client.mjs, tools/guardian/scheduler.mjs, tests/guardian/opencode-client.test.mjs]
---

## Change Content
`createOpencodeClient()` now retains the long-lived undici dispatcher internally and exposes an async `close()` method. The dispatcher remains stripped from the SDK factory config, preserving the SDK boundary while still allowing Guardian-owned lifecycle cleanup.

`scheduler.mjs` now wraps each shared-server tick in a `finally` block that calls `opencodeClient.close()` when a shared OpenCode server URL is configured.

## Reason for Change
The review found that each scheduler tick could create a new long-lived undici `Agent` through the shared OpenCode client without a corresponding close path. In resident scheduler mode, that risks accumulating unused dispatchers over time.

## Impact Scope
This affects only the shared OpenCode server path (`QA_GUARDIAN_OPENCODE_SERVER_URL`). Child-process fallback remains unchanged. Public client behavior is preserved with one new lifecycle method.

## Implementation
Added injectable `sdkConfigFactory` for tests, retained the dispatcher as a closure-local resource, and added `close()` to the returned client. The scheduler tick now closes the client in an outer `finally`, including idle/no-run ticks and early returns after gate/defer paths.

## Test Verification
- `node --test "tests/guardian/opencode-client.test.mjs" "tests/guardian/scheduler-core.test.mjs" "tests/guardian/scheduler-state.test.mjs" "tests/guardian/guardian-runtime.test.mjs"` passed 42/42.
- `node --check "tools/guardian/opencode-client.mjs"` passed.
- `node --check "tools/guardian/scheduler.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 567/567.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed as `ede8265 Close shared OpenCode client dispatchers`. This resolves the review blocker for per-tick shared OpenCode undici Agent lifecycle leaks.
