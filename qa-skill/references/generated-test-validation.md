# Generated Test Validation

Use this reference for M4 temporary generated validation assets and explicit repair mode. It does not authorize product repair in default `PROJECT_QA_ONLY` mode and does not add sync, checkpoint, conflict, history, capability discovery, installer, network, external-service, production, destructive, commit, push, PR, or release behavior.

## Generated Test Contract

Generated tests must be designed by the Project QA Coordinator against pre-existing acceptance IDs, risk IDs, and verification IDs already present in the Project Inventory, Risk and Verification Plan, or current failure evidence. A generated test cannot introduce a new acceptance requirement and then prove itself.

The host Main Agent or host Implementation Agent may create only new temporary generated validation assets under `tmp/generated-validation/` inside the isolated workspace from the Coordinator design. It may not edit existing product source, tests, configuration, dependencies, runtime config, or target files in QA-only mode. Module QA Agents remain read-only and independently validate the generated tests before any result can support `PASS`.

Independent validation requires all of the following:

- Meaningful behavior assertion tied to an existing expected result.
- Deterministic oracle that does not depend on model judgment, current time, random output, broad text matching, or the generated test's own source text.
- No vacuity, no circular self-proof, no weak matching, no skip, no deletion, no assertion weakening, and no assertion inversion.
- Traceability to pre-existing acceptance, risk, and verification IDs.
- Generated asset metadata with target-relative path under `tmp/generated-validation/`, explicit SHA-256, nonnegative byte count, writer actor, isolation workspace reference, and snapshot fingerprint. The recorded hash and byte count must exactly match the actual file in the isolated workspace.
- A separate independent QA validation record from a different read-only actor with recognized role `Module QA Agent` or `Independent QA Agent`, accepted status, evidence ID, evidence artifact path under a supplied safe artifact/workspace root, evidence artifact SHA-256, evidence artifact byte count, matching isolation workspace reference, matching snapshot fingerprint, and all meaningful/deterministic/anti-vacuity checks recorded. The evidence artifact is resolved canonically and read; its actual SHA-256 and byte count must match the record.
- Cleanup plan for temporary assets in the isolated workspace.

Only independently accepted generated tests can support `PASS`. Rejected generated tests are policy/infrastructure `BLOCKED`, remain visible as validation evidence or blockers, and cannot be counted as coverage.

## Cleanup And Retention

Successful QA-only runs clean temporary generated validation assets before `PASS`. Cleanup is confined to `tmp/generated-validation` root or descendants; any other workspace path, traversal, absolute path, NUL path, or path through a link is `BLOCKED` with no removals. Cleanup failure blocks `PASS` because target/runtime pollution cannot be excluded. Failed diagnostic retention must be explicit and host-owned; retained diagnostics are artifacts, not product repairs, and must not be written into the original target.

## Anti-Weaken Rules

A repair or generated validation step is rejected when it deletes a failing test, marks it skipped, weakens an assertion, inverts an assertion, broadens matching to superficial success output, removes a planned verification, or proves only that generated files exist. Such a step cannot produce `PASS` even if later command output is green.
