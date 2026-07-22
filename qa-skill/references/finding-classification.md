# Finding Classification

Use this taxonomy to route every observed issue without treating a failed command as proof of a product failure. This file is the canonical source for the six finding categories:

| Category | Definition | Typical next step |
|---|---|---|
| **product defect** | The product's observed behavior violates a supported requirement or acceptance criterion, with the available evidence pointing to product behavior as the cause. | Reproduce, isolate, and route for product correction. |
| **test or verification issue** | The test, oracle, assertion, procedure, or interpretation is wrong, stale, unreliable, or unable to verify the intended behavior. | Repair or replace the verification asset, then rerun the affected verification. |
| **environment/data/permission/dependency/tooling issue** | The environment, test data, access, external dependency, or required tool prevents reliable execution or changes the result without evidence of a product cause. | Restore the prerequisite or record the bounded omission and rerun. |
| **requirement or acceptance-criteria issue** | The requirement, expected behavior, or acceptance criterion is missing, contradictory, ambiguous, or not agreed. | Obtain clarification or an explicit acceptance decision. |
| **needs-human-judgment issue** | The evidence reaches a boundary that requires product, business, design, safety, privacy, accessibility, or other qualified human judgment. | Send the evidence and decision question through the human gate. |
| **temporarily unconfirmed issue** | The observation is credible but the available evidence cannot yet distinguish among the other categories. | Gather targeted evidence, reproduce, or escalate for human classification. |

Every finding requires all five fields below. A finding is incomplete if any field is absent.

| Required field | What to record |
|---|---|
| Observed behavior | What actually happened, including the relevant input, condition, and result. |
| Expected behavior | The requirement, oracle, or acceptance criterion that defines what should have happened. |
| Evidence reference | One or more stable evidence IDs, with enough detail to locate the command output, request, log, screenshot, or human observation. |
| Impact | The affected risk, user, workflow, data, or decision, including priority where known. |
| Next step | The smallest concrete action needed to resolve, verify, classify, or escalate the finding. |

An unavailable required runner, tool, dependency, environment, data source, or permission, such as `missing-qa-runner`, is **BLOCKED**, not product **FAIL**. Record it as an environment/data/permission/dependency/tooling issue, identify the verification items it prevents, and do not infer product behavior from the missing execution.

## Status Precedence And Rules

There are four statuses: `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW`.

| Status | Bounded meaning |
|---|---|
| `PASS` | The scoped verification completed with actual evidence, the expected behavior was met, no required verification remains blocked, and no critical human decision is pending. `PASS` applies only to the bounded verification item or scope. |
| `FAIL` | Actual evidence shows that a required expected behavior was not met, or a confirmed product defect remains unresolved. `FAIL` is not a label for unavailable tools or missing context. |
| `BLOCKED` | A required verification cannot be completed because critical context, environment, data, permission, dependency, or tooling is unavailable. `BLOCKED` is neither `FAIL` nor `PASS`. |
| `NEEDS_HUMAN_REVIEW` | Objective evidence exists, but it cannot replace a subjective, business, design, safety, privacy, or owner decision. This status is not `PASS`. |

Status precedence is deterministic. A missing or contradictory objective acceptance prerequisite that prevents defining expected behavior or executing a must-verify check is `BLOCKED`. `NEEDS_HUMAN_REVIEW` applies when objective evidence exists but cannot replace a subjective decision. The same rule covers business, design, safety, privacy, or owner decisions. When both apply, record the Human Gate, but keep the affected verification and overall status `BLOCKED` until the objective prerequisite is supplied.

No evidence, no `PASS`. A planned command, an existing test, a tool's self-reported success, or a statement that behavior looks correct is not execution evidence. Missing evidence keeps the item unverified or moves it to `BLOCKED` or `NEEDS_HUMAN_REVIEW`, as applicable. A passing lower layer does not prove an untested higher layer or user-visible behavior.
