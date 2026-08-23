---
type: change
record_id: change-96411a1dd44048a394cca9c0e583e5f5
date: 2026-08-23
title: Propagate scheduler abort signals to SDK prompts
status: done
source: implementation
key_conclusion: Scheduler cancellation now reaches fixer and QA SDK prompts, so Ctrl+C/SIGTERM can cooperatively abort active shared-server sessions instead of only stopping the outer scheduler loop.
topics: [qa-guardian, abort-signal, scheduler, sdk-sessions]
author: Sisyphus
related_files: [tools/guardian/fixer-session-runner.mjs, tools/guardian/qa-session-runner.mjs, tools/guardian/scheduler.mjs, tests/guardian/fixer-session-runner.test.mjs, tests/guardian/qa-session-runner.test.mjs]
---

## Change Content
`runFixerSession()` and `runQaSession()` now accept a scheduler `AbortSignal` and forward it to `client.prompt()`. The scheduler passes its resident process signal into both SDK session runners.

Added regressions proving the exact signal object reaches fixer and QA prompt calls.

## Reason for Change
The review found that scheduler shutdown could abort the outer resident loop without propagating cancellation into active fixer/QA SDK prompts. That left shared-server sessions running until their own deadline or provider completion.

## Impact Scope
This affects the shared OpenCode SDK fixer and QA paths. Investigation specialists already accepted a signal. Child-process fallback remains unchanged.

## Implementation
Added optional `signal = null` parameters to the fixer and QA runners, passed the signal into their `client.prompt()` calls, and wired the scheduler's tick-level signal through both runner invocations.

## Test Verification
- `node --test "tests/guardian/fixer-session-runner.test.mjs" "tests/guardian/qa-session-runner.test.mjs"` passed 33/33.
- `node --check "tools/guardian/fixer-session-runner.mjs"` passed.
- `node --check "tools/guardian/qa-session-runner.mjs"` passed.
- `node --check "tools/guardian/scheduler.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 572/572.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed as `568a7a2 Propagate scheduler abort signals to SDK prompts`. This resolves the review blocker for Ctrl+C/SIGTERM propagation into active fixer and QA shared-server sessions.
