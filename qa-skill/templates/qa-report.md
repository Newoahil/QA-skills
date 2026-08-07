# QA Report

## Repository Preflight

Record Repository Preflight before Change Intake.

| Repository Preflight field | Record |
|---|---|
| Skill source path | Supplied skill source path:  Canonical/resolved skill source path:  |
| Product target path | Supplied:  Resolved:  |
| Target decision | Explicit target accepted / targeted clarification needed / Repository Preflight BLOCKED:  |
| Git context | Git root from target probe / non-Git / unavailable; do not infer from `.git` presence:  |
| Target scope | Target-only QA scope and non-goals:  |
| Baseline and scoped Diff | Usable scoped Diff available, or Diff-dependent checks BLOCKED because:  |
| Blocked reason and rerun condition |  |
| Non-Diff limitations |  |

## Change Intake

Record the named Change Intake before planning.

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
| Profile Decision | `LITE` / `FULL`:  |
| Rigor | `Standard` / `Audit` / `N/A`:  |
| Approval reference | Required only when `Rigor` is `Audit`:  |
| Plan-stage validator | Available when Node is already available:  Invocation: `node "<resolved skill source path>/tools/validate-qa-plan.mjs" "<plan.json>" --json`  Result:  |
| Conclusion-stage validator | Invocation: `node "<resolved skill source path>/tools/validate-qa-plan.mjs" "<plan.json>" --json --require-conclusion`  Result:  |
| Authority boundary | JSON sidecar is planning and reconciliation metadata only. It is not product QA evidence, the authoritative report, Human Gate approval, or a release decision. |

## QA Applicability Matrix

Allowed assessments: `Required`, `Recommended`, `Not Applicable`, `Blocked`, `Deferred`.

Use one fixed row for each category. Keep the basis, readiness, omissions, rerun conditions, and residual risk auditable.

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

Plan Gate and Conclusion Gate must reconcile this matrix. The Plan Gate stays BLOCKED until all 11 rows have an assessment, a basis, and a readiness decision. The Conclusion Gate stays BLOCKED until every `Required`, `Recommended`, `Not Applicable`, `Blocked`, or `Deferred` row is reconciled against evidence, factual justification, omissions, rerun conditions, and residual risk.

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
| QA applicability matrix complete, with all 11 categories assessed and readable before opening | OPEN/BLOCKED:  |
| Repository Preflight reconciled: separate paths, explicit target decision, Git context, target-only scope, usable scoped Diff or blocked reason, and non-Diff limitations | OPEN/BLOCKED:  |
| Structured QA Plan Artifact contract is valid or a manual fallback is disclosed before OPEN; a validator contract failure blocks readiness | OPEN/BLOCKED:  |
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

Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW

| Conclusion gate field | Record |
|---|---|
| Evidence reconciled to every required verification and expected result | COMPLETE/BLOCKED:  |
| Findings classified and linked to risks, verification items, and evidence | COMPLETE/BLOCKED:  |
| Blocked, unverified, and omitted items reconciled with rerun conditions | COMPLETE/BLOCKED:  |
| Human review items and decisions reconciled | COMPLETE/BLOCKED:  |
| Residual risks, mitigations, and follow-up reconciled | COMPLETE/BLOCKED:  |
| QA applicability matrix reconciled, with every `Required`, `Recommended`, `Not Applicable`, `Blocked`, or `Deferred` row tied back to evidence, factual justification, omissions, reruns, and residual risk | COMPLETE/BLOCKED:  |
| Structured QA Plan Artifact conclusion contract recorded with `--require-conclusion` validation or disclosed manual fallback; a validator contract failure blocks the conclusion output contract | COMPLETE/BLOCKED:  |
| Verification traceability | Risk → Verification → Evidence → Status:  |
| Finding traceability, when present | Finding → Risk / Verification / Evidence:  |
| No unresolved blocker or critical human decision remains for `PASS` | COMPLETE/BLOCKED:  |

| Overall status | Traceability |
|---|---|
| PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW | Risks: R-. Verification items: V-. Evidence: E-. Findings: F-. Blocked or unverified items: . Human review items: H-. Residual risks: R-. |

Traceability contracts: every required verification uses `Risk → Verification → Evidence → Status`; each finding, when present, links `Finding → Risk / Verification / Evidence`.

Conclusion: State what passed with evidence, what failed, what remains blocked or unverified, what requires human judgment, and which residual risks remain. `PASS` requires actual evidence for every required verification, no unresolved blocking risk, and no pending critical human decision. No evidence means no `PASS`.
