# 2026-08-13 P1.1 Five-Case Validation and High-Complexity Root Cause Report

## 1. Purpose

This run validated the P1.1 changes after the P1 Lite regression:

1. Lite final-output hard gate.
2. `using-qa` relay rejection for marker-missing Lite reports.
3. Stronger API contract checklist.
4. Stronger parser / serializer checklist.

The validation set intentionally mixed:

| Slot | Case |
|---|---|
| Previous weak API contract | `dig-pr2-pre` |
| Previous weak parser | `js-yaml-155-pre` |
| Medium-high guard | `dig-pr2-post` |
| High complexity 1 | `prisma-21678-pre` |
| High complexity 2 | `nextauth-13465-pre` |

The goal was to verify whether P1.1 fixed the known weak cases and whether the current skill routing could handle genuinely higher-complexity bounded Issue QA.

## 2. Case Selection

| Case | Complexity | Reference | Why selected |
|---|---|---|---|
| `dig-pr2-pre` | Medium-high | <https://github.com/DIG-Network/create-dig-app/pull/2> | Previously lost to baseline due thinner API contract surface coverage. |
| `js-yaml-155-pre` | Medium | <https://github.com/nodeca/js-yaml/pull/155> | Previously lost to baseline due thinner parser variant / positive-control coverage. |
| `dig-pr2-post` | Medium-high | <https://github.com/DIG-Network/create-dig-app/pull/2> | Guard against regression on a previously strong API contract report. |
| `prisma-21678-pre` | High | <https://github.com/prisma/prisma/pull/21678> | Nested interactive transaction rollback/savepoint semantics; transaction state, provider matrix, rollback/error propagation. |
| `nextauth-13465-pre` | High | <https://github.com/nextauthjs/next-auth/pull/13465> | Auth/session race where stale session fetches can resurrect session/cookie state after signOut. |

High-complexity snapshots:

| Case | Repo | Snapshot |
|---|---|---|
| `prisma-21678-pre` | `prisma/prisma` | `85c63e5c50eb0da40d77d868d0ae275c72771bff` |
| `nextauth-13465-pre` | `nextauthjs/next-auth` | `1116034334c63db84de632d076a8fb0ad8bcec8e` |

## 3. Execution

Artifacts are stored under:

```text
C:\Users\lhw\AppData\Local\Temp\opencode\bounded-issue-ab\run-20260813-10case
```

Runner:

```text
C:\Users\lhw\AppData\Local\Temp\opencode\bounded-issue-ab\run-20260813-10case\run-p11-5case.mjs
```

Workspace note: Prisma exceeded Windows path length under the original deep benchmark path, so the high-complexity workspaces were cloned under the shorter path:

```text
C:\Users\lhw\AppData\Local\Temp\opencode\p1h
```

Global skill handling:

- Before clean baseline for the two new high-complexity cases, global `qa-skill` was temporarily moved out of the opencode skills path.
- After baseline completion, global `qa-skill` was restored.
- P1.1 QA Skill arms ran after syncing the current repository skill into the global skills path.

Pack validation before the run:

```text
node --test tests/qa-skill-pack.test.mjs
45 tests
45 pass
0 fail
```

All model runs completed successfully:

| Arm group | Runs | Result |
|---|---:|---|
| New high-complexity clean baseline | 2 | 2/2 `status=0`, final report present |
| P1.1 QA Skill | 5 | 5/5 `status=0`, final report present |

## 4. Quality Scores

Rubric: 6 dimensions x 0-2 = 12 max.

| Case | Baseline | P1 | P1.1 | P1.1 delta vs baseline | P1.1 delta vs P1 |
|---|---:|---:|---:|---:|---:|
| `dig-pr2-pre` | 12 | 11 | 12 | 0 | +1 |
| `js-yaml-155-pre` | 12 | 11 | 11 | -1 | 0 |
| `dig-pr2-post` | 11 | 12 | 12 | +1 | 0 |
| `prisma-21678-pre` | 12 | n/a | 9 | -3 | n/a |
| `nextauth-13465-pre` | 12 | n/a | 7 | -5 | n/a |

Totals for this five-case set:

| Arm | Score |
|---|---:|
| Baseline | 59 / 60 |
| P1.1 QA Skill | 51 / 60 |

Old three-case subset:

| Arm | Score |
|---|---:|
| P1 | 34 / 36 |
| P1.1 | 35 / 36 |

## 5. What Improved

| Case | Result |
|---|---|
| `dig-pr2-pre` | Fixed the API-contract gap. P1.1 covered collection `type`, item `trait_type`, legacy input, vendored template drift, validator/test masking, and downstream CHIP-0007/digstore consumers. |
| `dig-pr2-post` | No regression. P1.1 remained strong on collection contract, item behavior, legacy inputs, vendored tool parity, and safe glob tests. |
| Marker compliance | Improved from P1's strict 0/5 to P1.1 strict 3/5. |

