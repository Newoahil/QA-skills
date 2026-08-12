# QA Sign-Off (One Page)

A concise, one-page QA summary for humans. It is a readable digest of a completed QA run, not a replacement for the authoritative report. It never invents a verdict: every claim here must already be backed by the run's recorded evidence. It is not a release decision.

Use it for a fast sign-off view after a starter-flow run, a QA-Lite run, or as the top summary of a Full/Project QA report.

## Summary

| Field | Record |
|---|---|
| Product target | Explicit target that was QA'd:  |
| Scope | One sentence: what was checked:  |
| Out of scope | What was intentionally not checked:  |
| Overall status | `PASS` / `FAIL` / `BLOCKED` / `NEEDS_HUMAN_REVIEW`:  |

## Tested vs Not Tested

| Area | Tested? | Evidence reference | Note |
|---|---|---|---|
| <risk/verification area> | Yes / No / Blocked | E- / command+output ref | <one line> |

Every `Yes` row must point to real evidence. A `No` or `Blocked` row must say why and, if relevant, the rerun condition.

## Findings

| Finding ID | Severity | Status | Evidence reference | One-line summary |
|---|---|---|---|---|
| F- | high / medium / low | FAIL / NEEDS_HUMAN_REVIEW / BLOCKED | E- | <what is wrong and where> |

If there are no findings, state "No findings" explicitly rather than leaving this blank.

## Residual Risk

| Residual risk | Why it remains | Suggested follow-up |
|---|---|---|
| <what is still uncertain> | <not covered / blocked / needs human> | <optional next step> |

## Recommendation (Not A Decision)

- One or two sentences: what a reasonable next step would be (for example "ready to merge for the scoped change", "hold until cache regression is fixed", "needs product-owner confirmation on the acceptance rule").
- This is a recommendation only. The human owner makes the final release decision. QA does not approve releases and does not auto-fix.

## Integrity

- Overall status here must match the authoritative report exactly. Any mismatch is recorded and the authoritative report wins.
- `PASS` is stated only when every scoped Must Verify item has real passing evidence.
