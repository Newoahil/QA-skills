# qa-cr maturity scope v1

- Version: `qa-cr-maturity-scope-v1`
- Status: **Phase A candidate / not graduated**
- Authority: `docs/qa-orchestrator-subagent-maturity-development-plan.md`
- Purpose: Phase A measurement foundation only. This seed is **non-scoring** and is **not graduation evidence**.

## Frozen inputs

- Bounded diff and touched files only.
- Oracle or explicit acceptance commitments supplied by caller/governance artifacts.
- Supplied evidence already present in the repository or attached artifacts.
- Explicit out-of-scope statements from caller or governing manifest.
- Budget/stop condition defined as bounded review scope and caller-supplied stop rules; no invented token, latency, or cost budgets.

## Allowed abilities

- Static repository inspection only: read, grep, glob, codegraph-style reasoning over visible code and docs.
- Justified call-chain tracing when required to validate a bounded claim.
- Contract propagation across directly relevant modules, tests, schemas, configs, and docs when the oracle requires it.

## Prohibitions

- No shell, edit, network, delegation, or write actions.
- No final `Overall Status:` ownership for the parent workflow.
- No runtime verification, live environment checks, or test execution.
- No full-project audit beyond the bounded review slice.
- No auto-fix, auto-test execution, merge/ship/release decision, or policy override.

## Frozen taxonomy

- `CR-C1`: Direct correctness / business logic / control flow
- `CR-C2`: Call-chain / cross-module propagation
- `CR-C3`: API / schema / consumer contract
- `CR-C4`: Auth / permission / security / secret handling
- `CR-C5`: Data consistency / transaction / cache
- `CR-C6`: Concurrency / ordering / idempotency
- `CR-C7`: Timeout / retry / cancellation / error path
- `CR-C8`: Config / provider / environment matrix
- `CR-C9`: Tests / fixtures / generated artifacts / legacy compatibility
- `CR-C10`: Clean / irrelevant-name / no-op / false-positive controls

## Allowed status/gate pairs

- `OK` / `continue`
- `FAIL` / `stop_and_fail`
- `BLOCKED` / `blocked`
- `BLOCKED` / `need_e2e`
- `NEEDS_HUMAN_REVIEW` / `need_human`

## Primary-result retention

- `primaryAttempt = 1`
- `retryPolicy = none`
- Retain every primary result.
- Any diagnostic retry is attachment-only and can never replace the primary result.

## Complexity freeze

- `small`: bounded to one directly relevant file or one tightly-coupled file pair, one dominant claim, no material ambiguity; facts and rationale must say why the slice stays local.
- `medium`: bounded review spans multiple directly relevant files, one meaningful propagation hop, or one material ambiguity/variant; facts and rationale must state the extra surface.
- `large`: bounded review requires multi-module propagation, multiple evidence sources, or environment/contract interactions that materially widen static reasoning; facts and rationale must explain why a smaller tier would understate the review burden.

## Severity and provenance expectations

- Severity is frozen before evaluation and must be one of `critical`, `high`, `medium`, `low`.
- Severity must be traceable to the oracle/control intent, not inferred after the run from the observed result.
- Every case must include authority, summary, and source reference for the oracle.
- Every case must include provenance source type, source reference, license, and commit/tree identity when available; `null` is allowed only when the identity is genuinely unavailable.

## Phase A limitations

- This seed manifest is for measurement plumbing only.
- `seed-oracles/...` and `seed-cases/...` references are symbolic Phase A identifiers only; they are not materialized artifacts and are not graduation provenance by themselves.
- Phase B must materialize and govern those oracle/case artifacts before they can be used for scoring or provenance-bearing evaluation.
- It does **not** establish maturity score, G1-G11 PASS, breadth sufficiency, budget approval, or graduation readiness.
