# 2026-08-13 P6: Remove Overreach Instead of Adding a Rule

## 1. Purpose

Track A of `docs/p5-cost-and-calibration-20260813-results.md` found that on both calibration stress-test cases (`axios-7276-pre`, `date-fns-2329-pre`), baseline outperformed the skill because baseline improvised a minimal, safe, direct-runtime probe (`node -e "..."`) when the project's own configured test command was unavailable, while the skill-guided route stopped at `BLOCKED`.

The initially proposed fix was to add a new rule instructing the QA subagent to write an inline probe when tooling is missing. The user rejected this: baseline already does this naturally, unprompted, on its own. Adding a specific mandated technique would be a prosthetic bolted onto a limb the model was never missing — the real problem must be that something in the skill's existing wording was suppressing a capability the model already has.

## 2. Root Cause: Over-Narrow "Existing"

Grepping the pack for the operative constraint found three places using "existing" in a way that reads, plausibly, as "only the project's own pre-configured commands/scripts," not "any safe, already-available way to get evidence":

| File | Original wording | Problem |
|---|---|---|
| `qa-skill/qa-execute/SKILL.md` | "use only the project's existing commands and tools" | Reads as "only package.json-defined scripts," excluding directly invoking the already-installed language runtime (`node`, `python`) against unmodified source. |
| `qa-skill/qa-lite/SKILL.md` | "Execute only existing safe local verification methods" | Same narrowing. |
| `qa-skill/references/evidence-guide.md` | "Missing runners...are environment or tooling blockers. Classify them as `BLOCKED`" | States the failure mode but never mentions that a direct-runtime alternative might still exist; reads as "runner missing -> stop here." |

