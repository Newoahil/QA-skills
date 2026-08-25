---
type: change
record_id: change-9b2bd6d959c648cda2fd598bc20215fa
date: 2026-08-25
title: Guardian pre-QA Supervisor evidence
status: implemented
source: T2 implementation on feature/guardian-extensibility
key_conclusion: Guardian now captures real Supervisor status/diff and scoped-test evidence before independent QA, then reuses the validated command plan only after QA PASS so PR timing and evidence provenance remain explicit.
topics: [qa-guardian, pre-qa, evidence]
author: Sisyphus
related_files: [tools/guardian/supervisor-exec.mjs, tools/guardian/stage-runner.mjs, tests/guardian/supervisor-exec.test.mjs, tests/guardian/stage-runner.test.mjs]
implements: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content
Added a Supervisor `pre-qa-evidence` operation that inspects status/diff and executes the validated scoped test argv without staging, committing, or pushing. `runQaStage` passes the resulting structured command, exit code, stdout, and stderr evidence into QA's diff summary. Finalization keeps the same validated plan and reruns it only after QA PASS.

## Reason for Change
QA must judge an actual pre-PR snapshot with Supervisor-owned evidence while remaining an independent no-shell session. Finalization must not require a pre-existing PASS before tests can run, and it must not alter QA timing.

## Impact Scope
The Supervisor and stage runner seams changed. Fixer, QA session independence, TaskRef/TaskSource/EffectSink, PM reservation, and GitHub effect ownership remain intact.

## Implementation
`preQaEvidence` returns status/diff and per-command evidence, preserving failed results and avoiding all mutation operations. Legacy injected test contexts receive a bounded empty evidence shape; the real scheduler uses the Supervisor operation. `finalizeFix` continues to use the same `plan.test_commands`.

## Test Verification
- `node --test tests/guardian/supervisor-exec.test.mjs tests/guardian/stage-runner.test.mjs` passed: 39/39.
- `npm run test:guardian` passed: 707/707.
- `node --check` passed for modified implementation modules.
- LSP diagnostics reported no errors for implementation and direct test files.
- `git diff --check` passed.

## Notes
QA remains an independent pre-PR session after Fixer completion and before finalization; no PR is created before QA PASS.
