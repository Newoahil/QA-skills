# 2026-08-13 P3 No-Delegation Hardening Validation Results

## 1. Purpose

`docs/p2-full-route-hardening-20260813-results.md` found that P2's Full-route completion contract could be satisfied by delegating the remaining stages to a different subagent (`oracle`, `fixer`) via a `task` call, with only a well-written prompt as evidence, and no confirmation that the delegated agent actually loaded `qa-plan`/`qa-execute`/`qa-conclude` itself.

P3 closes that specific loophole. Unlike P1/P1.1/P2, this round's skill authoring (not the validation run) was done directly by the orchestrator, not delegated to a `fixer` task, per updated role split: skill iteration/writing is now the orchestrator's responsibility; only the actual validation run execution is delegated to a `gpt-5.5` background specialist.

## 2. Changes Made

1. `qa-skill/using-qa/SKILL.md`:
   - Roles bullet: the same QA subagent must not use a task/subagent/delegation call to hand off `qa-plan`, `qa-execute`, or `qa-conclude` to a different subagent, agent type, or new session, even when that handoff includes the resolved skill source path and an explicit load requirement.
   - Full completion contract: added an explicit "No delegation substitute" clause stating that handing off to another `subagent_type` (e.g. an advisory or implementation agent) is still a bypass, because the receiving agent was not designed to run this QA chain and its output cannot be treated as evidence that it loaded and applied `qa-plan`/`qa-execute`/`qa-conclude` and their references.
   - Non-goals: added two bullets forbidding Full-stage handoff to a different subagent, and forbidding substituting a delegated agent's output for same-session skill-loading evidence.
2. `qa-skill/qa-conclude/SKILL.md`: added a new **Same-Session Execution Check** section before the Conclusion Gate, requiring confirmation that the same session that ran `using-qa`/`qa-triage` is the one that loaded and applied `qa-plan`/`qa-execute`/`qa-conclude` directly; the Conclusion Gate stays `BLOCKED` when that evidence is missing, delegated, or replaced by a different subagent's output.
3. `tests/qa-skill-pack.test.mjs`: added `P3-ROUTING-022`, a semantic anchor test verifying both files carry the above language.

Pack validation:

```text
node --test tests/qa-skill-pack.test.mjs
48 tests
48 pass
0 fail
```

Global skill synced to `C:\Users\lhw\.config\opencode\skills\qa-skill` before the validation run.

## 3. Validation Run

Execution (cloning, running `opencode`, collecting artifacts) was delegated to a `fixer` background specialist; this report covers orchestrator-side acceptance only.

Same two high-complexity cases as P1.1/P2, fresh `q3` workspaces:

| Case | Snapshot |
|---|---|
| `prisma-21678-pre` | `prisma/prisma` @ `85c63e5c50eb0da40d77d868d0ae275c72771bff` |
| `nextauth-13465-pre` | `nextauthjs/next-auth` @ `1116034334c63db84de632d076a8fb0ad8bcec8e` |

New arm: `qa-skill-p3`.

## 4. Skill-Chain Evidence (Acceptance-Verified)

Unlike P2, the delegated specialist reported the full ordered `tool_use` sequence, not just skill loads, so the absence of any `task` call could be checked directly.

| Case | Skill loads (in order) | `task` delegation calls |
|---|---|---|
| `prisma-21678-pre` | `using-qa`, `qa-triage`, `qa-plan`, `qa-execute`, `qa-conclude` | **None** |
| `nextauth-13465-pre` | `using-qa`, `qa-triage`, `qa-plan`, `qa-execute`, `qa-conclude` | **None** |

Both reports also state explicitly, in-text: *"Same-session skill chain applied directly: `using-qa` → `qa-triage` → `qa-plan` → `qa-execute` → `qa-conclude`. No task delegation used."* (NextAuth report.)

**This is a genuine fix for the specific loophole found in P2.** The QA subagent now completes Full itself, in-session, without re-delegating to a mismatched subagent type.

## 5. Quality (Orchestrator Scoring)

Rubric: 6 dimensions x 0-2 = 12 max. Scored directly by the orchestrator from the final reports (not oracle-delegated this round).

| Case | Baseline | P1.1 | P2 | P3 | P3 delta vs baseline |
|---|---:|---:|---:|---:|---:|
| `prisma-21678-pre` | 12 | 9 | 11 | ~11 | -1 |
| `nextauth-13465-pre` | 12 | 7 | 10 | ~10 | -2 |

P3 did not meaningfully change the score versus P2 on either case. The fix solved a process-integrity problem, not a report-depth problem.

### Prisma detail

