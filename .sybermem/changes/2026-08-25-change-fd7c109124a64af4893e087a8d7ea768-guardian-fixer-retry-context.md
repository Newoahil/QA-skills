---
type: change
record_id: change-fd7c109124a64af4893e087a8d7ea768
date: 2026-08-25
title: Guardian Fixer retry context
status: implemented
source: T4 implementation on feature/guardian-extensibility
key_conclusion: Guardian persists prior QA report and Supervisor test evidence and injects them as untrusted DATA into the reused Fixer session, preserving exact recovery context without creating a new session.
topics: [qa-guardian, fixer, session-reuse]
author: Sisyphus
related_files: [tools/guardian/fixer-session-runner.mjs, tools/guardian/stage-runner.mjs, tests/guardian/fixer-session-runner.test.mjs]
implements: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content
Added prior-QA context to Fixer retries. The stage runner persists QA verdict/report and Supervisor evidence, then passes them to `runFixerSession` only on a QA retry marker. The Fixer prompt delimits both values as untrusted DATA, and session continuity remains governed by the existing resolver.

## Reason for Change
Bounded retries must be recoverable after restart and must show the Fixer the exact failed outcome and evidence without allowing report text to become instructions or creating a new session that loses context.

## Impact Scope
Fixer session prompt/state recovery changed; QA remains read-only and independent, and no Fixer finalization effect was introduced.

## Implementation
`PRIOR_QA_OUTCOME` and `SUPERVISOR_TEST_EVIDENCE` are JSON-encoded DATA sections. Persisted fields include verdict, report, and evidence needed for recovery. Existing valid Fixer sessions are reused unchanged.

## Test Verification
- `node --test tests/guardian/fixer-session-runner.test.mjs tests/guardian/stage-runner.test.mjs tests/guardian/state-router.test.mjs` passed: 67/67.
- Full Guardian suite and static checks are run again at phase close.

## Notes
No new Fixer session is created for a valid persisted session; the prompt remains shell-free and the injected report/evidence is explicitly untrusted.