## 6. What Remained Weak

| Case | Remaining gap |
|---|---|
| `js-yaml-155-pre` | P1.1 improved parser-variant intent but still lacked baseline-level positive controls. The command crashed before all controls ran, so evidence quality remained weaker. |
| `prisma-21678-pre` | P1.1 identified that savepoint support was absent, but report depth was too compressed for transaction semantics. It missed nested success/failure, SQL ordering, LIFO/multi-depth, provider matrix, timeout/cancellation, and logging/tracing coverage. |
| `nextauth-13465-pre` | P1.1 caught the core stale-session risk but was too terse for auth/session race QA. It lacked mount/focus/poll/cross-tab/signOut race variants, redirect:false behavior, JWT rolling-cookie consequences, concrete file path surfaces, and actionable MV matrix depth. |

## 7. Token Cost

| Arm | Total tokens | Avg tokens / run |
|---|---:|---:|
| Baseline | 1,517,137 | 303,427 |
| P1.1 QA Skill | 1,305,531 | 261,106 |
| P1, old three only | 634,333 | 211,444 |

Interpretation:

- P1.1 is cheaper than baseline on total token use for this five-case set.
- P1.1 is more expensive than P1 for the old three-case subset.
- The extra cost bought better markers and fixed `dig-pr2-pre`, but it did not buy enough depth on high-complexity cases.

## 8. Marker / Contract Assessment

Strict Lite marker pass count: **3/5**.

| Case | QA Route | Complexity Expansion Gate | Standalone Overall Status | Report Quality Self-Check | Risk -> Must Verify chain | Strict pass |
|---|---|---|---|---|---|---|
| `dig-pr2-pre` | Present | Present | Present | Present | Present | Yes |
| `js-yaml-155-pre` | Present | Present | Present | Present | Present | Yes |
| `dig-pr2-post` | Present | Present | Present | Present | Present | Yes |
| `prisma-21678-pre` | Missing | Missing | Present | Missing | Missing / implicit | No |
| `nextauth-13465-pre` | Present | Missing | Present | Missing | Missing | No |

Marker interpretation:

- P1.1 hard gate now works for the old bounded Lite-style cases.
- It does not solve high-complexity route execution because those cases should not be handled as compact Lite reports.

## 9. Root Cause

The main root cause is **not** that the model cannot reason about high-complexity issues. The root cause is that high-complexity cases did not reliably enter or complete the Full QA chain.

Observed skill loading:

| Case | Loaded skills | Interpretation |
|---|---|---|
| `prisma-21678-pre` | `using-qa` | Stayed at entry-level behavior; did not load `qa-triage`, `qa-plan`, `qa-execute`, or `qa-conclude`. |
| `nextauth-13465-pre` | `using-qa`, `qa-triage` | Reached triage but did not continue through Full planning/execution/conclusion. |

Both high-complexity cases should have triggered Full:

| Case | Mandatory Full signals |
|---|---|
| `prisma-21678-pre` | Transaction state consistency, nested rollback/savepoint semantics, provider matrix, ordering, cancellation/error propagation. |
| `nextauth-13465-pre` | Auth/session race, stale fetch ordering, cross-tab/focus/polling, JWT rolling-cookie side effects, state consistency. |

Root cause summary:

> P1.1 successfully improved Lite output compliance and medium-complexity coverage, but high-complexity bounded Issue QA was not forced into Full route execution. The result was a compressed summary rather than a Full-level risk / variant / evidence matrix.

## 10. Implication for Next Iteration

The next iteration should not further expand Lite. It should harden high-complexity routing and Full execution.

Required changes:

1. `qa-triage`: make the following mandatory Full triggers:
   - transaction / rollback / savepoint semantics;
   - auth / session / permission race;
   - concurrency / ordering / idempotency;
   - cross-module state consistency;
   - provider or environment matrix;
   - retry / cancellation / timeout behavior;
   - cache / DB / event side effects.
2. `using-qa`: if triage records `Profile Decision: FULL`, the same QA subagent must load and execute:

   ```text
   qa-plan -> qa-execute -> qa-conclude
   ```

   A final report that stops after `using-qa` or `qa-triage` does not satisfy the contract.
3. `qa-report.md` / Full route: add a high-complexity expansion gate requiring the applicable matrices:
   - state transition matrix;
   - race / ordering matrix;
   - provider / environment matrix;
   - failure / rollback / cancellation matrix;
   - downstream consumer impact matrix.

## 11. Current Claim Boundary

Allowed claim:

> P1.1 improves Lite compliance and fixes at least one prior medium-high API-contract weakness, but it does not yet handle high-complexity bounded Issue QA competitively.

Disallowed claim:

> QA Skill is now better than baseline on high-complexity real Issue QA.
