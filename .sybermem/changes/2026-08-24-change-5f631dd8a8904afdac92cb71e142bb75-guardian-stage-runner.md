---
type: change
record_id: change-5f631dd8a8904afdac92cb71e142bb75
date: 2026-08-24
title: Guardian fixer QA pipeline stage runner
status: implemented
source: P6 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian now runs the SDK fixer-to-QA sequence through a built-in stage manifest and stage runner while preserving existing state writes, artifacts, legacy execution, and post-QA finalization behavior.
topics: [qa-guardian, pipeline, stage-runner]
author: Sisyphus
related_files: [tools/guardian/stage-runner.mjs, tools/guardian/pipeline.manifest.mjs, tools/guardian/scheduler.mjs, tests/guardian/stage-runner.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Added a built-in two-stage pipeline manifest (`fixer`, then `qa`) and a stage runner that executes the existing SDK fixer session followed by independent QA. `scheduler.mjs` now delegates the SDK path to `runPipeline` and keeps the legacy child-process path plus post-QA audit, finalization, PR creation, verdict comments, and notification logic in place.

## Reason for Change

P6 of the extensibility plan needs a stage abstraction before adding a second stage implementation in P7. The safe boundary is the existing fixer-to-QA sequence, not the wider scheduler responsibilities.

## Impact Scope

The persisted state schema, `.qa/guardian/<issue>/` artifact paths, `fix/issue-<n>` branch naming, QA verdict artifact, session binding fields, and legacy invocation path remain unchanged. The source-level QA verdict regression guard remains satisfied by a scheduler-owned `writeQaVerdictArtifact` helper injected into the stage runner.

## Implementation

`stage-runner.mjs` validates manifest shape, stage ids, runner names, state transitions, retry policies, and extension points. The new test captures the previous state/artifact write order: fixer markdown, fixer state, branch state, QA markdown, QA state twice, and QA verdict artifact.

## Test Verification

- `node --test "tests/guardian/stage-runner.test.mjs" "tests/guardian/scheduler-session-status.test.mjs" "tests/guardian/fixer-session-runner.test.mjs" "tests/guardian/qa-session-runner.test.mjs" "tests/guardian/pipeline-harness.test.mjs"` passed: 42/42.
- `node --test "tests/guardian/qa-verdict-runtime.test.mjs" "tests/guardian/stage-runner.test.mjs"` passed: 8/8 after preserving the scheduler QA verdict artifact guard.
- `node --test "tests/guardian/*.test.mjs"` passed: 596/596.
- LSP diagnostics on `scheduler.mjs`, `stage-runner.mjs`, and `stage-runner.test.mjs` reported no diagnostics.

## Notes

P6 intentionally does not add notify stages, HTTP task sources, task-id persistence, or user-configurable pipeline loading. Those remain P7/P8 concerns.
