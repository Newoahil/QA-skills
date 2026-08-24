---
type: decision
record_id: decision-b531cef4d0f44652917eb044fbc0a31e
date: 2026-08-24
title: QA Guardian dual hot-plug extensibility plan
status: accepted
source: user-approved design in docs/qa-guardian-extensibility-design.md
supersedes: []
key_conclusion: QA Guardian will gain task-source and agent hot-plug extensibility through staged compatibility seams so GitHub behavior stays byte-identical while new sources and stages register by manifest plus restart.
topics: [qa-guardian, extensibility, architecture]
---

## Context

QA Guardian currently has strong internal engineering quality but its orchestration is specialized around the GitHub issue -> fixer -> QA -> PR flow. GitHub issue shape, `/guardian` comment commands, numeric issue identifiers, actor/effect GitHub verbs, hardcoded specialist roles, and the fixed fixer->QA sequence are coupled through scheduler, router, state, command parsing, and session binding code.

The target requirement is dual hot-plug extensibility at the configuration/manifest plus restart level: add task sources such as HTTP/API dispatchers and add agents without rewriting scheduler core behavior. Runtime dynamic loading is explicitly out of scope. Existing GitHub + QA behavior must remain byte-identical through the compatibility phases.

## Considered Options

1. Replace numeric issue ids globally first. Rejected because identity is embedded in state filenames, ledger tokens, artifacts, branches, prompts, and OpenCode session bindings.
2. Build a new parallel generic orchestrator. Rejected because the existing scheduler has important safety, idempotency, and gate behavior that should be preserved.
3. Extract compatibility seams in-place while keeping GitHub as the first built-in implementation. Accepted because it preserves behavior and lets each phase be verified independently.

## Final Decision

Implement the extensibility plan documented in `docs/qa-guardian-extensibility-design.md`:

- P1 introduces in-memory `TaskRef` only; no state schema, filename, branch, ledger, or session-binding change.
- P2 extracts `TaskSource` and a GitHub adapter that calls the unchanged `commands.mjs` parser to produce normalized `TaskObservation` data.
- P3 makes `routeIssue` consume normalized observations with golden tests proving byte-identical GitHub decisions and persisted state.
- P4 introduces `EffectSink` behind existing GitHub effect functions while keeping `EFFECTS` names and authorization semantics unchanged.
- P5 adds a specialist registry for read-only investigation agents.
- P6 extracts the built-in fixer->QA sequence into a validated stage runner with additive extension points only.
- P7 validates the abstractions with an HTTP/API task source and a narrow `notify` stage inserted at `after-qa` using a single `fact_webhook` effect.
- P8 remains deferred until non-numeric durable task ids require a migration away from `Number(issue)`.

## Impact and Consequences

The accepted plan turns future task-source and agent additions from core scheduler edits into implementation-file plus manifest registration work after the extraction is complete. It also keeps safety boundaries intact: the command parser remains GitHub-specific in the adapter, the actor/effect matrix continues to authorize before I/O, and pipeline configuration is constrained to declared extension points instead of becoming a free-form orchestration language.

The main trade-off is phased complexity. P8 string-id migration is explicitly separated from the initial hot-plug work to avoid breaking existing state, ledger, branch, artifact, and session assumptions. The HTTP source in P7 must not claim durable non-numeric-id support unless P8 is activated.

## Related Changes

- Baseline design commit: `3ccb132 Document Guardian extensibility plan`.
- Design document: `docs/qa-guardian-extensibility-design.md`.

## Notes

The P7 validation stage is `notify`, not `doc-update`, because it exercises manifest loading, deterministic stage insertion, and `EffectSink` integration while staying narrow enough to avoid custom state transitions or effect permissions.
