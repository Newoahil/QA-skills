# QA-Lite Report

## Profile Decision

Profile Decision: LITE/FULL

| Decision field | Record |
|---|---|
| Triage source | `qa-triage` routing state only; not evidence:  |
| Lite eligibility | One bounded requirement/fix/Diff, explicit product target, explicit scope, safe local verification, no Full trigger:  |
| Full fallback | If facts invalidate eligibility, record `Profile Decision: FULL` and continue `qa-plan` -> `qa-execute` -> `qa-conclude`:  |

## Preflight

Repository Preflight occurs before actual Diff/source inspection.

| Preflight field | Record |
|---|---|
| Skill source path | Supplied:  Resolved:  |
| Product target path | Supplied:  Resolved:  |
| Product target decision | Explicit product target accepted / BLOCKED:  |
| Scope readability | Explicit readable scope and non-goals:  |
| Safe local verification | Existing safe local verification method for scoped Must Verify:  |
| Diff/source timing | Preflight completed before actual Diff/source inspection:  |

## Change Intake

| Change Intake field | Record |
|---|---|
| Observed Facts |  |
| Inferred Intent | Intent:  Confidence:  Basis:  |
| Authoritative Acceptance Criteria | Criterion:  Source or owner:  |
| Unresolved Questions |  |

## Objective/Scope

| Field | Record |
|---|---|
| Objective |  |
| In scope |  |
| Out of scope |  |
| Product target |  |

## Risk/Verification/Evidence/Status

Use `Risk - Verification - Evidence` traceability for every scoped item.

| Risk ID | Priority | Verification ID | Expected result | Method | Evidence ID/reference | Status |
|---|---|---|---|---|---|---|
| R- | Must Verify / Should Verify / Optional / Explicitly Not Verified | V- |  |  | E- | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW |

No evidence means no `PASS`; without evidence a scoped `Must Verify` item cannot PASS and overall PASS is unavailable. Fresh rerun evidence is required after external repair or other material change.

## Findings

| Finding ID | Category | Risk IDs | Verification IDs | Evidence reference | Link to product target location | Status | Next step |
|---|---|---|---|---|---|---|---|
| F- | product defect / test or verification issue / environment/data/permission/dependency/tooling issue / requirement or acceptance-criteria issue / needs-human-judgment issue / temporarily unconfirmed issue | R- | V- | E- |  | FAIL/BLOCKED/NEEDS_HUMAN_REVIEW |  |

## Blocked/Unverified

| Item ID | Related risk or verification | Status | Blocker or unverified reason | Rerun condition |
|---|---|---|---|---|
| B- | R-/V- | BLOCKED |  |  |

## Human Review

| Human gate ID | Related risk, verification, or finding | Question | Evidence references | Owner | Decision/status |
|---|---|---|---|---|---|
| H- | R-/V-/F- |  | E- |  | NEEDS_HUMAN_REVIEW |

## Residual Risks

| Risk ID | Residual risk | Evidence and affected verification | Mitigation or follow-up |
|---|---|---|---|
| R- |  | E-/V- |  |

## QA Lite Gate

| Gate field | Record |
|---|---|
| Repository Preflight before Diff/source inspection | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Change Intake complete | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Risk - Verification - Evidence chain complete | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Findings linked to evidence | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Blocked, unverified, human review, and residual risks reconciled | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Exact relay / authoritative report delivery evidence | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |

Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW

Conclusion: State only what the scoped evidence proves. Do not make a release decision or project-wide claim.
