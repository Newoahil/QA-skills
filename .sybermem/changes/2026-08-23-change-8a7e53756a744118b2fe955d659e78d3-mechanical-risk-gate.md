---
type: change
record_id: change-8a7e53756a744118b2fe955d659e78d3
date: 2026-08-23
title: Enforce mechanical Guardian risk gates
status: done
source: implementation
key_conclusion: Wired deterministic risk grading into plan validation so a model-written LOW cannot bypass Gate 1 unless the mechanical LOW whitelist is explicitly satisfied.
topics: [qa-guardian, risk-gate, plan-validation]
author: Sisyphus
related_files: [tools/guardian/plan-validator.mjs, tools/guardian/risk.mjs, tests/guardian/plan-validator.test.mjs, tests/guardian/plan-gate.test.mjs, tests/guardian/pipeline-harness.test.mjs]
---

## Change Content
`validatePlan()` now calls `gradeRisk(plan.risk_assessment)` and requires both `plan.risk === 'LOW'` and a mechanical LOW result before granting `autonomousReady`. If the model writes LOW without a complete low-risk assessment, or if any whitelist clause fails, the plan remains structurally valid but requires Gate 1.

Added regressions across the plan validator, plan gate, and injected pipeline harness proving that missing mechanical LOW proof stops at `GATE_1_WAIT` even when the plan prose says LOW and QA would otherwise pass.

## Reason for Change
The review found that `gradeRisk()` existed but was not enforced in the scheduler plan path. Trusting `plan.risk` alone allowed a model-produced LOW to skip Gate 1 without mechanically proving low-danger surface, local impact, diff budget, reproducible oracle, and no scope expansion.

## Impact Scope
This affects enforced/shadow plan validation and any scheduler path that relies on `assessFixingEntry()`. Legacy mode remains unchanged. Human Gate 1 approval can still allow structurally valid non-autonomous plans, but autonomous LOW now needs the deterministic whitelist.

## Implementation
The plan validator keeps structural validity separate from autonomous readiness: mechanical risk failures are exposed as `plan:risk-assessment-not-low:*` errors and set `gateRequired`, but they do not make an otherwise well-formed plan structurally invalid. The returned result now includes `mechanicalRisk` for audit visibility.

## Test Verification
- `node --test "tests/guardian/risk-grading.test.mjs" "tests/guardian/plan-validator.test.mjs" "tests/guardian/plan-gate.test.mjs" "tests/guardian/pipeline-harness.test.mjs"` passed 33/33.
- `node --check "tools/guardian/plan-validator.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed 562/562.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed as `d04433d Enforce mechanical Guardian risk gates`. This resolves the review blocker where model-written LOW risk could previously bypass Gate 1 without deterministic verification.
