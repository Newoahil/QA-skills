---
type: change
record_id: change-f0b58f56a9aa4db49863cfe04ea14b5d
date: 2026-08-25
title: Guardian profile enforcement and PM source reservation
status: accepted
source: follow-up remediation after final review
key_conclusion: Guardian now enforces execution profiles, completes Gate 1 dual-channel closeout, fences finalization effects, marks new claims active, validates scheduler timing, and reserves source=pm as an explicit no-side-effect route so future PM integration remains additive.
topics: [qa-guardian, execution-profile, pm-integration]
author: Sisyphus
related_files: [tools/guardian/stage-runner.mjs, tools/guardian/notify-io.mjs, tools/guardian/scheduler.mjs, tools/guardian/supervisor-exec.mjs, tools/guardian/github-effect-sink.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e, decision-e8c0d364373b42a890557ce99762e7c8]
---

## Change Content
Completed the ordered follow-up remediation after the Guardian review. The runtime now enforces executionType profiles at the pipeline boundary, completes Gate 1 comment plus configured webhook delivery before recording its notification marker, fences verdict comments and supervisor finalization before irreversible operations, persists newly claimed issues as INVESTIGATING, validates lease/poll timing configuration, and reserves source=pm as an explicit pm-source-reserved route with a GitHub EffectSink defense-in-depth guard.

## Reason for Change
The prior review found that executionType routing existed only as a helper, Gate 1 custom closeout bypassed the webhook channel, stale runs could reach direct finalization/comment boundaries, newly claimed issues remained DISCOVERED during long investigation, and malformed timing values could undermine N=1 safety. The future PM workflow is intentionally not implemented yet; the source marker and profile boundary make that future adapter additive without allowing PM work to fall through GitHub behavior.

## Impact Scope
Stage profile selection, Gate 1 notification, scheduler claims/configuration, finalization/verdict boundaries, GitHub effect dispatch, and focused regression tests. GitHub source continues the existing coding pipeline. PM source is reserved and blocked with no GitHub side effects. PM TaskSource/EffectSink bodies, non-coding profiles, PM DAG ownership, and full P8 identity migration remain deferred.

## Implementation
- Wired executionSpec.executionType into runPipeline profile selection.
- Reused the normal safe webhook channel in Gate 1 closeout.
- Added active-run guards to verdict comment and supervisor finalization operations.
- Persisted INVESTIGATING at the initial new-task claim.
- Added finite-positive lease/poll validation with a minimum lease-to-poll ratio.
- Added source=pm reservation and GitHub-only EffectSink dispatch validation.

## Test Verification
- Full Guardian suite after the final implementation phase: 694 passed, 0 failed.
- Intermediate phase totals: 683, 685, 687, 688, 692, and 694 passed with no failures.
- LSP diagnostics on changed files: no diagnostics.
- `node --check` on changed modules: passed.
- `git diff --check`: passed.
- SyberMem project index build/check: passed.

## Notes
Commits: 6480a23, 7548141, 852e79e, f13e397, f73a59d, 78556dc. This record preserves the accepted PM preparation decisions and does not claim live GitHub/OpenCode E2E or PM workflow support.
