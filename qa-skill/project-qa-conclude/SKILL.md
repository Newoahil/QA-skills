---
name: project-qa-conclude
description: Project QA conclusion and four-status reconciliation from current module results, evidence, authority, and delivery integrity.
---

# Project QA Conclude

Use this skill only from [`using-project-qa`](../using-project-qa/SKILL.md) after the same Project QA Coordinator has current Module Results and Execution Evidence from [`project-qa-execute`](../project-qa-execute/SKILL.md), or after execution stops with a recorded blocker. Do not summarize around the report contract; complete the maintained project report and deliver it exactly.

## Conclusion Inputs

- Current Project Intake, snapshot identity, storage decision, Project Inventory, important-module/key-flow classification, Risk and Verification Plan, Plan Gate, Module Results, Execution Evidence, Authority and Manifest Integrity, Human Review Items, omissions, and residual risk.
- Module Results and evidence whose task IDs, isolation workspace references, and snapshot fingerprints match the current target snapshot. Exact validated carried-forward evidence can support current `PASS` for the unchanged module or flow only when its current reuse decision marks applicability validated and original provenance is preserved. Stale or missing fingerprints, missing or mismatched task IDs, or `N/A` isolation workspace references cannot support `PASS`.
- Target postflight integrity comparing original target product-file fingerprints before and after QA-only execution. Approved host artifact writes and approved `.qa` artifact writes are outside the product-file integrity comparison.
- Generated-test validation records, generated asset metadata, independent validation artifact metadata, cleanup results, and repair records when present. Only independently accepted generated tests can support `PASS`; cleanup failure blocks `PASS`; failed diagnostic retention must be explicit and host-owned.
- Repair records when explicit recorded user authorization was present: immutable original failure evidence with stable identity/hash, root-cause hypothesis, changed target-relative paths, minimal diff artifact with its own path, ID, SHA-256, byte count, before/after SHA-256 and bytes, original failure rerun first, affected module regression, fresh evidence with distinct IDs, and workspace/snapshot linkage.
- M5 recovery records when present: checkpoint/manifest atomic-write validation, resume lineage, compatible prior-history reference and completed compatible prior run plus current run marked `history_comparison_ready` after current inventory/evidence are available, unchanged reuse decisions with actual artifact revalidation and current applicability validation, stale invalidation through dependency edges, repair round count and no-progress carry-forward, complete original-target baseline/tree conflict-stop diagnostics, and history comparison classifications from [`../references/project-run-recovery.md`](../references/project-run-recovery.md).
- Explicit authority integrity input. Missing authority integrity, `ok` not exactly true, or unexplained authority mismatch is infrastructure `BLOCKED` and cannot be silently assumed healthy.
- Report artifact, manifest, module result artifacts, and completed delivery payload hashes and byte counts.

## Four-Status Reconciliation

The project conclusion is exactly one of `PASS`, `FAIL`, `BLOCKED`, or `NEEDS_HUMAN_REVIEW`. `SKIP` may describe an individual check but is never a project conclusion.

Apply this deterministic order:

1. Objective required blockers -> overall `BLOCKED`. Examples include missing acceptance prerequisites, unavailable required runner/tool/environment/data/permission, missing isolated workspace, unsafe storage, out-of-scope evidence, corrupt artifact hash, target product-file postflight mismatch, authority mismatch, or exact-delivery mismatch.
2. Otherwise confirmed required product failure -> `FAIL` when current evidence proves a critical expected result or Must Verify item failed.
3. Otherwise unresolved critical Human Gate with objective evidence -> `NEEDS_HUMAN_REVIEW` when executable evidence exists but a required business, UX, design, safety, privacy, accessibility, or owner decision remains unresolved.
4. Otherwise complete current evidence -> `PASS` only when every important module/key flow and Must Verify item has current evidence, all critical expected results pass, no objective blocker or critical Human Gate remains, omissions and residual risks are visible, and authority integrity matches.

For each Module Result, derive the module status from all evidence rows, findings, and Human Gates before comparing it to the declared module status: objective evidence/finding blocker -> module `BLOCKED`; otherwise product/evidence failure -> `FAIL`; otherwise critical Human Gate or `NEEDS_HUMAN_REVIEW` evidence -> `NEEDS_HUMAN_REVIEW`; otherwise non-empty all-`PASS` current evidence -> `PASS`. A declared Module Result status that does not match the derived status is infrastructure `BLOCKED`; mixed `PASS` plus `FAIL` evidence may validly declare module `FAIL`, and `PASS` evidence plus a critical Human Gate may validly declare `NEEDS_HUMAN_REVIEW`.

Preserve all lower-level findings even when the overall `BLOCKED` status has precedence. A product failure discovered before an infrastructure blocker remains recorded with its evidence, impact, and next step.

## Authority And Delivery Gate

- Infrastructure integrity is separate from product behavior. Missing/unavailable runner, tool, environment, data, permission, safe storage, corrupt artifact hash, or manifest mismatch is `BLOCKED`, never product `FAIL`.
- Empty command output can be valid evidence: zero-byte artifacts are permitted when artifact path and SHA-256 are present and match the recorded artifact.
- A failed target postflight integrity check means original target product files changed and is infrastructure `BLOCKED`; preserve the raw hash/fingerprint diagnostics and prohibit `PASS`.
- Artifact hash mismatch or byte-count mismatch is an infrastructure integrity failure that prohibits `PASS` without creating a fifth project status.
- Coordinator completed payload, report artifact, and manifest hashes must match exactly. Any byte mismatch fails the conclusion gate, keeps raw mismatch diagnostics, and prevents `PASS`.
- Missing or malformed delivery input is a structured failure with field-specific diagnostics; it must not throw away the conclusion record or be treated as exact delivery.
- Run-state authority cannot override report semantics; report text cannot rewrite actual command/tool evidence; delivery authority must not be reconstructed from a Main Agent summary.
- Run-state authority recovery state cannot be reconstructed from context, report text, or an agent summary. Checkpoint, manifest, evidence hash/byte/reference mismatch, unsupported checkpoint schema, invalid repair budget, invalid no-progress shape, stale current fingerprints, unsafe artifact path, complete original-target baseline conflict, or invalid resume/history lineage is infrastructure `BLOCKED` and remains within the four canonical statuses.
- Prior `PASS` history is comparison context only. A current objective `FAIL` remains project `FAIL`; history never enters Evidence authority and never overrides four-status reconciliation or exact delivery.
- A deleted failing test, skipped test, weakened assertion, inverted assertion, weak matching, vacuous generated test, or circular self-proof is policy/infrastructure `BLOCKED` and prevents `PASS`. A fourth repair round or repeated consecutive non-empty normalized diff/evidence/failure fingerprint creates a loop-control Human Gate and `NEEDS_HUMAN_REVIEW` without overriding a confirmed product `FAIL` under canonical reconciliation.

## Completed Result

Deliver the exact completed project report with one standalone `Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW` line replaced by the chosen status. Include report hash and byte count, storage decision, authority reconciliation, mismatch diagnostics if any, Human Gates, blocked items, residual risk, and the statement that no release approval is provided.
