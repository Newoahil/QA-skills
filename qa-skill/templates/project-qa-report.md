# Project QA Report

## Run Identity

| Field | Record |
|---|---|
| `qa_session_id` |  |
| `run_id` |  |
| `parent_run_id` | Optional; blank for first attempt; immediate same-session resume lineage only. |
| Compatible prior-history run | Explicit compatible previous-run reference for history comparison; separate from `parent_run_id`. |
| Mode | `PROJECT_QA_ONLY` by default; `PROJECT_FIX_AND_RERUN` only when explicit recorded user authorization exists. |
| User authorization record | Source=user, explicit=true, selected mode, request text/reference, timestamp, and record identity when repair is authorized. |

## Project Snapshot Identity

| Snapshot field | Record |
|---|---|
| Supplied skill source path |  |
| Resolved skill source path |  |
| Supplied product target path |  |
| Resolved product target path |  |
| Target path |  |
| Snapshot time |  |
| Git/working-tree state | Git and working-tree state when available, including uncommitted changes or unavailable reason. |
| Isolation-workspace reference |  |
| Source snapshot fingerprint for isolated workspace |  |

## Storage Decision

| Field | Record |
|---|---|
| Project-local storage eligibility | `.qa/runs/<run_id>/` allowed only when ignored/local-excluded without tracked-file changes. |
| Selected storage | Project-local ignored storage / host-owned external storage. |
| Fallback reason | If project-local storage is not proven safe, host-external storage is mandatory. |

## Project Intake

| Project Intake field | Record |
|---|---|
| Observed Facts |  |
| Inferred Intent | Intent:  Confidence:  Basis:  |
| Authoritative Acceptance Criteria | Criterion:  Source or owner:  |
| Unresolved Questions |  |

## External Context (Not Evidence)

`context_acquired: <yes/N/A>`. Present only when the current Diff, request, or report already names an explicit GitHub reference (Issue/PR/commit). No reference named means `N/A` and this section stays empty. This is bounded change-intent extraction: GitHub-only, explicit refs only, no search, one-hop, `gh` preferred. Each extracted item is a `qa_planning_inputs` record (planning-only contract).

| Planning input ID | Reference | Claim type | Claim (stated/intended) | Provenance | Confidence | Use limit | Availability |
|---|---|---|---|---|---|---|---|
| <planning-input-id> | <reference id or URL> | intent / acceptance_criteria / repro_steps / risk_hypothesis / contradiction / unusable_context | <short stated/intended summary of what it says> | <exact reference identifier/URL> | high / medium / low | planning_only | Read / Unavailable: <reason> |

Contradictions and no-useful-context references are recorded visibly here (claim type `contradiction` or `unusable_context`) so the human can see a reference was read but yielded no useful QA context or exposed a conflict. Every nontrivial claim requires provenance; a claim without provenance is discarded.

This section is Planning state only. It never supports PASS, is never Module Results or Execution Evidence, and does not persist beyond this run.

## Scope and Non-goals

| Field | Record |
|---|---|
| In scope | Explicit whole-project QA target only. |
| Out of scope | Successful sync/back-propagation, broad or unbounded technology discovery, automatic dependency handling, dependency installation, downloads, external frameworks, network access, external-service access, credential/secret use, commits, pushes, PRs, release approval, production/sensitive access, destructive operations, real model runs, M7 docs, and original-target writes are deferred or forbidden. M5 conflict handling is stop-only. |
| Phase 1 boundary | `using-qa` remains the requirement/fix/Diff route. |
| Active M5 recovery and M6 planning | Checkpoint resume, stale invalidation, compatible history comparison, conflict-stop, bounded static capability evidence, and host-bounded scheduling are active; M7 work remains deferred. |

## Capability Evidence And Candidate Planning

| Capability evidence ID | Source path | SHA-256 | Bytes | Reason | Recognized kind | Adapter | Confidence |
|---|---|---|---|---|---|---|---|
| <capability-evidence-id> | <target-relative allowlisted artifact path or REDACTED_SOURCE_PATH with identity/bytes when secret-like> | <actual SHA-256> | <actual byte count> | <why this artifact was recognized or structured BLOCKED bound/root/path reason and rerun condition> | package.json / Python manifest / go.mod / Java manifest / OpenAPI / explicit CLI entry | node / python / go / java / api / cli | direct/inferred/unknown |

