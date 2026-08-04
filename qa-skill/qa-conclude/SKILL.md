---
name: qa-conclude
description: Use when executed QA evidence must be classified and turned into a bounded human-reviewable conclusion
---

# QA Conclude

## Conclusion Gate

Apply the Conclusion Gate before writing an overall status. Every finding, unverified item, omission, blocker, and human item must be classified and linked to the plan, verification item, and evidence. Use the [finding classification](../references/finding-classification.md), [human gates](../references/human-gates.md), [evidence guide](../references/evidence-guide.md), and [QA report template](../templates/qa-report.md).

Reconcile the report's named **QA Conclusion Gate: COMPLETE/BLOCKED** placeholder. Apply canonical status precedence: a missing or contradictory objective acceptance prerequisite that prevents an expected result or executable must-verify check is `BLOCKED`; objective evidence that cannot replace a subjective, business, design, safety, privacy, or owner decision is `NEEDS_HUMAN_REVIEW`; when both apply, record the Human Gate but keep the affected verification and overall status `BLOCKED`. Do not declare the gate complete while required reconciliation or a blocking prerequisite is missing.

Replace the standalone `Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW` placeholder with exactly one of `PASS`, `FAIL`, `BLOCKED`, or `NEEDS_HUMAN_REVIEW` on its own line. This marker is mandatory: it must match the summary/traceability table and conclusion, and it must not be omitted or only implied by prose or a table. A conflict between the marker, traceability table, or conclusion, or a missing marker, blocks completion of the conclusion output contract.

Require every required verification to have complete `Risk → Verification → Evidence → Status` traceability. Each finding, when present, must link `Finding → Risk / Verification / Evidence`. The QA Conclusion Gate is `BLOCKED` when a required verification link is missing or a present finding lacks its required links.

The [six finding categories and four statuses](../references/finding-classification.md) are the source of truth: `product defect`, `test or verification issue`, `environment/data/permission/dependency/tooling issue`, `requirement or acceptance-criteria issue`, `needs-human-judgment issue`, and `temporarily unconfirmed issue`, mapped to `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW`. Keep visible omissions and blockers separate from confirmed failures. An unavailable required runner, tool, dependency, permission, data source, or environment is `BLOCKED`, not product `FAIL`.

## Reconcile the Report

1. Reconcile `Observed Facts`, `Inferred Intent`, `Authoritative Acceptance Criteria`, and `Unresolved Questions` from the named Change Intake against the approved scope, expected behavior, and execution results. Inferred intent must not replace authoritative acceptance criteria.
2. Check each must-verify item against fresh evidence IDs and the exact command or tool that produced them.
3. Confirm every result records observed behavior, expected behavior, exit or status, artifact, omissions or blockers, findings, cleanup, evidence minimization and redaction, and any risky-command approval reference.
4. Confirm no project-file edits occurred outside the QA report and approved temporary QA artifacts. If an external correction or other material change occurred, require fresh rerun evidence before changing any status.
5. Verify that every required verification has `Risk → Verification → Evidence → Status` traceability and that each finding, when present, links `Finding → Risk / Verification / Evidence`; missing required links block the QA Conclusion Gate. Do not create findings for successful verifications merely to satisfy traceability.
6. List all unresolved findings, unverified checks, residual risk, and human decisions still required. Do not infer acceptance from silence, a passing subset, or agent success.

## Four Statuses

- `PASS`: only when every must-verify item has actual evidence of the expected result, no unresolved blocker remains, and no critical human gate is pending. PASS is limited to the stated scope and is not release approval.
- `FAIL`: only when actual evidence proves unmet expected behavior or a confirmed blocking product defect. Do not use FAIL for a missing runner, dependency, tool, environment, or permission. A fully reconciled FAIL conclusion may be `COMPLETE`; the product failure itself does not make reconciliation incomplete.
- `BLOCKED`: a must-verify item could not be completed because required context, environment, data, permission, dependency, or tooling was unavailable, including an unavailable required runner, tool, dependency, or environment. BLOCKED is distinct from FAIL and PASS.
- `NEEDS_HUMAN_REVIEW`: objective evidence cannot replace a subjective, business, design, safety, privacy, high-risk, owner-controlled, or other human judgment. Subjective or owner-controlled acceptance becomes `NEEDS_HUMAN_REVIEW`, not FAIL.

No evidence, no PASS. If statuses conflict, preserve the highest-impact unresolved condition and explain the traceability. Do not convert `BLOCKED` or `NEEDS_HUMAN_REVIEW` into PASS.

## Human Gate and Boundaries

Apply the Human Gate for ambiguity, subjective experience, sensitive resources, destructive or irreversible actions, scope changes, and final acceptance. Record the question, evidence IDs, decision owner, decision, approval reference, and date or state. Leave the status `NEEDS_HUMAN_REVIEW` until the required human decision is recorded. Verify that evidence was minimized and redacted, and that required approvals are present and safe before reconciliation.

State residual risk, including omitted coverage, uncertain behavior, environmental limits, and remaining impact. Produce a bounded conclusion covering passed items, confirmed failures, blocked or unverified items, human review items, residual risk, and evidence links. The skill must not make a final release decision, recommend approval, or treat PASS as an autonomous release verdict.

Use the report template's named **QA Plan Gate: OPEN/BLOCKED** and **QA Conclusion Gate: COMPLETE/BLOCKED** placeholders when reconciling the same report from planning through conclusion.
