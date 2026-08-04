---
name: project-qa-execute
description: Read-only project module execution for explicit whole-project QA after an OPEN Project QA Plan Gate.
---

# Project QA Execute

Use this skill only from [`using-project-qa`](../using-project-qa/SKILL.md) after the same Project QA Coordinator completes [`project-qa-plan`](../project-qa-plan/SKILL.md) and the Project QA Plan Gate is `OPEN`. If the gate is `BLOCKED` or has unresolved `NEEDS_HUMAN_REVIEW`, stop before execution and keep the report current.

## Execution Boundary

- In `PROJECT_QA_ONLY`, the original/product surface remains read-only. Do not modify product source, existing product tests, fixtures, snapshots, configuration, documentation, dependencies, runtime config, `.gitignore`, tracked files, or the real target. The host-only temporary generated-asset exception permits new generated validation assets only inside the isolated workspace; successful runs clean those assets and cleanup failure blocks `PASS`.
- Module QA Agents are read-only, scope-bounded workers. They cannot delegate, cannot create product/test write tasks, and cannot expand beyond their explicit module task contract.
- Execute only safe, already-available local existing tests or checks selected in the plan plus independently accepted generated validation assets created inside isolation, and run safe tests and diagnostics only inside that isolated workspace, never in the original target. Missing or unavailable runner, tool, environment, data, permission, isolated workspace, or safe storage is `BLOCKED`, never product `FAIL`.
- Generated tests are temporary validation assets, not product repair. Repair requires explicit recorded user authorization and [`project-qa-repair`](../project-qa-repair/SKILL.md). M5 checkpoint resume, stale invalidation, compatible history comparison, and conflict-stop are active through [`../references/project-run-recovery.md`](../references/project-run-recovery.md). M6 bounded static capability evidence is active through [`../references/project-capability-discovery.md`](../references/project-capability-discovery.md), and host-bounded scheduling is active through [`../references/module-resource-scheduling.md`](../references/module-resource-scheduling.md). Successful sync/back-propagation, broad capability discovery, dependency installation, automatic commit, push, PR, release approval, real model runs, network or external services, production access, and destructive operations remain deferred or forbidden.

## Module Task Contract

Every dispatched Module QA Agent receives these fields before any action:

| Field | Required record |
|---|---|
| Module ID | Explicit module identifier from Project Inventory. |
| Task ID | Stable module task identity for this run. |
| Allowed paths | Exact module paths plus declared shared dependencies; all other paths are out of scope. |
| Risk and verification IDs | Planned risks, Must Verify items, and key-flow links this task may validate. |
| Planned commands/tools | Unexecuted candidate records approved only for planning, with policy label, `execution_state: UNEXECUTED`, source evidence refs, purpose, argv/cwd hint, minimized script metadata hash/bytes/classification, safe observed toolchain basis when applicable, required tool, and prerequisites. |
| Declared resources | Explicit `resource_declaration_state: declared` plus database, port, file, credential, fixture, environment, cache, service, external-system, or other mutable resource assumptions. |
| Snapshot fingerprint | Target snapshot fingerprint that must match all result evidence. |
| Isolated workspace reference | Concrete non-empty isolated workspace reference tied to the source snapshot; execution cannot use `N/A` and must not run in the original target. |
| Result contract | Required Module Result and Execution Evidence fields from [`../references/project-qa-run-contract.md`](../references/project-qa-run-contract.md). |

Out-of-scope path access is rejected and recorded as infrastructure evidence. The result remains visible in Module Results and Execution Evidence with `BLOCKED`, an observation, the requested path, the module/task ID, and the snapshot fingerprint.

Allowed paths are target-relative paths resolved inside the isolation workspace. Symlink/junction/realpath escape outside that workspace is out-of-scope infrastructure `BLOCKED` evidence.

## Resource Scheduling