| Capability ID | Observed capability | Evidence refs | Candidate refs | Browser omitted reason |
|---|---|---|---|---|
| <capability-id> | Node / Python / Go / Java / API-only / CLI-only / unknown observed capability | <capability evidence IDs> | <candidate IDs or N/A> | <explicit reason when no browser/Playwright check is mandatory> |

| Candidate ID | Policy label | Execution state | Source evidence refs | Purpose | Argv/cwd hint | Script metadata | Toolchain basis | Required tool | Prerequisites | Missing prerequisite | Human Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| <candidate-id> | LOCAL_EXISTING_CHECK_CANDIDATE / HUMAN_GATE_REQUIRED; not a project status | UNEXECUTED | <evidence IDs> | <planning purpose with no raw unsafe identifiers> | <argv and cwd hint only; no raw unsafe identifiers> | <safe script name/identifier or redacted display, script-name SHA-256/bytes, script content SHA-256/bytes, safety classification, redacted/minimized reasons; no raw script content> | <safe observed package-manager basis such as npm@version or N/A> | <already-installed local tool> | <objective prerequisites> | <BLOCKED prerequisite and rerun condition, if any> | <reason, redacted/minimized blocked_action, exact_question, default_if_no_answer: do_not_execute, if any> |

## Project Inventory

| Module ID | Type | Entries | Existing tests | Shared dependencies | Used by | Sources | Unknowns |
|---|---|---|---|---|---|---|---|
| <module-id> | Important entry module / shared dependency / service / utility | <entry paths> | <existing test paths grouped by module> | <dependency module IDs> | <dependent module IDs> | <observed source paths or owners> | <unknowns or N/A> |

## Risk and Verification Plan

### Important Module and Key Flow Classification

| Item ID | Item type | Classification | Priority | Reason or basis | Sources |
|---|---|---|---|---|---|
| <module-or-flow-id> | Module / shared dependency / key flow / utility | important / lower priority | Must Verify / Should Verify / Optional / Explicitly Not Verified | <why this item matters or why omission is reviewable> | <requirements, manifests, entries, owners, or observed dependency sources> |

### Key Flows

| Flow ID | Entry | Dependencies | Expected result | Verification intent | Sources | Affected modules |
|---|---|---|---|---|---|---|
| <flow-id> | <entry module or user/API/CLI entry> | <module or service dependency chain> | <project-specific expected result from authoritative criteria> | <planned validation layer and evidence intent before execution> | <requirements, manifests, entries, owners, or observed dependency sources> | <module IDs affected by this flow> |

### Planned Verification

| Verification ID | Risk or item | Planned layer | Preconditions | Expected result | Evidence needed later | Human Gate |
|---|---|---|---|---|---|---|
| <verification-id> | <risk, module, or flow ID> | Static/unit / API/integration / E2E/system / Specialist non-functional / Manual acceptance | <objective prerequisites> | <expected result from authoritative criteria> | Current module, flow, or independently accepted generated-validation evidence through M4. | N/A / BLOCKED prerequisite / NEEDS_HUMAN_REVIEW item |

### Omissions

| Item ID | Status | Why not verified or lower priority | Residual risk | Rerun or priority-change condition |
|---|---|---|---|---|
| <omission-id> | Optional / Explicitly Not Verified | <visible reason, such as no observed capability or not on a key flow> | <remaining risk> | <condition that would trigger replanning or verification> |

## Project QA Plan Gate

Project QA Plan Gate: OPEN/BLOCKED/NEEDS_HUMAN_REVIEW

