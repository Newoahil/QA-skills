---
type: decision
record_id: decision-1d9031b7f2b54e31b9bad620b1b3c7a7
date: 2026-08-25
title: Keep qa-guardian as the runnable Fixer agent for now
status: active
source: manual-session-note
supersedes: []
key_conclusion: Keep qa-guardian as the runnable Fixer agent for now because fixer-agent.md is only a role-contract document and a safe rename needs compatibility migration.
topics: [qa-guardian, agent-roles, fixer-agent]
---

## Context
During #263 Guardian testing, the user asked why `fixer-agent.md` was not assigned a model and whether QA-discovered problems should be handled by the Fixer. The current role architecture says the Fixer role exists, but in the current runtime it is still executed by the `qa-guardian` agent. `fixer-agent.md` deliberately has no frontmatter and is not registered as a runnable OpenCode agent.

## Considered Options
- Rename `qa-guardian` directly to `fixer-agent` now.
- Keep `qa-guardian` as the runtime agent and treat `fixer-agent.md` as role documentation.
- Later add a runnable `fixer-agent` while preserving compatibility with existing `qa-guardian` sessions/state.

## Final Decision
Do not rename the runtime agent yet. For current testing and operation, the runnable Fixer remains `qa-guardian`; `fixer-agent.md` remains a non-runnable role-contract document. QA findings are still handled by the Fixer role, but that role is currently implemented by `qa-guardian`.

## Impact and Consequences
This avoids breaking existing scheduler dispatch, permission checks, session resolver assumptions, tests, and persisted `.qa/guardian/*.json` records that refer to `qa-guardian`. A future rename should be done as a compatibility migration: introduce or promote a runnable `fixer-agent`, update role-to-agent mappings and tests, and tolerate legacy `qa-guardian` session records until old state is drained.

## Related Changes
- Current model configuration treats the actual Fixer runtime as `qa-guardian`; `fixer-agent.md` remains model-less because it is not runnable.
- `qa-guardian` is currently assigned the user-requested Fixer model policy.

## Notes
If this decision changes later, update the scheduler/fixer session runner/session resolver/poll invocation paths together rather than only renaming the markdown file.
