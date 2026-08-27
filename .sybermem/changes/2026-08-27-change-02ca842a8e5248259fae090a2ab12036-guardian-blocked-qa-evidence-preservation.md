---
type: change
record_id: change-02ca842a8e5248259fae090a2ab12036
date: 2026-08-27
title: Preserve terminal non-PASS QA evidence
status: completed
source: implementation-session
key_conclusion: Guardian now persists and returns complete QA verdict evidence for environment BLOCKED and NEEDS_HUMAN_REVIEW handbacks so operators retain actionable diagnostics without changing state routing, GitHub comment behavior, or authority boundaries.
topics: [qa-guardian, qa-evidence, reliability]
author: Sisyphus
related_files: [tools/guardian/stage-runner.mjs, tests/guardian/stage-runner.test.mjs]
related: [change-87e938ab00a2459ba4cf6e70a1042c40]
---

## Change Content
Aligned terminal non-PASS QA handling in `runQaStage`: environment `BLOCKED` now persists the same verdict status, report hash, evidence summary, and sanitized Supervisor evidence already retained for other QA outcomes; both environment `BLOCKED` and `NEEDS_HUMAN_REVIEW` return the constructed `qaVerdict` when stopping the pipeline.

## Reason for Change
The handback state previously preserved the environment-blocked reason but omitted the detailed QA report from authoritative state and dropped the verdict from the pipeline result. Keeping the already-created evidence makes blocked runs diagnosable and observable while remaining fail-closed.

## Impact Scope
Only QA stage evidence persistence and its direct regression test changed. The issue still transitions to `HANDED_BACK` with the existing reason, no PR is created, no approval is granted, and the scheduler's GitHub verdict-comment policy is unchanged.

## Implementation
- Added `qa_verdict_status`, `qa_verdict_hash`, `qa_verdict_report`, and `supervisor_test_evidence` to the environment-blocked state write.
- Returned `qaVerdict` from both terminal environment `BLOCKED` and `NEEDS_HUMAN_REVIEW` branches.
- Strengthened the existing stage-runner test to assert persisted state evidence and returned verdicts for both outcomes.
- Verified the related base-freshness behavior remains implemented separately: the Supervisor fetches `origin/<base_branch>` before Fixer edits, creates new fix branches from the latest base, refreshes clean stale branches, and fails dirty stale branches closed. The authoritative details remain in related record `change-87e938ab00a2459ba4cf6e70a1042c40`.

## Test Verification
- Red test confirmed the prior missing return with `TypeError: Cannot read properties of undefined (reading 'status')`.
- `node --test tests/guardian/stage-runner.test.mjs`: 30/30 passed.
- `npm run test:guardian`: 837/837 passed.
- `node --check` passed for the implementation and test files.
- LSP diagnostics reported no issues for either changed file.
- Commit `dca931d fix(guardian): preserve blocked qa evidence` was pushed to `origin/feature/guardian-extensibility`.

## Notes
This change intentionally does not make worktrees continuously track remote `dev` and does not add a pre-PR rebase. Base freshness is enforced at Fixer branch preparation; long-running work may still encounter ordinary upstream divergence later, which remains visible to human PR review.