| Gate field | Record |
|---|---|
| Explicit product target supplied and resolved | OPEN/BLOCKED:  |
| Target snapshot identity recorded | OPEN/BLOCKED:  |
| Storage decision safe | OPEN/BLOCKED:  |
| Project Intake complete for current planning | OPEN/BLOCKED:  |
| Project Inventory complete | OPEN/BLOCKED:  |
| Important modules and key flows classified with reasons and sources | OPEN/BLOCKED:  |
| Risk and Verification Plan complete | OPEN/BLOCKED:  |
| Omissions visible and justified | OPEN/BLOCKED:  |
| Missing objective prerequisite | BLOCKED item and rerun condition:  |
| Subjective decision | NEEDS_HUMAN_REVIEW item:  |
| Module task readiness and declared resources recorded | OPEN/BLOCKED:  |
| Capability evidence and observed capabilities recorded | OPEN/BLOCKED:  |
| Candidate policies, Human Gates, and missing prerequisites recorded | OPEN/BLOCKED:  |
| Host-bounded resource schedule recorded | OPEN/BLOCKED:  |

Only an `OPEN` Project QA Plan Gate may hand off to read-only module execution. `BLOCKED` or unresolved `NEEDS_HUMAN_REVIEW` pauses before Module QA Agents are dispatched.

## Resource Declarations And Schedule

| Task ID | Resource declaration state | Declared resources | Result path | Artifact path | Isolation key | Isolation evidence ref | Serial reasons | Parallel-eligible reasons | Resource diagnostics |
|---|---|---|---|---|---|---|---|---|---|
| <task-id> | <declared required; missing/ambiguous/unknown invalid> | <canonical kind:id resource IDs only; no raw secrets, URL userinfo, or connection strings> | <distinct root-bound safe result path with canonical output identity> | <distinct root-bound safe artifact path with canonical output identity> | <distinct safe isolation key or N/A> | <distinct safe path, full evidence identity from path+hash+bytes, actual SHA-256, bytes under supplied artifact root or N/A> | <durable per-task invalid authority/shared-unisolated/canonical collision/force-serial/host fallback reasons> | <durable per-task disjoint declared resource or distinct validated isolation reasons noting host bound and separate safe paths> | <redacted serialization/fail-closed reason, if any> |

| Schedule field | Record |
|---|---|
| Host-declared limit | <finite positive integer or invalid supplied value> |
| Effective host limit | <limit used; fallback to 1 with visible reason when invalid> |
| Parallel-eligible tasks | <task IDs and reason; not authorization> |
| Serial tasks | <task IDs and shared/undeclared/missing/ambiguous resource reason> |
| Deterministic waves | <wave number -> task IDs, capped by effective host limit> |
| Duplicate or unsafe paths | <BLOCKED/serialized diagnostics> |
| Schedule ok | true/false for fail-closed planning diagnostics; not a project status. |

Scheduling records are Planning state. They do not authorize commands and do not replace candidate policy or Execution Evidence.

## Module Results

| Module ID | Task ID | Scope and allowed paths | Verification IDs | Declared resources | Isolation workspace | Snapshot fingerprint | Result status | Evidence references | Findings or Human Gates |
|---|---|---|---|---|---|---|---|---|---|
| <module-id> | <task-id> | <target-relative paths resolved inside isolation workspace> | <verification IDs> | <database/port/file/credential/fixture/environment/cache/service/external-system or N/A> | <concrete workspace reference, not N/A for execution> | <snapshot fingerprint> | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW | <evidence IDs and artifact references> | <finding IDs, blocker IDs, or Human Gate IDs> |

## Execution Evidence

| Evidence ID | Module ID | Task ID | Verification ID | Actual command/tool | Observation | Exit/status | Artifact reference/hash | Timestamp | Snapshot fingerprint | Isolation workspace |
|---|---|---|---|---|---|---|---|---|---|---|
| <evidence-id> | <module-id> | <task-id> | <verification-id> | <safe existing local command or read-only tool actually used inside isolation workspace> | <minimum reviewable observation> | <exit code or tool status> | <relative or host-owned artifact path, SHA-256, byte count> | <timestamp> | <snapshot fingerprint> | <isolation workspace reference> |

### Generated Test Validation

