# 2026-08-13 P2 Full-Route Hardening Validation Results

## 1. Purpose

`docs/p11-high-complexity-validation-20260813-results.md` found that high-complexity bounded Issue cases stayed at `using-qa` or `qa-triage` and never completed `qa-plan -> qa-execute -> qa-conclude`, so they were delivered as compressed summaries instead of Full QA reports.

P2 fixed the routing/completion contract, not report content:

1. `qa-triage/SKILL.md` and `references/qa-lite-triage.md`: added mandatory Full triggers for transaction/rollback/savepoint semantics, auth/session/permission race, concurrency/ordering/idempotency, cross-module state consistency, provider/environment matrix, retry/cancellation/timeout, and cache/DB/event side effects.
2. `using-qa/SKILL.md`: added a Full completion contract. When `Profile Decision: FULL` is recorded, the same QA subagent session must load and execute `qa-plan`, `qa-execute`, and `qa-conclude`; stopping early does not satisfy the contract.
3. `tests/qa-skill-pack.test.mjs`: added semantic anchors for the new triggers and the Full completion requirement.

Pack validation after implementation:

```text
node --test tests/qa-skill-pack.test.mjs
47 tests
47 pass
0 fail
```

Execution for this round (implementation, global skill sync, and both validation runs) was delegated to a `fixer` background specialist. This report covers acceptance/verification only.

## 2. Case Selection

Reused the two high-complexity cases from the P1.1 report, since those are the two known failures this fix targets:

| Case | Repo | Snapshot | Complexity |
|---|---|---|---|
| `prisma-21678-pre` | `prisma/prisma` | `85c63e5c50eb0da40d77d868d0ae275c72771bff` | Nested transaction rollback/savepoint semantics |
| `nextauth-13465-pre` | `nextauthjs/next-auth` | `1116034334c63db84de632d076a8fb0ad8bcec8e` | Auth/session stale-fetch race after `signOut` |

New arm: `qa-skill-p2`. Fresh clean workspaces (`.../p1h/p21678/q2`, `.../p1h/n13465/q2`) were used to avoid any leftover state from prior runs; the earlier `qa-skill-p11` and `baseline` artifacts were left untouched for comparison.

## 3. Quality Scores

Rubric: 6 dimensions x 0-2 = 12 max.

| Case | Baseline | P1.1 | P2 | P2 delta vs baseline | P2 delta vs P1.1 |
|---|---:|---:|---:|---:|---:|
| `prisma-21678-pre` | 12 | 9 | 11 | -1 | +2 |
| `nextauth-13465-pre` | 12 | 7 | 10 | -2 | +3 |

P2 recovered most of the gap on both cases. Prisma is close to baseline; NextAuth improved substantially but is still below baseline.

## 4. What Improved

Both P2 reports now show completed Full-route structure that P1.1 was missing:

| Marker | prisma-21678-pre | nextauth-13465-pre |
|---|---|---|
| `QA Route: Full` / `Profile Decision: FULL` | Present | Present |
| `QA Plan Gate: OPEN` | Present | Present |
| `Must Verify` / Findings with evidence | Present (`Must Verify Items` table, `Findings` table) | Present (`F1`/`F2`/`F3` findings) |
| `QA Conclusion Gate: COMPLETE` | Present | Present |
| Standalone `Overall Status:` line | Present (`FAIL`) | Present (`FAIL`) |
| `Report Quality Self-Check` | Present | Present |

Both correctly identified the actual product gap in the pre-fix snapshot (no savepoint implementation for Prisma; no stale-fetch guard for NextAuth) and correctly avoided a false `PASS`.

## 5. What Still Falls Short of Baseline

| Case | Remaining gap |
|---|---|
| `prisma-21678-pre` | Baseline had a more explicit breakdown of nested success/failure ordering, LIFO/multi-depth behavior, timeout/cancellation, and logging/tracing. P2 references these more generally without expanding them into the same depth. |
| `nextauth-13465-pre` | Baseline had sharper, itemized Must Verify entries for mount/focus/poll/cross-tab/signOut `redirect:false`/signIn regression with concrete file/line references. P2 covers the same surfaces narratively but lacks an explicit Must Verify matrix with that granularity. |

