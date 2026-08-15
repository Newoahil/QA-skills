# 2026-08-14 P8: Prior-Redesign (141-line skill) 5-case Verification

## 1. Purpose

Following the multi-session design discussion that reframed the skill from an SOP (41 files, 3917 lines) into a **QA Prior** (what a trustworthy verdict must establish, the boundaries, where to keep exploring — not ordered steps), a new skill was written from scratch and verified against the same 5 cases used in P7's 3-arm test.

This round answers: does the redesigned prior hold quality against baseline / old-full / old-min, does its orchestration and mechanism-level read-only enforcement work, and does the "20% template-compliance / claim-vs-product decoupling" failure disappear.

## 2. What was built

Three files, 141 lines total (vs old 3917):

| File | Lines | Role |
|---|---:|---|
| `SKILL.md` | 77 | Six-stage QA prior (requirement analysis → plan → evidence → verdict → report → close-out) as a *thinking framework*, not a pipeline. Only mandatory format = one `Overall Status:` line. Includes a soft "suggested shape" for hand-off, explicitly non-mandatory. |
| `agents/qa.md` | 33 | Orchestrator primary agent. `edit: deny` + bash blacklist (install/push/reset/checkout denied) + `webfetch/websearch: deny` + `task` limited to `qa-facet` only. Read-only enforced by mechanism, not prose. |
| `agents/qa-facet.md` | 31 | Read-only, hidden subagent for parallel facet/recon investigation. `edit: deny` + `task: deny`. Returns findings *with evidence*. |

