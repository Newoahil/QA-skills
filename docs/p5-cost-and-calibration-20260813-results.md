# 2026-08-13 P5 Cost Reduction + Calibration Stress Test Results

## 1. Purpose

Two independent tracks, both directly requested after the user rejected "tying baseline" as an acceptable goal:

- **Track B (cost)**: P4's exploration-first redesign closed most of the quality gap on two high-complexity cases but cost 1.3x-4x baseline tokens and did not improve versus P3. Track B tests whether a "Round-Trip Budget" fix (reduce tool-call turn count, since cache-read cost is cumulative per turn) can cut cost toward a `<2x` target without losing the quality gained in P4.
- **Track A (calibration)**: the only clearly validated "beats baseline" result so far was a single case (`fake-timers-541-pre`, `+3` vs baseline) where baseline overclaimed `PASS` from insufficient evidence and the skill correctly refused to. Track A tests whether that specific advantage — catching baseline overclaiming — reproduces on new real-world "overclaim trap" candidates, using a new, separate Calibration scoring lens rather than the general 6-dimension breadth rubric.

Per the current role split, all skill authoring in this round was done directly by the orchestrator; only validation-run execution was delegated to a `fixer` background specialist.

## 2. Track B: Cost Reduction

### 2.1 Root Cause (Confirmed by Direct Step-by-Step Analysis)

Reading the raw `opencode-events.jsonl` for the P4 Prisma run confirmed a specific mechanism: `cache.read` tokens are not a one-time cost, they are **paid again at every subsequent turn**, because each turn re-reads the entire accumulated session context. Summing the per-step `cache.read` values across all 24 `step_finish` events in that run reproduces the previously-reported total exactly (1,369,600), confirming that **total cost grows roughly quadratically with the number of tool-call turns**, not linearly. This means cutting turn count has an outsized effect on cost.

### 2.2 Fix

Added a **Round-Trip Budget** rule to `qa-skill/qa-execute/SKILL.md` (and cross-referenced from `qa-skill/qa-plan/SKILL.md` for the planning/investigation phase): batch related shell commands, greps, and reads into as few tool calls as possible instead of issuing many near-duplicate ones (for example, one combined `git log`/`git status`/`git diff --stat` probe instead of several separate calls, and one well-chosen `git diff --unified=N` width instead of retrying at several widths). Also loosened the report-update cadence in `qa-execute` from "after every result" to "after each logical checkpoint," since forcing a report rewrite after every atomic action was itself a source of extra turns.

Pack tests: `49/49` passing after this change (no new tests added for this track; existing semantic anchors still hold).

### 2.3 Validation (fresh `q5` workspaces, same two high-complexity cases)

| Case | Metric | Baseline | P4 | P5 | P5 vs baseline |
|---|---|---:|---:|---:|---:|
| `prisma-21678-pre` | input tokens | 49,450 | 117,640 | 65,850 | 1.33x |
| `prisma-21678-pre` | cache read | 347,136 | 1,369,600 | 590,336 | 1.70x |
| `prisma-21678-pre` | tool-call steps | n/a | 40 | 26 | n/a |
| `nextauth-13465-pre` | input tokens | 39,237 | 52,336 | 65,447 | 1.67x |
| `nextauth-13465-pre` | cache read | 218,112 | 603,136 | 488,448 | 2.24x |
| `nextauth-13465-pre` | tool-call steps | n/a | ~26-29 | 26 | n/a |

Prisma's cost ratio improved substantially: cache read dropped from 3.95x to 1.70x baseline, close to the `<2x` target. NextAuth's cache-read ratio improved (2.77x -> 2.24x) but its input-token ratio slightly worsened (1.33x -> 1.67x); net effect is roughly flat to mildly improved.

### 2.4 Quality Held, But With a Real Trade-off

Orchestrator scoring (6-dim rubric, 0-12):

| Case | Baseline | P4 | P5 |
|---|---:|---:|---:|
| `prisma-21678-pre` | 12 | 11 | 11 |
| `nextauth-13465-pre` | 12 | 11 | 11 |

Quality did not regress numerically. But P5's Prisma report **lost a specific piece of depth that made P4 notable**: P4 discovered, via git-history archaeology (comparing version tags, then searching further history), a real later commit (`fix: remove savepoint operations from the D1 adapter (#29499)`) proving the PR's own D1 adapter change was later judged unsafe. P5's report does not contain this finding (`Discovered during execution` is not present in P5's Prisma report at all) — the batching guidance likely discouraged the extra exploratory git commands that led to it in P4.

**Honest read:** turn-count reduction bought a real cost win but was not free; at least once, it cost the single best piece of evidence P4 had produced. This is a genuine tension between the Round-Trip Budget (fewer turns) and Risk Surface Exploration (wider investigation) that P5 did not fully resolve — it optimized turns without a way to protect specifically valuable deep-dive commands.

## 3. Track A: Calibration Stress Test

### 3.1 Case Selection

Reused `fake-timers-541-pre` as the known positive anchor (not re-run this round). Sourced two new real candidates via librarian research, both selected for a "shallow read looks correct, but resolving it fully requires more than static reading" property:

| Case | Repo | Reference | Why selected |
|---|---|---|---|
| `axios-7276-pre` | `axios/axios` | PR #7276 | `settle()` maps only 4xx/5xx status families to an error code; the fix's correctness for custom-rejected statuses outside that range involves a judgment call about semantics, not just a mechanical bug. |
| `date-fns-2329-pre` | `date-fns/date-fns` | PR #2329 (issue #2307) | `formatDistanceStrict` DST behavior depends on timezone/runtime behavior across both spring-forward and fall-back transitions, not provable by static reading alone. |

Both baseline and skill arms were run against the pre-fix snapshot for each, with global `qa-skill` temporarily disabled for the baseline runs and restored afterward.

