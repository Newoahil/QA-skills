---
type: change
record_id: change-bc32a227720045119b782db221dbe469
date: 2026-08-23
title: Require QA before Guardian finalization and preserve acceptance comments
status: done
source: implementation
key_conclusion: Moved Guardian commit/push finalization behind audited QA PASS and forwarded QA acceptance prose into verdict comments so the scheduler matches the independent-QA-before-PR product contract.
topics: [qa-guardian, qa-gate, verdict-comment]
author: Sisyphus
related_files: [tools/guardian/scheduler.mjs, tools/guardian/fixer-session-runner.mjs, tests/guardian/fixer-session-runner.test.mjs, tests/guardian/verdict-comment-integration.test.mjs]
---

## Change Content
Updated the SDK fixer path so `runFixerSession()` reports a validated completion and PR summary but never invokes `supervisor.finalizeFix()` itself. The scheduler now runs independent QA against the prepared fix branch first, audits the resulting `qa-verdict`, and only then calls Supervisor finalization to run scoped tests, stage, commit, and push.

Also updated `writeVerdictComment()` wiring so `prTitle` and `qaAcceptanceMarkdown` reach `buildVerdictComment()`. The issue verdict comment now contains the QA-authored Chinese acceptance artifact instead of falling back to generic generated bullets.

## Reason for Change
The review found two product-contract violations: the enforced SDK path committed and pushed before independent QA completed, and verdict comments silently dropped the QA acceptance prose. Both broke the intended separation of powers: Fixer edits, read-only QA verifies, then Supervisor finalizes and publishes the evidence.

## Impact Scope
This affects the shared OpenCode SDK scheduler path and the Supervisor verdict-comment writer. The legacy child-process path is unchanged. Supervisor remains the only owner of commit/push/PR creation, and QA remains read-only.

## Implementation
The fixer runner now returns `completion` metadata for scheduler use and leaves `finalization` null. Scheduler persists the expected fix branch after branch preparation, passes fixer completion metadata to QA as data, audits QA output, and calls `supervisor.finalizeFix()` only when `auditQaVerdict()` approves. The approved PR flow then uses the finalized branch and forwards QA acceptance fields to the verdict comment builder.

## Test Verification
- `node --test "tests/guardian/fixer-session-runner.test.mjs" "tests/guardian/qa-session-runner.test.mjs" "tests/guardian/qa-gate.test.mjs" "tests/guardian/qa-verdict-runtime.test.mjs" "tests/guardian/gate2-pr.test.mjs" "tests/guardian/verdict-comment.test.mjs" "tests/guardian/verdict-comment-integration.test.mjs" "tests/guardian/supervisor-exec.test.mjs"` passed 69/69.
- `node --check "tools/guardian/fixer-session-runner.mjs"` and `node --check "tools/guardian/scheduler.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 558/558.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed as `7fcb411 Require QA approval before finalization` and `2c3b025 Include QA acceptance in verdict comments`. This resolves the QA-before-finalize blocker and the QA acceptance issue-comment passthrough defect from the QA Guardian review.