Key design decisions carried in from the design sessions:
- Six STLC-aligned stages as concerns to satisfy, revisitable, not a one-way flow.
- Reconstruct the oracle first; classify bug-fix vs new-requirement; build a diff-anchored "commitment list" to fight long-context drift.
- Missing authoritative oracle → infer + label, don't block; PASS allowed on reliable inference, `NEEDS_HUMAN_REVIEW` when the correct standard itself can't be inferred.
- Try direct-runtime probe before `BLOCKED`; lightest-equivalent verification before heavy e2e.
- Orchestrator dispatches read-only facet sub-agents **only by risk** (default: don't split); evidence stays first-hand; reconciliation verifies each load-bearing PASS/FAIL's evidence, never concatenates conclusions.
- Only hard format is the single `Overall Status:` line.

## 3. Method

Reused P7's 5 cases and harness (`opencode run --format json --model cpa/gpt-5.5`), one run per case, delegated to the `fixer` specialist. New skill triggered via `--agent qa` (not the old "Load using-qa" prompt). nextauth workspace reused from P7's `nxa-full`.

### 3.1 A load-resolution bug found and fixed mid-verification

First attempt loaded `qa-skill-old-backup` instead of the new skill: opencode indexes skills by frontmatter `name`, and the renamed backup still declared `name: qa-skill`, causing a name collision that resolved to the backup (old Applicability Matrix / Conclusion Gate / Self-Check appeared in reports). Fix: moved the backup out of `skills/` entirely (to `_skill-archive/`). A single-case smoke test then confirmed the new skill loaded (no old sub-skills, `Overall Status:` present, no matrix/gate/self-check). All 5 runs re-executed after the fix.

## 4. Results

### 4.1 Quality (orchestrator-scored, 6-dim rubric 0-12; all 5 read in full)

| Case | Baseline | Old Full | Old Min | **New prior** | Verdict correct? |
|---|---:|---:|---:|---:|---|
| claude-skill-check-pre | 11 | ~11 | ~11-12 | **~12** | ✓ FAIL — direct Python probe, 9 boundary variants incl. 64/65-char, plus regression-test drafts |
| js-yaml-155-pre | 12 | ~11 | ~11-12 | **~12** | ✓ FAIL — real `node`, 3-variant adjacent control isolating exact trigger |
| dig-pr2-pre | 12 | ~11 | ~11 | **~12** | ✓ FAIL — vendored-template drift + stale spec + tests pinning wrong contract; ran 187+44 tests |
| fake-timers-541-pre | 8 | ~11 | ~10-11 | **~11** | ✓ FAIL — Node probe reproduces crash, located to source line |
| nextauth-13465-pre | 12 | ~11 | ~12 | **~12** | ✓ PASS — dispatched 1 `qa-facet`, line-by-line source + temp probe for fail-closed, incl. adjacent OK-session control |
| **Total** | **55** | **55** | **56-58** | **~59** | 5/5 correct |

### 4.2 Cost (token totals)

| Case | Baseline total | New total | New / base | tool_use steps | qa-facet |
|---|---:|---:|---:|---:|---|
| claude-skill-check-pre | 116,663 | 175,333 | 1.50x | 14 | 0 |
| js-yaml-155-pre | 279,900 | 246,236 | 0.88x | 19 | 0 |
| dig-pr2-pre | 283,796 | 332,904 | 1.17x | 17 | 0 |
| fake-timers-541-pre | 137,884 | 185,151 | 1.34x | 16 | 0 |
| nextauth-13465-pre | 261,451 | 609,815 | 2.33x | 29 | 1 |
| **Total** | **1,079,694** | **1,549,439** | **1.44x** | | |

## 5. Interpretation

1. **Quality is the project's best to date (~59), while the skill shrank to 3.6% of its former size.** All 5 verdicts correct, every one backed by first-hand evidence (ran commands, pasted output, located source lines). Nothing relied on "looks correct."
2. **The design-contract behaviors fired self-emergently, not by template-filling.** Adjacent-variant controls (js-yaml 3-variant, claude-skill 64/65 boundary, nextauth OK-session), try-runtime-before-BLOCKED (all 4 tool-missing cases improvised a direct runtime probe rather than giving up — the exact behavior that lost to baseline in P5/P6), infer-and-label under missing oracle (nextauth explicitly "inferred from git history" then PASS), and risk-driven orchestration (only the one high-complexity case dispatched a facet; simple cases did not) all appeared without any mandatory section forcing them.
3. **The 20%-compliance / claim-vs-product decoupling problem is gone.** All 5 reports carry the single `Overall Status:` line; the rest is free-form and length-scaled to complexity. No report declared a matrix/gate it did not produce — because none is required.
4. **Read-only was mechanism-enforced.** No edit tool calls, no install attempts across all runs; the several hundred lines of old anti-delegation prose were replaced by agent-permission config.

## 6. Honest limitations

- n=5, single run per arm per case; model stochasticity is a real confound (adjacent-variant counts, facet dispatch, could vary run-to-run).
- Scoring is orchestrator-judged, not blinded, same 6-dim rubric as the rest of the project.
- Cost on the two simplest cases is still ~1.5x baseline — the P7-identified "no turn-batching instruction" gap persists; not addressed in this round.
- Reliability/consistency across repeated runs of the same case (the 5x5 variance question) remains untested for the new prior.

## 7. Claim boundary

Allowed:

> On this 5-case sample, a 141-line prior-style skill matched or slightly exceeded every prior arm (baseline 55, old-full 55, old-min 56-58; new ~59), produced correct evidence-backed verdicts on all five, self-emergently exhibited the specific behaviors previously engineered in over five rounds (adjacent controls, runtime-probe-before-BLOCKED, risk-driven orchestration), and eliminated the template-decoupling failure — at 3.6% of the old skill's size and ~1.44x baseline cost (comparable to old-min).

Disallowed:

> That the new prior is proven superior in general. n=5 single-run is not sufficient for that. It is sufficient to adopt the prior-style skill as the working production baseline going forward and to retire the old 41-file SOP pack from the default route.

## 8. State after this round

- New skill is live at global `skills/qa-skill`; old full pack archived at `_skill-archive/qa-skill-old-backup` (retrievable, no longer scanned). `agents/qa.md` + `agents/qa-facet.md` registered.
- Reports at `C:\Users\lhw\AppData\Local\Temp\opencode\qa-v2-verify\<case>\final-report.md`.
- Source at `C:\works\QA-skill-new\` (SKILL.md + agents/).
- Not yet done: larger-sample / repeat-run validation; turn-batching cost instruction; full-test-sedimentation (cross-run) capability — next課題.
