---
type: bug
record_id: bug-26ad869551cf43f585bbfc062876eccc
date: 2026-08-19
title: Structured-output schemas did not match dossier and plan validators
severity: high
status: resolved
key_conclusion: Tightened specialist and plan json_schema definitions to match the existing evidence/plan validators, so SDK output is valid by construction (evidence provenance fields + allowed kinds; risk restricted to LOW/HIGH).
topics: [qa-guardian, json-schema, validation]
related: [bug-b963cb3902ec472fba0747de51688475, change-1a149adf92854c34938da07409ba28a9]
---

## Bug Description

The #211 SDK E2E produced a large dossier and plan, but both were marked invalid. The dossier had
49 evidence items, yet validation reported invalid evidence kinds and missing source/observation/
supports/contradicts. The plan used a narrative risk string instead of `LOW` or `HIGH`.

## Root Cause

The json_schema passed to OpenCode was too loose:

- hypotheses/evidence items were generic objects with no required fields;
- evidence `kind` allowed arbitrary strings instead of the validator's known vocabulary;
- plan `risk` allowed any string instead of the required `LOW|HIGH` enum.

The model therefore returned structurally plausible but validator-incompatible data.

## Solution

- Specialist schema now requires hypothesis `id/statement`.
- Evidence schema requires `id/kind/source/observation/supports/contradicts`, with `kind` enum
  derived from `EVIDENCE_STRENGTH`.
- Plan schema restricts `risk` to `LOW` or `HIGH`.

## Prevention Measures

- Tests assert the evidence required-field list and plan risk enum.
- Keep SDK output schemas aligned with the validators; schema changes and validator changes must
  ship together.

## Related Changes

- `tools/guardian/investigation-process.mjs`
- `tests/guardian/investigation-process.test.mjs`
- Full suite: 295/295 green.
