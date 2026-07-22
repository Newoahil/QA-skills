# Risk Checklist

Use this checklist to choose verification from the current requirement, change, affected behavior, and available evidence. Do not run a fixed test package just to appear complete.

## Risk Priorities

Mark each relevant risk as one of these four priorities and give the reason:

- **Must Verify**: failure would invalidate a key requirement, create material harm, or leave a blocking risk.
- **Should Verify**: meaningful adjacent or supporting risk that may be deferred only with a visible reason.
- **Optional**: useful confidence check with limited impact when omitted.
- **Explicitly Not Verified**: outside scope or not feasible for this run. State the boundary, reason, and residual risk.

## Selectable Validation Layers

Choose one or more of these five validation layers. The layer name is a planning choice, not proof that the layer was executed:

1. **Static/unit**: source, configuration, schemas, types, lint rules, and focused unit behavior.
2. **API/integration**: service contracts, requests and responses, persistence, queues, and component interaction.
3. **E2E/system**: the complete supported workflow across system boundaries.
4. **Specialist non-functional**: security, privacy, performance, reliability, accessibility, resilience, or compatibility checks.
5. **Manual acceptance**: human review of UX, visual behavior, business intent, ambiguity, and acceptance conditions.

Lower-layer PASS does not prove higher-layer or user-visible behavior. For example, a static or unit PASS does not prove an API contract, complete workflow, production-like reliability, or manual acceptance.

## Core Risk Areas

For each area, mark the priority, select a validation layer, and link the risk to at least one verification item:

- **Core behavior**: the changed requirement, success path, failure path, and stated acceptance conditions.
- **Adjacent regression**: neighboring features, shared components, public contracts, and unchanged behavior likely to be affected.
- **Data, state, and boundaries**: empty, invalid, duplicate, large, missing, concurrent, transition, persistence, and recovery cases.
- **Permissions, security, and privacy**: identity, authorization, secrets, sensitive data, isolation, abuse paths, and audit needs.
- **Environment, dependencies, and tooling**: configuration, versions, external services, test data, credentials, platform assumptions, and unavailable tools.
- **Reliability, performance, and compatibility**: timeouts, retries, load, resource use, failure recovery, supported versions, and operational limits.
- **UX, visual, and business intent**: user-visible behavior, accessibility, wording, layout, workflow clarity, domain rules, and subjective acceptance.

## Mapping And Omission Rules

- Map every key risk to at least one verification item, or record why it cannot be verified.
- Each verification item should state its target, preconditions, method, expected result, required evidence, and whether human judgment is required.
- Make omitted layers, skipped checks, unavailable tools, blocked conditions, and their reasons visible in the Markdown report.
- Do not treat a test definition, a planned command, or a lower-layer PASS as evidence for an unexecuted higher layer.
- Re-run affected verification after a fix and record the new execution evidence. Preserve the original finding and any remaining residual risk.

See the governing [QA principles](./qa-principles.md) for evidence, status, scope, and ownership rules.
