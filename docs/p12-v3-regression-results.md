# 2026 P12: v3 Regression Verification (prior-style skill + full-qa entry) 5-case

## 1. Purpose

Regression check of the current global `qa-skill` after the full-project QA entry layer
(`references/full-qa.md`) and the scope-confirm hint were added. Goal: confirm bounded-QA
core quality did not regress versus the P8 prior-redesign run (P8 quality ~59; baseline 55),
and that the current agent definition loads the new skill (not the archived old pack).

This is a regression run, not a new-capability test. It only exercises bounded QA; full-project
mode was not exercised.

## 2. Setup

- Skill: `C:\Users\lhw\.config\opencode\skills\qa-skill\` (confirmed new prior; `references/`
  contains `full-qa.md`, `using-qa.md`, `qa-memory.md`; no `qa-skill-old-backup` in the skills path).
- Orchestrator agent: `qa` (`mode: all`) at `~\.config\opencode\agents\qa.md`.
- opencode: `1.18.18`; model `cpa/gpt-5.5`.
- Runner: `C:\Users\lhw\AppData\Local\Temp\opencode\qa-v3-verify\run-qa-v3.mjs`
  (spawns opencode `run --agent qa --format json --model cpa/gpt-5.5 --auto --dir <ws> <prompt>`,
  captures stdout to `opencode-events.jsonl`, extracts final report, records token/marker stats).
- Outputs per case: `C:\Users\lhw\AppData\Local\Temp\opencode\qa-v3-verify\<caseId>\`.

### 2.1 Runner-marker bug found and fixed mid-run (does not affect model behavior)

The first smoke run reported `newSkillPath=false` and `oldSubskills=true`, which looked like an
old-skill load. Inspection of the raw event stream showed this was a false alarm in the runner's
detection regex, not a real load problem:

- The `skill` tool event carried `metadata.dir = ...\skills\qa-skill` and loaded content beginning
  "This is a QA *prior*, not a procedure" plus the newly-added full-qa line -> the new skill was in
  fact loaded.
- `oldSubskills=true` matched the new skill's own prose references to `references/using-qa.md` /
  `qa-memory.md`, not old pipeline sub-skills.
- Token totals were undercounted because the event type is `step-finish` (hyphen) with
  `part.tokens.total` and nested `cache.read`, not `step_finish` / `cache_read`.

The runner's marker/token logic was corrected to read structured events (skill tool `metadata.dir`,
`step-finish` tokens) instead of regex over prose, then the captured smoke data was recomputed with
zero additional model cost. All markers then read correctly (see section 3).

## 3. Facts (per case)

All five workspaces are pre-fix snapshots (bug present). nextauth workspace HEAD verified as
`1116034334c63db84de632d076a8fb0ad8bcec8e` (same pre-fix commit P8 used).

| Case | Snapshot | Overall | newSkill | oldBackup | oldSub | oldSections | facet | exit |
|---|---|---|---|---|---|---|---|---|
| fake-timers-541-pre | pre-fix | FAIL | true | false | false | false | 0 | 0 |
| claude-skill-check-pre | pre-fix | FAIL | true | false | false | false | 0 | 0 |
| js-yaml-155-pre | pre-fix | FAIL | true | false | false | false | 0 | 0 |
| dig-pr2-pre | pre-fix | FAIL | true | false | false | false | 0 | 0 |
| nextauth-13465-pre | pre-fix | FAIL | true | false | false | false | 0 | 0 |

Evidence per case (all first-hand; no "looks correct"):

- fake-timers: `node -e` probe using a temp in-memory stub for the absent `@sinonjs/commons`;
  reproduced `requestIdleCallback` firing during `tick(1)` observing `now=20`; adjacent normal
  `setTimeout` regression control; source lines in `src/fake-timers-src.js`. `mocha` absent -> did
  not install; used runtime probe.
- claude-skill-check: `python -c` probe; reproduced off-by-one lower bound (`name='a'` len1 ok=False
  E102, len2 ok=True, len64 ok=True, len65 ok=False) plus description-length bounds (19/20/1024/1025);
  ran 16 existing test functions via manual invocation. `pytest` absent -> did not install.
- js-yaml-155: `node -e` probe; 4-variant adjacent control isolating `!!null` empty-scalar
  `TypeError: Cannot read properties of null` vs working `!!null null` / `null` / `~`; oracle inferred
  from git history (commit e89db06), explicitly labeled inferred; source `lib/js-yaml/type/null.js`.
  `mocha`/`jshint` absent -> did not install.
- dig-pr2: two probes (canonical lib `validateProject` + scaffolded vendored `dig-nft.mjs validate`)
  both reproduced a manifest with a missing `metadata_uris` target passing validation; ran
  `node --test "test/*.js"` -> 187 passed / 0 failed; source `SPEC.md:524-526`, `lib/nft-cli.js:231-238`.
- nextauth: reproduced stale-session race via a state-machine probe
  (`race_result STALE_SESSION_RESURRECTED`); source `packages/next-auth/src/react.tsx` lines 347-367,
  414-442. `vitest`/`node_modules` absent -> did not install; used runtime probe.

### 3.1 Token / step summary

`total = input + output + reasoning`; `cacheRead` is listed separately.

| Case | input | output | reasoning | cacheRead | total | toolUse | facet |
|---|---:|---:|---:|---:|---:|---:|---:|
| fake-timers-541-pre | 57418 | 3328 | 1178 | 435200 | 61924 | 24 | 0 |
| claude-skill-check-pre | 27195 | 1917 | 652 | 103424 | 29764 | 11 | 0 |
| js-yaml-155-pre | 33200 | 2426 | 750 | 258560 | 36376 | 23 | 0 |
| dig-pr2-pre | 58104 | 2914 | 984 | 497152 | 62002 | 25 | 0 |
| nextauth-13465-pre | 31664 | 1832 | 1064 | 275968 | 34560 | 18 | 0 |
| Total | | | | | 224626 | | 0 |

### 3.2 Other observed facts

- Verdict correctness: 5/5 FAIL, each matching its pre-fix snapshot (bug present -> FAIL correct).
- First-hand evidence: 5/5 (commands run, output pasted, behavior reproduced, source located).
- Claim/product decoupling: 0/5 (only the single `Overall Status:` line is fixed format; no report
  declared a section/matrix it did not produce).
- Read-only: 5/5 held. Four cases hit missing test tooling (pytest / mocha / vitest / node_modules /
  @sinonjs/commons) and all improvised runtime probes rather than installing; no edit-product-file or
  install attempt, no permission denial recorded.
- qa-facet dispatch: 0/5 (all covered serially in one session). P8 dispatched 1 facet on nextauth;
  this run did not -> run-to-run variance, coverage preserved.

### 3.3 False-positive control (nextauth post-fix)

The 5 cases above are all pre-fix snapshots, so a skill that blindly returned FAIL would still
score 5/5. To test the opposite failure mode (wrongly failing FIXED code), a post-fix nextauth
snapshot was built and QA'd:

- PR #13465 is OPEN (not merged to main); its head is `e7a32ba19ce4869437f460b30c69dec750adb63d`
  on branch `fix/client-session-race`. The fix adds `AbortController` / `abortFetches` guards to
  `_getSession` in `packages/next-auth/src/react.tsx` so a stale fetch resolving after signOut is
  aborted and cannot resurrect the session.
- A clone was checked out to that head (guard confirmed present via grep: `abortFetches`,
  `AbortController`). No dependencies installed, no build.
- Same runner/agent/model. Result:

| Snapshot | HEAD | Overall | Evidence |
|---|---|---|---|
| nextauth pre-fix | `1116034...` | FAIL | reproduced the stale-session race |
| nextauth post-fix | `e7a32ba1...` | PASS | probe shows the guard aborts the stale result (no resurrection) |

The post-fix PASS was evidence-backed, not "code looks fixed": vitest/node_modules were absent so
QA did not install; it ran an equivalent local Node probe of the shared-AbortController / current-
controller pattern and observed `{"finalApplied":true,"staleApplied":false,"session":null,"abortCleared":true}`,
i.e. the stale result is dropped after the signed-out state is applied. newSkillPath true, oldBackup
false, facet 0, read-only held (no install/deny). Token total ~498k (cacheRead 438784), toolUse 25.

Conclusion (fact): on the same case, pre-fix -> FAIL and post-fix -> PASS, both first-hand. The skill
distinguished the bug from its fix rather than reflexively failing. No false positive observed on
this one control (n=1).

## 4. Comparison vs baseline (P8 baseline arm final reports)

Baseline reports read from `...\cases\<case>\artifacts\baseline\final-report.md`
(nextauth baseline lives under `p3m\artifacts\nxa-*`, not read this round).

| Case | Baseline verdict | v3 verdict | Stronger side |
|---|---|---|---|
| fake-timers-541-pre | Conditional PASS (static) | FAIL (dynamic repro) | v3 (baseline gave up on dynamic and was optimistic) |
| claude-skill-check-pre | Fail | FAIL | v3 slightly broader (adds 64/65 + description bounds + 16 tests); ~tie |
| js-yaml-155-pre | Fail | FAIL | tie (same root cause, same probe method) |
| dig-pr2-pre | Fail (4 findings, 3 test runs) | FAIL (1 core finding, 187 tests) | baseline (broader coverage) |
| nextauth-13465-pre | (P8 recorded PASS, labeled inferred) | FAIL (dynamic repro) | baseline text not read; not compared |

Notes:

- fake-timers: the baseline report gave a **Conditional PASS** based on static inspection after its
  probe failed on the missing `@sinonjs/commons` dependency (it verified the `jump(0)` no-timers path
  only). v3 stubbed the missing dependency, ran a real probe on the `requestIdleCallback` path, and
  reproduced a real miscalibration bug -> FAIL. Different sub-scenario, but v3's dynamic reproduction
  is stronger than baseline's static give-up, and v3's verdict is the more accurate one for a pre-fix
  snapshot.
- dig-pr2: this is the one case where baseline was broader (four Must-Fix findings across lib /
  vendored template / pinned tests / spec, plus 187+60+probe test runs). v3 correctly FAILed on a
  different-but-valid contract defect (validation accepts a missing metadata file) with two probes and
  187 tests, but with less breadth than baseline this round. Depth variance, not a wrong verdict.
- nextauth: v3 replaced P8's inferred PASS with a first-hand reproduced FAIL on the same pre-fix
  commit. For a pre-fix snapshot FAIL is the correct call; evidence strength (real repro) exceeds an
  inferred PASS.

## 5. Interpretation (facts, not a ship decision)

- No regression observed versus P8: 5/5 correct evidence-backed verdicts, read-only mechanism held,
  new skill confirmed loaded, template-decoupling absent - the same properties P8 reported.
- One clear improvement over baseline (fake-timers): v3 kept trying runtime probes past a missing
  dependency instead of falling back to an optimistic static Conditional PASS - the exact
  "try-runtime-before-BLOCKED" behavior P8 valued.
- One case weaker than baseline in depth (dig-pr2): fewer findings than the baseline report, though
  the verdict is still correct and evidence-backed. Consistent with P8's stated n=1 depth variance.

## 6. Honest limitations

- n=1 single run per case; no repeat-run variance measured. dig-pr2's depth dip shows single-run
  depth does vary. Evidence supports "no regression seen," not "statistically stable improvement."
- Scoring here is qualitative (verdict correctness + evidence presence + read-only + load check),
  not the P8 6-dimension 0-12 rubric re-applied blind.
- nextauth baseline text was not re-read this round, so its row is a verdict-level note only.
- Full-project QA mode (`full-qa.md`) and cross-run `.qa/` memory were not exercised here; they remain
  untested end-to-end (as already noted in the READMEs).
- The task brief labeled nextauth "expected PASS," but the workspace is the pre-fix commit
  `1116034...`; FAIL is correct for that snapshot. A true false-positive check would require a
  separate post-fix nextauth workspace, which was not run.

## 7. Artifacts

- Per-case: `C:\Users\lhw\AppData\Local\Temp\opencode\qa-v3-verify\<caseId>\`
  (`opencode-events.jsonl`, `final-report.md`, `terminal.json`).
- Summary: `C:\Users\lhw\AppData\Local\Temp\opencode\qa-v3-verify\run-summary.json`.
- Runner: `C:\Users\lhw\AppData\Local\Temp\opencode\qa-v3-verify\run-qa-v3.mjs`.