### 3.2 Result: This Did Not Reproduce the Hoped-For Effect

Both cases correctly reached `FAIL` on both arms — no `PASS` overclaim happened anywhere in this stress test. That alone means this specific test did not reproduce the `fake-timers-541-pre` pattern (baseline confidently overclaiming a status that evidence did not support). But reading the actual reports revealed something more important and more concerning: **on both cases, baseline's evidence was more rigorous than the skill's, not less.**

#### `axios-7276-pre`

- **Baseline**: wrote and ran an actual inline Node script importing `settle.js`/`AxiosError.js` directly and exercising 8 real status codes (`200, 301, 399, 400, 499, 500, 599, 600`), producing a real captured output table showing exactly which codes come back `undefined`. This is genuine executable evidence, produced specifically because the project's own test runner (`vitest`) was unavailable.
- **Skill (Lite route)**: correctly identified the same array-indexing bug via static inspection, but when it tried to verify, it only attempted the project's existing test command (`npm run test:vitest:browser`), which failed because `vitest` was missing — and stopped there. It did not improvise an equivalent minimal executable probe the way baseline did.
- **Score**: baseline `12/12`, skill `11/12` (executable-steps dimension). Skill did not overclaim, but it was **less resourceful**, not more calibrated.

#### `date-fns-2329-pre`

- **Baseline**: ran real Node probes under `TZ=America/New_York` for **both** DST transition directions: spring-forward (produces `120 min`/`2h` instead of the correct `60 min`/`1h`) and fall-back (collapses a real 60-minute elapsed gap to `0 minutes`/`0 hours` — arguably the more severe of the two bugs).
- **Skill (Full route)**: also ran a real Node probe under the same timezone, but **only tested the spring-forward case**. It did not test or even flag the fall-back direction as an explicit unverified item; the report reads as if DST behavior were fully characterized when a more severe failure mode was silently untested.
- **Score**: baseline `12/12`, skill `10/12` (executable-steps and actionability dimensions, for the undisclosed coverage gap).

### 3.3 What This Actually Found

This was not the calibration win we were testing for. It surfaces a different, more concrete problem: **when the project's own test tooling is unavailable, baseline consistently improvises a minimal, safe, direct executable probe to get real evidence, while the skill-guided route more often stops at "existing test command failed, mark BLOCKED."** This pattern likely also explains part of why `prisma-21678-pre` and `nextauth-13465-pre` results have repeatedly shown `BLOCKED` for unit/integration checks across every skill version tested (P1.1 through P5) — the skill has never once tried writing its own equivalent of baseline's inline Node probe in any of these rounds.

Secondary finding: the test design itself has the same flaw noted for an earlier Track A attempt — running against a **pre-fix** snapshot reduces the task to "is the described bug present," a factual/executable question either arm can resolve with enough resourcefulness. It does not stress the "should this be flagged as a judgment call, not resolved unilaterally" property the candidates were chosen for. To actually test that property, the target should be a **post-fix** snapshot where the implemented solution's completeness/correctness is itself the debatable point (for example, axios's choice to broaden `ERR_BAD_RESPONSE` to all non-4xx/5xx statuses).

### 3.4 Track A Score Summary

| Case | Baseline | Skill | Result |
|---|---:|---:|---|
| `axios-7276-pre` | 12 | 11 | Skill loses (resourcefulness gap) |
| `date-fns-2329-pre` | 12 | 10 | Skill loses (coverage gap, undisclosed) |

`fake-timers-541-pre` (not re-run, prior result retained as reference): skill `+3` vs baseline — remains the only case in the entire benchmark history where skill decisively beat baseline via calibration discipline. It is currently an **n=1** result, not yet a demonstrated pattern.

## 4. Updated Claim Boundary

Allowed claim:

> The Round-Trip Budget fix cut Prisma's cost ratio from ~4x to ~1.7x baseline while holding quality at the same numeric score, at the cost of losing one specific deep-dive finding P4 had produced. The calibration stress test did not reproduce the `fake-timers-541-pre` advantage on two new real cases; instead it surfaced a concrete, more actionable gap: the skill-guided route gives up with `BLOCKED` when official test tooling is unavailable, while baseline reliably improvises a minimal executable probe to keep gathering real evidence.

Disallowed claim:

> The skill has a demonstrated calibration advantage over baseline in general. Cost is now under 2x across the board. `fake-timers-541-pre`'s result generalizes.

## 5. Next Iteration Candidates, Ranked

1. **Highest leverage, directly evidenced**: add explicit guidance (likely in `qa-execute` and the risk checklist / evidence guide) requiring the QA subagent to attempt a minimal, safe, inline executable probe (e.g., a small Node/Python one-liner directly exercising the changed function) when the project's own test runner is unavailable, before recording `BLOCKED` for that verification. This directly targets a repeated, now twice-confirmed pattern (axios, date-fns) and plausibly a contributor to the `BLOCKED` outcomes seen on Prisma/NextAuth across every prior round.
2. Re-run the calibration stress test against **post-fix** snapshots (not pre-fix) for axios and date-fns, so the actual judgment-call property (is the implemented fix's scope/semantics fully correct, not just "is a described bug present") is what gets tested.
3. Resolve the Round-Trip Budget vs. Risk Surface Exploration tension: find a way to keep valuable deep-dive investigation commands (like the git-history archaeology that found the Prisma D1 issue in P4) even while reducing routine/duplicate command count, rather than treating "fewer turns" as a uniform pressure that can cut productive exploration along with wasteful repetition.
4. Do not re-run the two high-complexity cases again until item 1 (inline probe capability) is implemented; re-running now would likely just reproduce the same `BLOCKED`-for-tooling pattern that already caps quality on both cases regardless of exploration depth.
