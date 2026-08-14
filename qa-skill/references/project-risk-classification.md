# Project Risk Classification

Use this reference for M2 Project QA planning through [`../project-qa-plan/SKILL.md`](../project-qa-plan/SKILL.md). It classifies project modules, shared dependencies, key flows, omissions, blockers, and Human Gates before M3 execution evidence exists.

## Important Module Rules

Mark a module, service, entry point, shared dependency, or key flow as `important` and `Must Verify` when any rule applies:

- It provides the main user entry, project purpose, or core business capability.
- It handles identity, authorization, payment, money, privacy, sensitive data, persistence, startup, deployment, recovery, or external contracts.
- It is a shared dependency used by multiple important modules.
- Failure would prevent the project from starting, building, executing a key flow, preserving data, or satisfying authoritative acceptance criteria.
- Project docs, user request, requirements, manifests, or runtime configuration mark it as critical.

Every important/Must Verify record must include a reason or basis and a source path, owner, requirement, manifest, or observed dependency. A record that only says "important" or "high risk" without reason and source is incomplete.

## Lower Priority And Omissions

A low-impact item may be `Should Verify`, `Optional`, or `Explicitly Not Verified` only when impact is limited, it is not on a key flow, it is not a shared dependency of an important module, and the omission reason is reviewable. Record source, omission reason, residual risk, and the condition that would change priority.

Lower priority records must stay project-specific in the report and include enough source evidence for reviewers to understand why the item is not on a key flow or shared dependency path.

## Key Flow Rules

Record key flows that cross important modules or represent the project purpose. A flow record contains flow ID, entry, dependency chain, expected result, verification intent, sources, and affected modules.

## Status Classification

- `BLOCKED`: a missing objective prerequisite, contradictory acceptance criterion, unavailable critical data, tool, permission, or unsafe storage prevents planning or later execution of a `Must Verify` item. Record the exact missing prerequisite and rerun condition.
- `NEEDS_HUMAN_REVIEW`: executable evidence can be planned or exists, but a subjective business, UX, design, safety, privacy, accessibility, or owner-controlled decision remains unresolved. A subjective decision maps to `NEEDS_HUMAN_REVIEW`; it is not `BLOCKED` or `FAIL` by itself.
- `FAIL`: reserved for current execution evidence showing expected behavior was not met; M2 planning does not create product `FAIL` without execution evidence.
- `PASS`: prohibited in M2 because current Module Results and Execution Evidence are deferred until M3.

When both a missing objective prerequisite and a subjective decision apply, `BLOCKED` retains precedence because expected results or required verification cannot be completed.

## Technology-Neutral Planning

Select validation layers by risk and observed capability. Do not force Web, browser, Playwright, or E2E/system checks onto CLI/API-only projects. If no browser capability is observed, record the browser omission as `Explicitly Not Verified` with a visible reason and plan suitable `Static/unit` or `API/integration` verification intent instead.
