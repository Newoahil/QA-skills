---
type: change
record_id: change-17308a56b3624791a0d2d64f2f049455
date: 2026-08-25
title: Guardian QA outcome routing
status: implemented
source: T3 implementation on feature/guardian-extensibility
key_conclusion: Guardian now routes PASS, FAIL, BLOCKED, and NEEDS_HUMAN_REVIEW through explicit lifecycle states, bounding code-actionable retries and handing environment/manual blockers back without active-state residue.
topics: [qa-guardian, lifecycle, qa-outcomes]
author: Sisyphus
related_files: [tools/guardian/stage-runner.mjs, tools/guardian/state-router.mjs, tests/guardian/stage-runner.test.mjs, tests/guardian/state-router.test.mjs]
implements: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content
Added explicit QA outcome routing. FAIL retains bounded Fixer retries and hands back at the cap. BLOCKED caused by missing Supervisor evidence reruns QA in VERIFYING; code-actionable BLOCKED retries Fixer with a distinct marker; environment/manual BLOCKED and NEEDS_HUMAN_REVIEW persist HANDED_BACK states.

## Reason for Change
Non-PASS QA outcomes must never leave ambiguous active FIXING/VERIFYING residue or allow PR creation. The scheduler needs recoverable, auditable state transitions that distinguish actionable code failures from human/environment blockers.

## Impact Scope
Only stage and pure router lifecycle decisions changed. QA remains independent and PR creation remains blocked unless the final verdict is PASS.

## Implementation
The stage runner classifies the report's `blocker_class` DATA marker and persists `qa-evidence-retry`, `qa-blocked-code-actionable-retry`, `qa-blocked-environment`, and `qa-needs-human-review` markers. The router consumes the missing-evidence marker into VERIFYING.

## Test Verification
- `node --test tests/guardian/stage-runner.test.mjs tests/guardian/state-router.test.mjs` passed: 52/52.
- Combined T3/T4 focused tests passed: 67/67.
- Full Guardian suite and static checks are run again at phase close.

## Notes
All non-PASS outcomes keep PR creation blocked; human retry remains the explicit recovery path for handed-back states.
