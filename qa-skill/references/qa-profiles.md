# QA Profiles And Escalation Contract

This reference defines the Phase 1 operating profiles for triage and escalation. It keeps the canonical route decision set at `LITE` or `FULL`. `Audit` is not a third route decision, not a new execution status, and not Phase 2 project QA. It is a Full-route rigor level that is used only when high-risk work is explicitly requested or approved.

## Route Rule

- `Profile Decision: LITE` means the run stays on the Lite path.
- `Profile Decision: FULL` means the run uses the Full path.
- `Audit` never appears as a Profile Decision or execution status.
- When `Audit` is chosen, the route is still `FULL`, with extra rigor metadata and reviewer depth.

## Profile Summary

| Level | Route | When it applies | Cost intent |
|---|---|---|---|
| Lite | `LITE` | One bounded, low-risk target with a safe local verifier and no ambiguity. | Keep spend near the default 8.2-cost behavior. Use the smallest sufficient evidence set. |
| Full | `FULL` | Any uncertainty, broader scope, or risk trigger that makes Lite unsafe. | Spend more only when the extra verification is worth it. Escalate toward 9.5 only when the risk justifies it. |
| Audit | `FULL` | Explicit high-risk release, security, financial, privacy, or compliance work that needs stricter review. | Accept higher cost only with approval. Do not assume the extra spend is automatic or always needed. |

## Lite Profile

Lite is eligible only when all of these are true:

- One explicitly bounded target, fix, or diff.
- The target is low risk.
- A safe local verifier already exists in the product target.
- The scope is readable and narrow enough to plan without guesswork.
- All 11 QA categories can be assessed without leaving `Required`, `Recommended`, `Not Applicable`, `Blocked`, or `Deferred` in an ambiguous state.
- No category is left with `Blocked` or `Deferred` ambiguity.
- No security, privacy, permissions, data migration, release, operational, or cross-module concern is present.

Lite escalates to Full as soon as any eligibility condition is missing, unreadable, contradicted, inferred, or invalidated during the run.

## Full Profile

Full applies when any of these are true:

- The change is uncertain or the expected result is not fully explicit.
- The scope crosses modules, shared behavior, or public contracts.
- The work touches security, privacy, data, permissions, release, or operations.
- A prerequisite is missing, blocked, or not yet trustworthy.
- The change has broad regression risk.
- The user explicitly asks for Full QA, project QA, whole-product QA, release QA, or audit-style scrutiny.

Full is the canonical escalation path from Lite. It does not create a new route family.

## Audit Profile

Audit is a Full-route rigor level for work that is explicitly high risk, such as release, security, financial, privacy, or compliance work.

Audit is appropriate when:

- the user explicitly asks for audit-level scrutiny, or
- the work owner explicitly approves the extra rigor for a high-risk target.

Audit is not a third decision outcome. It is not a new Profile Decision value. It is not a Phase 2 project QA mode.

Audit does not guarantee quality or approval. It only raises the rigor applied to a Full-route run.

## Automatic Escalation Triggers

Any of these force Full routing, even if the change first looked Lite:

- uncertainty about the root cause, acceptance, or expected behavior
- cross-module, shared, or architecture-level impact
- security, privacy, credentials, secrets, or sensitive data
- permissions, authorization, or access control
- data migration, persistence, recovery, or schema risk
- release, operational, or rollback risk
- broad regression risk
- missing prerequisites for a safe local verifier
- environment, tool, fixture, or dependency uncertainty
- generated validation, repair, recovery, resume, history comparison, capability discovery, or resource scheduling work
- explicit user request for Full, audit-style, release, or project-wide scrutiny

## Minimum Planning Artifacts

Every run records the same planning shape, scaled by profile:

- target and scope
- non-goals
- authoritative acceptance criteria or the best available equivalent
- risk assessment for all 11 QA categories
- verifier choice and why it is safe or sufficient
- evidence plan, including expected observations and rerun needs
- explicit blockers, deferred items, and human review items

Lite planning stays compact. Full planning is more detailed. Audit planning adds explicit reviewer intent, rerun depth, and approval boundaries.

## Validator Expectations

Validators check consistency, not truth by assertion.

- They confirm that the chosen profile matches the documented risk and scope.
- They confirm that category assessments, verifier choices, and evidence claims do not contradict each other.
- They do not turn a plan into proof.
- They do not upgrade `Audit` into a separate route, status, or release decision.

## Evidence Depth

Lite evidence should be just enough to prove the bounded target with a safe local verifier.

Full evidence should cover the relevant failure paths, adjacent risks, and any category marked `Required`.

Audit evidence should be deeper than ordinary Full evidence when approval is granted, but only for the approved high-risk scope.

Audit may include repeated runs, independent review, or broader corroboration, but only when that extra work is justified and approved.

## Rerun And Review Expectations

Lite reruns only what is needed to confirm the bounded target.

Full reruns affected checks after a fix or when new evidence changes the risk picture.

Audit may require repeated runs and independent review when the owner approves that cost.

No profile forces repeated runs by default. Each rerun must have a reason.

## Human Gate Rules For Audit Cost

Audit expenses need Human Gate approval when they add any of these:

- network access
- credentials or secrets
- production-like resources
- multiple model runs beyond the minimal needed set
- destructive or hard-to-roll-back cost

If the cost stays within the already approved local and non-destructive scope, Audit can continue without a new gate.

## Cost Intent

- Lite: conserve tokens, keep the path short, and stop at the first safe local proof.
- Full: spend the extra tokens needed to resolve uncertainty and cover real risk.
- Audit: spend carefully, but only after explicit approval, because the goal is stronger scrutiny, not more work for its own sake.

## Boundary Notes

- Audit does not mean Phase 2 project QA.
- Audit does not create a third route decision.
- Audit does not promise a pass.
- Audit does not replace human release judgment.