- Resource IDs are structured logical IDs in `kind:id` form; canonical shared kinds are database, port, file, credential, fixture, environment, cache, service, and external-system. Never place raw secrets, tokens, connection strings, passwords, bearer tokens, API keys, or credential values in resource IDs.
- Disjoint-resource module tasks are parallel-eligible when their mutable declared resources do not overlap, but parallel eligibility is not command authorization.
- Task IDs and isolation keys are nonempty safe logical IDs; duplicate task IDs and secret-like isolation keys are invalid authority and make the schedule `ok:false`.
- Shared database, port, file, credential, fixture, environment, cache, service, or external-system tasks are serial unless every sharing task has a distinct isolation key and an independently validated actual isolation evidence ref under a supplied artifact root with distinct safe path, distinct evidence identity from path plus hash plus bytes, SHA-256, and byte count. Hash/byte mismatch invalidates the ref; identical content at different safe paths may still be distinct evidence.
- Overlapping read-only source paths alone do not require serialization; undeclared, missing `resource_declaration_state`, ambiguous, unknown, malformed, secret-like, or non-`declared` resource state fails closed with redacted diagnostics and `ok:false`. Valid declared shared mutable resources without isolation evidence serialize and may remain `ok:true`; attempted parallel sharing or provided-but-invalid isolation evidence is invalid authority.
- The scheduler forms deterministic waves in task order and caps each wave by the finite positive integer host-declared limit. Missing, zero, negative, non-integer, or non-finite limits fall back to `1` with a visible reason; do not invent a universal maximum.
- Parallel tasks retain distinct safe result paths and artifact paths under the supplied safe output/artifact root. Duplicate result paths, duplicate artifact paths, result/artifact collisions, traversal, absolute, drive-qualified, UNC, NUL-containing, existing directory leaves, symlink/junction in any existing path component, leaf links, parent or leaf realpath escapes, lstat/realpath races, or canonical output identity collisions return `ok:false` schedule diagnostics and force involved tasks serial without changing project statuses.
- The schedule records durable per-task `serial_reasons` and `parallel_eligible_reasons`, the effective host limit, fallback reason, isolation evidence, resource declarations, result paths, artifact paths, and waves. Serial reasons include invalid authority, shared-unisolated resource, collisions, force-serial, and host fallback when relevant; parallel reasons include disjoint declared resources or shared resources with distinct validated isolation evidence and must note host bound plus separate safe paths. The schedule is Planning state; it does not authorize unsafe commands or dependency installation.

## Evidence Capture

Capture trajectory-shaped evidence for every verification attempt. Each evidence row records module ID, task ID, verification ID, actual command/tool, observation, exit/status, artifact reference/hash, timestamp, and snapshot fingerprint. Candidate command records and schedule records are not verification attempts and are not Execution Evidence. Redact sensitive data and keep only the minimum reviewable evidence.

On resume, execute only modules and flows whose current scope requires fresh evidence after M5 stale invalidation. Exact validated carried-forward evidence may satisfy current-run coverage and support current `PASS` for the unchanged module or flow only when unchanged reuse matches exactly, a storage/artifact root is available, the original artifact is re-read through safe path resolution with actual SHA-256/bytes, exact `source_run_id`, `result_id`, and `evidence_id` provenance is preserved, and the current reuse decision marks current applicability validated. Carried-forward evidence is not a new observation. Stale evidence and prior `PASS` history remain historical context only and cannot replace current objective execution evidence.

Generated tests must be independently validated against [`../references/generated-test-validation.md`](../references/generated-test-validation.md): pre-existing acceptance/risk/verification IDs, meaningful behavior, deterministic oracle, no vacuity, no circular self-proof, no weak matching, no skip/deletion, no assertion weakening, and no assertion inversion. Only independently accepted generated tests can support `PASS`.

Use [`../references/project-evidence-guide.md`](../references/project-evidence-guide.md) for evidence shape, unavailable-runner classification, resource declarations, and artifact integrity. Planning intent, command names alone, model summaries, historical reports, generated-test existence, or Module Agent success prose are not execution evidence.
