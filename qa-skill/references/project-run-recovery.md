# Project Run Recovery

Phase 2 M5 activates checkpoint resume, stale invalidation, compatible history comparison, and conflict-stop for project QA. These rules extend the Run-state authority subdomain only; they are not a fifth authority domain and do not add a fifth project status. The only project conclusions remain `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW`.

## Resume Identity

- `qa_session_id` is stable for the logical project QA session and remains stable across resume attempts.
- Every resume creates a new `run_id`; a resumed attempt must not reuse any earlier `run_id`.
- `parent_run_id` is only the immediate same-session resume lineage link. It points to the previous attempt in the same `qa_session_id`, is blank on the first run, and cannot point to itself or to a cross-session run.
- A compatible prior-history run reference is separate from `parent_run_id`. It is explicit comparison context, not resume lineage, and parent-as-history misuse is rejected whether supplied as a run argument or embedded on any run record.
- Reject self lineage, cross-session lineage, malformed lineage, non-immediate parents, and parent-as-history misuse as structured infrastructure `BLOCKED` when the defect prevents trustworthy resume.

## Storage Decision

Use the existing storage decision only. Project-local `.qa/runs/<run_id>/` storage is allowed only when `.qa/` is already ignored or local-excluded and can be used without tracked-file changes. Otherwise use host-owned external storage. M5 must not create a repository `.qa/`, modify `.gitignore`, or touch tracked files to make storage work.

## Checkpoint Authority

Checkpoint and manifest records belong to Run-state authority. Context prose, report text, or an agent summary cannot reconstruct authority when checkpoint artifacts are missing or corrupt.

Each checkpoint and manifest is written inside selected safe storage by writing a same-directory temporary file, verifying hash and bytes, then performing an atomic rename. Detached in-memory checkpoint or manifest payloads are never trusted during validation.

Each checkpoint records:

| Field | Required record |
|---|---|
| Schema version | Supported checkpoint schema version. |
| Checkpoint ID | Stable checkpoint identity. |
| Originating session/run | `qa_session_id`, `run_id`, and lineage fields for the run that wrote it. |
| Phase and pending work | Current phase and exact pending work before resume. |
| Target/scope fingerprint | Target identity and scope identity for the checkpoint. |
| Module fingerprints | Per-module fingerprints. |
| Dependency-closure fingerprints | Fingerprints for each module plus declared dependency closure. |
| Completed task/result/evidence refs | Non-empty module ID, result ID, task ID, verification IDs, snapshot fingerprint, concrete workspace reference, canonical status, evidence IDs, actual SHA-256, bytes, and source run/result/evidence provenance linked to the owning result. |
| Storage reference | Project-local ignored storage or host-owned external storage reference. |
| Repair loop state | Repair round budget with maximum = 3, integer used round count from 0 to 3, and no-progress fingerprints with normalized diff, evidence, and failure fields. |
| Manifest integrity | Manifest hash/bytes and checkpoint hash/bytes. |

Resume validates actual checkpoint, manifest schema/id/checkpoint records, every manifest artifact, and evidence artifacts in temporary or selected safe storage. Corrupt, truncated, missing, unsupported, hash mismatch, byte mismatch, reference mismatch, invalid repair budget, invalid no-progress shape, or symlink/junction/realpath escape is structured infrastructure `BLOCKED`. It cannot be downgraded to product `FAIL`, inferred from context, or repaired by report prose.

## Unchanged Reuse

Unchanged reuse requires a storage/artifact root to re-read the actual artifact and verify SHA-256 and bytes, plus the exact target scope identity, module fingerprint, dependency-closure fingerprint, module identity, task identity, verification identity, original evidence path, original evidence hash, original evidence bytes, source run/result/evidence provenance, snapshot fingerprint, and workspace reference. Resume must use safe path resolution under the storage/artifact root, reject symlink/junction/realpath escapes, and exactly preserve and compare `source_run_id`, `result_id`, and `evidence_id`. Reused evidence is carried-forward evidence with original provenance, validated artifact integrity, and a current reuse decision that marks current applicability validated. Exact validated carried-forward evidence is eligible to satisfy current-run coverage and support current `PASS` for the unchanged module or flow only. It is not fabricated fresh evidence and does not enter Evidence authority as a new observation.

## Stale Invalidation

A changed module invalidates itself plus declared dependent modules, key flows, and coverage through dependency edges. Unaffected modules remain reusable only when the exact unchanged-reuse tuple matches. Stale evidence remains visible as historical and diagnostic context but cannot support current `PASS`. Repair round count and no-progress state persist across resume.

## Conflict Stop

M5 implements conflict detection and stop only, not successful sync. Before any sync-like action, compare the repair-start original-target per-path bytes/hash baseline with the current original target; on mismatch, emit no copy, merge, sync, or back-propagation action. The baseline is the complete original-target regular-file manifest and tree fingerprint. Compare the union of baseline and current paths so added, deleted, and changed files all conflict. Special files and symlink/junction/realpath escapes fail closed as `BLOCKED`. On mismatch, report conflicting paths with expected and current fingerprints, return the existing `BLOCKED` status, and preserve user bytes exactly.

## History Comparison

History comparison uses an explicit compatible previous-run reference separate from resume lineage plus a completed compatible prior run plus current run marked `history_comparison_ready` after current inventory/evidence are available; invalid compatibility produces no classifications. Those records must have the same stable project identity, target scope, contract/schema basis, and a current reference that matches the prior run and does not overlap parent lineage. Stable finding identity is canonical SHA-256 over a fixed ordered labeled sequence of non-empty structured invariant fields: category/kind, module/flow scope, verification/acceptance/risk/rule identity. Exclude observed prose, timestamps, run IDs, paths, and summaries.

Classify history exactly as `NEW`, `PERSISTENT`, `RESOLVED`, or `NO_LONGER_APPLICABLE`. `NEW` and `PERSISTENT` require affirmative current objective finding evidence for that exact stable identity. `RESOLVED` requires affirmative current `PASS` evidence for the same applicable criterion; absence alone never resolves. `NO_LONGER_APPLICABLE` requires affirmative current inventory, plan, or evidence that the scope no longer applies. Incompatible runs, missing current evidence, missing compatibility, or unrelated current evidence refuses classification visibly.

## Current Precedence

Prior `PASS` history is comparison context only. Current objective `FAIL` remains project `FAIL`; current objective blocker remains `BLOCKED`. History never enters Evidence authority and never overrides four-status reconciliation, exact delivery, or the requirement for current objective evidence.

Exact delivery remains based on the completed current report and current evidence, not on historical summaries or prior run status.
