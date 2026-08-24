---
type: bug
record_id: bug-897d6e684d654aafba07f30dc5079f44
date: 2026-08-24
title: Gate 1 approve loop caused by model output schema drift
source: Runtime investigation of LambdaTheory/tuantuanrent issue #263
severity: high
status: resolved
key_conclusion: Fixed Guardian generation boundaries so specialist evidence and plan risk conform to strict validators before artifact publication, preventing an accepted Gate 1 plan from being consumed and then silently reset to GATE_1_WAIT.
topics: [qa-guardian, gate1, schema-validation]
---

## Bug Description

For issue #263 the scheduler correctly consumed `/guardian approve` and logged `RESUME -> FIXING`,
but immediately logged `run.blocked_plan_gate reason=plan-not-autonomous-ready`, reset the state to
`GATE_1_WAIT`, cleared the approval identity, and posted the same plan again. Repeating approval
could never advance the run.

## Root Cause

The model-facing JSON schemas were advisory rather than a reliable generation boundary. Specialist
sessions returned evidence kinds such as `source`, `grep`, `issue-data`, `test-inventory`,
`tool-observation`, or omitted `kind` entirely; parallel specialists also reused local IDs such as
`E1`. The dossier synthesizer concatenated these raw results unchanged. The plan builder likewise
returned `risk` as a prose object such as `{ level: "中", items: [...] }`, even though the plan
validator requires the exact string `LOW` or `HIGH`; `risk_assessment`, consumed by `gradeRisk`, was
not required by the generation schema. Invalid dossier/plan artifacts were still written and shown
to a human as approvable Gate 1 plans. On approval, the strict plan gate revalidated them, correctly
rejected them, and returned to Gate 1, creating the loop.

## Solution

- Added a generation-side evidence normalization boundary before dossier synthesis. Canonical kinds
  remain unchanged; known model aliases are conservatively mapped; missing kinds are inferred only
  from explicit provenance/tool/command metadata; ungrounded evidence fails closed. Test inventory
  is treated as `static_search`, not as an executed regression test, and generic tool observations
  are not automatically upgraded to runtime reproduction.
- Namespaced cross-specialist duplicate evidence IDs deterministically instead of requiring parallel
  agents to coordinate a global counter.
- Tightened the specialist prompt to require the six evidence fields and the canonical 8-kind
  vocabulary.
- Required structured `risk_assessment` in the plan schema and prompt. All plan-builder return paths
  now normalize exact/case-insensitive LOW/HIGH values and fail safe to HIGH for missing, translated,
  ambiguous, or object risk values while preserving original detail in `risk_prose`.
- Added pre-artifact strict validation: structurally invalid dossier/plan output now fails before it
  can be persisted or posted as an approvable Gate 1 plan. Existing validators were not loosened.
- Backed up and reset #263 after the fix so a fresh investigation uses the corrected generator.

## Prevention Measures

- Keep `validateEvidenceItem`, `validateDossier`, and `validatePlan` strict and unchanged.
- Treat provider-side JSON schema as helpful but insufficient; normalize and validate at the local
  model-output boundary.
- Never map evidence to a stronger category than its explicit provenance proves.
- Do not publish Gate 1 plans that cannot pass the same structural validation used after approval.
- Regression coverage now includes #263 evidence aliases/missing kinds, duplicate specialist IDs,
  object/ambiguous plan risk on SDK and child-process paths, required risk assessment, and pre-write
  artifact rejection.

## Related Changes

- `7e7fa6d Normalize Guardian specialist evidence before synthesis`
- `f13db87 Enforce Guardian plan generation schema before artifacts`
- Full Guardian suite: 662/662 passed.
- Runtime backup: `D:\tuantuanrent.qa-guardian-control\.qa\guardian\263.schema-fix-reset-20260824-181101.bak`
