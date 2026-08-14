# 2026-08-13 P4 Exploration-First Redesign Validation Results

## 1. Purpose

`docs/p3-no-delegation-hardening-20260813-results.md` concluded that the process-integrity problem (delegation bypass) was fixed, but report depth on the two high-complexity cases still trailed baseline (`-1`, `-2`), and an independent strategic diagnosis (oracle) found a specific root cause: the Full route locks the risk register early (right after a shallow preflight/diff/intake pass) and then `qa-execute` explicitly forbade "expanding scope," which suppressed incorporating risks discovered while actually reading the code. The user confirmed this framing directly: the skill should help the agent avoid missing things, not treat an early glance as sufficient.

P4 redesigns the Full route around that diagnosis. Per the current role split, this round's skill authoring was done directly by the orchestrator (not delegated to `fixer`); only the validation run execution was delegated to a `gpt-5.5` background specialist.

## 2. Changes Made

1. `qa-skill/qa-plan/SKILL.md`: inserted a new required stage, **Risk Surface Exploration**, between `Inputs and Assumptions` and `Risk Analysis`. It requires a free-form, unstructured scratch pass over the actual affected source and adjacent code paths before any risk gets compressed into the structured table. For any mandatory Full trigger, the exploration must reach that trigger's domain shape (state transitions/ordering/depth for transaction/rollback; full event timeline and entry points for auth/session race; interleavings/retries/recovery for concurrency; named providers/environments for a provider matrix; write/read/invalidate/event ordering for cache/DB/event side effects), not stop once the trigger is merely confirmed to apply. `Risk Analysis` is now explicitly framed as a compression of that scratch list; a dropped item needs a stated reason.
2. `qa-skill/qa-execute/SKILL.md`: added a new **Risk Discovery During Execution** section that splits what used to be one rule ("do not expand scope") into two: off-target scope expansion (different feature/component — still forbidden) versus a risk discovered within the same approved target while executing (now required to be added to the risk register with `Discovered during execution: yes`, verified like any planned risk, not suppressed).
3. `qa-skill/templates/qa-report.md`: added a `Risk Surface Exploration` section before `Risk Analysis`, added a `Discovered during execution` column to the Risk Analysis table, reframed the Full risk budget ("3-7") as a floor and not a ceiling for mandatory-Full-trigger cases, and added a new Report Quality Self-Check row for risk-surface completeness.
4. `qa-skill/references/qa-report-quality-rubric.md`: synced the same requirement into dimension 2 (risk-chain awareness): the risk table must be derived from a prior exploration pass, and execution-discovered risks must not be dropped as "scope expansion."
5. `qa-skill/qa-conclude/SKILL.md`: added a reconciliation check before the Conclusion Gate — a risk register that exactly matches the initial plan despite execution clearly touching unanticipated code paths is now a named rubric anti-pattern that keeps the gate `BLOCKED` until resolved or justified.
6. `tests/qa-skill-pack.test.mjs`: added `P4-DEPTH-023`, a semantic anchor test covering all five files above.

Pack validation:

```text
node --test tests/qa-skill-pack.test.mjs
49 tests
49 pass
0 fail
```

Global skill synced to `C:\Users\lhw\.config\opencode\skills\qa-skill` before the validation run.

## 3. Validation Run

Execution (cloning, running `opencode`, collecting artifacts) was delegated to a `fixer` background specialist; this report covers orchestrator-side acceptance and scoring only.

Same two high-complexity cases as P1.1/P2/P3, fresh `q4` workspaces. New arm: `qa-skill-p4`.

## 4. Process Compliance (Confirmed, Not Just Claimed)

| Case | Skill loads (in order) | `task` delegation calls |
|---|---|---|
| `prisma-21678-pre` | `using-qa`, `qa-triage`, `qa-plan`, `qa-execute`, `qa-conclude` | **None** |
| `nextauth-13465-pre` | `using-qa`, `qa-triage`, `qa-plan`, `qa-execute`, `qa-conclude` | **None** |

The P3 no-delegation fix held under P4: both runs completed Full in the same session with no re-delegation.

Marker presence in both final reports: `Profile Decision: FULL`, `Risk Surface Exploration` section, at least one `Discovered during execution: yes` row, `QA Plan Gate`, `QA Conclusion Gate`, standalone `Overall Status:` line. `Report Quality Self-Check` is present in the NextAuth report but missing as a named section in the Prisma report (present in substance via inline conclusion text, but not the named section) — a minor, not fatal, format gap.

## 5. Quality (Orchestrator Scoring)

Rubric: 6 dimensions x 0-2 = 12 max, scored directly by the orchestrator from the final reports.

| Case | Baseline | P1.1 | P2 | P3 | P4 | P4 delta vs baseline |
|---|---:|---:|---:|---:|---:|---:|
| `prisma-21678-pre` | 12 | 9 | 11 | ~11 | 11 | -1 |
| `nextauth-13465-pre` | 12 | 7 | 10 | ~10 | 11 | -1 |

This is the first round where the skill-guided Full route lands within one point of baseline on **both** high-complexity cases, versus a 3-5 point gap in P1.1 and a 1-2 point gap in P2/P3.

### Prisma detail

The exploration pass surfaced genuinely deep coverage that prior rounds lacked: LIFO/multi-depth ordering across "awaited, unawaited, sibling, parent-child, and grandchild transactions," inner-commit-vs-outer-commit semantics, timeout/cancellation serialization, savepoint naming safety, and a full per-provider SQL syntax breakdown (Postgres/Neon vs MySQL/MariaDB/SQLite vs SQL Server). This matches or exceeds baseline's depth on these specific points.

