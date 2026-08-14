---
name: project-qa-repair
description: Explicit M4 generated-validation and isolated repair boundary for project QA after recorded user authorization when repair is requested.
---

# Project QA Repair

Use this skill only from [`using-project-qa`](../using-project-qa/SKILL.md) for two strictly separated subflows: QA-only generated validation, or explicit repair after current failure evidence and a structured user authorization record. Repair authorization is created by the Main Agent from an unambiguous user request such as fix issues and rerun full project QA; raw text or literal token presence is never authorization by itself. Ordinary QA failure, ambiguous fix wording, or a desire for passing results cannot infer repair authorization.

## Authority Boundary

- The Project QA Coordinator remains read-only for QA evidence but may orchestrate and dispatch the two M4 subflows.
- Module QA Agents are read-only, scope-bounded, and non-delegating. QA roles do not write product files, tests, generated validation assets, dependencies, configuration, runtime config, `.gitignore`, or the original target.
- In QA-only generated validation, the host Main Agent or host Implementation Agent may create only new temporary generated-validation assets under `tmp/generated-validation/` inside the isolated workspace from the Coordinator design; it must not edit existing product source, tests, configuration, dependencies, runtime config, or target files.
- In explicit repair, the host Main Agent or host Implementation Agent is the only writer for product/test changes, and only inside the isolated workspace copy after explicit recorded user authorization and an exact planned repair path classified as `product-source` or `product-test`. The original target is never written, modified, synced, or back-propagated in M4.
- M5 checkpoint resume, conflict handling as conflict-stop, and history comparison are active through [`../references/project-run-recovery.md`](../references/project-run-recovery.md). Successful sync, back-propagation, broad capability discovery, dependency installation and aliases, network or external-service access and aliases, production access, destructive operations and aliases, commits, pushes, PRs, and release approval remain deferred or forbidden.

## QA-Only Generated Validation

`PROJECT_QA_ONLY` is the default mode. In QA-only mode, repair orchestration cannot start and product repair is prohibited. QA-only may create temporary generated validation assets only under `tmp/generated-validation/` inside the isolated workspace when they are needed to validate a planned risk, acceptance criterion, or verification item. Cleanup is confined to `tmp/generated-validation` root or descendants, and successful QA-only runs clean those assets before `PASS`; cleanup failure blocks `PASS`. Failed diagnostic retention must be explicit, host-owned, and recorded without polluting the original target.

Generated tests are designed by the Coordinator against pre-existing acceptance IDs, risk IDs, and verification IDs. The host writer creates the generated test file under `tmp/generated-validation/` inside the isolated workspace. Independent read-only QA validates that the generated test has meaningful behavior, a deterministic oracle, no vacuity, no circular self-proof, no weak matching, no skip/deletion pattern, and no assertion weakening or inversion. Only independently accepted generated tests can support `PASS`.

Generated tests under `tmp/generated-validation/` must link to pre-existing acceptance IDs, risk IDs, and verification IDs.

The QA-only route is: generated asset design -> host writer creates new temporary generated-validation assets -> independent execute validation -> cleanup. Cleanup failure is infrastructure `BLOCKED` and cannot support `PASS`.

Successful run cleans assets; cleanup failure blocks `PASS`.

## Repair Round Contract

Each repair round records these distinct IDs and artifacts:

Repair records pair immutable original failure evidence with a minimal diff artifact that has its own path, SHA-256, byte count, before SHA-256, and after SHA-256.

| Repair field | Required record |
|---|---|
| Repair round ID | Stable ID for the attempt. |
| Original failure evidence ID | Immutable original failure evidence, never overwritten by reruns. |
| Root-cause hypothesis ID | Hypothesis linked to the failing behavior and planned verification IDs. |
| Changed target-relative paths | Minimal target-relative file list changed inside the isolated workspace. |
| Minimal diff ID | Diff artifact with before SHA-256 and bytes plus after SHA-256 and bytes. |
| Original rerun evidence ID | Rerun original failure first before broader regression. |
| Module regression evidence ID | Affected module regression after the original failure rerun. |
| Fresh evidence ID | Fresh current evidence that independent QA may use for status. |

The rerun order is original failure first, then affected module regression, then project regression only when needed by the plan. Main Agent summaries, model claims, generated-test creation logs, and historical evidence cannot replace fresh independent QA evidence.

The repair route is: current failure evidence -> explicit recorded repair authorization -> exact repair write plan with target-relative paths classified as `product-source` or `product-test` -> host writer modifies only those planned product/test paths inside isolation -> fresh execute reruns -> conclude. Repair writes require an exact planned path classified as `product-source` or `product-test`. Package/dependency manifests, lockfiles, configuration, documentation, runtime/tool config, `.opencode`, and Git metadata files are not repair write targets in M4.

## Loop Limits And Human Gate

Run at most three repair rounds. The fourth repair round is refused and all three attempts remain visible with unresolved status. Stop early when consecutive rounds repeat the same non-empty normalized diff fingerprint, evidence fingerprint, or failure fingerprint as no progress; record a loop-control Human Gate and `NEEDS_HUMAN_REVIEW` without spinning. Confirmed product failure still follows canonical reconciliation and remains `FAIL` unless an objective blocker takes precedence.

Delete a failing test, skip it, weaken an assertion, invert an assertion, broaden matching to superficial success text, remove a planned verification, or accept an invalid generated test is rejected as policy/infrastructure `BLOCKED` and cannot produce `PASS`.

## M5 Conflict Stop

Before any sync-like action after an isolated repair, compare the repair-start complete original-target regular-file manifest and tree fingerprint against the current original target. Added, deleted, changed, special-file, symlink, junction, or realpath-escape differences all stop as existing `BLOCKED`. Report conflicting paths with expected and current fingerprints, emit no copy, merge, sync, or back-propagation action, and preserve user bytes exactly. M5 does not implement successful sync.