| Generated validation ID | Linked pre-existing acceptance/risk/verification IDs | Generated asset metadata | Host writer | Independent QA validation artifact | Meaningful behavior | Deterministic oracle | Rejection checks | Cleanup status | Supports PASS |
|---|---|---|---|---|---|---|---|---|---|
| <generated-validation-id> | <pre-existing IDs only> | <target-relative path under `tmp/generated-validation/`, SHA-256, byte count, workspace, snapshot> | Host Main Agent / host Implementation Agent inside isolated workspace | <validator role, actor, evidence ID, canonical artifact path under safe root, actual SHA-256, actual byte count, matching workspace/snapshot> | PASS/BLOCKED | PASS/BLOCKED | no vacuity / no circular self-proof / no weak matching / no skip/deletion / no assertion weakening / no assertion inversion | PASS/BLOCKED | YES/NO |

QA-only may create temporary generated validation assets only under `tmp/generated-validation/` inside the isolated workspace. A successful run cleans only `tmp/generated-validation` root or descendants before `PASS`; cleanup failure blocks `PASS`. Failed diagnostic retention must be explicit and host-owned.

QA-only route: generated asset design -> host writer creates new temporary generated-validation assets -> independent execute validation -> cleanup.

### Repair Record

| Repair round ID | Original failure evidence ID | Root-cause hypothesis ID | Changed target-relative paths | Minimal diff artifact | Authorization/workspace/snapshot linkage | Original rerun evidence ID | Module regression evidence ID | Fresh evidence ID | Round status |
|---|---|---|---|---|---|---|---|---|---|
| <repair-round-id> | <immutable original failure evidence with FAIL status, task ID, verification ID, canonical artifact path, actual SHA-256/bytes, workspace, and snapshot> | <root-cause hypothesis> | <paths changed only inside isolated workspace> | <own path, ID, SHA-256, byte count, before SHA-256/bytes, after SHA-256/bytes> | <authorization record, workspace reference, snapshot fingerprint> | <rerun original failure first> | <affected module regression> | <fresh independent evidence> | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW |

The host Main Agent or host Implementation Agent is the only writer inside the isolated workspace after explicit recorded user authorization and an exact planned repair path classified as `product-source` or `product-test`. The original target is never written, modified, synced, or back-propagated in M4.

Repair route: current failure evidence -> explicit recorded repair authorization -> host writer modifies product/tests only inside isolation -> fresh execute reruns -> conclude.

### Repair Loop Control

| Control item | Required record |
|---|---|
| Maximum rounds | Max three repair rounds; refuse a fourth and keep all three attempts visible. |
| No-progress stop | Repeated normalized diff fingerprint, evidence fingerprint, or failure fingerprint stops as no progress. |
| Human Gate | Record `NEEDS_HUMAN_REVIEW` without spinning when no progress or the repair limit is reached. |

### M5 Run Recovery

| Recovery field | Record |
|---|---|
| Resume identity | Stable `qa_session_id`; every resume has a new `run_id`; `parent_run_id` is immediate same-session resume lineage only. |
| Prior history | Explicit compatible previous-run reference separate from resume lineage. |
| Checkpoint | Same-directory temporary file -> verify hash/bytes -> atomic rename; schema version, checkpoint ID, originating session/run, phase, pending work, target/scope fingerprint, per-module fingerprints, dependency-closure fingerprints, completed result module/result/task/verification IDs, snapshot fingerprint, concrete workspace reference, canonical status, storage reference, repair round budget max = 3 with used count 0 to 3, no-progress fingerprints, checkpoint hash/bytes. |
| Manifest | Manifest schema/id, manifest hash/bytes plus checkpoint and every evidence artifact reference with actual SHA-256, bytes, and provenance. |
| Unchanged reuse | Storage/artifact root, exact target scope identity, module fingerprint, dependency-closure fingerprint, module/task/verification identities, original evidence path/hash/bytes, exact source run/result/evidence provenance, snapshot, and workspace; re-read actual artifact under safe path resolution; current reuse decision marks applicability validated; eligible for current-run coverage and `PASS` only for the unchanged module or flow. |
| Stale invalidation | Changed module invalidates itself plus declared dependent modules, key flows, and coverage through dependency edges; stale evidence remains historical/diagnostic and cannot support current `PASS`. |
| Conflict-stop | Repair-start complete original-target regular-file manifest and tree fingerprint compared with current original target before sync-like action; added/deleted/changed/unsafe paths record expected/current fingerprints; no copy/merge/sync/back-propagation action; user bytes preserved. |
| History comparison | Completed compatible prior run plus current run marked `history_comparison_ready` after current inventory/evidence are available, with same stable project identity, target scope, and schema; stable finding identity is canonical SHA-256 over non-empty invariant fields; classify exactly `NEW`, `PERSISTENT`, `RESOLVED`, `NO_LONGER_APPLICABLE`; `NEW` and `PERSISTENT` require affirmative current objective finding evidence; invalid compatibility produces no classifications; absence alone never resolves. |

