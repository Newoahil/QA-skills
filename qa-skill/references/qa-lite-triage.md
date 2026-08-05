# QA-Lite Triage Reference

This reference defines the deterministic all-or-Full routing rule for [`../qa-triage/SKILL.md`](../qa-triage/SKILL.md) and [`../qa-lite/SKILL.md`](../qa-lite/SKILL.md). Triage is routing state, not evidence, and cannot support `PASS` by itself.

## All-Or-Full Decision

QA-Lite is allowed only when every Lite eligibility condition is explicit and currently true. If any eligibility condition is missing, unreadable, ambiguous, contradicted, inferred from convenience paths, or invalidated during Lite work, the route is Full. Record `Profile Decision: FULL` and continue the same child session through `qa-plan` -> `qa-execute` -> `qa-conclude`.

## Lite Eligibility

All of these must be true:

- One explicitly bounded requirement, fix, or Diff.
- Explicit product target that is readable and separate from the skill source path.
- Explicit readable product target scope and non-goals.
- Scoped objective acceptance criteria are available enough to define expected results.
- Scoped `Must Verify` items have an existing safe local verification method already present in the product target.
- No project-wide claim, whole-product claim, audit claim, release claim, or Full trigger.

## Mandatory Full Triggers

- Cross-module or architecture scope, shared architecture behavior, cross-module risk, or cross-module impact must escalate and route to Full through `qa-plan`.
- Ambiguous acceptance, contradictory acceptance, missing objective acceptance, ambiguous root cause, unknown root cause, or root cause uncertainty must escalate to Full through `qa-plan`.
- Security or privacy issue, concern, constraint, or scope must escalate to Full through `qa-plan`.
- Sensitive data, data migration risk, data migration impact, permissions risk, authorization constraint, release request, release risk, or operational risk must route to Full through `qa-plan`.
- Environment uncertainty, tool uncertainty, data uncertainty, permission uncertainty, dependency uncertainty, or runner uncertainty affecting `Must Verify` must escalate or route to Full through `qa-plan`.
- Generated validation, generated checks, generated tests, generated assets, repair, recovery, resume, history, capability discovery, capability scheduling, or resource scheduling remain Full and route to `qa-plan`.
- Explicit full request, whole-project request, whole project QA, project-wide mode, project-wide goal, audit request, release QA, or full QA run falls back or routes to Full through `qa-plan`.

## Evidence Boundary

`qa-triage` records only routing facts and `Profile Decision`. QA-Lite must independently perform Repository Preflight before Diff or source inspection, compact Change Intake, risk planning, safe local verification, evidence recording, Human Gates, final status reconciliation, fresh rerun evidence when needed, and exact authoritative report relay.
