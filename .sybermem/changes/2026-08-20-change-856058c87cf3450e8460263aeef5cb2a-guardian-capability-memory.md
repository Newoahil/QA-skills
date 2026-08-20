---
type: change
record_id: change-856058c87cf3450e8460263aeef5cb2a
date: 2026-08-20
title: Add configurable Guardian capabilities and optional SyberMem memory integration
status: done
source: manual
key_conclusion: Added config-gated Guardian investigation specialists and optional non-blocking SyberMem recall/record integration so repository users can enable stronger investigation and engineering memory without making external OMO/SyberMem capabilities mandatory.
topics: [qa-guardian, capabilities, sybermem]
author: Sisyphus
related_files: [tools/guardian/capabilities.mjs, tools/guardian/memory-provider.mjs, tools/guardian/investigation-coordinator.mjs, tools/guardian/investigation-process.mjs, tools/guardian/investigation-runtime.mjs, tools/guardian/scheduler.mjs, qa-skill/agents/guardian-history.md, qa-skill/agents/guardian-plan-critic.md, tools/guardian/README.md, tools/guardian/DEPLOY.md]
related: [change-ab75b9ee58354673b48b9c875f91a889, change-260993fcf6504e8eb9e54f84f0dd45f4, change-cc34c0f387b04539bef2107012ba5deb]
---

## Change Content
Added repository-local optional capability support for QA Guardian:

- Extended `tools/guardian/capabilities.mjs` with config/env-driven switches for `codegraph`,
  `context7`, `git_history`, `local_runtime`, `plan_critic`, and `sybermem`, plus `agents` and
  `skills.disabled` controls for optional Guardian specialists.
- Added two read-only specialist agents:
  - `guardian-history` for local git-history/regression-window investigation.
  - `guardian-plan-critic` for plan safety, risk, evidence, and verifiability critique.
- Updated specialist selection so complex investigations can include docs/history/critic roles when
  capabilities are available and not disabled, while simple issues stay bounded to code/runtime.
- Added `tools/guardian/memory-provider.mjs`, an optional SyberMem adapter for bounded recall before
  investigation and opt-in record after Gate 2.
- Threaded memory context into specialist and plan prompts as engineering memory hints.
- Documented the new config surface, capability defaults, safe degradation behavior, and SyberMem
  memory semantics in `tools/guardian/README.md` and `tools/guardian/DEPLOY.md`.

## Reason for Change
The user wanted OMO-like investigation/plan-review power and SyberMem engineering memory available to
other users of this repository, but with explicit switches to disable optional skills/capabilities and
without making personal OMO/SyberMem setup a hard dependency. The change keeps the core Guardian model
intact: Fixer edits only, QA independently verifies, and the Supervisor owns Git/GitHub/state.

## Impact Scope
The change is additive and safety-gated:

- Core scheduler behavior still works when SyberMem, Context7, and codegraph are absent.
- External memory recall failures return `unavailable` and only log bounded warnings.
- Memory is summarized and injected as DATA hints, never facts or instructions.
- Gate 2 SyberMem recording is opt-in via `memory.record_after_gate2=true`.
- Optional specialists can be disabled through `agents` or `skills.disabled`.

## Implementation
Implemented the feature in five atomic commits:

1. `63009a7 Add configurable Guardian capabilities`
2. `a82f678 Add Guardian history and plan critic specialists`
3. `7beaa83 Add optional SyberMem memory provider`
4. `c272487 Inject memory hints into Guardian investigation`
5. `577e986 Document optional Guardian capabilities and memory`

The implementation deliberately avoids giving Fixer broad OMO-style powers. Instead, the scheduler
controls read-only specialists and optional memory context while preserving the existing Supervisor and
independent-QA boundaries.

## Test Verification
Full Guardian suite passed after the change:

- `node --test "tests/guardian/*.test.mjs"` -> 413/413 pass.
- Syntax checks passed for `capabilities.mjs`, `investigation-coordinator.mjs`,
  `investigation-process.mjs`, `memory-provider.mjs`, and `scheduler.mjs`.

Additional regression coverage locks:

- Capability defaults, env/config overrides, and disabled agent/skill behavior.
- Specialist roster selection for complex/simple investigations.
- SyberMem recall/record disabled and unavailable degradation.
- Memory context threading into investigation/plan prompts as DATA hints.

## Notes
Future follow-up: make Context7 and restricted runtime probes fully executable via explicit safe MCP or
Supervisor-owned allow-lists. This record captures the current repository-local integration layer and
safe optional SyberMem provider, not a guarantee that every external capability is installed.
