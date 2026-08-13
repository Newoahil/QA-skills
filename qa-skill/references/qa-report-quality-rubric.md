# QA Report Quality Rubric

This rubric defines what makes a QA report professionally useful, not merely format-complete. It applies to Lite and Full Diff QA reports and is reconciled by [`qa-conclude`](../qa-conclude/SKILL.md) before `QA Conclusion Gate: COMPLETE`. It is a quality standard, not a fifth status and not product evidence by itself.

## Why This Exists

A report can satisfy every table heading in [`templates/qa-report.md`](../templates/qa-report.md) and still fail to help a developer, reviewer, or release owner. Format completeness is necessary but not sufficient. This rubric names the difference and gives concrete anti-patterns to reject.

## The Core Chain

Every `Required` risk and every claimed status must be traceable end to end:

```text
Risk -> Must Verify -> Verification -> Evidence -> Status
```

A report is not complete when a risk has no verification, a verification has no evidence, or a status has no risk/evidence link. `qa-conclude` blocks `COMPLETE` on any missing link in this chain for a `Required` row.

## Six Quality Dimensions

### 1. Scope discipline

- States what is tested and what is explicitly not tested (non-goals).
- Does not silently expand scope from what was actually inspected.
- Does not treat "the repository looks fine" as scope coverage.

Anti-pattern: a report with no non-goals and no explicit untested-behavior statement.

### 2. Risk relevance and risk-chain awareness

- Considers all 11 applicability categories (see [risk checklist](./risk-checklist.md)), but only expands `Required` and selected `Recommended` rows into the full chain. `Not Applicable` rows get a one-line factual basis, not a paragraph.
- For changes with cross-cutting impact, names the actual affected chain: for example state -> cache -> read path, or credential -> session/token -> protected endpoint -> other active sessions. A generic "regression risk exists" without naming the chain is not sufficient for a `Required` regression row.
- Every `Must Verify` item states why it is required, not just what it is.

Anti-pattern: an 11-row matrix where every non-Required row is a full paragraph, or a `Required` row that never names the concrete affected path.

### 3. Executable verification steps

- Each `Must Verify` item names setup, action, expected result, and evidence source, concrete enough that another engineer could run it without guessing.
- "Run tests" or "check X works" is a placeholder, not a verification step.
- Steps that assert both the positive path and at least one relevant negative/boundary case for `Required` risks.

Anti-pattern: `Method or steps` cell containing only "verify behavior" or "run the test suite" with no concrete action or expected result.

### 4. Evidence-to-status calibration

- `PASS` only when every `Must Verify` item tied to that status has direct, current evidence of the expected result.
- Passing an unrelated or broader smoke/build check is not evidence for an issue-specific behavior; state explicitly when the only evidence is a broader repository-level check and what remains unverified.
- Environment/dependency/tooling/network unavailability is `BLOCKED`, never `FAIL`.
- Subjective, business, design, safety, or owner judgment is `NEEDS_HUMAN_REVIEW`, never a guessed `PASS`.

Anti-pattern: `PASS` supported only by "inspected the code" or "the build succeeded," with no verification tied to the actual expected behavior.

### 5. Actionability for the next human

- A developer could take the report and know what to add tests for.
- A reviewer could take the report and know what to re-check before merge.
- A release/QA owner could take the report and know what residual risk remains and who must decide it.
- Findings link back to the risk, verification, and evidence that produced them, not just a prose description.

Anti-pattern: a report that only a QA subagent's own reasoning can interpret; a human reader cannot tell what evidence backs which conclusion.

### 6. Memory and context integrity (when those modules are active)

- Content sourced from `project-qa-context` or `project-qa-memory` is labeled as planning input or risk candidate, never as evidence.
- A memory-derived risk is revalidated against the current scope and current evidence before it can affect a status.
- Memory or context content is not repeated verbatim as if it were current findings.

Anti-pattern: a report that cites a memory rule or an Issue/PR discussion as if it were current verification evidence.

## Report Budget (Concision Rules)

These rules exist to prevent the chain above from becoming a token-heavy, mechanically filled matrix.

- All 11 applicability categories must appear (none silently omitted), but only `Required` and selected `Recommended` rows get the full Risk/Verification/Evidence detail. `Not Applicable` rows: one line, factual basis only. `Blocked` rows: one line naming the missing prerequisite and rerun condition. `Deferred` rows: one line naming owner, trigger, and rerun condition.
- Default `Must Verify` budget: Lite targets 1-3 items; Full targets 3-7 top-level items. Going over the Full default is allowed when the risk genuinely requires it, but related checks should be grouped under a parent risk rather than listed as unrelated singletons, and the reason for the larger set should be visible.
- Evidence entries are summaries (command/tool, exit or result code, what it covered), not pasted raw logs. Use the minimization and redaction rules in [`evidence-guide.md`](./evidence-guide.md).
- Do not restate a table's content in prose immediately below it. Use prose only for exceptions, blockers, human decisions, or the final conclusion narrative.
- Lite reports stay short: no 11-row full-detail matrix, no long narrative sections; compact table plus a short conclusion is sufficient.

## Anti-Patterns Summary

Reject a report, or send it back to `qa-execute`/`qa-conclude` reconciliation, when it contains any of:

- A `Required` risk with no verification or no evidence.
- "Run tests," "looks correct," or "inspected the code" used as if it were evidence.
- `PASS` based on a broader or unrelated smoke/build check when the actual issue-specific behavior was not exercised.
- An environment/dependency/network failure recorded as `FAIL` instead of `BLOCKED`.
- A subjective/business/design/security judgment recorded as `PASS` instead of `NEEDS_HUMAN_REVIEW`.
- A generic risk statement with no named affected chain for a change that clearly has cross-cutting impact (state, cache, permissions, upstream/downstream, concurrency, rollback).
- Memory or external context treated as current evidence.
- Full-length paragraphs for `Not Applicable` rows, or omission of any of the 11 categories.
- Table content duplicated in prose immediately after the table.

## Relationship To Other References

This rubric does not redefine status precedence, finding categories, human gates, or evidence handling; it references and enforces them. See [`qa-principles.md`](./qa-principles.md), [`risk-checklist.md`](./risk-checklist.md), [`evidence-guide.md`](./evidence-guide.md), [`finding-classification.md`](./finding-classification.md), and [`human-gates.md`](./human-gates.md) for the underlying rules this rubric holds reports accountable to.