Notably, the report also surfaced a finding **neither baseline nor any prior skill round found**: it located version tags bracketing the actual PR merge, ran `git diff` between them to inspect the real PR diff, then searched further git history and found a later commit (`fix: remove savepoint operations from the D1 adapter (#29499)`) — concrete, falsifiable evidence that the PR's own D1 adapter change was later judged unsafe and reverted. This was recorded as `Discovered during execution: yes` (`R8`), exactly the mechanism P4 was designed to enable.

Caveat: part of this depth may be attributable to the model successfully locating a real diff via git tag comparison in this run (a capability/luck factor, not solely the process redesign), not guaranteed to recur every run. The `-1` deduction reflects a minor rubric issue: one finding (`F2`) uses a non-canonical status label ("Unverified by runtime here, but material residual risk/finding") instead of one of the four canonical statuses.

### NextAuth detail

The report independently reproduced nearly all of baseline's race-variant breakdown — mount, focus/visibility, polling, cross-tab broadcast, and `signOut({redirect:false})`'s own call to `_getSession` — each with specific file/line citations. It also used the execution-discovery mechanism as designed: `R7` (`signOut({redirect:false})` itself performs an unguarded session fetch after signout) was recorded mid-execution as `Discovered during execution: yes`, not folded silently into the original plan.

Critically, this run also **fixed the P3 calibration regression**: P3 had misclassified this as `BLOCKED` because "no diff was present," even though this is intentionally a pre-fix snapshot QA target where absence of the fix is the expected finding. P4's prompt explicitly reminded the run of this, and the report correctly states "Snapshot type: pre-fix snapshot; absence of local diff is expected and not a blocker," then concludes `Overall Status: FAIL` — the same conclusion baseline reached.

The `-1` deduction reflects two specific items baseline had that this report did not: an explicit `signIn({redirect:false})` regression check, and the note about an existing skipped Keycloak signout test assertion.

## 6. Cost

| Case | Metric | Baseline | P2 | P3 | P4 | P4 vs baseline |
|---|---|---:|---:|---:|---:|---:|
| `prisma-21678-pre` | input tokens | 49,450 | 35,359 | 180,683 | 117,640 | 2.38x |
| `prisma-21678-pre` | cache read | 347,136 | 138,752 | 1,068,544 | 1,369,600 | 3.95x |
| `nextauth-13465-pre` | input tokens | 39,237 | 24,160 | 86,555 | 52,336 | 1.33x |
| `nextauth-13465-pre` | cache read | 218,112 | 150,016 | 580,096 | 603,136 | 2.77x |

Cost is still meaningfully higher than baseline, and did not clearly improve versus P3 (Prisma's cache read actually rose further). Cost was never the primary target of P4 — the redesign targeted depth, not efficiency — but this means the tradeoff is now "closer quality at 1.3x-4x the cost" rather than "worse quality at 3-7x the cost," which is a materially better position than P3, though still not a favorable one on cost alone.

## 7. Verdict

| Aspect | Verdict |
|---|---|
| Process compliance (no delegation) | Held. Confirmed via full tool-call sequence on both cases. |
| Report depth vs baseline | Materially closed. `-1` on both cases, versus `-3`/`-5` at P1.1 and `-1`/`-2` at P2/P3. |
| Execution-discovery mechanism | Working as designed. Both reports used `Discovered during execution: yes` for a genuine mid-execution finding, not a planned item. |
| Calibration regression from P3 | Fixed. NextAuth correctly reached `FAIL`, not `BLOCKED`, for the pre-fix snapshot. |
| Cost | Still high, not improved versus P3, and this was not the fix's target. |
| Unique value beyond baseline | Demonstrated once (Prisma D1 historical-regression finding), not yet repeatable evidence. |

n=2, single run per arm. This does not establish that Full route now reliably matches baseline on high-complexity QA in general — it establishes that the specific diagnosed mechanism (early risk-register lock-in + suppressed execution-time discovery) was a real, fixable contributor, and that fixing it closed most of the observed gap on these two cases.

## 8. Updated Claim Boundary

Allowed claim:

> P4's exploration-first redesign closed most of the previously observed high-complexity quality gap (from `-3`/`-5` at P1.1 down to `-1`/`-1` at P4) on the two tested cases, while preserving P3's process-compliance fix, and the execution-time risk-discovery mechanism worked as designed in both runs. Cost remains 1.3x-4x baseline and was not addressed by this change.

Disallowed claim:

> The QA Skill now reliably matches or exceeds baseline on high-complexity bounded Issue QA in general, or that cost is now acceptable.

## 9. Next Iteration Candidates

1. Expand the high-complexity sample beyond n=2 before drawing a durable conclusion; the current result is promising but not yet statistically meaningful.
2. Investigate cost: P4 did not reduce token spend versus P3 and increased it further on Prisma. If exploration-first is kept, the next question is whether the scratch-list exploration pass itself can be made more token-efficient without losing depth.
3. Standardize the two remaining specific gaps found (Prisma's non-canonical status label on `F2`; NextAuth's missing `signIn` regression check and existing-skipped-test note) as small, targeted rubric/checklist reinforcements rather than broad new rules, consistent with the P4 diagnosis that broad rule-adding without addressing sequencing was the original problem.
4. Re-run the same 5-case set from P1/P1.1 (not just the 2 high-complexity cases) to confirm the exploration-first change does not regress the previously-fixed medium-complexity cases (`dig-pr2-pre`, `claude-skill-check-pre`, `click-2730-pre`) or blow up their token cost disproportionately, since Lite was not touched by this round but Full-route cases within that 5-case set were.
