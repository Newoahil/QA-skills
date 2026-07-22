# Human Gates

## Mandatory Human Gate

Use a Human Gate whenever the agent cannot establish a decision from objective, approved criteria. A Human Gate preserves human ownership. It does not by itself determine the verification status: objective-prerequisite blockers are `BLOCKED`, while decisions that remain subjective or owner-controlled are `NEEDS_HUMAN_REVIEW`.

## Objective-Prerequisite Blockers

A missing or contradictory objective acceptance prerequisite that prevents defining expected behavior or executing a must-verify check is `BLOCKED`. Record the missing prerequisite, the affected verification, and the question or artifact needed to supply it. Do not infer expected behavior or claim `PASS`.

## Subjective Owner Decisions

When objective evidence exists but cannot replace a subjective, business, design, safety, privacy, or owner decision, mark the affected item `NEEDS_HUMAN_REVIEW`. The agent must not make the final release decision, launch decision, or business acceptance decision.

A Human Gate is mandatory for:

- missing or contradictory objective acceptance prerequisites
- subjective or ambiguous owner decisions about acceptance criteria
- subjective claims about premium quality, polish, UX, visual design, or business intent
- sensitive credentials, personal data, production data, or external environments
- high-risk, destructive, irreversible, or hard-to-rollback actions
- scope expansion beyond the approved task
- final acceptance, launch, release, or go or no-go decisions

The agent may collect evidence, identify risks, prepare a focused question, and state what remains unverified. It must not infer approval from silence, a passing subset, a plan, an assertion, or “looks good.”

## Gate record

Record:

1. the decision or action requiring a human
2. why objective evidence cannot settle it
3. the evidence IDs and residual risk available to the reviewer
4. the exact question or approval needed
5. the reviewer identity, decision, and time when supplied

Until the required human decision is recorded, a subjective or owner-controlled result remains `NEEDS_HUMAN_REVIEW`, not `PASS` and not an autonomous no-launch decision. Missing tools or dependencies remain `BLOCKED`; they do not become a product `FAIL` merely because a human gate is also present. When both apply, record the Human Gate but keep the affected verification and overall status `BLOCKED` until the objective prerequisite is supplied.

Evidence rules are defined in [evidence-guide.md](evidence-guide.md), including rerun evidence and the guarded Diff-related test updates protocol.
