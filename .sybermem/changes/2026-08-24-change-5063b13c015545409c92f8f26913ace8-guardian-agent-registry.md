---
type: change
record_id: change-5063b13c015545409c92f8f26913ace8
date: 2026-08-24
title: Guardian specialist agent registry
status: implemented
source: P5 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian specialist selection now reads from a manifest-backed registry, eliminating duplicated hard-coded role lists while preserving existing specialist selection behavior.
topics: [qa-guardian, agent-registry, specialists]
author: Sisyphus
related_files: [tools/guardian/agent-registry.mjs, tools/guardian/agents.manifest.mjs, tools/guardian/investigation-coordinator.mjs, tools/guardian/capabilities.mjs, tests/guardian/agent-registry.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Added a built-in specialist manifest and registry loader for Guardian investigation agents. `selectSpecialists` now uses registry roles filtered by complexity, capability availability, and configured enablement. `GUARDIAN_AGENT_ROLES` now comes from the registry instead of a second duplicate array.

## Reason for Change

P5 of the extensibility plan needs specialists to be manifest-described before later pipeline work can add or remove agents without editing selection code in multiple places.

## Impact Scope

Behavior remains equivalent for the built-in roles: simple issues select code/runtime; complex issues select code/business/runtime plus docs/history/plan-critic when capabilities are available. `skills.disabled` and `agents.<role>=false` still disable specialists.

## Implementation

`agent-registry.mjs` validates manifest shape, rejects unknown keys and duplicate roles, freezes normalized registry entries, and exposes `rolesForMode`. The built-in manifest keeps the previous role order and capability gates.

## Test Verification

- `node --test "tests/guardian/agent-registry.test.mjs" "tests/guardian/investigation-coordinator.test.mjs" "tests/guardian/capabilities.test.mjs"` passed: 17/17.
- `node --test "tests/guardian/*.test.mjs"` passed: 593/593.
- LSP diagnostics on registry, manifest, coordinator, capabilities, and registry tests reported no diagnostics.

## Notes

This phase is intentionally limited to built-in manifest loading. External manifest discovery can be added later without changing the current selection contract.
