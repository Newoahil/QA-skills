---
name: qa-skill
description: Root QA skill router. Selects Diff QA vs Project QA, explains where QA-Lite fits, and routes to the correct entry skill without performing QA itself.
---

# QA Skill Router

Use this root skill when the user asks for QA, review, validation, verification, or quality assessment and the correct QA route is not already selected.

This file is the entry router only. It does not plan, execute, conclude, repair, or write memory. After routing, follow exactly one downstream entry skill.

## Route First By Scope

1. **Explicit whole-project QA** -> use [`using-project-qa`](using-project-qa/SKILL.md).
   - The user explicitly asks to QA a whole project, repository, product target, or broad project surface.
   - A product target is supplied or must be requested by `using-project-qa`.
   - Project QA never uses `qa-lite`.

2. **Single Diff / requirement / fix / PR-change QA** -> use [`using-qa`](using-qa/SKILL.md).
   - The user asks to QA one requirement, one implementation, one fix, one Diff, or one bounded PR/change.
   - `using-qa` then invokes [`qa-triage`](qa-triage/SKILL.md) to choose Lite or Full.

3. **Ambiguous scope** -> ask one concise clarification before loading a downstream route:
   - "Is this QA for one bounded change, or for the whole project?"

## Beginner On-Ramp And One-Page Sign-Off

- **New to QA?** For a small, clearly bounded change, start from [`references/qa-starter-flow.md`](references/qa-starter-flow.md): a 5-step ramp (Scope -> Risk -> Checks -> Evidence -> Verdict) that keeps the load-bearing rules (read-only, evidence-first, four statuses, human gates) without the full ceremony. It is an on-ramp into `using-qa`, not a separate route; escalate to Full when a high-risk category appears or scope grows.
- **Need a concise human summary?** Use [`templates/qa-signoff.md`](templates/qa-signoff.md) as a one-page digest (scope, tested/not tested, findings, residual risk, recommendation). It mirrors the authoritative report, never invents a verdict, and is a recommendation only, never a release decision.

## Where QA-Lite Fits

`qa-lite` is not a top-level route. Never call [`qa-lite`](qa-lite/SKILL.md) directly from this router.

QA-Lite can be selected only by [`qa-triage`](qa-triage/SKILL.md) inside Diff QA when every Lite eligibility condition is explicitly satisfied and no Full trigger exists. Any uncertainty falls back to Full (`qa-plan` -> `qa-execute` -> `qa-conclude`).

## Project QA Core And Optional Modules

Project QA has a small core path:

```text
using-project-qa
  -> project-qa-plan
  -> project-qa-execute
  -> project-qa-conclude
```

Optional project modules activate only when their trigger is present:

| Module | Trigger | Output | PASS evidence? |
|---|---|---|---|
| [`project-qa-context`](project-qa-context/SKILL.md) | current material explicitly names a GitHub Issue/PR/commit | `qa_planning_inputs` | No |
| [`project-qa-memory`](project-qa-memory/SKILL.md) | authorized `.qa/memory/index.yaml` exists | `qa_planning_inputs` | No |
| [`project-qa-repair`](project-qa-repair/SKILL.md) | explicit `PROJECT_FIX_AND_RERUN` authorization | isolated repair/rerun flow | Only fresh rerun evidence |

Capability discovery, resource scheduling, generated validation, recovery, and history comparison are also conditional project QA capabilities. They are not the default route and never override current evidence.

## Invariants For Every Route

- QA is read-only unless an explicit repair/generated-validation subflow authorizes a host writer inside isolation.
- Planning inputs, GitHub context, memory, schedules, candidates, and history are never PASS evidence.
- The only final statuses are `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW`.
- No current objective evidence means no `PASS`.

## Decision Tree

```text
QA request
│
├─ explicit whole-project QA?
│  └─ using-project-qa -> project-qa-plan -> project-qa-execute -> project-qa-conclude
│
└─ bounded Diff / requirement / fix / PR-change QA?
   └─ using-qa -> qa-triage
      ├─ qa-lite, only if all Lite conditions pass and no Full trigger exists
      └─ qa-plan -> qa-execute -> qa-conclude
```
