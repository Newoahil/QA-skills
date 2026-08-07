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

## Structured QA Plan Artifact

`qa-plan/v1` planning and reconciliation metadata only. It is not product QA evidence, the authoritative report, Human Gate approval, or a release decision.

| Artifact field | Record |
|---|---|
| Artifact reference/path | `plan.json` or equivalent local path:  |
| Schema/version | `qa-plan/v1` |
| Profile Decision | `LITE` |
| Rigor | `Standard` / `N/A`; `Audit` requires escalation to `FULL`:  |
| Approval reference | `N/A` while the route remains Lite:  |
| Plan-stage validator | If Node is already available, run `node "<resolved skill source path>/tools/validate-qa-plan.mjs" "<plan.json>" --json`. Result:  |
| Conclusion-stage validator | If Node is already available, run `node "<resolved skill source path>/tools/validate-qa-plan.mjs" "<plan.json>" --json --require-conclusion` before the QA Lite Gate. Result:  |
| Authority boundary | JSON sidecar is planning and reconciliation metadata only. It is not product QA evidence, the authoritative report, Human Gate approval, or a release decision. |

## QA Applicability Matrix

Allowed assessments: `Required`, `Recommended`, `Not Applicable`, `Blocked`, `Deferred`.

Lite keeps one fixed row for each category inside the bounded profile. If any row cannot be justified from the bounded profile, escalate to Full and continue in `qa-plan`.

| Category | Assessment | Change or project basis | Risk / verification IDs | Coverage sufficiency / readiness | Evidence / result | Deferred / blocked resolution | Residual risk |
|---|---|---|---|---|---|---|---|
| Static/build |  |  |  |  |  |  |  |
| Unit |  |  |  |  |  |  |  |
| Integration |  |  |  |  |  |  |  |
| Contract/API |  |  |  |  |  |  |  |
| E2E |  |  |  |  |  |  |  |
| Database/migration |  |  |  |  |  |  |  |
| Security |  |  |  |  |  |  |  |
| Performance |  |  |  |  |  |  |  |
| Compatibility |  |  |  |  |  |  |  |
| Accessibility/visual |  |  |  |  |  |  |  |
| Regression |  |  |  |  |  |  |  |

Lite does not allow `Blocked` or `Deferred` matrix rows while it remains Lite. If any row becomes `Blocked` or `Deferred`, or any Lite semantic rule fails, escalate to Full before execution or conclusion.
When Node is already available, plan validation happens before execution. Node unavailability alone does not block product QA or justify installation.

Every Lite row must be assessed within the bounded profile or escalated to Full before the exact relay can be treated as complete.

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
| QA applicability matrix complete, with all 11 categories assessed or escalated to Full | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Risk - Verification - Evidence chain complete | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Findings linked to evidence | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Blocked, unverified, human review, and residual risks reconciled | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Structured QA Plan Artifact conclusion contract recorded with `--require-conclusion` validation or disclosed manual fallback; a validator contract failure blocks the Lite conclusion output contract | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |
| Exact relay / authoritative report delivery evidence | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW:  |

Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW

Conclusion: State only what the scoped evidence proves. Do not make a release decision or project-wide claim.