## 6. Root Cause Found During Acceptance: Delegation, Not Missing Skill Loads

Marker-level acceptance looked complete, so a deeper check was run on `opencode-events.jsonl` to see how the Full route was actually produced.

Finding: for both cases, the top-level QA session only ever called the `skill` tool twice (`using-qa`, then `qa-triage`). It never called `skill` for `qa-plan`, `qa-execute`, or `qa-conclude` itself. Instead, immediately after triage, it made a single `task` tool call delegating the rest of the run to a subagent:

| Case | Delegated to | 
|---|---|
| `prisma-21678-pre` | `subagent_type: oracle` |
| `nextauth-13465-pre` | `subagent_type: fixer`, which in turn delegated again to `subagent_type: oracle` |

The delegation prompts did include the resolved skill source path and an explicit instruction to load `using-qa -> qa-triage -> qa-plan -> qa-execute -> qa-conclude`, plus the exact required markers (`QA Plan Gate`, `QA Conclusion Gate`, standalone `Overall Status`, `Report Quality Self-Check`). This technically satisfies the letter of the `using-qa` Full completion contract added in P2 ("hand off the resolved skill source path and an explicit load requirement" is treated as compliant delegation).

However, the delegated subagent's own tool calls are not visible in this session's `opencode-events.jsonl` (different/nested session, not captured by the parent stream), so it cannot be confirmed from this evidence whether the delegated subagent actually read `qa-plan`/`qa-execute`/`qa-conclude` and their references, or whether it produced Full-style structure by pattern-matching the parent's very detailed, marker-explicit prompt instead. The missing depth noted in Section 5 (matrices, ordering/LIFO detail, itemized Must Verify granularity) is consistent with the second possibility: the delegated subagent likely approximated Full structure from the prompt rather than fully applying the Full route's detailed skill content (11-category matrix guidance, evidence guide depth, etc.).

This is a real, still-open gap, not merely a scoring nuance: the current contract can be satisfied by a well-written delegation prompt without verifiable evidence that the child actually loaded the Full skill files.

## 7. Verdict

**Partial genuine fix.**

| Aspect | Verdict |
|---|---|
| Routing decision (Full vs Lite) | Fixed. Both cases now correctly trigger and record `Profile Decision: FULL`. |
| Report completion (no longer stopping at `using-qa`/`qa-triage`) | Fixed. Both cases now deliver complete Full-route reports with all required gates and markers. |
| Report depth vs baseline | Materially improved, not yet at baseline level for either case. |
| Verifiable skill-loading compliance for `qa-plan`/`qa-execute`/`qa-conclude` | Not verified. Evidence only shows a compliant-looking delegation, not confirmed loading by the executing subagent. |

n=2. Treat this as a promising fix for the routing/completion failure, with an unresolved instrumentation and process-compliance gap around delegated execution.

## 8. Next Iteration Candidates

1. Add a cheap, mechanical check: require the final report (or a `Skill Chain Evidence` section) to name which skill files were loaded by whichever session executed Full, not just record markers. Missing chain evidence should block conclusion, mirroring how missing markers already block Lite delivery.
2. Decide whether host-level delegation to a differently-named subagent (`oracle`, `fixer`) mid-QA-run is acceptable at all for the QA chain, or whether `using-qa`'s contract should require the *same* QA subagent to continue Full itself rather than re-delegating to another subagent type.
3. If delegation remains allowed, tighten the Full route's own internal completeness requirements (matrix depth, itemized Must Verify granularity) so that even a delegated subagent following the prompt-only instructions is pushed toward baseline-level depth.
4. Do not expand to a larger case set until item 1 or 2 is resolved, since without chain evidence the "Full route now works" claim cannot be mechanically verified, only inferred from report content.

## 9. Current Claim Boundary

Allowed claim:

> P2 fixed the two known high-complexity routing failures at the report-completion level (Full route no longer stops early), and closed most of the quality gap versus baseline, but the underlying skill-loading compliance for delegated Full execution is not yet mechanically verified.

Disallowed claim:

> The high-complexity routing gap is fully solved and verified compliant.
