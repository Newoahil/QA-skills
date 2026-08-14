---
name: qa-conclude
description: Use when executed QA evidence must be classified and turned into a bounded human-reviewable conclusion
---

# QA Conclude

## Same-Session Execution Check

Before the Conclusion Gate, confirm that this same QA subagent session — the one that already ran `using-qa` and `qa-triage` — is the session that loaded and applied `qa-plan`, `qa-execute`, and this `qa-conclude` file itself, directly, not through a task, subagent, or other delegation call to a different subagent or agent type. A run where `qa-triage` recorded `Profile Decision: FULL` and the remaining stages were then handed off to a different subagent, agent type, or new session — even one given the skill path, an explicit load requirement, and the exact required markers to reproduce — has not satisfied this check: that receiving agent was not the same QA subagent session and its output cannot substitute for this session's own skill loads. Record the skill-loading evidence for `qa-plan`, `qa-execute`, and `qa-conclude` from this same session; the QA Conclusion Gate stays `BLOCKED` when that evidence is missing, delegated, or replaced by a different subagent's output.

## Conclusion Gate

Apply the Conclusion Gate before writing an overall status. Every finding, unverified item, omission, blocker, and human item must be classified and linked to the plan, verification item, and evidence. Use the [finding classification](../references/finding-classification.md), [human gates](../references/human-gates.md), [evidence guide](../references/evidence-guide.md), [applicability rubric](../references/applicability-rubric.md), [QA profiles](../references/qa-profiles.md), [QA report quality rubric](../references/qa-report-quality-rubric.md), and [QA report template](../templates/qa-report.md).

Reconcile the report's **Report Quality Self-Check** against the [QA Report Quality Rubric](../references/qa-report-quality-rubric.md): every `Required` risk must carry a complete `Risk -> Must Verify -> Verification -> Evidence -> Status` chain naming the actual affected chain for cross-cutting changes, not a generic risk statement; every `Must Verify` step must be concrete enough to execute without guessing; no status may rest on an unrelated or broader smoke/build check alone; any memory or `project-qa-context` content must be labeled planning input, never evidence. A rubric anti-pattern in a `Required` row keeps the QA Conclusion Gate `BLOCKED` until resolved or explicitly recorded as an accepted limitation with residual risk. Do not restate a table's content in prose immediately below it; use prose only for exceptions, blockers, human decisions, or the final conclusion narrative.

Reconcile risk-surface completeness before treating the Self-Check as satisfied: confirm the report shows a `Risk Surface Exploration` scratch pass that happened before the `Risk Analysis` table was authored, and that for any mandatory Full trigger, that exploration reached the trigger's domain shape rather than stopping once the trigger was merely confirmed. Confirm any risk discovered while executing an approved verification, still within the same bounded target, was added to the risk register with `Discovered during execution: yes` and carried through the same evidence and status rules as a planned risk, not silently dropped as "scope expansion." A risk register that exactly matches the initial plan with no discovered-during-execution entries, despite execution clearly having touched code paths or behavior the plan did not anticipate, is a rubric anti-pattern and keeps the QA Conclusion Gate `BLOCKED` until reconciled or explicitly justified.

Reconcile the report's named **QA Conclusion Gate: COMPLETE/BLOCKED** placeholder. Apply canonical status precedence: a missing or contradictory objective acceptance prerequisite that prevents an expected result or executable must-verify check is `BLOCKED`; objective evidence that cannot replace a subjective, business, design, safety, privacy, or owner decision is `NEEDS_HUMAN_REVIEW`; when both apply, record the Human Gate but keep the affected verification and overall status `BLOCKED`. Do not declare the gate complete while required reconciliation or a blocking prerequisite is missing.

QA applicability assessments stay distinct from execution statuses. `Required`, `Recommended`, `Not Applicable`, `Blocked`, and `Deferred` classify the matrix row, while `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW` classify execution outcome. QA Conclusion Gate reconciliation is blocked when missing rows, omitted rows, or missing applicability are present in the matrix, and the QA Conclusion Gate stays `BLOCKED` until every row is reconciled.

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
7. Treat `Not Applicable`, `Blocked`, and `Deferred` rows as applicability records that still need reconciliation, not as executed results.
8. A `Not Applicable` row requires justification, reason, or rationale, and if that justification is missing, absent, or required and still missing, the row is `BLOCKED`.
9. A `Deferred` row requires an owner or responsible person and a trigger, resume, revisit, or rerun condition, and if ownerless or triggerless, the row is `BLOCKED`.
10. A `Required` row with unresolved, incomplete, open, or not done work keeps the QA Conclusion Gate `BLOCKED` and prevents `COMPLETE`.
11. A `Required` row without satisfactory evidence, including missing evidence, absent evidence, without evidence, or no evidence, cannot PASS and must remain `BLOCKED`.
12. A `Blocked` row records its missing prerequisites and rerun conditions.

Before conclusion, update the same `qa-plan/v1` Planner artifact with the actual verification statuses, evidence refs, and conclusion fields. Then run `node "<resolved skill source path>/tools/validate-qa-plan.mjs" "<plan.json>" --json --require-conclusion` when Node is already available and no install is needed. Use the resolved skill source path rather than cwd or the product target. A contract failure keeps the conclusion output contract `BLOCKED`. Validation success means the JSON contract is consistent only, not that the product passed. If Node is unavailable, do not install anything and do not block product QA only for that reason; record deterministic validation unavailable and reconcile the same schema, rubric, and gate rules manually.

## Four Statuses

- `PASS`: only when every must-verify item has actual evidence of the expected result, no unresolved blocker remains, and no critical human gate is pending. PASS is limited to the stated scope and is not release approval.
- `FAIL`: only when actual evidence proves unmet expected behavior or a confirmed blocking product defect. Do not use FAIL for a missing runner, dependency, tool, environment, or permission. A fully reconciled FAIL conclusion may be `COMPLETE`; the product failure itself does not make reconciliation incomplete.
- `BLOCKED`: a must-verify item could not be completed because required context, environment, data, permission, dependency, or tooling was unavailable, including an unavailable required runner, tool, dependency, or environment. BLOCKED is distinct from FAIL and PASS.
- `NEEDS_HUMAN_REVIEW`: objective evidence cannot replace a subjective, business, design, safety, privacy, high-risk, owner-controlled, or other human judgment. Subjective or owner-controlled acceptance becomes `NEEDS_HUMAN_REVIEW`, not FAIL.

No evidence, no PASS. If statuses conflict, preserve the highest-impact unresolved condition and explain the traceability. Do not convert `BLOCKED` or `NEEDS_HUMAN_REVIEW` into PASS.

## Human Gate and Boundaries

Apply the Human Gate for ambiguity, subjective experience, sensitive resources, destructive or irreversible actions, scope changes, and final acceptance. Record the question, evidence IDs, decision owner, decision, approval reference, and date or state. Leave the status `NEEDS_HUMAN_REVIEW` until the required human decision is recorded. Verify that evidence was minimized and redacted, and that required approvals are present and safe before reconciliation.

State residual risk, including omitted coverage, uncertain behavior, environmental limits, and remaining impact. Produce a bounded conclusion covering passed items, confirmed failures, blocked or unverified items, human review items, residual risk, and evidence links. The skill must not make a final release decision, recommend approval, or treat PASS as an autonomous release verdict. The JSON Planner artifact stays separate from the authoritative Markdown report relay and from any Human Gate approval or release decision.

Use the report template's named **QA Plan Gate: OPEN/BLOCKED** and **QA Conclusion Gate: COMPLETE/BLOCKED** placeholders when reconciling the same report from planning through conclusion.
