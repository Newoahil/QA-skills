---
type: change
record_id: change-3045c5709920400db10cd5ae1215f1e0
date: 2026-08-24
title: Guardian HTTP task source and notify stage
status: implemented
source: P7 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian now has a second TaskSource implementation and a second pipeline stage implementation, proving both extensibility seams without changing default GitHub scheduler behavior or requiring durable string task ids.
topics: [qa-guardian, task-source, pipeline, notify-stage]
author: Sisyphus
related_files: [tools/guardian/http-task-source.mjs, tests/guardian/http-task-source.test.mjs, tools/guardian/stage-runner.mjs, tools/guardian/pipeline.manifest.mjs, tests/guardian/stage-runner.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Added an HTTP/API dispatch `TaskSource` adapter that maps injected dispatch records into source-neutral `TaskObservation` values with `http` task refs, facts, cursor, terminal state, and control events.

Added a built-in `notify` pipeline stage at the `after-qa` extension point. The stage is default no-op and only emits a single `fact_webhook` effect through an injected `EffectSink` when explicitly enabled.

## Reason for Change

P7 validates the extensibility design by adding one real second implementation for task sources and one real second implementation for pipeline stages, without widening P8 identity persistence scope.

## Impact Scope

Default GitHub scheduler behavior remains unchanged because the notify stage skips unless `notifyStage.enabled === true`, an effect sink is injected, and a webhook URL is provided. No persisted state schema, filename, branch naming, or `task_id` migration was introduced.

## Implementation

`http-task-source.mjs` mirrors the existing task-source contract without relying on GitHub comments. The notify stage emits only `EFFECTS.FACT_WEBHOOK` as `ACTORS.SUPERVISOR`; effect authorization remains owned by the provided sink.

## Test Verification

- `node --test "tests/guardian/http-task-source.test.mjs" "tests/guardian/github-task-source.test.mjs"` passed: 6/6.
- `node --test "tests/guardian/stage-runner.test.mjs" "tests/guardian/http-task-source.test.mjs" "tests/guardian/effect-sink.test.mjs" "tests/guardian/scheduler-session-status.test.mjs" "tests/guardian/qa-verdict-runtime.test.mjs"` passed: 16/16.
- `node --test "tests/guardian/*.test.mjs"` passed: 599/599.
- LSP diagnostics on HTTP source, HTTP source tests, stage runner, pipeline manifest, and stage runner tests reported no diagnostics.

## Notes

P8 remains deferred and should only be activated if non-numeric task sources need durable scheduler state.