Strong: precise file/line evidence (`transaction-manager.ts`, `transaction.ts`, adapter files), correctly distinguishes `FAIL` (static absence of implementation) from `BLOCKED` (missing `jest`/dependencies for runtime), clear scoped conclusion.

Still short of baseline: does not expand nested success/failure ordering, LIFO/multi-depth behavior, or timeout/cancellation/logging/tracing to the same depth baseline did.

### NextAuth detail — a new calibration concern

The P3 NextAuth report classified `Overall Status: BLOCKED` because "the current snapshot does not appear to contain the referenced PR fix / diff." This is a **judgment regression**, not just a depth gap: the target snapshot is intentionally the pre-fix state for a bounded snapshot QA (not diff-dependent QA), so the absence of a diff is expected, not a valid blocking reason. Baseline and earlier P1.1/P2 runs correctly treated the same evidence (stale-fetch guard absent in source) as a product-defect `FAIL`. P3's own Finding F3 documents the same residual risk but does not let it drive the final status, which is misapplied caution rather than a better answer.

## 6. Cost

Because the QA subagent now does Full itself instead of delegating, per-run cost rose sharply versus P2 (which had cheaply "outsourced" most of the work):

| Case | Metric | P2 | P3 | Change |
|---|---|---:|---:|---:|
| `prisma-21678-pre` | input tokens | 35,359 | 180,683 | +411% |
| `prisma-21678-pre` | cache read | 138,752 | 1,068,544 | +670% |
| `nextauth-13465-pre` | input tokens | 24,160 | 86,555 | +258% |
| `nextauth-13465-pre` | cache read | 150,016 | 580,096 | +287% |

Genuine same-session Full execution is materially more expensive than the delegated shortcut it replaces, without a corresponding quality gain on these two cases.

## 7. Verdict

| Aspect | Verdict |
|---|---|
| Delegation bypass (P2's loophole) | Fixed. Confirmed via full tool-call sequence: no `task` calls appear between `qa-triage` and `qa-conclude`. |
| Process honesty | Improved. The QA subagent now genuinely executes Full itself rather than producing a plausible-looking delegated summary. |
| Report depth vs baseline | Not improved. Both cases remain below baseline (`-1`, `-2`), essentially unchanged from P2. |
| Cost | Worse. 3-7x more expensive than the P2 delegated version for the same or slightly worse quality. |
| New risk introduced | Yes. NextAuth's status calibration (`BLOCKED` instead of `FAIL`) is a regression in judgment quality, not just depth. |

n=2. This does not establish that Full-route execution is broadly reliable, only that the specific delegation loophole is closed for these two cases.

## 8. Root Cause Reframed

Three rounds (P1.1 -> P2 -> P3) were needed to get the QA subagent to genuinely attempt Full route itself. That process problem is now resolved. But resolving it exposed the real, harder problem plainly for the first time: **even when Full route is executed honestly and in full, in the same session, its analytical depth on high-complexity cases still does not match baseline**, and cost is high enough that this is not yet a favorable trade.

This is no longer a routing/delegation problem. It is a content/analysis-depth problem in `qa-plan`/`qa-execute`'s actual guidance for high-complexity risk categories (state transition ordering, provider/environment matrices, cancellation/timeout behavior), and a calibration problem in how `qa-conclude` distinguishes "no diff available" from "pre-fix snapshot QA where the defect's absence-of-fix is itself the finding."

## 9. Current Claim Boundary

Allowed claim:

> P3 fixed the specific delegation-bypass loophole found in P2: the QA subagent now completes Full route in the same session without re-delegating to a mismatched subagent type. This did not improve report depth or cost on the two tested high-complexity cases, and surfaced a new status-calibration regression on one of them.

Disallowed claim:

> The QA Skill now handles high-complexity bounded Issue QA competitively with baseline.

## 10. Next Iteration Candidates

1. Do not attempt further process/routing fixes on these two cases; the process is now honest and the remaining gap is analytical depth and calibration, not compliance.
2. Fix `qa-conclude`'s snapshot-vs-diff framing: a bounded Issue QA target that is intentionally a pre-fix snapshot must not be classified `BLOCKED` merely for lacking a local diff; the applicable question is whether the claimed fix's behavior is present or absent in the snapshot.
3. Strengthen `qa-plan`/`qa-execute` guidance for the specific high-complexity categories already named as mandatory Full triggers (transaction/rollback, ordering, provider/environment matrices, cancellation/timeout) so Full route reliably expands them, not just detects that the trigger applies.
4. Re-evaluate cost tradeoff before any further expansion: at 3-7x the token cost of the shortcut it replaced, Full route needs a corresponding quality gain to be worth recommending; none was observed yet on n=2.
