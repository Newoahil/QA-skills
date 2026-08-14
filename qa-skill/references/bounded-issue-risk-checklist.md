# Bounded Issue Risk Checklist

Use this only for QA-Lite bounded issue QA. Lite = compact report, not shallow analysis: apply the relevant type checklist, then report only the top 3-5 risks, <=5 Must Verify, and evidence 1-2 lines each.

## Complexity Expansion Gate

Trigger for these change types: parser/serializer, API contract, runtime edge, CLI/config compatibility, validator boundary, data/state consistency, concurrency/ordering, auth/security/session.

Required output: `Change type`, `Affected surfaces`, `Adjacent variants`, `Compatibility risks`, `Downstream consumers`, and `Must Verify derived from above`. If the affected surface or risk cannot be bounded, escalate Full.

## Type-Specific Checklist

| Change type | Bounded checks |
|---|---|
| API contract | old/new shape, downstream caller, serialization, docs/tests; old shape and new shape; producer and consumer locations; generated artifacts / fixtures / hashes; legacy input compatibility; docs/examples/tests that encode the contract; positive and negative compatibility controls |
| Parser/serializer | empty, null, nested, adjacent tokens, roundtrip, invalid input; failing minimal reproducer; adjacent/nested/empty/null variant; positive controls for already-supported syntax; negative or contrasting type controls; roundtrip or multi-document/stream control when relevant; distinguish non-crash from exact semantic output |
| Runtime edge | zero/no-op, already-done, ordering, async/timer |
| CLI/config | default, override, env, CI/runtime version, help text |
| Validator | min/max, charset, reserved, negative controls, test gap |
| Data/state | create/update/delete, rollback, cache, idempotency |
| Auth/security/session | caller identity, scope, session lifetime, bypass path; usually Full if security-sensitive |
| Concurrency/ordering | ordering, race window, retry, duplicate event, idempotency |

For every selected row, derive a Risk -> Must Verify -> Verification -> Evidence -> Status chain. Missing chain, route marker, status marker, or Report Quality Self-Check blocks Lite conclusion.
