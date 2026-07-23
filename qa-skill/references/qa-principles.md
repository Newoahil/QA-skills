# QA Principles

QA is a scoped, evidence-based, technology-neutral check of a stated requirement or change. It is not a claim that the whole product is correct or exhaustively certified.

## Operating Rules

- QA starts only when the user manually triggers it. The main agent loads the QA workflow and starts one dedicated QA subagent, reusing that subagent for the run.
- Define the current requirement, expected behavior, scope, non-goals, assumptions, and risks before execution. The plan gate comes before any verification.
- Give priority to the current requirement and current execution evidence. Historical notes, expectations, and context can inform a plan, but they do not prove behavior.
- Use the project's available checks and the validation layers selected by risk. QA is technology neutral and does not require a particular language, platform, browser, or tool.
- Record actual evidence, such as observed output, requests and responses, logs, artifacts, screenshots, measurements, or a dated manual observation. A plan, an existing test, or a claim that something looks correct is not evidence.
- No evidence, no PASS. A successful command or test proves only what that check actually covered.
- Keep unknown, skipped, unverified, BLOCKED, NEEDS_HUMAN_REVIEW, and residual risk visible. Make omissions and blockers visible, including what was omitted and why.
- Do not silently expand scope. If a new risk or question matters, record it and ask a targeted question, or mark the run BLOCKED when missing critical context prevents safe judgment.
- QA is read-only and must not make an automatic product fix. Do not edit product source, product tests or test files, fixtures, snapshots, configuration, or documentation. Evidence collection may write only the continuously maintained Markdown QA report and approved temporary QA artifacts, such as evidence logs or screenshots. An edit is not execution evidence.

## Roles And Limits

- The main agent owns scope control, context questions, subagent coordination, report delivery, and communication with the human.
- The QA subagent independently challenges assumptions, designs risk-based checks, executes available validation, records actual evidence, and continuously maintains the Markdown QA report throughout the run.
- The human owns ambiguous requirements, subjective UX or visual acceptance, sensitive or high-risk actions, scope expansion, acceptance, and release decisions.
- QA must not make the final release decision. A QA PASS is limited to the stated scope and evidence; it is not automatic approval to release.

## Findings And Status

Classify findings using the canonical categories in [finding-classification.md](./finding-classification.md): product defect, test or verification issue, environment/data/permission/dependency/tooling issue, requirement or acceptance-criteria issue, needs-human-judgment issue, or temporarily unconfirmed issue.

Use four statuses:

- `PASS`: required checks have actual evidence, with no unresolved blocking risk or required human judgment.
- `FAIL`: evidence shows that a key expectation is not met or a blocking defect remains.
- `BLOCKED`: a required check cannot be completed because critical context, environment, data, permission, dependency, or tooling is unavailable. A missing or contradictory objective acceptance prerequisite that prevents defining expected behavior or executing a must-verify check is also `BLOCKED`.
- `NEEDS_HUMAN_REVIEW`: objective evidence exists but cannot replace a required subjective, business, design, safety, privacy, or owner decision.

When both conditions apply, record the Human Gate but keep the affected verification and overall status `BLOCKED` until the objective prerequisite is supplied. Apply the full precedence rules from [finding-classification.md](./finding-classification.md).

None of the last three statuses is PASS. The conclusion must trace each status to its risk, verification item, and evidence, while listing omissions, blockers, and residual risk.

For the risk choices and validation layers, use the [risk checklist](./risk-checklist.md).
