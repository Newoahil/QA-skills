---
type: change
record_id: change-fc6f4a6d2cb045139598ab804c0355e3
date: 2026-08-25
title: Guardian plan validation retry
status: implemented
source: Issue #263 investigation retry hardening on feature/guardian-extensibility
key_conclusion: Guardian now canonicalizes specialist evidence namespaces from the scheduled role and retries one locally invalid plan with exact validator errors before handing back.
topics: [qa-guardian, investigation, plan-validation]
author: Sisyphus
related_files: [tools/guardian/evidence.mjs, tools/guardian/investigation-coordinator.mjs, tools/guardian/investigation-process.mjs, tools/guardian/investigation-runtime.mjs, tests/guardian/evidence.test.mjs, tests/guardian/investigation-coordinator.test.mjs, tests/guardian/investigation-runtime.test.mjs]
---

## Change Content
Canonical specialist role identity is now injected during dossier synthesis so duplicate evidence IDs use runtime roles such as `guardian-runtime:E1`, even if a specialist self-reports a verbose display name. Investigation planning now retries once when `validatePlan` returns any errors, passing those exact errors back as untrusted DATA while preserving the first invalid plan as `plan-invalid.json`.

## Reason for Change
Issue #263 reproduced two plan-validation failures after all specialists succeeded: the generated plan referenced canonical evidence IDs while the dossier had verbose self-reported prefixes, and LOW risk was emitted with string `localImpact` / `diffLines` values. Those local validation errors prevented `plan.json` creation and therefore blocked downstream spec/plan review.

## Impact Scope
The validator policy is unchanged and remains fail-closed. The change is limited to evidence namespace normalization, plan-builder retry feedback, and investigation runtime retry orchestration. Existing specialist/session execution and GitHub side effects are unchanged.

## Implementation
`synthesizeDossier` accepts wrapped `{ role, result }` specialist outputs from `prepareInvestigation` and passes the scheduled role into `normalizeSpecialistResult`. `processPlanBuilder` includes retry guidance when `previousPlanErrors` are provided, including exact LOW risk assessment typing/budget constraints. `prepareInvestigation` allows at most two plan attempts and throws with validator errors if the retry is still invalid.

## Test Verification
- `node --test tests/guardian/evidence.test.mjs tests/guardian/investigation-coordinator.test.mjs tests/guardian/investigation-runtime.test.mjs tests/guardian/investigation-process.test.mjs tests/guardian/plan-validator.test.mjs` passed: 70/70.
- `node --test "tests/guardian/*.test.mjs"` passed: 729/729.

## Operational Follow-up
After the fix, issue #263 state/artifacts were backed up to `D:\tuantuanrent.qa-guardian-control\.qa\guardian\263-reset-backup-20260825-191435` and active `263.json`, `263\`, and `.scheduler.lock` were confirmed absent so the next scheduler start can claim it fresh.