### Important Module And Key Flow Coverage

| Item ID | Item type | Required evidence | Current evidence | Coverage status | Omission or residual risk |
|---|---|---|---|---|---|
| <module-or-flow-id> | Important module / key flow / Must Verify item | <expected module result or evidence chain> | <current evidence IDs or exact carried-forward evidence with validated current applicability> | COVERED/BLOCKED/FAILED/NEEDS_HUMAN_REVIEW | <visible omission or residual risk> |

### Project Traceability

| Risk ID | Verification ID | Evidence ID | Status | Module or flow | Expected result |
|---|---|---|---|---|---|
| <risk-id> | <verification-id> | <evidence-id> | PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW | <module-or-flow-id> | <critical expected result> |

### Infrastructure State

| Item | State | Evidence reference | Rerun condition |
|---|---|---|---|
| Runner/tool/environment/data/permission/storage/resource/artifact integrity | PASS/BLOCKED | <evidence or authority reference> | <exact condition to rerun> |
| Target postflight integrity | PASS/BLOCKED | <product-file pre/post fingerprint or hash comparison; approved host artifact writes and approved `.qa` artifact writes are outside the product-file integrity comparison> | <restore target product files or rerun from a clean snapshot> |

## Authority and Manifest Integrity

| Authority domain | Record |
|---|---|
| Evidence authority |  |
| Report-semantic authority |  |
| Run-state authority |  |
| Run-state recovery subdomain | Checkpoint, manifest, resume lineage, compatible prior-history reference, stale invalidation, conflict-stop, repair-loop carry-forward, and history comparison state; not a fifth authority or status. |
| Delivery authority |  |
| SHA-256 and byte count references | Report and material artifacts:  |
| Authority reconciliation | Any unexplained mismatch prevents `PASS`. Infrastructure-integrity failure blocks `PASS`. Artifact hash mismatch or byte mismatch prohibits `PASS` without creating a fifth project status. |

## Findings

| Finding ID | Status | Authority domain | Evidence reference | Impact | Next step |
|---|---|---|---|---|---|
| F- | FAIL/BLOCKED/NEEDS_HUMAN_REVIEW | Evidence authority / Report-semantic authority / Run-state authority / Delivery authority |  |  |  |

## Unverified and Blocked Items

| Item ID | Status | Reason | Rerun condition |
|---|---|---|---|
| U- | BLOCKED |  |  |

## Human Review Items

| Item ID | Decision question | Evidence references | Decision owner | Decision and date |
|---|---|---|---|---|
| H- |  |  |  |  |

## Cleanup/Retention

| Field | Record |
|---|---|
| Project-local `.qa` handling | No `.qa/` runtime artifacts unless already ignored/local-excluded without tracked-file changes. |
| Host-external storage retention |  |
| Cleanup required |  |
| Temporary generated validation assets | Created only inside isolated workspace; removed before `PASS` or cleanup failure blocks `PASS`. |
| Failed diagnostic retention | Explicit host-owned artifact reference; no original-target pollution. |

## Residual Risk

| Risk ID | Residual risk | Evidence or authority reference | Follow-up |
|---|---|---|---|
| R- |  |  |  |

## Project QA Conclusion Gate

Project QA Conclusion Gate: COMPLETE/BLOCKED

Overall Status: PASS/FAIL/BLOCKED/NEEDS_HUMAN_REVIEW

Project `PASS` is permitted only when every important module/key flow, every Must Verify item, and all current evidence align for the same snapshot fingerprint.

