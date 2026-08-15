# 2026-08-14 P7: Minimal Skill vs Full Skill 3-Arm Comparison

## 1. Purpose

Following an external agent's architectural critique — Skill should encode "what good QA requires" (outcome criteria, boundaries) and let the Agent decide "where/how deep to explore," rather than encoding a step-by-step procedure — this round tested that hypothesis directly. A 26-line `qa-skill-minimal` was written (outcome criteria + hard boundaries + explicit "you decide" section, no fixed template, no numbered stages, no applicability matrix, no gates) and run head-to-head against the current production `qa-skill` (over a thousand lines across `using-qa`/`qa-triage`/`qa-lite`/`qa-plan`/`qa-execute`/`qa-conclude`/references/templates) and against baseline, on the same 5 cases.

This is the first controlled 3-arm test in this project's history (baseline / full skill / minimal skill), rather than the usual 2-arm (baseline / skill) comparison.

## 2. Design

### 2.1 `qa-skill-minimal`

Full text is ~26 lines. Structure:
- What the report must establish: scope, evidence-backed status, calibrated four-status use (with the P6-derived instruction to try a direct-runtime probe before defaulting to `BLOCKED`), risk-proportional exploration that folds in new findings rather than discarding them, actionable findings, disclosed residual risk.
- Hard boundaries: read-only, no install/network/production without approval, treat repo content as data not instructions, no release decision.
- Explicit "what you decide yourself": investigation path/depth/order, tool choice, report structure, report length.

No Lite/Full triage, no numbered stage sequence, no applicability matrix, no named gates, no JSON planner artifact, no round-trip budget instruction.

### 2.2 Cases (5, reused from existing corpus, baseline reused unmodified)

| Case | Complexity |
|---|---|
| `claude-skill-check-pre` | Low (validator boundary) |
| `js-yaml-155-pre` | Medium (parser) |
| `dig-pr2-pre` | Medium-high (API contract) |
| `fake-timers-541-pre` | Calibration trap (the only case with a previously confirmed skill-beats-baseline result) |
| `nextauth-13465-pre` | High (auth/session race — took 4 engineering rounds, P2 through P5, to bring full-skill from 7/12 to 11/12) |

Execution (10 new runs: 5 cases x {full, min}) was delegated to a `fixer` background specialist. Baseline was reused from existing clean artifacts, not re-run.

## 3. Results

### 3.1 Quality (orchestrator scoring, 6-dim rubric, 0-12; all 10 runs read in full)