None of these were wrong in intent (they correctly forbid installing dependencies, forcing an unrelated stack like Playwright onto a project that doesn't use it, or mutating the product). But the wording was broad enough to also suppress a completely safe, zero-install, zero-mutation technique baseline uses by default.

## 3. Fix: Subtractive Clarification, Not a New Rule

Edited the three files above to remove the accidental narrowing, without prescribing a specific technique:

- `evidence-guide.md`: added one clarifying paragraph stating that a missing project-configured runner is not automatically the end of verification — if the project's own language runtime is already present and the unmodified source can be exercised directly and safely (no install, no mutation, no network, no generated test), that direct invocation is itself an existing safe local verification method. Explicitly: "do not default to `BLOCKED` the moment a project-configured script or test command fails."
- `qa-execute/SKILL.md`: reworded the precondition-check step so "the project's own language runtime" is stated as equally valid to a project-defined script, referencing the evidence guide.
- `qa-lite/SKILL.md`: same clarification added to the Lite execution step.

This does not tell the model *how* to verify (no mandated script, no required tool) — it only removes wording that was accidentally read as forbidding a technique the model already uses on its own.

Pack tests: `49/49` passing after the edit (no new tests added; this is a wording clarification, not a new contract requiring its own anchor test at this time).

## 4. Validation: Re-ran the Two Cases That Exposed the Problem

Fresh workspaces (`qa-skill-v2`), qa-skill arm only (baseline unchanged, not re-run since baseline behavior wasn't the thing being fixed).

### `axios-7276-pre`

The report now runs a direct Node probe against unmodified `settle.js`/`AxiosError.js`, exercising both the failing cases (`200`, `301`, `600` -> `undefined`) and positive controls (`404` -> `ERR_BAD_REQUEST`, `500` -> `ERR_BAD_RESPONSE`) with real captured output — matching baseline's approach almost exactly. It also explicitly separates "full test suite `BLOCKED`" from "bounded direct evidence still obtained," which is precisely the distinction that was previously collapsed into a single `BLOCKED`.

### `date-fns-2329-pre`

The report now tests **both** DST transition directions with real `TZ=America/New_York` runtime probes — spring-forward (`2h` instead of correct `1h`) and fall-back (`0h` instead of correct `1h`, the more severe bug that was previously missed entirely) — plus a day-level positive control. It also correctly escalated from a Lite-leaning read to `Profile Decision: FULL` specifically because "scoped verification depends on runtime/TZ behavior," which is itself a sign the exploration reasoning is working as intended.

### Score (same 6-dimension rubric, 0-12, orchestrator-scored)

| Case | Baseline | Skill (P5, before fix) | Skill (v2, after fix) |
|---|---:|---:|---:|
| `axios-7276-pre` | 12 | 11 | **12** |
| `date-fns-2329-pre` | 12 | 10 | **12** |

Both cases now score identically to baseline. The 1-2 point gaps from the P5 report are fully closed on this stress test.

## 5. What This Confirms

The user's diagnosis was correct and more precise than the orchestrator's first-pass fix proposal. The pattern across this entire benchmark history (P1 through P5) has repeatedly been: a rule written for a good reason (prevent scope creep, prevent risky commands, prevent overclaiming) ends up worded broadly enough to also suppress ordinary competent behavior the model would otherwise produce unprompted. The correct response each time has been to **find and narrow the overreaching rule**, not to **add a new rule compensating for the capability the overreach removed**. This is the same shape of fix as P4 (Risk Surface Exploration removed the "no scope expansion" overreach that was suppressing execution-time risk discovery) and P3 (removed the ambiguity that allowed delegation to substitute for same-session execution) — this round applied the identical principle to verification-method choice specifically.

## 6. Updated Claim Boundary

Allowed claim:

> Removing three instances of an accidentally over-narrow "existing" restriction (not adding any new mandated technique) fully closed the gap found in the P5 calibration stress test: both `axios-7276-pre` and `date-fns-2329-pre` now score `12/12`, matching baseline exactly, by restoring the model's own default behavior of improvising a safe direct-runtime probe when a project's configured test command is unavailable.

Disallowed claim:

> This fix generalizes to all "existing"/"only" wording elsewhere in the pack without checking each instance, or that `BLOCKED`-for-tooling is now eliminated everywhere (Prisma/NextAuth still had genuine `BLOCKED` findings for checks that a direct-runtime probe realistically cannot substitute for, such as full DB-backed provider-matrix execution — this fix targets function-level, dependency-free verification specifically, not every missing-tooling scenario).

## 6.5 Token Follow-Up: `todowrite` Exclusion (Inconclusive, Deprioritized)

Separate from the "existing"-wording fix above, per-step analysis of `axios-7276-pre` (v2 run) found 4 separate `todowrite` calls contributing to its step count, alongside 2 wasted retries fixing PowerShell quoting for the inline Node probe. Since `cache.read` cost is cumulative per turn, cutting step count has an outsized effect. A one-line exclusion was added to `using-qa/SKILL.md`: the QA subagent does not need a todo/checklist tool during a QA run, since the Markdown report is the authoritative progress record; explicitly framed as not carrying over a general-coding-task habit that has no QA value.

A single follow-up validation run (`qa-skill-v3`, fresh workspace, same case) did **not** show the expected improvement: `todowrite` calls went from 4 (v2) to 5 (v3), total steps went from 16 to 27, and `cache.read` went from 386,048 to 491,008 — worse, not better. The correct `FAIL` conclusion and evidence quality were preserved, so this did not regress correctness, only cost.

Given n=1 per version (both v2 and v3 are single runs, and LLM tool-use habits are stochastic), this single data point cannot distinguish "the exclusion wording is too soft to override an ingrained habit" from "ordinary run-to-run variance." Per explicit user direction, this thread is being deprioritized rather than investigated further: token cost is a secondary concern relative to establishing a genuine differentiation advantage (see companion note below). The `using-qa` edit is left in place since it is harmless and directionally correct, but it should not be treated as a validated cost fix.

## 7. Next Steps

1. Re-run `prisma-21678-pre` and `nextauth-13465-pre` under this same fix to see whether any of their remaining `BLOCKED` findings (e.g., `transaction-manager.test.ts` via `jest`) could similarly be converted into direct evidence via a safe inline probe, or whether those specific checks genuinely require the full dependency/DB stack and `BLOCKED` remains correct there.
2. Before adding any further rule anywhere in the pack, first ask the same question this round answered: is baseline already doing the desired thing unprompted? If so, look for an existing overreach to narrow before writing a new instruction.
3. Consider a lightweight audit pass over the remaining "only"/"existing"/"do not" phrasings across the pack (`qa-plan`, `qa-conclude`, `references/*.md`) for the same failure shape, rather than waiting for each one to surface via a losing benchmark case.
