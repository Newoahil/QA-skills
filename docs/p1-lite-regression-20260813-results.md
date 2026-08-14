# 2026-08-13 P1 Lite Regression Results

## Scope

This regression was run after the first P1 Lite/triage improvement, before the later P1.1 hard-gate fix.

The run targeted the previous weak or underperforming bounded Issue cases:

| Case | Reason selected |
|---|---|
| `dig-pr2-pre` | Old QA Skill lost to baseline; API contract surface was thinner. |
| `dig-pr2-post` | Medium-high complexity guard; old QA Skill only slightly beat baseline. |
| `claude-skill-check-pre` | Old QA Skill lost to baseline; validator test gap was weak. |
| `js-yaml-155-pre` | Old QA Skill lost to baseline; parser variant coverage was thinner. |
| `click-2730-pre` | Old QA Skill tied baseline; needed better default-map surface coverage. |

Valid artifacts:

```text
C:\Users\lhw\AppData\Local\Temp\opencode\bounded-issue-ab\run-20260813-10case\cases\<case>\artifacts\qa-skill-p1
```

## Quality Scores

Rubric: 6 dimensions x 0-2 = 12 max.

| Case | Baseline | Old QA Skill | P1 QA Skill | Old delta vs baseline | P1 delta vs baseline | P1 delta vs old QA |
|---|---:|---:|---:|---:|---:|---:|
| `dig-pr2-pre` | 12 | 11 | 11 | -1 | -1 | 0 |
| `dig-pr2-post` | 11 | 12 | 12 | +1 | +1 | 0 |
| `claude-skill-check-pre` | 11 | 10 | 12 | -1 | +1 | +2 |
| `js-yaml-155-pre` | 12 | 11 | 11 | -1 | -1 | 0 |
| `click-2730-pre` | 11 | 11 | 12 | 0 | +1 | +1 |

Totals over these 5 cases:

| Arm | Score |
|---|---:|
| Baseline | 57 / 60 |
| Old QA Skill | 55 / 60 |
| P1 QA Skill | 58 / 60 |

## Cost

| Arm | Total tokens | Avg tokens / run |
|---|---:|---:|
| Baseline | 1,245,000 | 249,000 |
| Old QA Skill | 531,133 | 106,227 |
| P1 QA Skill | 790,972 | 158,194 |

P1 quality was best on this 5-case slice and still used materially fewer tokens than baseline, but it was about 49% more expensive than old QA Skill.

## What Improved

| Case | Result |
|---|---|
| `claude-skill-check-pre` | Fixed the old weakness: covered single-character names, trailing hyphen rejection, missing pytest, and validator test gap. |
| `click-2730-pre` | Fixed the old surface gap: covered dual-flag directions, non-flag and single-flag controls, and tied cause to `default_map` vs `self.default`. |
| `dig-pr2-post` | Stayed strong on collection `type`, item `trait_type`, legacy input, vendored template, and safe glob checks. |

## Still Weak

| Case | Remaining gap |
|---|---|
| `dig-pr2-pre` | P1 improved API-contract discussion but still did not match baseline's coverage of canonical JSON/hash/docs/tests/generated artifact implications. |
| `js-yaml-155-pre` | P1 added a parser variant but still did not match baseline's positive controls for already-supported null forms and contrasting `!!str` behavior. |

## Marker Compliance

Strict marker compliance was still **0/5**.

| Marker | Result |
|---|---|
| `QA Route: Lite` | Generally present. |
| Standalone `Overall Status` | Generally present. |
| `Risk -> Must Verify -> Verification -> Evidence -> Status` | Present or partial. |
| `Complexity Expansion Gate: triggered/skipped` | Frequently missing. |
| `## Report Quality Self-Check` | Frequently missing. |

## Direct Follow-up Implemented After This Run

The next P1.1 fix was implemented after these results:

1. Promote Lite markers from template guidance to final-output hard gate.
2. Require host relay to reject Lite summaries/reports missing exact markers.
3. Strengthen API contract minimum coverage: old/new shape, producer/consumer, generated artifacts/fixtures/hashes, legacy compatibility, docs/examples/tests, positive/negative compatibility controls.
4. Strengthen parser/serializer minimum coverage: minimal reproducer, adjacent/nested/empty/null variants, positive controls, contrasting type controls, roundtrip or stream control when relevant, and non-crash vs semantic-output distinction.

P1.1 pack validation after implementation:

```text
node --test tests/qa-skill-pack.test.mjs
45 tests, 45 pass, 0 fail
```

## Next Validation Set

The next run should use 5 cases:

| Slot | Case |
|---|---|
| Previous weak API contract | `dig-pr2-pre` |
| Previous weak parser | `js-yaml-155-pre` |
| High complexity 1 | Prisma PR #21678 nested transaction savepoint rollback semantics |
| High complexity 2 | NextAuth PR #13465 stale session fetch after signOut race |
| Medium-high guard | `dig-pr2-post` |