| Conclusion field | Record |
|---|---|
| Current evidence supports every claim | COMPLETE/BLOCKED:  |
| Authority domains reconciled | COMPLETE/BLOCKED:  |
| Every important module/key flow has current evidence | COMPLETE/BLOCKED:  |
| Every Must Verify item has Risk -> Verification -> Evidence -> Status traceability | COMPLETE/BLOCKED:  |
| Critical expected results pass unless recorded as FAIL | COMPLETE/BLOCKED:  |
| No objective blocker or critical Human Gate remains for PASS | COMPLETE/BLOCKED:  |
| Omissions and residual risks visible | COMPLETE/BLOCKED:  |
| Module Results and Execution Evidence current for snapshot fingerprint | COMPLETE/BLOCKED:  |
| Isolation workspace concrete and tied to source snapshot | COMPLETE/BLOCKED:  |
| Module Result task IDs match planned task IDs | COMPLETE/BLOCKED:  |
| Declared module statuses match derived statuses from evidence/findings/Human Gates | COMPLETE/BLOCKED:  |
| Explicit authority integrity input present and `ok` is exactly true | COMPLETE/BLOCKED:  |
| Target postflight integrity proves product files unchanged | COMPLETE/BLOCKED:  |
| Generated tests independently accepted before supporting PASS | COMPLETE/BLOCKED/N/A:  |
| Generated validation cleanup completed | COMPLETE/BLOCKED/N/A:  |
| Repair records complete with immutable original failure, root-cause hypothesis, changed paths, minimal diff, original rerun, module regression, and fresh evidence | COMPLETE/BLOCKED/N/A:  |
| Repair loop limit and no-progress fingerprint checks satisfied | COMPLETE/BLOCKED/N/A:  |
| M5 checkpoint/manifest atomic write and actual artifact revalidation satisfied | COMPLETE/BLOCKED/N/A:  |
| M5 complete target baseline conflict-stop satisfied with no sync/back-propagation action | COMPLETE/BLOCKED/N/A:  |
| M5 compatible history prerequisites and current evidence requirements satisfied | COMPLETE/BLOCKED/N/A:  |
| M6 capability evidence, observed capabilities, candidate policies, missing prerequisites, and Human Gates visible | COMPLETE/BLOCKED/N/A:  |
| M6 resource declarations, effective host limit/fallback, deterministic waves, isolation evidence, and separate result/artifact paths visible | COMPLETE/BLOCKED/N/A:  |
| No unexplained mismatch remains for `PASS` | COMPLETE/BLOCKED:  |
| Four-status conclusion rule | Objective required blockers -> overall `BLOCKED`; otherwise confirmed required product failure -> `FAIL`; otherwise unresolved critical Human Gate with objective evidence -> `NEEDS_HUMAN_REVIEW`; otherwise complete current evidence -> `PASS`. Preserve all lower-level findings even when overall `BLOCKED`. |

`SKIP` may describe an individual check, but it is not a project conclusion. The only project statuses are `PASS`, `FAIL`, `BLOCKED`, and `NEEDS_HUMAN_REVIEW`.

## Delivery Authority

| Field | Record |
|---|---|
| Completed-result delivery payload |  |
| Mirror equality | Exact mirror equality with report artifact, if any:  |
| Delivery SHA-256 and byte count |  |
| Coordinator completed payload, report artifact, and manifest hashes | Exact match required:  |
| Mismatch diagnostics | Raw mismatch diagnostics for any byte mismatch:  |
| Malformed delivery input diagnostics | Structured field-specific failure diagnostics, if any:  |

Generated tests and explicitly authorized isolated repair are active in M4 under the boundaries above. Resume and history comparison were deferred or forbidden in M4. In M5, checkpoint recovery, stale invalidation, conflict-stop, and compatible history comparison are active under the recovery contract. In M6, bounded static capability evidence and host-bounded scheduling are active as Planning state. Successful sync/back-propagation, broad technology command discovery, automatic dependency handling, dependency installation, downloads, automatic commit, push, PR, release approval, real model runs, network or external-service access, credential or secret use, production or sensitive access, destructive operations, and M7 docs remain deferred or forbidden.
