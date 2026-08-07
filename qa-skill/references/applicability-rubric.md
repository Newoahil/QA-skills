# Phase 1 Applicability Rubric

[`risk-checklist.md`](./risk-checklist.md) remains the governing category taxonomy and the source of truth for the 11 categories, the five assessments, the five validation layers, and the execution statuses. This rubric only makes those fields more consistent for planners. It does not replace the checklist.

## How To Read The Fields

- **Assessment** answers, should this category enter the verification plan for this change?
- **Risk priority** answers, if it enters the plan, how urgent is it?
- **Validation layer** answers, at what layer should the check happen?
- **Execution status** answers, what happened when the check was run or could not be run?

These fields are related but not interchangeable. A `Required` category must map to at least one `Must Verify` risk; a `Recommended` category normally maps to `Should Verify` or `Optional` risk unless it is promoted to `Required`. A chosen validation layer does not prove execution. A `PASS` does not prove broader product quality. A `Not Applicable` row still needs factual evidence for why the category is outside scope.

## Minimum Row Rules

- `Required` and selected `Recommended` rows produce verification items.
- `Not Applicable` rows must cite target, scope, or change facts that place the category outside the current boundary.
- `Blocked` rows must name the missing prerequisite and the rerun condition.
- `Deferred` rows must name the owner, trigger, rerun condition, and residual risk.
- If the case is unclear, choose `Full` or `Human Gate` rather than optimistic `Not Applicable`.
- Keep the rubric technology neutral. Do not force Web, E2E, security, or performance work onto a change that does not reach those risks.

## Assessment Semantics

- **Required**: the change reaches this category, and evidence is needed before the category can PASS.
- **Recommended**: the category is a meaningful adjacent check, but it is not the core obligation for this change.
- **Not Applicable**: facts show the category is outside the current target, change, or boundary.
- **Blocked**: the category is in scope, but verification cannot start or finish because a prerequisite is missing.
- **Deferred**: the category is in scope, but the owner has chosen to postpone it.

## Per Category Rubric

### Static/build

- **Required** when source, config, schema, dependency, generated artifact, build, type, or lint changes can alter the result.
- **Recommended** when the change is behavior-focused but still depends on compile, schema, or config validity.
- **Not Applicable** when the change is purely external to the repo content this category covers, for example a documentation-only update with no buildable source impact.
- **Blocked** when the repo, build tool, schema compiler, or required file set is unavailable.
- **Deferred** when build or static checks are intentionally postponed by owner decision, with a rerun trigger.
- Example, Required: changing a type signature that can fail compilation.
- Anti-example, Not Applicable: claiming `Static/build` is irrelevant while editing a schema file.

### Unit

- **Required** when local logic, branches, calculations, parsing, or error handling change.
- **Recommended** when nearby logic is stable but the change could disturb edge cases.
- **Not Applicable** when the change only alters wording, metadata, or another area with no local logic effect.
- **Blocked** when the unit harness, fixture, or required local test path is missing.
- **Deferred** when unit checks are postponed for a documented reason and rerun later.
- Example, Required: a branch that changes how invalid input is rejected.
- Anti-example, Not Applicable: treating a calculation change as outside Unit just because it is small.

### Integration

- **Required** when component collaboration, persistence, queues, caches, or external boundaries are touched.
- **Recommended** when the change is local but shares state, storage, or service boundaries with other components.
- **Not Applicable** when the change never crosses a component or boundary that the repo models.
- **Blocked** when the service, database, queue, mock, fixture, or environment needed for the interaction is absent.
- **Deferred** when the integration path is real but intentionally postponed.
- Example, Required: a service call that now writes to a queue and database.
- Anti-example, Not Applicable: a pure copy edit in a self-contained help page.

### Contract/API

- **Required** when HTTP, RPC, event, CLI, schema, or public format behavior changes.
- **Recommended** when the implementation is internal but still depends on a stable request or response shape.
- **Not Applicable** when no public contract, payload, or interface shape changes.
- **Blocked** when the contract definition, consumer, schema, or test endpoint is unavailable.
- **Deferred** when the contract check is a known follow-up and the owner accepts the delay.
- Example, Required: adding a field to a response or changing an event payload.
- Anti-example, Not Applicable: a private refactor that leaves every contract shape unchanged.

### E2E

- **Required** when a critical user or system flow crosses supported boundaries and the change can affect the full path.
- **Recommended** when the change is below the surface but could still break the main path end to end.
- **Not Applicable** when the change cannot influence a complete supported flow, for example a deeply isolated helper with no user-facing path.
- **Blocked** when the required environment, route, account, device, or system boundary is unavailable.
- **Deferred** when the full flow is valid but intentionally postponed, with a rerun trigger.
- Example, Required: a checkout or sign in path that now depends on new behavior.
- Anti-example, Not Applicable: marking E2E irrelevant just because unit tests passed.

