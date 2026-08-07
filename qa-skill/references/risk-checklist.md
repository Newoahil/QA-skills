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

## Canonical QA Applicability Matrix

Use this matrix before any plan or conclusion. Every category must be assessed, and none may be silently omitted.

- Exact categories: Static/build, Unit, Integration, Contract/API, E2E, Database/migration, Security, Performance, Compatibility, Accessibility/visual, Regression.
- Exact assessments: Required, Recommended, Not Applicable, Blocked, Deferred.
- The matrix is technology-neutral. Select rows from the project and change signals, not from a fixed tool stack.
- Selection signals adapt to the project and change type, including changed behavior, affected code paths, user-visible surfaces, shared dependencies, public contracts, config and data surfaces, environment assumptions, platform limits, risk history, and the evidence already available.
- Do not force browser, E2E, security, or performance execution on irrelevant projects.

### Default Category Selection Signals

These default signals guide applicability assessment; they are not automatic execution mandates. Factual evidence about the project, target scope, or change may justify `Not Applicable`, `Blocked`, `Deferred`, or a lower assessment with a visible rationale.

| Category | Default project or change signals |
|---|---|
| `Static/build` | Source, config, schema, dependency, generated artifact, build, type, or lint changes. |
| `Unit` | Local logic, branches, calculations, or error handling changes. |
| `Integration` | Component collaboration, persistence, service, queue, cache, or external boundary changes. |
| `Contract/API` | HTTP, RPC, event, CLI, schema, or public format changes. |
| `E2E` | Changed critical user or system flows crossing supported boundaries. |
| `Database/migration` | Schema, query, persistence, data conversion, migration, rollback, or recovery changes. |
| `Security` | Auth, authz, input-output, secrets, privacy, sensitive data, or dependency changes. |
| `Performance` | Query, algorithmic cost, latency, throughput, retry, memory, or limits changes. |
| `Compatibility` | Public contracts, platform, version, browser, data format, or upgrade-downgrade changes. |
| `Accessibility/visual` | UI, interaction, layout, text, design system, or visible workflow changes. |
| `Regression` | Every changed behavior or configuration gets affected and adjacent regression selection. |

### Assessment Rules

- Required means the change or scope reaches the category, and satisfactory evidence is needed before PASS.
- Recommended means the category is a meaningful adjacent or supporting check for this change.
- Not Applicable means factual project or scope evidence shows the category is outside the current boundary.
- Blocked means the category is in scope, but missing prerequisites prevent verification. Record the missing prerequisites and the rerun conditions.
- Deferred means the category is in scope, but the owner has postponed it. Record the owner, the trigger, the rerun condition, and the residual risk.
- Every category row must carry one of these assessments and a short rationale.

### Readiness Requirements

For any Required row, record the authoritative criteria mapping, the Must Verify mapping, the changed or affected behavior, and positive, negative, and boundary cases where they are relevant.
- Include project-owned thresholds if the project defines them.
- Satisfactory evidence must exist before a Required row can reach PASS.

### Coverage Sufficiency Record

Coverage is sufficient when the record maps to the authoritative criteria, the Must Verify items, and the changed or affected behavior.
- The record should show positive, negative, and boundary cases where relevant.
- If the project already owns thresholds or limits, use those thresholds.
- Do not invent a universal percentage.

### Regression Selection Rules

Select Regression from changed behavior, direct callers, shared dependencies, public contracts, config or data surfaces, adjacent failure paths, and historical defects.
- Re-run regression checks that can observe the change or its nearby fallout.
- Use the category when the safest answer is to recheck what the change can disturb.

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
