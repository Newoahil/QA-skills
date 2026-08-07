---
name: qa-triage
description: Triage-first router for single requirement, fix, or Diff QA: deterministically chooses QA-Lite or the unchanged Full QA route.
---

# QA Triage

Run this skill only inside the one dedicated QA subagent session started by [`../using-qa/SKILL.md`](../using-qa/SKILL.md). `qa-triage` is routing state, not evidence: it records eligibility facts and the `Profile Decision`, then reuses that same session for either [`../qa-lite/SKILL.md`](../qa-lite/SKILL.md) or the unchanged Full route, [`../qa-plan/SKILL.md`](../qa-plan/SKILL.md) -> [`../qa-execute/SKILL.md`](../qa-execute/SKILL.md) -> [`../qa-conclude/SKILL.md`](../qa-conclude/SKILL.md). For profile and rigor rules, see [QA profiles](../references/qa-profiles.md).

## Deterministic All-Or-Full Rule

Apply the all-or-Full triage from [`../references/qa-lite-triage.md`](../references/qa-lite-triage.md). QA-Lite is eligible only when every Lite condition is explicitly true and no Full trigger is present. Any missing, unreadable, ambiguous, contradictory, or later-invalidated fact routes to Full. Ambiguous cases must escalate to Full and continue through `qa-plan`, never by guessing Lite.

## Lite Eligibility Checklist

Record `Profile Decision: LITE` only when all conditions below are true:

1. The request is exactly one explicitly bounded requirement, fix, or Diff.
2. The product target is explicit, readable, and separate from the skill source path.
3. The product target has explicit readable scope and non-goals suitable for target-only QA.
4. The scoped `Must Verify` items have an existing safe local verification method already available in the product target.
5. No escalation trigger exists.
6. The request does not ask for or imply a project-wide claim, release claim, audit claim, or whole-product correctness claim.

## Full Triggers

Record `Profile Decision: FULL` and continue the same QA subagent through [`../qa-plan/SKILL.md`](../qa-plan/SKILL.md) when any trigger exists:

- Cross-module scope, cross-module risk, shared architecture concern, architecture-level behavior, or impact that spans module boundaries must escalate or route to Full through `qa-plan`.
- Ambiguous acceptance, contradictory acceptance criteria, missing objective acceptance, unclear expected behavior, or unresolved root cause must escalate to Full through `qa-plan`.
- Security or privacy issue, security/privacy concern, sensitive data scope, data migration risk or impact, permissions risk, authorization request, release risk, release request, operational risk, or other high-risk constraint must route to Full through `qa-plan`.
- Environment uncertainty, tool uncertainty, data uncertainty, permission uncertainty, dependency uncertainty, or runner uncertainty that affects any `Must Verify` item must escalate and route to Full through `qa-plan`.
- Generated validation, generated checks, generated tests, generated assets, repair, recovery, resume, history comparison, capability discovery, capability scheduling, or resource scheduling remain Full and route to `qa-plan`.
- Explicit full request, whole-project request, project-wide mode or goal, audit request, release QA, full QA, or whole-product QA falls back or routes to Full through `qa-plan`.

## Rigor Note

When the run needs extra review depth, record `rigor: Standard` or `rigor: Audit` on the same run. `Audit` is still Full route, not a third route decision, and it requires `approvalRef` before the Planner can treat the rigor as approved.

## Routing Output

Use the QA-Lite report template only after `Profile Decision: LITE`. If facts invalidate Lite eligibility during `qa-lite`, record `Profile Decision: FULL` in the same report and continue the same child through the unchanged Full route: `qa-plan` -> `qa-execute` -> `qa-conclude`. Do not create a second child, parallel route, automatic QA pipeline, generated check, repair flow, release decision, or project-mode Lite route.
