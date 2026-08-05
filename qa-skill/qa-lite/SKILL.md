---
name: qa-lite
description: Compact evidence-first QA for one bounded requirement, fix, or Diff after qa-triage selects Lite.
---

# QA Lite

Run this skill only after [`../qa-triage/SKILL.md`](../qa-triage/SKILL.md) records `Profile Decision: LITE` in the same QA subagent session. QA-Lite is read-only and compact, but it is still evidence-first QA. It must not edit, change, modify, touch, or write product source, product target files, product tests, fixtures, snapshots, configuration, or documentation. It may write only the QA-Lite report and approved temporary QA artifacts such as evidence logs or screenshots.

## Required Run

1. Create or open one Markdown report from [`../templates/qa-lite-report.md`](../templates/qa-lite-report.md). Keep the report continuously maintained.
2. Independently run Repository Preflight before actual Diff/source inspection. Confirm separate supplied and resolved skill source and product target paths, explicit product target, target-only scope, readable local target, and the existing safe local verification method. Pack self-tests are not product QA evidence.
3. Before risk planning, record compact `Change Intake`: `Observed Facts`, `Inferred Intent` with confidence and basis, `Authoritative Acceptance Criteria` with source or owner, and `Unresolved Questions`.
4. Build a scoped Risk - Verification - Evidence chain for the bounded request. Every `Must Verify` item needs expected result, safe local method, evidence requirement, and status.
5. Execute only existing safe local verification methods that are in scope and do not require installation, dependency mutation, generated validation, repair, recovery, production access, credentials, release action, or other Human Gate approval.
6. Record actual evidence, command/tool/request/observation, result, artifact or reference, and execution time. No evidence means no `PASS`; without evidence the item cannot PASS and overall PASS is unavailable.
7. Use exactly four statuses: `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW`. `PASS` requires evidence for every scoped `Must Verify`, no unresolved blocker, and no pending critical Human Gate.
8. Apply Human Gates for objective gaps, subjective owner judgment, risky resources, approvals, security/privacy/sensitive decisions, and any action outside read-only safe local verification. Keep `BLOCKED` precedence when objective prerequisites are missing.
9. After any external product repair or other material change, preserve original evidence and require fresh rerun evidence for each affected verification before changing status to `PASS`.
10. Deliver the complete authoritative report by exact relay. When the host provides completed child result authority, use that exact relay as the authoritative report; preserve `child-report-relay-evidence` or `report-source` style metadata when available. Do not reconstruct a summary in place of the report.

## Escalation While Running

If any fact invalidates Lite eligibility, stop Lite execution, record `Profile Decision: FULL`, list the invalidating fact, and expand the same authoritative report to [`../templates/qa-report.md`](../templates/qa-report.md), preserving all triage, preflight, intake, evidence, findings, and unresolved items already recorded. Then continue the same QA subagent through the unchanged Full route in [`../qa-plan/SKILL.md`](../qa-plan/SKILL.md), [`../qa-execute/SKILL.md`](../qa-execute/SKILL.md), and [`../qa-conclude/SKILL.md`](../qa-conclude/SKILL.md). Do not create a parallel report or discard earlier evidence. Cross-module architecture risk, ambiguous acceptance or root cause, security or privacy scope, data migration, permissions, release, operational risk, uncertainty affecting `Must Verify`, generated validation, repair, recovery, history, capability discovery, resource scheduling, explicit full, whole-project, project-wide, audit, or release QA all escalate to Full.

## Non-goals

- No product mutation, automatic product repair, generated checks, generated validation, test maintenance, recovery/resume handling, capability discovery, resource scheduling, project-mode Lite, release approval, commit, push, PR, or multi-agent flow.
- No project-wide claim. QA-Lite can conclude only on the scoped bounded target and evidence in its report.

For routing details, read [`../references/qa-lite-triage.md`](../references/qa-lite-triage.md). For shared Human Gate semantics, read [`../references/human-gates.md`](../references/human-gates.md).
