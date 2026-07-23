# QA Report

## Change Intake

Record the named Change Intake before planning.

| Change Intake field | Record |
|---|---|
| Observed Facts |  |
| Inferred Intent | Intent:  Confidence:  Basis:  |
| Authoritative Acceptance Criteria | Criterion:  Source or owner:  |
| Unresolved Questions |  |

## Objective and Scope

| Field | Record |
|---|---|
| Objective |  |
| In scope |  |
| Out of scope |  |
| Change or requirement under review |  |

## Inputs and Assumptions

| Input or assumption | Source or owner | Effect on QA |
|---|---|---|
|  |  |  |

## Risk Analysis

| Risk ID | Priority | Risk statement | Validation layer | Must verify | Reason if omitted |
|---|---|---|---|---|---|
| R- | Must Verify / Should Verify / Optional / Explicitly Not Verified |  | Static/unit / API/integration / E2E/system / Specialist non-functional / Manual acceptance | Yes/No |  |

## Verification Plan

| Verification ID | Risk IDs | Preconditions | Method or steps | Expected result | Required evidence | Human gate |
|---|---|---|---|---|---|---|
| V- | R- |  |  |  | E- | Yes/No |

QA Plan Gate: OPEN/BLOCKED

| Plan gate field | Record |
|---|---|
| Objective and scope complete, including explicit non-goals | OPEN/BLOCKED:  |
| Inputs, assumptions, critical-context questions, and answers | OPEN/BLOCKED:  |
| Risks ranked with `Must Verify`, `Should Verify`, `Optional`, or `Explicitly Not Verified` | OPEN/BLOCKED:  |
| `Must Verify` methods, preconditions, expected results, evidence requirements, and human gates | OPEN/BLOCKED:  |
| Validation layers selected and omitted layers with reasons | OPEN/BLOCKED:  |
| Named Change Intake, existing coverage, and no unresolved critical or contradictory authoritative criterion | OPEN/BLOCKED:  |
| Risks, methods, omissions, evidence requirements, and human gates reviewed | OPEN/BLOCKED:  |

## Execution and Evidence

| Evidence ID | Verification ID | Command, request, or observation | Result | Artifact or reference | Executed at |
|---|---|---|---|---|---|
| E- | V- |  | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW |  |  |

Evidence must be actual and reviewable. A successful runner or command alone does not establish an overall `PASS`.

| Evidence handling field | Record |
|---|---|
| Evidence minimization and redaction | Minimum reviewable evidence only; redacted excerpt, hash, path, or summary:  |
| Risky-command human approval reference | Approval or human-gate ID, or `N/A`:  |
| Writable outputs | QA report and approved temporary QA artifacts only, such as evidence logs or screenshots; no product source, tests, fixtures, snapshots, configuration, or documentation:  |

Do not make raw credentials, tokens, secrets, personal data, production data, or sensitive request, response, or log values mandatory when a safer reviewable form is sufficient.

## Findings

Use exactly one category for each finding: product defect; test or verification issue; environment/data/permission/dependency/tooling issue; requirement or acceptance-criteria issue; needs-human-judgment issue; temporarily unconfirmed issue.

| Finding ID | Category | Status | Risk IDs | Verification IDs | Observed behavior | Expected behavior | Evidence reference | Impact | Next step |
|---|---|---|---|---|---|---|---|---|---|
| F- |  | FAIL/BLOCKED/NEEDS_HUMAN_REVIEW | R- | V- |  |  | E- |  |  |

## Unverified and Blocked Items

| Verification or risk ID | Omitted layer or item | Status | Why it was not verified | Blocker or missing prerequisite | Resolution and rerun condition |
|---|---|---|---|---|---|
| V-/R- |  | BLOCKED |  |  |  |

An unavailable required runner, for example `missing-qa-runner`, or an unavailable tool, dependency, environment, data source, or permission is an `environment/data/permission/dependency/tooling issue` with status `BLOCKED`, not product `FAIL`.

## Human Review Items

| Item ID | Related risk, verification, or finding | Decision question | Evidence references | Decision owner | Decision and date |
|---|---|---|---|---|---|
| H- | R-/V-/F- |  | E- |  |  |

## Residual Risks

| Risk ID | Residual risk after execution | Evidence and affected verification | Likelihood or impact | Mitigation, monitoring, or follow-up |
|---|---|---|---|---|
| R- |  | E-/V- |  |  |

## Overall Status and Conclusion

QA Conclusion Gate: COMPLETE/BLOCKED

| Conclusion gate field | Record |
|---|---|
| Evidence reconciled to every required verification and expected result | COMPLETE/BLOCKED:  |
| Findings classified and linked to risks, verification items, and evidence | COMPLETE/BLOCKED:  |
| Blocked, unverified, and omitted items reconciled with rerun conditions | COMPLETE/BLOCKED:  |
| Human review items and decisions reconciled | COMPLETE/BLOCKED:  |
| Residual risks, mitigations, and follow-up reconciled | COMPLETE/BLOCKED:  |
| Verification traceability | Risk → Verification → Evidence → Status:  |
| Finding traceability, when present | Finding → Risk / Verification / Evidence:  |
| No unresolved blocker or critical human decision remains for `PASS` | COMPLETE/BLOCKED:  |

| Overall status | Traceability |
|---|---|
| PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW | Risks: R-. Verification items: V-. Evidence: E-. Findings: F-. Blocked or unverified items: . Human review items: H-. Residual risks: R-. |

Traceability contracts: every required verification uses `Risk → Verification → Evidence → Status`; each finding, when present, links `Finding → Risk / Verification / Evidence`.

Conclusion: State what passed with evidence, what failed, what remains blocked or unverified, what requires human judgment, and which residual risks remain. `PASS` requires actual evidence for every required verification, no unresolved blocking risk, and no pending critical human decision. No evidence means no `PASS`.
