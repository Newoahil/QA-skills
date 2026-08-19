---
type: bug
record_id: bug-a47057aaf97145de807476aef76844e3
date: 2026-08-19
title: Scheduler did not import the QA verdict artifact writer
severity: high
status: resolved
key_conclusion: Imported writeArtifact in the scheduler so a completed independent QA PASS can be persisted and continue through the QA gate and PR creation.
topics: [qa-guardian, qa-verdict, scheduler]
related: [bug-95af95c0c87348659c6d36a12974beb0, bug-aebf3f8b068f48b59ce275467409fa20]
---

## Bug Description

Issue #211 reached a completed independent QA PASS, but the scheduler failed before writing
`qa-verdict.json`. A foreground run exposed the exact runtime error:
`writeArtifact is not defined`.

## Root Cause

`scheduler.mjs` invoked `writeArtifact(...)` in the SDK QA path but imported only
`quarantineArtifacts`, `readArtifact`, and `readArtifactPair` from `artifacts.mjs`.

## Solution

- Import `writeArtifact` in `scheduler.mjs`.
- Add a regression assertion that the scheduler both imports and invokes the artifact writer.

## Prevention Measures

- The QA verdict runtime test now protects the wiring between scheduler and artifact persistence.
- Foreground scheduler reproduction remains the preferred way to expose post-agent orchestration
  failures that do not appear in the agent session transcript.

## Related Changes

- `tools/guardian/scheduler.mjs`
- `tests/guardian/qa-verdict-runtime.test.mjs`
- Full suite: 306/306 green.