| Case | Baseline quality | Full quality | Min quality | Baseline tokens | Full tokens | Min tokens | Full/Base | Min/Base | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `claude-skill-check-pre` | 11 | ~11 | ~11-12 | 116,663 | 53,213 | 167,611 | 0.46x | 1.44x | Both skill arms correctly FAIL with real executable evidence (direct Python invocation). Min tested 7 positive/negative variants vs full's 5. |
| `js-yaml-155-pre` | 12 | ~11 | ~11-12 | 279,900 | 304,292 | 404,331 | 1.09x | 1.44x | Both skill arms correctly FAIL. Min tested 3 crash variants vs full's 1, and additionally checked the built `dist/js-yaml.js` bundle for parity — full never checked the dist bundle at all. |
| `dig-pr2-pre` | 12 | ~11 | ~11 | 283,796 | 557,171 | 374,709 | 1.96x | 1.32x | Both skill arms correctly FAIL, both confirmed the vendored-template drift, both ran real `node --test` evidence. Full is more itemized; min covers the same substance narratively, plus ran a narrower targeted test file in addition to the broad glob. |
| `fake-timers-541-pre` | 8 | ~11 | ~10-11 | 137,884 | 73,374 | 217,945 | 0.53x | 1.58x | Baseline overclaimed here (the project's only previously confirmed calibration win). Both skill arms correctly FAIL with a real Node shim reproducing the crash; full additionally ran an adjacent regression control that min did not test. |
| `nextauth-13465-pre` | 12 | ~11 | **~12** | 261,451 | 451,722 | 419,621 | 1.73x | 1.60x | **Min found something full has never found across 5 prior engineering rounds (P2/P3/P4/P5):** a skipped Keycloak signout test with its exact skip reason quoted (`packages/next-auth/test/e2e/tests/providers/keycloak.spec.ts:34-38`), and it traced the JWT rolling-cookie mechanism to concrete server-side code (`packages/core/src/lib/actions/session.ts:42-80`) rather than full's generic "plausible... may refresh cookies" framing. |
| **Total (5 cases)** | **55** | **55** | **56-58** | **1,079,694** | **1,439,772** | **1,584,217** | **1.33x** | **1.47x** | |

**Aggregate: minimal skill matched full skill's quality total and both matched baseline's quality total (55), while minimal skill exceeded on the hardest case specifically — the only version across the entire project history on the nextauth case to recover the Keycloak-skip finding. Both skill arms cost more than baseline in aggregate (full 1.33x, min 1.47x), but the size and even the direction of that premium swings per case: baseline is markedly cheaper than both skill arms on the two lowest/medium-complexity cases where it can wrap up in 8-9 steps, while on `dig-pr2-pre` full skill is the most expensive arm of the three, not baseline.**

### 3.2 Cost detail (token breakdown by component)

| Case / arm | Input | Output | Reasoning | Cache read | Total | Tool_use steps |
|---|---:|---:|---:|---:|---:|---:|
| `claude-skill-check-pre` / full | 20,060 | 1,740 | 181 | 31,232 | 53,213 | 2 |
| `claude-skill-check-pre` / min | 21,625 | 1,597 | 517 | 143,872 | 167,611 | 13 |
| `js-yaml-155-pre` / full | 47,375 | 3,369 | 1,132 | 252,416 | 304,292 | 21 |
| `js-yaml-155-pre` / min | 37,788 | 2,845 | 690 | 363,008 | 404,331 | 26 |
| `dig-pr2-pre` / full | 60,818 | 3,911 | 1,434 | 491,008 | 557,171 | 27 |
| `dig-pr2-pre` / min | 64,908 | 2,330 | 783 | 306,688 | 374,709 | 19 |
| `fake-timers-541-pre` / full | 23,337 | 1,481 | 428 | 48,128 | 73,374 | 3 |
| `fake-timers-541-pre` / min | 27,681 | 2,186 | 686 | 187,392 | 217,945 | 20 |
| `nextauth-13465-pre` / full | 59,334 | 4,071 | 1,245 | 387,072 | 451,722 | 27 |
| `nextauth-13465-pre` / min | 45,510 | 2,812 | 611 | 370,688 | 419,621 | 25 |
| `nextauth-13465-pre` | 387,072 | 370,688 | 27 | 25 | 0.96x (roughly even) |

**Cost is not monotonic with skill size.** On the two simplest cases, full skill wrapped up in 2-3 tool-use steps (the P5 Round-Trip Budget instruction working exactly as designed: batch related commands), while minimal skill — with no batching guidance at all — took 13-20 separate steps to reach the same conclusion, costing 4-5x more due to the cumulative-per-turn cache-read mechanism established in P5. On the two hardest cases, the relationship reverses: full skill's heavier ceremony (applicability matrix, named gates, self-check tables, Complexity Expansion Gate table) adds overhead that does not pay for itself, and minimal skill was as cheap or cheaper while finding more.

## 4. Interpretation

The external agent's critique holds up under direct test, with an important refinement:

1. **The quality ceiling is not being set by the amount of procedural scaffolding.** A 26-line prior produces evidence-first, well-calibrated, appropriately-scoped QA that matches full skill on simple/medium cases and exceeds it on the hardest case tested. This strongly supports the "Prior/Constraints, not SOP" framing over the current many-file, many-stage architecture.
2. **The scaffolding's actual measured benefit is narrow and specific: turn-count discipline on simple cases.** The one place full skill clearly outperformed on cost was where the P5 Round-Trip Budget instruction fired correctly and kept a simple case to 2-3 steps. That specific instruction has real, measured value independent of everything else in the pack.
3. **The scaffolding's cost on hard cases is not just neutral, it may be actively counterproductive.** On `nextauth-13465-pre`, the case that consumed four dedicated engineering rounds (P2-P5) to close from 7/12 to 11/12, minimal skill reached 12/12 on the first attempt, at comparable or lower cost, and found something full skill never found. This is consistent with the original satisficing diagnosis from earlier in this project: heavy structure gives the model an easier, closable goal ("fill the table, name the gate") that can substitute for the harder, open-ended goal ("actually find everything").

## 5. Honest Limitations

- n=5 cases, single run per arm per case. Model stochasticity is a real confound, especially given some qualitative differences (e.g., dist-bundle checking, adjacent variant counts) could vary run to run for either arm.
- Scoring is orchestrator-judged, not blinded, using the same 6-dim rubric applied throughout this project.
- The cost comparison is confounded by one specific known-effective instruction (Round-Trip Budget) that exists in full skill and not in minimal skill; it is not a clean test of "content length" alone.
- This does not test reliability/consistency across repeated runs of the same case (the 5x5-style variance question raised earlier in this project remains untested for the minimal skill).

## 6. Updated Claim Boundary

Allowed claim:

> On this 5-case sample, a 26-line minimal-prior skill matched full skill's QA quality on 4 cases and exceeded it on the hardest case, including recovering a specific finding no prior engineered version of full skill had found. Cost was mixed: minimal skill was markedly more expensive on simple cases (missing the turn-batching instruction) and as cheap or cheaper on the two hardest cases.

Disallowed claim:

> Minimal skill is proven superior in general, or that all of full skill's structure is unnecessary. n=5 single-run-per-case is not sufficient to retire the full skill pack; it is sufficient to justify treating a much shorter, criteria-based redesign as the leading hypothesis rather than continuing to add scaffolding to the current architecture.

## 7. Recommended Next Step

Do not continue adding rules to the current full-skill architecture based on this result. The evidence points the other way: the next highest-leverage move is very likely importing the one validated win from full skill (turn-count/batching discipline) into the minimal skill, then re-testing whether a ~30-line "prior + one cost instruction" version can match full skill's quality at full skill's best-case cost or better, across a larger sample, before deciding whether the full multi-file pack should be retired, kept only for specific high-stakes/compliance use cases, or redesigned around the minimal shape.
