# QA-CR B2 parent export v2 contract

## Scope

- Phase: V2-A docs/data/fixture contract only.
- Real-run status: B2-v2 is tombstoned after one consumed fail-closed authorization attempt due credential environment; no retry. B2-v1 also remains spent and cannot be rerun.
- Phase A manifest/scope and `qa` / `qa-cr` prompts remain unchanged.
- This contract covers non-scoring plumbing only and makes no defect, accuracy, or graduation claims.

## Authority table

| Source | Authoritative for | Never authoritative for |
| --- | --- | --- |
| Parent JSONL (`opencode run --format json`) | terminal/session/task topology, observed completed `qa-cr` child session IDs, emitted `step_finish` usage/cost | message timing, native step timing, canonical totals |
| Parent export (`opencode export <parent> --pure`) | assistant message `time.created` / `time.completed`, exported assistant identity, canonical unique `step-finish` usage/cost | synthesized step timing, retries, double-counted totals |
| Child export (`opencode export <child> --pure`) | child `info.id`, child `info.parentID`, assistant message timing, child message/step usage-cost | parent topology beyond `info.parentID`, native step timing |

Export validation requires exact native Session fields (`id`, `projectID`, `directory`, `title`, `version`, `time.created`, `time.updated`, optional `parentID`), user message identity/model fields, assistant provider/model/agent/mode/path identity, and assistant `parentID` linkage to exactly one user message in the same export.

## Execution sequence

1. Execute exactly one parent run.
2. Export exactly one same-environment, same-working-directory parent session.
3. For each observed completed parent `task` tool whose `state.input.subagent_type` is `qa-cr`, export exactly one child session.
4. Treat exports as observation retrieval only; they are never retries or replacement runs.

## Reconciliation and no-double-counting

- Parent completeness requires exact reconciliation between parent JSONL and parent export by `sessionID + messageID + part.id`.
- Matching requires equal part count, equal token component presence/value (`input`, `output`, `reasoning`, `cache.read`, `cache.write`, `total`), equal `cost`, and equal `reason` when present.
- Any missing part, duplicate exported `step-finish`, count drift, or value mismatch fails closed.
- Canonical parent totals come only from unique exported `step-finish` parts.
- Raw JSONL totals, assistant message `info.cost` / `info.tokens`, and any session totals are validation checks only and are never summed into canonical totals.

## Timing semantics

- JSONL envelope `timestamp` is OpenCode CLI `Date.now()` emit-time and diagnostic-only.
- Emit-time never satisfies authoritative execution timing and must never be converted into `part.time`.
- Authoritative parent/child message timing comes from complete assistant export `info.time.created` / `info.time.completed`.
- Native step timing is `UNAVAILABLE` when step parts do not carry native timing fields.

## Schema and artifact inventory

- Parallel IDs introduced for v2: `qa-cr-run-telemetry-v2`, `qa-cr-score-input-facts-v2`, `qa-cr-evidence-envelope-v2`, `qa-cr-b2-probe-v2`, `qa-cr-runtime-pin-v1`, `qa-cr-real-attempt-authorization-v1`.
- Fixture inventory for this lane:
  - `tests/orchestrator/maturity/fixtures/opencode-1.18.19/parent-events.jsonl`
  - `tests/orchestrator/maturity/fixtures/opencode-1.18.19/parent-export.json`
  - `tests/orchestrator/maturity/fixtures/opencode-1.18.19/child-export.json`
  - `tests/orchestrator/maturity/fixtures/opencode-1.18.19/README.md`
  - `benchmarks/qa-cr-maturity/probes/b2-parent-export-v2.json`

## Runtime pin

- Eligibility requires a directly invoked executable observed at version `1.18.19` exactly.
- Runtime pin records pre-execution and post-execution executable SHA plus observed version.
- Package metadata is not an eligibility source.

## Identity and authorization

- B2-v1 is permanently spent and the public v1 entrypoint always throws `b2_v1_attempt_consumed`.
- B2-v2 public real entry is an unconditional consumed tombstone and always throws `b2_v2_attempt_consumed`; the historical authorization path/SHA remain pinned only as spent audit history.
- Immutable one-shot authorization binds exact keys only: `schemaVersion`, `authorizationId`, `probeId`, `probeSha256`, `attempt`, `maxAttempts`, `retryPolicy`, `status`, `manifestSha256`, `scopeSha256`, `caseId`, `caseSha256`, `fixtureTreeSha256`, `candidateDiffSha256`, `promptSha256`, `qaSkillTreeSha256`, `qaAgentSha256`, `qaCrAgentSha256`, `providerId`, `modelId`, `expectedRuntimeVersion`, `expectedExecutableSha256`, `artifactRootPathSha256`.
- All bound hashes are lowercase SHA-256 hex. Run identity includes all immutable fields and run ID is keyed only to the canonical authorization hash: `qa-cr-b2-parent-export-v2-a1-${authorizationSha256.slice(0,24)}`.

## Retention and redaction

- A durable external artifact root remains mandatory for any future new-version real attempt.
- Sealed redacted evidence must be retained on both success and failure.
- Synthetic repo state and isolated runtime state must be removed after execution.
- Diagnostics are limited to allowlisted safe issue/status codes plus retained evidence location.

## Fixture rules

- Native OpenCode 1.18.19 casing is preserved where pinned by the fixture (`sessionID`, `messageID`, `parentID`, JSONL `timestamp`).
- Parent and child export top-level `info` objects report `version: 1.18.19`.
- Export message objects are shaped as `{ info, parts }`; they do not carry a redundant top-level `role` field.
- `tool_use` JSONL events use native `part.type: tool`, including parent export tool parts.
- `step-start` parts contain only native identity fields (`type`, `id`, `sessionID`, `messageID`, optional `snapshot`) and never synthetic `title` data.
- Parent JSONL must include one `step_start`, one completed `tool_use` task for `qa-cr`, and at least two distinct `step_finish` parts in the same assistant message.
- Native `step-finish` token objects may omit `total`; compatibility checks may observe it, but canonical accounting cannot require it for v1.18.19 native fixtures.
- `step-start` / `step-finish` parts must not contain `time`, `startedAt`, `finishedAt`, `startTimeMs`, or `endTimeMs`.
- Assistant message linkage uses native `info.parentID == <corresponding user message id>`; child session linkage is valid only through child export top-level `info.parentID == <parent session id>`.
- Paths must be relative or `[redacted]`; absolute paths are forbidden.

## Terminal and replay gates

- Stored run observations retain an exact `terminalContractStatus` marker over the original terminal tuple shape; missing `exitCode: 0` never normalizes into success.
- Replay requires exact telemetry top-level shape `{ schemaVersion, parent, children, aggregate, emitTiming }`.
- Structurally valid but ineligible runtime pins are retained and replayed into blocked facts; malformed or context-mismatched pins fail with controlled replay mismatch.

## Failure semantics and forbidden claims

- Any reconciliation mismatch, missing artifact, partial seal, invalid linkage, runtime version drift, or unauthorized retry fails closed.
- Forbidden claims: native step timing availability, scoring eligibility, retryability, replacement-run equivalence, package-metadata runtime pinning, defect-rate improvement, accuracy improvement, or graduation readiness.

## Validation and one-shot gate

- V2-A validation is deterministic only: parse fixtures, verify no native step timing fields, and prove parent JSONL/export reconciliation semantics.
- The consumed v2 one-shot attempt will not be retried; any future real attempt requires a new version with newly reviewed and frozen runtime-pin and authorization artifacts.