### Database/migration

- **Required** when schema, query, persistence, data conversion, migration, rollback, or recovery behavior changes.
- **Recommended** when application logic depends on stored data shape, even if the migration is small.
- **Not Applicable** when no database or persistent data path is touched.
- **Blocked** when the database, migration runner, seed data, or rollback path is not available.
- **Deferred** when the owner postpones migration or data validation.
- Example, Required: adding a column and changing the write path.
- Anti-example, Not Applicable: a frontend copy tweak with no persisted data impact.

### Security

- **Required** when auth, authz, input-output handling, secrets, privacy, sensitive data, or dependency behavior is changed.
- **Recommended** when the change touches trust boundaries or data exposure but does not directly alter security logic.
- **Not Applicable** when there is no plausible security boundary effect in the current scope.
- **Blocked** when the required threat model, secret, credentialed account, or security test setup is missing.
- **Deferred** when security validation is intentionally postponed, with a clear rerun trigger and residual risk.
- Example, Required: a new permission check or secret handling path.
- Anti-example, Not Applicable: assuming no security relevance just because the diff is small.

### Performance

- **Required** when query cost, algorithmic cost, latency, throughput, retries, memory, or limits change.
- **Recommended** when the change could affect hot paths, shared resources, or resource use indirectly.
- **Not Applicable** when the change has no reasonable path to measurable cost impact.
- **Blocked** when the load test, telemetry, benchmark setup, or production-like input is unavailable.
- **Deferred** when performance work is explicitly postponed.
- Example, Required: a loop, query, or cache change on a hot path.
- Anti-example, Not Applicable: treating a data-path change as irrelevant because no benchmark is ready.

### Compatibility

- **Required** when public contracts, platform support, versioning, browser support, data format, or upgrade and downgrade behavior change.
- **Recommended** when the change is internal but could affect older clients, alternate platforms, or stored data readers.
- **Not Applicable** when no supported compatibility boundary is involved.
- **Blocked** when the target platform, older version, sample data, or compatibility harness is unavailable.
- **Deferred** when compatibility validation is intentionally postponed.
- Example, Required: changing a file format consumed by older clients.
- Anti-example, Not Applicable: saying compatibility does not matter while changing a public payload.

### Accessibility/visual

- **Required** when UI, interaction, layout, text, design system, or visible workflow changes affect what users can see or operate.
- **Recommended** when the change is not directly visual but can still alter presentation, focus, labels, or user understanding.
- **Not Applicable** when the change has no user-visible surface in the current scope.
- **Blocked** when the target UI, device, browser, font, locale, or inspection surface is unavailable.
- **Deferred** when visual or accessibility review is intentionally postponed, with owner and rerun trigger recorded.
- Example, Required: a button, dialog, layout, or text change visible to users.
- Anti-example, Not Applicable: a backend-only refactor with no visible effect.

### Regression

- **Required** when the change could disturb the changed behavior, direct callers, shared dependencies, public contracts, config, or data surfaces.
- **Recommended** when nearby behavior is not directly changed but is likely to feel the impact.
- **Not Applicable** only when there is factual evidence that no adjacent behavior, caller, or shared dependency is affected.
- **Blocked** when the relevant adjacent path, dataset, or regression target cannot be reached.
- **Deferred** when the regression check is intentionally delayed and the owner accepts the residual risk.
- Example, Required: a change to shared validation that could affect all callers.
- Anti-example, Not Applicable: assuming no regression risk because the edit touched one file.

## Verification Set Guidance

Use the assessment to decide whether a row becomes a verification item.

- `Required` rows always map to at least one verification item.
- `Recommended` rows map to a verification item when the planner needs extra confidence or the adjacent risk is real.
- `Not Applicable` rows do not produce verification items, but they do require factual evidence for the exclusion.
- `Blocked` rows produce a blocked item that records the missing prerequisite and the rerun condition.
- `Deferred` rows produce a deferred item that records the owner, trigger, rerun condition, and residual risk.

Record the minimum useful set, not a universal percentage. The right set depends on the change, the target, and the evidence already available.

## Decision Guardrails

- Treat the assessment as a planning decision, not proof.
- Treat risk priority as a ranking inside the plan, not a verdict on applicability.
- Treat validation layer choice as a placement decision, not evidence that a check ran.
- Treat execution status as the record of what actually happened.
- When facts are mixed or unclear, do not hide behind `Not Applicable`. Choose `Full` or `Human Gate`, then explain why.
