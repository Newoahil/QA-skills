# Full-project QA mode

Use this reference only when the requested target is whole-project QA, continuous quality gating, release gating, or a periodic project-wide check. Ordinary bounded QA on one requirement, fix, or diff should not load this reference.

Full-project QA is a thin entry layer over the normal QA prior: split the project into natural units, verify each unit as a bounded target, then close with honest coverage and risk. It is not an exhaustive proof that the whole project is correct.

## Positioning

- Primary use: continuous quality gates for CI/CD, release readiness, or scheduled whole-project QA.
- Secondary use: taking over an unfamiliar project and producing a health check. Be candid: an old project with no oracle has limited verifiability.
- Do not create a special mode for one large feature. For feature work, use the normal bounded QA prior against the feature's commitments.
- This is behavioral QA, not Code Review. Assume code review already happened.
- Validate behavior first. Do not actively perform Code Review. If you incidentally find an obvious code-level, security, or maintainability issue, report it and label it as a CR/code-level finding. Do not pretend you did not see it, and do not let it replace behavioral evidence.
- If a unit has no behavioral oracle, mark it as "no verification basis". Do not degrade into Code Review and call that QA.

## 1. Split the project into verifiable units

Identify the project's natural boundaries and split by the structure the project actually uses: modules, services, packages, business domains, directories, or other coherent units. Let the repository shape decide the cut; do not force a fixed taxonomy.

After splitting, check completeness. Confirm that the units cover the project and that no meaningful code, module, service, or package silently falls outside every unit. If something is left out, either add it to a unit or explicitly mark it as uncovered with the reason.

The split is only an anchor for QA work. Keep it lightweight enough to guide verification, not a documentation project.

## 2. Verify each unit as bounded QA

For each unit, run the normal QA prior as if that unit were the bounded target. Reconstruct the unit's behavioral oracle before judging it.

Oracle priority:

1. Reusable cases or conventions in `.qa/`, when the project already has QA memory.
2. Existing tests, specs, fixtures, documented behavior, or executable examples.
3. Behavior inferred from code and interfaces, clearly labeled as inferred.

If no usable oracle exists, mark the unit as "no verification basis" and explain what evidence is missing. Missing oracle is a coverage result, not a reason to invent a Code Review verdict.

Depth scales with risk. Money, permissions, data integrity, migrations, auth, core business flows, and cross-service boundaries deserve deeper evidence. Low-risk support code can receive a lighter scan. For release or other important gates, the caller may request full-depth verification: split the work across QA agents where possible, let each deeply verify one unit, and accept the higher cost.

Also verify key integration points between units, not only the units in isolation. Pay special attention to service boundaries and contracts such as Feign, HTTP, RPC, message queues, shared schemas, events, jobs, and persistence handoffs. Cross-boundary behavior is often where full-project QA finds real failures.

## 3. Close out and exit

A full-project QA report should make coverage honest and actionable. Include enough structure for the reader to see:

- each unit and its status: PASS, FAIL, no verification basis, BLOCKED, or NEEDS_HUMAN_REVIEW as appropriate;
- high-risk units and FAIL details with first-hand evidence;
- key integration points checked and their evidence;
- units or areas not dynamically verified, and why;
- residual risk from environment, missing oracle, or scope limits;
- one `Overall Status:` line for the whole run.

The whole-run `Overall Status:` is the worst required sub-result. A required unit or integration FAIL makes the run FAIL. If there is no FAIL but required evidence is BLOCKED or needs human judgment, the whole run reflects that. Do not write "mostly PASS" as the status.

Exit only when the split is complete and every unit has an explicit disposition: verified, no verification basis, BLOCKED, NEEDS_HUMAN_REVIEW, or intentionally uncovered with a reason. Silent skip means the QA is not done.

Be honest about the claim. Full-project QA means coverage plus risk grading, not exhaustive proof that every behavior is correct.

## Continuous gate incrementality

When `.qa/` exists and contains prior full-project results, use it to reduce repeated cost. Compare the current run to prior memory, deeply verify units changed by new commits or relevant file movement, and sample stable units for regression confidence. Do not skip stable units forever; sampling keeps the gate honest.

If `.qa/` does not exist, do not create it silently. Follow the main skill's memory rules.

## Environment constraints

All normal QA boundaries still apply: read-only, no dependency installs, no network, and no production or external-service access without explicit human approval.

Assume the local or CI environment is already prepared. QA may run available project commands, tests, scripts, and probes, but does not build the environment. If dynamic verification cannot be stood up, downgrade to static inspection plus existing runnable tests or probes, and clearly mark which units or integrations were not dynamically verified.
