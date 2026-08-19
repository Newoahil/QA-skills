---
type: bug
record_id: bug-8a392be541a943bdad199b2dd863ca7c
date: 2026-08-19
title: Plan evidence_ids contained prose instead of known evidence IDs
severity: medium
status: resolved
key_conclusion: Made the plan json_schema derive evidence_ids.items.enum from the dossier's known evidence IDs, preventing the model from returning "ID + prose" strings rejected by the plan validator.
topics: [qa-guardian, json-schema, plan-validation]
related: [bug-26ad869551cf43f585bbfc062876eccc]
---

## Bug Description

The #211 dossier became valid after schema tightening, but the plan stayed invalid because each
`evidence_ids` entry contained an evidence ID plus a full description/source quote. The plan
validator requires exact IDs matching dossier evidence.

## Root Cause

The plan json_schema declared `evidence_ids` as arbitrary strings. The model was free to emit
descriptive strings instead of IDs.

## Solution

`processPlanBuilder` now builds a dynamic plan schema whose `evidence_ids.items.enum` is the exact
set of known evidence IDs from the dossier. The structured-output model can only select legal IDs.

## Prevention Measures

- Test locks the evidence id enum generated from the dossier.
- Continue using json_schema constraints to encode validator invariants at generation time.

## Related Changes

- `tools/guardian/investigation-process.mjs`
- `tests/guardian/investigation-process.test.mjs`
- Full suite: 295/295 green.
